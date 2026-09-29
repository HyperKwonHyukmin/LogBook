import pytest

from app import models
from app.ingest.inbox import InboxWatcher
from app.worker import run_once


class Clock:
    t = 0.0

    def __call__(self):
        return self.t


def test_run_once_end_to_end(db, storage, make_user):
    make_user("A476854")
    d = storage.inbox / "3496_Mooring_검토"
    d.mkdir()
    (d / "3496_FWD.bdf").write_text("GRID", encoding="utf-8")
    (d / "검토.pdf").write_bytes(b"%PDF-1.7")
    clock = Clock()
    w = InboxWatcher(storage, stable_seconds=60, clock=clock, owner_of=lambda p: "a476854")
    assert run_once(db, storage, w) == {"staged": 0, "processed": 0, "failed": 0}
    clock.t += 61
    assert run_once(db, storage, w) == {"staged": 1, "processed": 1, "failed": 0}
    db.expire_all()
    [e] = db.query(models.Entry).all()
    assert e.title == "3496 Mooring 검토" and e.uploaded_by == "A476854"


def test_failed_processing_marks_batch_after_retries(db, storage, monkeypatch):
    import app.worker as worker

    b = models.Batch(key="k1", source="inbox", original_name="x")
    db.add(b)
    db.flush()
    db.add(models.Job(type="process_batch", target_id=b.id))
    db.commit()

    def boom(*a, **k):
        raise RuntimeError("처리 실패")

    monkeypatch.setattr(worker, "process_batch", boom)
    monkeypatch.setattr(worker.jobs, "RETRY_STEP", worker.timedelta(0))
    w = InboxWatcher(storage, clock=Clock(), owner_of=lambda p: None)
    for _ in range(3):
        run_once(db, storage, w)
    db.expire_all()
    assert db.get(models.Batch, b.id).state == "failed"
    assert "처리 실패" in db.get(models.Batch, b.id).error


def test_run_once_processes_write_meta_jobs(db, storage, make_user, setup_entry_with_files):
    """워커가 'write_meta' 작업을 받으면 entry.json/_INFO.txt 를 다시 쓴다(I3) —
    confirm() 이 메타 쓰기 실패 시 큐에 넣어 두는 재시도 경로."""
    from app import jobs
    from app.entries import service

    u = make_user("A100001")
    _, e = setup_entry_with_files()
    service.confirm(db, storage, e, u)
    db.expire_all()
    e = db.get(models.Entry, e.id)

    # 이미 있는 entry.json 을 지워서 write_meta job 이 다시 만드는지 확인한다.
    base = storage.vault / e.vault_rel.replace("/", "\\")
    (base / "entry.json").unlink()
    jobs.enqueue(db, "write_meta", e.id)
    db.commit()

    w = InboxWatcher(storage, clock=Clock(), owner_of=lambda p: None)
    stats = run_once(db, storage, w)
    assert stats["failed"] == 0
    assert (base / "entry.json").is_file()


def test_main_recovers_running_jobs_once_at_startup(monkeypatch, storage, caplog):
    """main() 은 루프를 돌기 전에 jobs.recover_running() 을 한 번 호출해, 이전 실행이
    비정상 종료돼 'running' 에 멈춰 있던 작업을 다시 큐에 넣는다(그 개수를 로그로 남긴다)."""
    import app.worker as worker

    calls = {"n": 0}

    def fake_recover(db):
        calls["n"] += 1
        return 3

    monkeypatch.setattr(worker.jobs, "recover_running", fake_recover)
    monkeypatch.setattr(worker, "get_storage", lambda: storage)
    monkeypatch.setattr(worker, "run_once", lambda *a, **k: {"staged": 0, "processed": 0, "failed": 0})

    class StopLoop(Exception):
        pass

    def fake_sleep(_):
        raise StopLoop

    monkeypatch.setattr(worker.time, "sleep", fake_sleep)

    with caplog.at_level("INFO", logger=worker.log.name):
        with pytest.raises(StopLoop):
            worker.main()

    assert calls["n"] == 1
    assert any("3" in r.message for r in caplog.records if "복구" in r.message)


def test_main_logs_orphaned_staging_folders_at_startup(storage, monkeypatch, caplog):
    """배치 행이 없는 _staging\\<key> 폴더가 있으면(파일은 옮겨졌는데 배치 생성이
    실패해 undo 까지 실패한 드문 경우 등) 워커 시작 시 로그로 남긴다(I2). clean_db 가
    (autouse) 매 테스트 앞에서 테이블을 비우므로 실제 SessionLocal 을 그대로 쓴다 —
    batches 테이블이 비어 있어 이 폴더는 항상 '고아' 로 잡힌다."""
    import app.worker as worker

    (storage.staging / "orphan-key-1234").mkdir(parents=True)

    monkeypatch.setattr(worker, "get_storage", lambda: storage)
    monkeypatch.setattr(worker.jobs, "recover_running", lambda db: 0)

    class StopLoop(Exception):
        pass

    def fake_sleep(_):
        raise StopLoop

    monkeypatch.setattr(worker.time, "sleep", fake_sleep)
    monkeypatch.setattr(worker, "run_once", lambda *a, **k: {"staged": 0, "processed": 0, "failed": 0})

    with caplog.at_level("WARNING", logger=worker.log.name):
        with pytest.raises(StopLoop):
            worker.main()

    assert any("orphan-key-1234" in r.message for r in caplog.records)


def test_run_once_cleans_stale_web_uploads(db, storage, make_user):
    from datetime import datetime, timedelta

    from app import models
    from app.ingest.inbox import InboxWatcher
    from app.uploads import service as uploads
    from app.worker import run_once

    user = make_user("A100001")
    b = uploads.begin(db, storage, user, name="old", target_entry_id=None)
    b.received_at = datetime.now() - timedelta(hours=30)
    db.commit()
    run_once(db, storage, InboxWatcher(storage))
    assert db.query(models.Batch).filter_by(key=b.key).count() == 0
