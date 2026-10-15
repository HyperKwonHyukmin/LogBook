"""리뷰 8 — entry.json 원자적 쓰기, write_meta 의 긴 재시도, 매일 재동기화, registry.json 재시도."""
import json
import os
from datetime import datetime, timedelta

import pytest

from app import jobs, models
from app.entries import service
from app.entries.files import entry_dir, write_entry_files, write_text_atomic
from app.ops.daily import run_daily
from app.ops.metasync import resync_entry_meta
from app.ops.state import get_state


def ok_runner(out):
    out.write(b"-- dump")


def _confirmed(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    _b, e = setup_entry_with_files()
    service.confirm(db, storage, e, u)
    db.expire_all()
    return db.get(models.Entry, e.id)


def test_atomic_write_keeps_old_file_on_failure(tmp_path, monkeypatch):
    import app.entries.files as files_mod

    target = tmp_path / "entry.json"
    target.write_text('{"version": 1}', encoding="utf-8")

    def broken_replace(src, dst):
        raise OSError("SMB 끊김(시뮬레이션)")

    monkeypatch.setattr(files_mod.os, "replace", broken_replace)
    with pytest.raises(OSError):
        write_text_atomic(target, '{"version": 2}')
    assert target.read_text(encoding="utf-8") == '{"version": 1}'   # 기존 파일은 온전하다(예전엔 0바이트)
    assert os.listdir(tmp_path) == ["entry.json"]                   # 임시 파일도 남지 않는다


def test_atomic_write_retries_briefly_locked_target(tmp_path, monkeypatch):
    import app.entries.files as files_mod

    real = files_mod.os.replace
    calls = {"n": 0}

    def locked_once(src, dst):
        calls["n"] += 1
        if calls["n"] == 1:
            raise PermissionError("다른 프로세스가 사용 중(시뮬레이션)")
        return real(src, dst)

    monkeypatch.setattr(files_mod.os, "replace", locked_once)
    monkeypatch.setattr(files_mod, "REPLACE_WAIT_SECONDS", 0)
    write_text_atomic(tmp_path / "entry.json", "{}")
    assert (tmp_path / "entry.json").read_text(encoding="utf-8") == "{}" and calls["n"] == 2


def test_write_meta_job_keeps_retrying_with_backoff(db):
    job = jobs.enqueue(db, "write_meta", 1)
    db.commit()
    job.attempts = jobs.MAX_ATTEMPTS
    jobs.fail(db, job, "OSError")
    assert job.state == "queued"                               # 예전에는 3번째에 failed
    assert job.run_after >= datetime.now() + timedelta(minutes=3)
    # 오래 실패하면 간격은 최대 1시간
    job.attempts = 20
    jobs.fail(db, job, "OSError")
    assert job.state == "queued" and job.run_after <= datetime.now() + jobs.RETRY_CAP + timedelta(seconds=5)
    # 그래도 끝은 있다(그 뒤는 매일 재동기화가 맡는다)
    job.attempts = jobs.MAX_ATTEMPTS + jobs.LONG_RETRY_EXTRA
    jobs.fail(db, job, "OSError")
    assert job.state == "failed"
    # 다른 작업은 그대로 3번
    other = jobs.enqueue(db, "extract_file", 1)
    db.commit()
    other.attempts = jobs.MAX_ATTEMPTS
    jobs.fail(db, other, "x")
    assert other.state == "failed"


def test_claim_does_not_exhaust_write_meta_early(db):
    job = jobs.enqueue(db, "write_meta", 1)
    db.commit()
    job.attempts = jobs.MAX_ATTEMPTS
    db.commit()
    got = jobs.claim_next(db)
    assert got is not None and got.id == job.id and got.state == "running"


def test_failed_meta_write_queues_one_job(db, storage, make_user, monkeypatch, setup_entry_with_files):
    import app.entries.files as files_mod

    def broken(*a, **k):
        raise OSError("SMB 끊김(시뮬레이션)")

    monkeypatch.setattr(files_mod, "write_text_atomic", broken)
    e = _confirmed(db, storage, make_user, setup_entry_with_files)
    service._write_meta_or_queue(db, storage, e)   # 끊긴 동안의 두 번째 변경
    assert db.query(models.Job).filter_by(type="write_meta", target_id=e.id).count() == 1


def test_worker_write_meta_for_deleted_entry_completes(db, storage):
    from app import worker
    from app.ingest.inbox import InboxWatcher

    jobs.enqueue(db, "write_meta", 987654)
    db.commit()
    worker.run_once(db, storage, InboxWatcher(storage))
    assert db.query(models.Job).filter_by(type="write_meta").one().state == "done"


def test_resync_rewrites_missing_and_stale(db, storage, make_user, setup_entry_with_files):
    e = _confirmed(db, storage, make_user, setup_entry_with_files)
    meta = entry_dir(storage, e) / "entry.json"
    assert resync_entry_meta(db, storage)["rewritten"] == 0     # 최신이면 건드리지 않는다

    meta.unlink()
    r = resync_entry_meta(db, storage)
    assert r["rewritten"] == 1 and json.loads(meta.read_text(encoding="utf-8"))["entry_id"] == e.entry_id

    e.version += 2   # 쓰기 실패로 DB 만 앞서 나간 상태
    e.title = "바뀐 제목"
    db.commit()
    assert resync_entry_meta(db, storage)["rewritten"] == 1
    data = json.loads(meta.read_text(encoding="utf-8"))
    assert data["version"] == e.version and data["title"] == "바뀐 제목"

    meta.write_text("{깨진", encoding="utf-8")
    assert resync_entry_meta(db, storage)["rewritten"] == 1


def test_resync_trashed_and_missing_folder(db, storage, make_user, setup_entry_with_files):
    e = _confirmed(db, storage, make_user, setup_entry_with_files)
    service.trash(db, storage, e, db.query(models.User).filter_by(employee_id="A100001").one())
    db.expire_all()
    e = db.get(models.Entry, e.id)
    meta = storage.trash / e.trash_rel / "entry.json"
    assert meta.is_file()
    # 휴지통 이동은 version 을 올리지만 entry.json 은 확정 때 그대로가 정상 — 다시 쓰지 않는다
    assert resync_entry_meta(db, storage)["rewritten"] == 0
    meta.unlink()
    assert resync_entry_meta(db, storage)["rewritten"] == 1 and meta.is_file()
    # 폴더 자체가 없으면 만들지 않는다
    os.rename(storage.trash / e.trash_rel, storage.trash / "elsewhere")
    r = resync_entry_meta(db, storage)
    assert r["no_folder"] == 1 and not (storage.trash / e.trash_rel).exists()


def test_resync_limit(db, storage, make_user, setup_entry_with_files):
    e = _confirmed(db, storage, make_user, setup_entry_with_files)
    (entry_dir(storage, e) / "entry.json").unlink()
    assert resync_entry_meta(db, storage, limit=0)["rewritten"] == 0


def test_daily_runs_resync(db, storage, make_user, setup_entry_with_files):
    e = _confirmed(db, storage, make_user, setup_entry_with_files)
    (entry_dir(storage, e) / "entry.json").unlink()
    r = run_daily(db, storage, datetime(2026, 10, 2, 2, 10, 0), backup_runner=ok_runner)
    assert r["ran"] and r["meta"]["rewritten"] == 1
    assert (entry_dir(storage, e) / "entry.json").is_file()


def test_registry_failure_is_retried_same_day(db, storage, monkeypatch):
    import app.ops.daily as daily

    results = iter([False, True])
    monkeypatch.setattr(daily, "write_registry", lambda db, storage: next(results))
    r = run_daily(db, storage, datetime(2026, 10, 2, 2, 10, 0), backup_runner=ok_runner)
    assert r["ran"] and r["registry"] is False
    assert get_state(db, "last_daily")["registry"] is False
    # 간격 안에는 다시 하지 않는다
    assert "registry_retry" not in run_daily(db, storage, datetime(2026, 10, 2, 2, 40, 0), backup_runner=ok_runner)
    r = run_daily(db, storage, datetime(2026, 10, 2, 3, 20, 0), backup_runner=ok_runner)
    assert r == {"ran": False, "registry_retry": True}
    assert get_state(db, "last_daily")["registry"] is True
    assert "registry_retry" not in run_daily(db, storage, datetime(2026, 10, 2, 5, 0, 0), backup_runner=ok_runner)


def test_write_entry_files_noop_without_vault_rel():
    write_entry_files(None, None, models.Entry(id=1, status="draft"), base=None)
