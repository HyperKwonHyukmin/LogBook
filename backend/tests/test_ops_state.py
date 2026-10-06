from datetime import datetime, timedelta

from app import models
from app.ops.state import WORKER_ALIVE_SECONDS, get_state, set_state, worker_status


def test_state_roundtrip(db):
    assert get_state(db, "x") is None
    set_state(db, "x", {"a": 1})
    set_state(db, "x", {"a": 2})
    db.commit()
    assert get_state(db, "x") == {"a": 2}
    assert db.query(models.SystemState).count() == 1


def test_worker_status(db):
    now = datetime(2026, 10, 2, 12, 0, 0)
    assert worker_status(db, now) == {"alive": False, "at": None, "stats": None}
    set_state(db, "worker_heartbeat", {"at": (now - timedelta(seconds=30)).isoformat(), "stats": {"processed": 2}})
    db.commit()
    s = worker_status(db, now)
    assert s["alive"] is True and s["stats"] == {"processed": 2}
    set_state(db, "worker_heartbeat", {"at": (now - timedelta(seconds=WORKER_ALIVE_SECONDS + 1)).isoformat(), "stats": {}})
    db.commit()
    assert worker_status(db, now)["alive"] is False


def test_run_once_writes_heartbeat(db, storage):
    from app.ingest.inbox import InboxWatcher
    from app.worker import run_once

    run_once(db, storage, InboxWatcher(storage))
    hb = get_state(db, "worker_heartbeat")
    assert hb and hb["at"] and "processed" in hb["stats"]
