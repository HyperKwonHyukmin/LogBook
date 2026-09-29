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
    # process_batch 1 + 검토.pdf 본문 추출(extract_file) 1. 가짜 PDF 라 추출은 failed 로
    # 기록되지만 작업 자체는 완료 처리된다(깨진 문서는 재시도해도 같다).
    assert run_once(db, storage, w) == {"staged": 1, "processed": 2, "failed": 0}
    db.expire_all()
    [e] = db.query(models.Entry).all()
    assert e.title == "3496 Mooring 검토" and e.uploaded_by == "A476854"
    [x] = db.query(models.FileExtract).all()
    assert db.get(models.File, x.file_id).name == "검토.pdf" and x.state == "failed"


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


def _extract_jobs(db, make_entry_file, n):
    out = []
    for i in range(n):
        _e, f = make_entry_file(name=f"r{i}.pdf")
        db.add(models.FileExtract(file_id=f.id, state="queued"))
        out.append(f)
    db.commit()
    return out


def test_extract_job_final_failure_marks_extract_failed(db, storage, make_entry_file, monkeypatch):
    """파일을 끝내 못 읽어 작업이 최종 실패하면 추출 상태도 queued 로 남지 않고 failed 가 된다."""
    import app.worker as worker

    [f] = _extract_jobs(db, make_entry_file, 1)
    db.add(models.Job(type="extract_file", target_id=f.id, attempts=worker.MAX_ATTEMPTS - 1))
    db.commit()

    def boom(*a, **k):
        raise OSError("공유 폴더 끊김")

    monkeypatch.setattr(worker, "run_extract", boom)
    stats = run_once(db, storage, InboxWatcher(storage))
    assert stats["failed"] == 1
    db.expire_all()
    row = db.get(models.FileExtract, f.id)
    assert row.state == "failed" and "공유 폴더 끊김" in row.error


def test_extract_budget_leaves_rest_queued(db, storage, make_entry_file, monkeypatch):
    """한 주기에서 본문 추출에 쓰는 시간을 제한한다 — 예산을 넘으면 남은 추출 작업은 다음 주기로
    미루고, 다른 종류 작업은 계속 처리한다."""
    import app.worker as worker

    files = _extract_jobs(db, make_entry_file, 3)
    for f in files:
        db.add(models.Job(type="extract_file", target_id=f.id))
    db.commit()
    ran = []
    monkeypatch.setattr(worker, "run_extract", lambda db, storage, f: ran.append(f.id))
    ticks = iter([0.0, 0.0] + [1000.0] * 50)  # 시작 시각, 첫 확인은 예산 안, 그 뒤로는 초과
    monkeypatch.setattr(worker, "_clock", lambda: next(ticks))
    run_once(db, storage, InboxWatcher(storage))
    assert ran == [files[0].id]
    # 예산을 넘긴 뒤에도 추출 아닌 작업은 돈다
    monkeypatch.setattr(worker, "EXTRACT_BUDGET_SECONDS", 0)
    monkeypatch.setattr(worker, "_clock", lambda: 5.0)
    e, _f = make_entry_file(name="x.pdf")
    db.add(models.Job(type="write_meta", target_id=e.id))
    db.commit()
    run_once(db, storage, InboxWatcher(storage))
    db.expire_all()
    states = {j.target_id: j.state for j in db.query(models.Job).filter_by(type="extract_file")}
    assert states == {files[0].id: "done", files[1].id: "queued", files[2].id: "queued"}
    assert db.query(models.Job).filter_by(type="write_meta").one().state == "done"
