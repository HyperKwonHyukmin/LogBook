import os
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException

from app import models
from app.ops.purge import purge_entry, purge_expired
from app.storage.paths import to_long


def _trashed(db, storage, make_entry_file, days_ago=0, rel="E1_x"):
    e, f = make_entry_file(status="trashed", name="r.pdf")
    e.trash_rel = rel
    e.updated_at = datetime.now() - timedelta(days=days_ago)
    db.add(models.FileText(file_id=f.id, seq=0, locator="page:1", text="본문"))
    db.add(models.FileExtract(file_id=f.id, state="done"))
    db.commit()
    os.makedirs(to_long(storage.trash / rel / "files"), exist_ok=True)
    with open(to_long(storage.trash / rel / "files" / "r.pdf"), "wb") as fh:
        fh.write(b"x")
    return e, f


def test_purge_entry_removes_folder_and_rows(db, storage, make_entry_file):
    e, f = _trashed(db, storage, make_entry_file)
    eid, fid = e.id, f.id  # 지운 뒤에는 만료된 행의 속성을 읽을 수 없다
    purge_entry(db, storage, e, "A100001")
    assert not os.path.exists(to_long(storage.trash / "E1_x"))
    assert db.get(models.Entry, eid) is None and db.get(models.File, fid) is None
    assert db.query(models.FileText).count() == 0
    assert db.query(models.AuditLog).filter_by(action="TRASH_PURGE").count() == 1


def test_purge_rejects_live_entry(db, storage, make_entry_file):
    e, _ = make_entry_file(status="confirmed")
    with pytest.raises(HTTPException) as ei:
        purge_entry(db, storage, e, "A100001")
    assert ei.value.detail == "not_trashed"


def test_purge_expired(db, storage, make_entry_file):
    old, _ = _trashed(db, storage, make_entry_file, days_ago=91, rel="E_old")
    new, _ = _trashed(db, storage, make_entry_file, days_ago=10, rel="E_new")
    old_id, new_id = old.id, new.id
    assert purge_expired(db, storage, days=90) == 1
    assert db.get(models.Entry, old_id) is None and db.get(models.Entry, new_id) is not None


def test_purge_clears_duplicate_reference(db, storage, make_entry_file):
    """다른 Entry 의 파일이 지우는 파일을 중복 원본으로 가리켜도 FK 위반 없이 지우고 참조만 비운다."""
    e, f = _trashed(db, storage, make_entry_file)
    _other, g = make_entry_file(name="copy.pdf")
    g.duplicate_of_id = f.id
    db.commit()
    purge_entry(db, storage, e, "A100001")
    db.expire_all()
    assert db.get(models.File, g.id).duplicate_of_id is None


def test_purge_folder_failure_keeps_db(db, storage, make_entry_file, monkeypatch):
    e, f = _trashed(db, storage, make_entry_file)
    import app.ops.purge as purge

    def boom(*a, **k):
        raise OSError("locked")
    monkeypatch.setattr(purge.shutil, "rmtree", boom)
    with pytest.raises(HTTPException) as ei:
        purge_entry(db, storage, e, "A100001")
    assert ei.value.status_code == 503 and ei.value.detail == "storage_error"
    db.expire_all()
    assert db.get(models.Entry, e.id) is not None and db.get(models.File, f.id) is not None


def test_purge_waits_for_restore_and_skips(db, storage, make_entry_file):
    """복원이 행을 잠근 채 진행 중일 때 영구 삭제가 끼어들면, 복원이 끝난 뒤 다시 확인해 건너뛴다(리뷰 I2).

    잠그기 전에 읽은(휴지통 상태의) 객체로 삭제를 시작해도, 잠근 뒤의 최신 상태(확정)를 보고 409 로 멈춘다.
    Vault 로 돌아간 폴더와 DB 행은 그대로 남아야 한다."""
    import threading
    import time

    from app import database

    e, f = _trashed(db, storage, make_entry_file)
    eid, rel, vault_rel = e.id, e.trash_rel, e.vault_rel
    bind = database.engine.execution_options(isolation_level="READ COMMITTED")
    restorer = database.SessionLocal(bind=bind)
    purger = database.SessionLocal(bind=bind)
    try:
        locked = restorer.get(models.Entry, eid, with_for_update=True)  # 복원이 먼저 잠근다
        stale = purger.get(models.Entry, eid)                              # 삭제 쪽은 아직 휴지통으로 본다
        assert stale.status == "trashed"
        outcome = {}

        def run():
            try:
                purge_entry(purger, storage, stale, "A100001")
                outcome["result"] = "purged"
            except HTTPException as exc:
                outcome["result"] = exc.detail

        t = threading.Thread(target=run)
        t.start()
        time.sleep(0.5)
        assert t.is_alive()  # 잠금을 기다리는 중
        dest = storage.vault / vault_rel
        os.makedirs(to_long(dest.parent), exist_ok=True)
        os.rename(to_long(storage.trash / rel), to_long(dest))
        locked.status, locked.trash_rel = "confirmed", None
        restorer.commit()
        t.join(30)
        assert outcome["result"] == "not_trashed"
    finally:
        restorer.close()
        purger.close()
    db.expire_all()
    assert db.get(models.Entry, eid).status == "confirmed"
    assert os.path.exists(to_long(storage.vault / vault_rel / "files" / "r.pdf"))


def test_purge_rejects_stale_view(db, storage, make_entry_file):
    """다른 휴지통 폴더로 다시 버려졌거나(trash_rel 변경) 보관 기간 기준이 바뀐 경우도 건너뛴다."""
    e, _ = _trashed(db, storage, make_entry_file, days_ago=1)
    e.trash_rel = "E1_other"  # 호출자가 들고 있던 옛 값 흉내(DB 는 E1_x)
    with pytest.raises(HTTPException) as ei:
        purge_entry(db, storage, e, "A100001")
    assert ei.value.detail == "not_trashed"
    e2, _ = _trashed(db, storage, make_entry_file, days_ago=1, rel="E2_y")
    with pytest.raises(HTTPException) as ei:
        purge_entry(db, storage, e2, "A100001", older_than=datetime.now() - timedelta(days=90))
    assert ei.value.detail == "not_expired"
    assert os.path.exists(to_long(storage.trash / "E2_y"))


def test_purge_removes_failed_jobs_of_files(db, storage, make_entry_file):
    e, f = _trashed(db, storage, make_entry_file)
    fid, eid = f.id, e.id
    db.add_all([models.Job(type="convert_model", target_id=fid, state="failed", attempts=3),
                models.Job(type="write_meta", target_id=eid, state="failed", attempts=3)])
    db.commit()
    purge_entry(db, storage, e, "A100001")
    assert db.query(models.Job).count() == 0
