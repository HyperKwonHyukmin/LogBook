from datetime import datetime

from app.ops.daily import run_daily
from app.ops.state import get_state


def ok_runner(out):
    out.write(b"-- dump")


def test_runs_once_per_day_after_hour(db, storage):
    early = datetime(2026, 10, 2, 1, 0, 0)
    assert run_daily(db, storage, early, backup_runner=ok_runner)["ran"] is False
    t = datetime(2026, 10, 2, 2, 10, 0)
    r = run_daily(db, storage, t, backup_runner=ok_runner)
    assert r["ran"] is True and r["backup"]["ok"] is True and r["registry"] is True
    assert run_daily(db, storage, datetime(2026, 10, 2, 9, 0, 0), backup_runner=ok_runner)["ran"] is False
    assert run_daily(db, storage, datetime(2026, 10, 3, 2, 1, 0), backup_runner=ok_runner)["ran"] is True
    assert get_state(db, "last_backup")["ok"] is True


def test_backup_failure_recorded(db, storage):
    def bad(out):
        from app.ops.backup import BackupError
        raise BackupError("mysqldump_not_found")
    r = run_daily(db, storage, datetime(2026, 10, 2, 3, 0, 0), backup_runner=bad)
    assert r["ran"] is True and r["backup"]["ok"] is False
    assert get_state(db, "last_backup")["error"] == "mysqldump_not_found"
    # 리뷰 반영: 백업이 실패한 날은 완료로 치지 않는다 — 간격(60분) 안에는 다시 돌지 않고, 지나면 다시 시도한다
    assert get_state(db, "last_daily").get("date") is None
    assert run_daily(db, storage, datetime(2026, 10, 2, 3, 30, 0), backup_runner=bad)["ran"] is False
    r = run_daily(db, storage, datetime(2026, 10, 2, 4, 1, 0), backup_runner=ok_runner)
    assert r["ran"] is True and r["backup"]["ok"] is True
    assert get_state(db, "last_daily")["date"] == "2026-10-02"


def test_worker_calls_daily_and_survives_errors(db, storage, monkeypatch):
    """워커 주기가 일일 작업을 부르고, 일일 작업이 터져도 주기는 끝까지 돈다."""
    import app.worker as worker
    from app.ingest.inbox import InboxWatcher

    seen = []
    monkeypatch.setattr(worker, "run_daily", lambda db, storage: seen.append(1) or {"ran": False})
    worker.run_once(db, storage, InboxWatcher(storage))
    assert seen == [1]

    def boom(db, storage):
        raise RuntimeError("daily boom")
    monkeypatch.setattr(worker, "run_daily", boom)
    stats = worker.run_once(db, storage, InboxWatcher(storage))
    assert "processed" in stats and get_state(db, "worker_heartbeat") is not None


def test_no_real_dump_guard():
    """안전장치: 테스트에서는 실제 mysqldump 경로가 존재하지 않는 곳을 가리킨다."""
    import os

    from app.ops import backup

    assert not os.path.isfile(backup.settings.mysqldump_path)


def test_cli_purge_trash(db, storage, make_entry_file, capsys):
    from datetime import timedelta

    from app import cli, models

    e, _ = make_entry_file(status="trashed")
    e.trash_rel = "E_cli"
    e.updated_at = datetime.now() - timedelta(days=5)
    db.commit()
    eid = e.id
    assert cli.main(["purge-trash", "--days", "10"]) == 0
    assert "0건" in capsys.readouterr().out
    assert cli.main(["purge-trash", "--days", "3"]) == 0
    assert "1건" in capsys.readouterr().out
    db.expire_all()
    assert db.get(models.Entry, eid) is None


def test_second_worker_skips_while_first_holds_claim(db, storage):
    """다른 워커가 같은 날 '시도 중' 을 먼저 기록했으면 간격 안에서는 돌지 않는다(리뷰 I8)."""
    from app import database

    other = database.SessionLocal()
    try:
        from app.ops.daily import _claim

        assert _claim(other, datetime(2026, 10, 2, 2, 0, 5)) is not None  # 첫 워커가 잡았다
    finally:
        other.close()
    assert run_daily(db, storage, datetime(2026, 10, 2, 2, 0, 30), backup_runner=ok_runner)["ran"] is False


def test_daily_writes_heartbeat(db, storage):
    run_daily(db, storage, datetime(2026, 10, 2, 2, 10, 0), backup_runner=ok_runner)
    assert get_state(db, "worker_heartbeat") is not None
