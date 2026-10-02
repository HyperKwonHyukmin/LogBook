import os

import pytest

from app import jobs, models
from app.bdf.lbm import read_lbm
from app.convert.job import enqueue_convert, model_paths, requeue_entry_models, run_convert
from app.entries.locate import file_path
from app.storage.paths import to_long

MAIN = "BEGIN BULK\nINCLUDE 'mesh.bdf'\nINCLUDE 'mat.bdf'\nPSHELL,5,1,12.\nENDDATA\n"
MESH = ("GRID,1,,0.,0.,0.\nGRID,2,,1000.,0.,0.\nGRID,3,,1000.,1000.,0.\nGRID,4,,0.,1000.,0.\n"
        "CQUAD4,1,5,1,2,3,4\n")
MAT = "MAT1,1,206000.,,0.3\n"


def _write(db, storage, f, text: str | bytes):
    p = file_path(db, storage, f)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as fh:
        fh.write(text.encode() if isinstance(text, str) else text)


@pytest.fixture
def entry3(db, storage, make_entry_file):
    e, main = make_entry_file(name="main.bdf", kind="model", sha="a" * 64)
    _e, mesh = make_entry_file(entry=e, name="mesh.bdf", kind="model", sha="b" * 64)
    _e, mat = make_entry_file(entry=e, name="mat.bdf", kind="model", sha="c" * 64)
    for f, t in ((main, MAIN), (mesh, MESH), (mat, MAT)):
        _write(db, storage, f, t)
    return e, main, mesh, mat


def test_enqueue_only_models(db, make_entry_file):
    _e, bdf = make_entry_file(name="a.bdf", kind="model")
    _e2, pdf = make_entry_file(name="r.pdf", kind="report")
    assert enqueue_convert(db, bdf) and not enqueue_convert(db, pdf)
    db.commit()
    assert db.get(models.ModelSummary, bdf.id).state == "queued"
    assert [j.type for j in db.query(models.Job)] == ["convert_model"]


def test_convert_with_includes(db, storage, entry3):
    _e, main, mesh, mat = entry3
    run_convert(db, storage, main)
    s = db.get(models.ModelSummary, main.id)
    assert s.state == "done" and s.error is None and len(s.key) == 64
    assert s.counts["CQUAD4"] == 1 and s.bbox["max"] == [1000.0, 1000.0, 0.0]
    assert s.includes == ["mesh.bdf", "mat.bdf"] and s.missing == []
    lbm, png = model_paths(storage, s.key)
    assert os.path.exists(to_long(lbm)) and os.path.exists(to_long(png))
    with open(to_long(lbm), "rb") as fh:
        header, blocks = read_lbm(fh.read())
    assert blocks["quads"].shape == (1, 6)
    assert db.get(models.ModelSummary, mesh.id).state == "include"
    assert db.get(models.ModelSummary, mat.id).state == "include"
    ft = db.query(models.FileText).filter_by(file_id=main.id, locator="model").one()
    assert "CQUAD4 1" in ft.text and "PSHELL t12" in ft.text


def test_included_file_converted_later_stays_include(db, storage, entry3):
    _e, main, mesh, _mat = entry3
    run_convert(db, storage, main)
    run_convert(db, storage, mesh)
    assert db.get(models.ModelSummary, mesh.id).state == "include"
    assert db.query(models.FileText).filter_by(file_id=mesh.id, locator="model").count() == 0


def test_included_file_first_then_overridden(db, storage, entry3):
    _e, main, mesh, _mat = entry3
    run_convert(db, storage, mesh)              # 단독으로 먼저 변환됨
    assert db.get(models.ModelSummary, mesh.id).state == "done"
    run_convert(db, storage, main)              # 본 파일이 INCLUDE 하므로 include 로 바뀐다
    assert db.get(models.ModelSummary, mesh.id).state == "include"
    assert db.query(models.FileText).filter_by(file_id=mesh.id, locator="model").count() == 0


def test_missing_include_warns_and_requeue(db, storage, make_entry_file):
    e, main = make_entry_file(name="main.bdf", kind="model")
    _write(db, storage, main, "INCLUDE 'C:\\pc\\mesh.bdf'\nGRID,1,,0.,0.,0.\nGRID,2,,1.,0.,0.\nCROD,1,1,1,2\n")
    run_convert(db, storage, main)
    s = db.get(models.ModelSummary, main.id)
    assert s.state == "done" and s.missing == ["C:\\pc\\mesh.bdf"]
    assert any(w.startswith("include_missing") for w in s.warnings)
    db.query(models.Job).delete()
    db.commit()
    assert requeue_entry_models(db, e.id) == 1
    db.commit()
    assert db.query(models.Job).filter_by(type="convert_model", target_id=main.id).count() == 1


def test_no_elements_skipped(db, storage, make_entry_file):
    _e, f = make_entry_file(name="mat.bdf", kind="model")
    _write(db, storage, f, MAT)
    run_convert(db, storage, f)
    s = db.get(models.ModelSummary, f.id)
    assert (s.state, s.error) == ("skipped", "no_elements")


def test_drm_and_trash_and_size(db, storage, make_entry_file):
    _e, a = make_entry_file(name="a.bdf", kind="model")
    _write(db, storage, a, b"HHIDRMC" + b"\0" * 64)
    run_convert(db, storage, a)
    assert db.get(models.ModelSummary, a.id).error == "drm"
    _e, t = make_entry_file(status="trashed", name="t.bdf", kind="model")
    run_convert(db, storage, t)
    assert db.get(models.ModelSummary, t.id).error == "trashed"
    _e, big = make_entry_file(name="big.bdf", kind="model")
    big.size = 2 * 1024 ** 3
    db.commit()
    run_convert(db, storage, big)
    assert db.get(models.ModelSummary, big.id).error == "too_large"


def test_parse_error_fails_without_raising(db, storage, make_entry_file, monkeypatch):
    _e, f = make_entry_file(name="a.bdf", kind="model")
    _write(db, storage, f, MESH)
    import app.convert.job as job

    def boom(*a, **k):
        raise RuntimeError("파서 오류")
    monkeypatch.setattr(job, "build_model", boom)
    run_convert(db, storage, f)
    s = db.get(models.ModelSummary, f.id)
    assert s.state == "failed" and "파서 오류" in s.error


def test_missing_main_file_raises(db, storage, make_entry_file):
    _e, f = make_entry_file(name="nope.bdf", kind="model")
    with pytest.raises(OSError):
        run_convert(db, storage, f)


def test_staging_siblings_by_batch(db, storage, make_entry_file):
    e, main = make_entry_file(status="draft", name="main.bdf", kind="model")
    _e, mesh = make_entry_file(entry=e, name="mesh.bdf", kind="model")
    _write(db, storage, main, "INCLUDE 'mesh.bdf'\n")
    _write(db, storage, mesh, MESH)
    run_convert(db, storage, main)
    assert db.get(models.ModelSummary, main.id).state == "done"
    assert db.get(models.ModelSummary, mesh.id).state == "include"


def test_moved_during_read_raises_retryable(db, storage, make_entry_file, monkeypatch):
    """읽는 동안 확정(staging → vault)으로 파일이 옮겨졌으면 재시도 오류를 던져 새 위치에서 다시 돈다."""
    from sqlalchemy import update

    import app.convert.job as job

    _e, f = make_entry_file(name="m.bdf", kind="model")
    _write(db, storage, f, MESH)
    original = job.DeckReader.read

    def read_then_move(self, rel):
        out = original(self, rel)
        db.execute(update(models.File).where(models.File.id == f.id).values(rel_path="moved/m.bdf"))
        db.commit()
        return out
    monkeypatch.setattr(job.DeckReader, "read", read_then_move)
    with pytest.raises(job.FileMoved) as ei:
        run_convert(db, storage, f)
    assert isinstance(ei.value, OSError)
    s = db.get(models.ModelSummary, f.id)
    assert s is None or s.state != "done"


def test_memory_error_fails_without_retry(db, storage, make_entry_file, monkeypatch):
    import app.convert.job as job

    _e, f = make_entry_file(name="m.bdf", kind="model")
    _write(db, storage, f, MESH)

    def boom(self, rel):
        raise MemoryError()
    monkeypatch.setattr(job.DeckReader, "read", boom)
    run_convert(db, storage, f)
    s = db.get(models.ModelSummary, f.id)
    assert (s.state, s.error) == ("failed", "memory_error")


def test_include_over_budget_skipped_too_large(db, storage, make_entry_file, monkeypatch):
    import app.convert.job as job

    e, main = make_entry_file(name="main.bdf", kind="model")
    _e, mesh = make_entry_file(entry=e, name="mesh.bdf", kind="model")
    _write(db, storage, main, "INCLUDE 'mesh.bdf'\n")
    _write(db, storage, mesh, MESH)
    monkeypatch.setattr(job, "MAX_MODEL_BYTES", 40)
    run_convert(db, storage, main)
    s = db.get(models.ModelSummary, main.id)
    assert (s.state, s.error) == ("skipped", "too_large")


def test_id_out_of_range_fails_cleanly(db, storage, make_entry_file):
    _e, f = make_entry_file(name="m.bdf", kind="model")
    _write(db, storage, f, "GRID,1,,0.,0.,0.\nGRID,3000000000,,1.,0.,0.\nCROD,1,1,1,3000000000\n")
    run_convert(db, storage, f)
    s = db.get(models.ModelSummary, f.id)
    assert (s.state, s.error) == ("failed", "id_out_of_range")


def test_sol_truncated(db, storage, make_entry_file):
    _e, f = make_entry_file(name="m.bdf", kind="model")
    _write(db, storage, f, "SOL " + "X" * 40 + "\nCEND\nBEGIN BULK\n" + MESH)
    run_convert(db, storage, f)
    s = db.get(models.ModelSummary, f.id)
    assert s.state == "done" and s.sol == "X" * 20


def test_dropped_include_requeues_sibling(db, storage, entry3):
    """본 파일이 다시 변환되며 더는 INCLUDE 하지 않는 형제는 다시 변환 대기열로 간다."""
    _e, main, mesh, mat = entry3
    run_convert(db, storage, main)
    assert db.get(models.ModelSummary, mesh.id).state == "include"
    _write(db, storage, main, "BEGIN BULK\nINCLUDE 'mesh.bdf'\nPSHELL,5,1,12.\nENDDATA\n")  # mat.bdf 를 뺐다
    db.query(models.Job).delete()
    db.commit()
    run_convert(db, storage, main)
    assert db.get(models.ModelSummary, mat.id).state == "queued"
    assert db.query(models.Job).filter_by(type="convert_model", target_id=mat.id).count() == 1
    assert db.get(models.ModelSummary, mesh.id).state == "include"
    assert db.query(models.Job).filter_by(target_id=mesh.id).count() == 0


def test_requeue_keeps_previous_key_and_fingerprint(db, storage, make_entry_file):
    _e, f = make_entry_file(name="m.bdf", kind="model")
    _write(db, storage, f, MESH)
    run_convert(db, storage, f)
    key = db.get(models.ModelSummary, f.id).key
    enqueue_convert(db, f)
    db.commit()
    s = db.get(models.ModelSummary, f.id)
    assert (s.state, s.key) == ("queued", key)
    assert db.query(models.FileText).filter_by(file_id=f.id, locator="model").count() == 1
    from app.convert.job import mark_failed
    mark_failed(db, f.id, "공유 폴더 끊김")
    s = db.get(models.ModelSummary, f.id)
    assert (s.state, s.key) == ("failed", key)
    assert db.query(models.FileText).filter_by(file_id=f.id, locator="model").count() == 1
