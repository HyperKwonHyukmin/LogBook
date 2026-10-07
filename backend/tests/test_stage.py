import pytest

from app import models
from app.ingest.inbox import ReadyItem, stage_item


def test_stage_folder(db, storage, make_user):
    make_user("A476854")
    d = storage.inbox / "3496_검토"
    (d / "model").mkdir(parents=True)
    (d / "model" / "a.bdf").write_text("GRID", encoding="utf-8")
    batch = stage_item(db, storage, ReadyItem("folder", "3496_검토", [d], "a476854"))
    assert not d.exists()
    assert (storage.staging / batch.key / "3496_검토" / "model" / "a.bdf").is_file()
    assert (batch.source, batch.original_name, batch.uploader, batch.uploader_guess) == \
        ("inbox", "3496_검토", "A476854", "A476854")
    assert db.query(models.Job).filter_by(type="process_batch", target_id=batch.id).count() == 1
    assert db.query(models.AuditLog).filter_by(action="BATCH_RECEIVED").count() == 1


def test_stage_loose_files_unknown_owner(db, storage):
    a, b = storage.inbox / "a.bdf", storage.inbox / "a.f06"
    a.write_text("1", encoding="utf-8")
    b.write_text("2", encoding="utf-8")
    batch = stage_item(db, storage, ReadyItem("loose", "a.bdf", [a, b], "z000000"))
    assert sorted(p.name for p in (storage.staging / batch.key).iterdir()) == ["a.bdf", "a.f06"]
    assert batch.uploader is None and batch.owner_account == "z000000"


def test_stage_rolls_back_on_failure(db, storage, monkeypatch):
    a, b = storage.inbox / "a.bdf", storage.inbox / "b.bdf"
    a.write_text("1", encoding="utf-8")
    b.write_text("2", encoding="utf-8")
    import app.ingest.inbox as mod

    real = mod.os.rename
    calls = {"n": 0}

    def flaky(src, dst):
        calls["n"] += 1
        if calls["n"] == 2:
            raise OSError("잠김")
        return real(src, dst)

    monkeypatch.setattr(mod.os, "rename", flaky)
    with pytest.raises(OSError):
        stage_item(db, storage, ReadyItem("loose", "a.bdf", [a, b], None))
    assert a.exists() and b.exists()
    assert db.query(models.Batch).count() == 0


def test_stage_compensates_when_db_work_fails_after_move(db, storage, monkeypatch):
    """파일 이동은 됐는데 그 뒤 배치 행 생성/감사 기록이 실패하면, 파일을 Inbox 로
    되돌리고 DB 는 변경 없이 그대로여야 한다(I2)."""
    a = storage.inbox / "a.bdf"
    a.write_text("1", encoding="utf-8")

    import app.ingest.inbox as mod

    def boom(*a_, **k_):
        raise RuntimeError("감사 로그 실패(시뮬레이션)")

    monkeypatch.setattr(mod.audit, "record", boom)

    with pytest.raises(RuntimeError):
        stage_item(db, storage, ReadyItem("loose", "a.bdf", [a], None))

    assert a.exists()
    assert db.query(models.Batch).count() == 0
    assert db.query(models.Job).count() == 0


def test_stage_accepts_already_prefixed_paths_from_watcher_scan(db, storage):
    """InboxWatcher.poll() 이 실제로 내놓는 형태 — os.scandir 결과라 이미 \\\\?\\ 접두된
    Path 다. to_long() 이 멱등이라 이중 접두 없이 그대로 옮겨져야 한다."""
    d = storage.inbox / "3496_검토"
    d.mkdir()
    (d / "a.bdf").write_text("GRID", encoding="utf-8")
    prefixed = type(d)("\\\\?\\" + str(d))
    assert str(prefixed).startswith("\\\\?\\")
    batch = stage_item(db, storage, ReadyItem("folder", "3496_검토", [prefixed], "a476854"))
    assert (storage.staging / batch.key / "3496_검토" / "a.bdf").is_file()
