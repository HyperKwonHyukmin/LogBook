import json
import os
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi import HTTPException

from app import models
from app.entries import service


def test_confirm_moves_to_vault_and_writes_metadata(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001", name="권혁민")
    b, e = setup_entry_with_files()
    service.confirm(db, storage, e, u)
    db.expire_all()
    e = db.get(models.Entry, e.id)
    year = datetime.now().year
    assert (e.status, e.vault_rel, e.confirmed_by) == ("confirmed", f"{year}/{e.entry_id}", "A100001")
    base = storage.vault / str(year) / e.entry_id
    assert (base / "files" / "3496_검토" / "model" / "a.bdf").is_file()
    meta = json.loads((base / "entry.json").read_text(encoding="utf-8"))
    assert meta["entry_id"] == e.entry_id and meta["hulls"][0]["hull_no"] == "3496"
    assert len(meta["files"]) == 2
    assert "3496 검토" in (base / "_INFO.txt").read_text(encoding="utf-8")
    assert all(f.location == "vault" for f in db.query(models.File))
    assert db.get(models.Hull, "3496") is not None
    assert db.get(models.Batch, b.id).state == "done"
    assert not (storage.staging / b.key).exists()
    assert db.query(models.AuditLog).filter_by(action="ENTRY_CONFIRM").count() == 1


def test_only_uploader_can_confirm(db, storage, make_user, setup_entry_with_files):
    other = make_user("B200002")
    _, e = setup_entry_with_files()
    with pytest.raises(HTTPException) as ei:
        service.confirm(db, storage, e, other)
    assert ei.value.status_code == 403


def test_admin_can_confirm_stale_batch(db, storage, make_user, setup_entry_with_files):
    admin = make_user("C300003", is_admin=True)
    b, e = setup_entry_with_files()
    with pytest.raises(HTTPException):
        service.confirm(db, storage, e, admin)
    b.received_at = datetime.now() - timedelta(days=31)
    db.commit()
    service.confirm(db, storage, e, admin)
    assert db.get(models.Entry, e.id).status == "confirmed"


def test_title_required(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    _, e = setup_entry_with_files()
    e.title = "  "
    db.commit()
    with pytest.raises(HTTPException) as ei:
        service.confirm(db, storage, e, u)
    assert ei.value.detail == "title_required"


def test_move_failure_rolls_back(db, storage, make_user, monkeypatch, setup_entry_with_files):
    u = make_user("A100001")
    b, e = setup_entry_with_files()
    import app.entries.files as files_mod

    real = files_mod.os.rename
    n = {"i": 0}

    def flaky(src, dst):
        n["i"] += 1
        if n["i"] == 2:
            raise OSError("잠김")
        return real(src, dst)

    monkeypatch.setattr(files_mod.os, "rename", flaky)
    with pytest.raises(HTTPException) as ei:
        service.confirm(db, storage, e, u)
    assert ei.value.status_code == 503
    assert (storage.staging / b.key / "3496_검토" / "model" / "a.bdf").is_file()
    db.expire_all()
    assert db.get(models.Entry, e.id).status == "draft"


def test_trailing_dot_folder_survives_stage_process_confirm(db, storage, make_user):
    """이름 끝에 점이 있는 폴더(3496_검토.)와 그 안의 하위 폴더(model.)가 stage → process
    → confirm 전 구간을 거쳐도 잘리지 않고 그대로 살아남아야 한다(I1)."""
    from app.ingest.inbox import ReadyItem, stage_item
    from app.ingest.process import process_batch
    from app.storage.paths import long_join

    make_user("A476854")
    # long_join 으로 직접 만든다 — os.mkdir(to_long(storage.inbox / "3496_검토.")) 처럼
    # 먼저 접두 없는 Path 를 만들고 나서 to_long() 을 부르면, 그 to_long() 호출 자체가
    # abspath 를 타 점을 지운 뒤 생성해 버린다(디렉터리 자체가 점 없이 만들어짐).
    top_long = long_join(storage.inbox, "3496_검토.")
    os.mkdir(top_long)
    sub_long = long_join(top_long, "model.")
    os.mkdir(sub_long)
    with open(long_join(sub_long, "a.bdf"), "wb") as fh:
        fh.write(b"GRID")

    # InboxWatcher.poll() 이 실제로 주는 형태 — 이미 \\?\ 접두된 Path.
    batch = stage_item(db, storage, ReadyItem("folder", "3496_검토.", [Path(top_long)], "a476854"))
    process_batch(db, storage, batch)
    db.expire_all()
    entry = db.query(models.Entry).filter_by(batch_id=batch.id).one()
    assert any(f.rel_path == "3496_검토./model./a.bdf" for f in
              db.query(models.File).filter_by(entry_id=entry.id))

    u = db.query(models.User).filter_by(employee_id="A476854").one()
    service.confirm(db, storage, entry, u)
    db.expire_all()
    entry = db.get(models.Entry, entry.id)
    base = storage.vault / entry.vault_rel.replace("/", "\\")
    # 검증도 long_join 으로 한다 — Path(...) / to_long() 을 그대로 쓰면 검증 자체가
    # 점을 지우는 같은 함정에 빠진다.
    landed = long_join(base, "files/3496_검토./model./a.bdf")
    assert os.path.isfile(landed)


def test_confirm_compensates_when_db_work_fails_after_move(db, storage, make_user, monkeypatch,
                                                            setup_entry_with_files):
    """move_all() 로 파일을 옮긴 뒤 audit.record() 가 실패하면(DB 오류 등), 파일을 원래
    자리로 되돌리고 DB 는 변경 없이 그대로여야 한다(I2)."""
    u = make_user("A100001")
    b, e = setup_entry_with_files()

    import app.entries.service as service_mod

    def boom(*a, **k):
        raise RuntimeError("감사 로그 실패(시뮬레이션)")

    monkeypatch.setattr(service_mod.audit, "record", boom)

    with pytest.raises(RuntimeError):
        service.confirm(db, storage, e, u)

    db.expire_all()
    e = db.get(models.Entry, e.id)
    assert e.status == "draft" and e.vault_rel is None
    assert all(f.location == "staging" for f in db.query(models.File).filter_by(entry_id=e.id))
    assert (storage.staging / b.key / "3496_검토" / "model" / "a.bdf").is_file()
    # move_all 의 undo() 는 파일만 되돌린다(만들어진 빈 폴더 정리는 하지 않는다) —
    # 그래도 파일 내용이 vault 에 남아 있으면 안 된다.
    assert not any((storage.vault / str(datetime.now().year)).rglob("*.bdf"))
    assert not any((storage.vault / str(datetime.now().year)).rglob("*.pdf"))


def test_undo_failure_raises_storage_error_partial(db, storage, make_user, monkeypatch, setup_entry_with_files):
    """옮기기는 됐는데 그 뒤 DB 작업이 실패해서 되돌리려는데, 되돌리기 자체도 실패하면
    (예: 파일이 그 사이 잠김) 원래 오류 대신 503 storage_error_partial 을 내야 한다(I7) —
    파일이 원래도 새 자리도 아닌 애매한 상태라 사람이 직접 봐야 한다는 신호다."""
    u = make_user("A100001")
    _, e = setup_entry_with_files()

    import app.entries.files as files_mod
    import app.entries.service as service_mod

    real_rename = files_mod.os.rename
    state = {"phase": "forward"}

    def flaky(src, dst):
        if state["phase"] == "forward":
            return real_rename(src, dst)
        raise OSError("되돌리기 실패(시뮬레이션)")

    monkeypatch.setattr(files_mod.os, "rename", flaky)

    def boom(*a, **k):
        state["phase"] = "undo"
        raise RuntimeError("감사 로그 실패(시뮬레이션)")

    monkeypatch.setattr(service_mod.audit, "record", boom)

    with pytest.raises(HTTPException) as ei:
        service.confirm(db, storage, e, u)
    assert (ei.value.status_code, ei.value.detail) == (503, "storage_error_partial")


def test_write_entry_files_noop_for_draft():
    from app.entries.files import write_entry_files

    draft = models.Entry(id=1, status="draft")
    # entry_to_dict 등 DB 접근이 필요한 경로를 아예 타지 않는다 — status 검사가 맨 위에서
    # 걸러야 한다(I3). db 인자로 None 을 넘겨도 여기서 끝나야 예외가 안 난다.
    write_entry_files(None, None, draft)


def test_confirm_queues_write_meta_job_when_metadata_write_fails(db, storage, make_user, monkeypatch,
                                                                 setup_entry_with_files):
    """entry.json/_INFO.txt 쓰기가 실패해도(OSError) 이미 성공한 확정 자체는 되돌리지
    않는다 — 대신 write_meta 작업을 큐에 넣고 계속한다(I3)."""
    u = make_user("A100001")
    _, e = setup_entry_with_files()

    import app.entries.files as files_mod

    def boom(*a, **k):
        raise OSError("메타 쓰기 실패(시뮬레이션)")

    monkeypatch.setattr(files_mod, "write_entry_files", boom)

    result = service.confirm(db, storage, e, u)
    db.expire_all()
    e = db.get(models.Entry, e.id)
    assert e.status == "confirmed"  # 확정 자체는 성공
    assert result.entry_id == e.entry_id
    job = db.query(models.Job).filter_by(type="write_meta", target_id=e.id).one()
    assert job.state == "queued"


def test_merge_into_existing_entry(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    b1, first = setup_entry_with_files()
    service.confirm(db, storage, first, u)
    b2 = models.Batch(key="20260930-000000-cccc", source="inbox", original_name="추가", uploader="A100001",
                      target_entry_id=first.id)
    db.add(b2)
    db.flush()
    d = models.Entry(title="추가", status="draft", batch_id=b2.id, uploaded_by="A100001", merge_into_id=first.id)
    db.add(d)
    db.flush()
    d.entry_id = f"E{d.id:06d}"
    p = storage.staging / b2.key / "r.pdf"  # 기존과 같은 이름 → 충돌 접미
    p.parent.mkdir(parents=True)
    p.write_bytes(b"new")
    db.add(models.File(batch_id=b2.id, entry_id=d.id, rel_path="3496_검토/r.pdf", name="r.pdf", ext=".pdf",
                       kind="report", size=3, sha256="b" * 64))
    (storage.staging / b2.key / "3496_검토").mkdir()
    p.rename(storage.staging / b2.key / "3496_검토" / "r.pdf")
    db.commit()
    service.confirm(db, storage, d, u)
    db.expire_all()
    first = db.get(models.Entry, first.id)
    names = sorted(f.rel_path for f in db.query(models.File).filter_by(entry_id=first.id))
    assert names == ["3496_검토/model/a.bdf", "3496_검토/r (2).pdf", "3496_검토/r.pdf"]
    assert db.get(models.Entry, d.id) is None
    assert first.version == 2
    assert db.query(models.AuditLog).filter_by(action="ENTRY_FILES_ADDED").count() == 1


def _staged_add_batch(db, storage, first, key, uploader="A100001"):
    """확정 자료의 [파일 추가]로 올린 배치가 _staging 에 막 들어온 상태(process_batch 전)."""
    b = models.Batch(key=key, source="web", original_name="추가", uploader=uploader, state="staged",
                     target_entry_id=first.id)
    db.add(b)
    p = storage.staging / key / "보고서.pdf"
    p.parent.mkdir(parents=True)
    p.write_bytes(b"%PDF-1.4 report")
    db.commit()
    return b


def test_add_files_batch_merges_without_inbox(db, storage, make_user, setup_entry_with_files):
    from app.ingest.process import process_batch

    u = make_user("A100001")
    _b1, first = setup_entry_with_files()
    service.confirm(db, storage, first, u)
    b = _staged_add_batch(db, storage, first, "20261007-000000-aaaa")
    process_batch(db, storage, b)
    assert service.auto_merge_batch(db, storage, b) == 1
    db.expire_all()
    first = db.get(models.Entry, first.id)
    names = sorted(f.rel_path for f in db.query(models.File).filter_by(entry_id=first.id))
    assert "보고서.pdf" in names
    assert db.get(models.Batch, b.id).state == "done"
    assert db.query(models.Entry).filter_by(batch_id=b.id, status="draft").count() == 0
    assert db.query(models.AuditLog).filter_by(action="ENTRY_FILES_ADDED").count() == 1


def test_add_files_batch_stays_in_inbox_when_target_trashed(db, storage, make_user, setup_entry_with_files):
    from app.ingest.process import process_batch

    u = make_user("A100001")
    _b1, first = setup_entry_with_files()
    service.confirm(db, storage, first, u)
    b = _staged_add_batch(db, storage, first, "20261007-000000-bbbb")
    process_batch(db, storage, b)
    first = db.get(models.Entry, first.id)
    first.status = "trashed"   # 그 사이 휴지통으로 간 경우
    db.commit()
    assert service.auto_merge_batch(db, storage, b) == 0
    db.expire_all()
    assert db.get(models.Batch, b.id).state == "processed"
    assert db.query(models.Entry).filter_by(batch_id=b.id, status="draft").count() == 1


def test_normal_batch_is_not_auto_merged(db, storage, make_user, setup_entry_with_files):
    make_user("A100001")
    b, _draft = setup_entry_with_files()
    assert service.auto_merge_batch(db, storage, b) == 0
