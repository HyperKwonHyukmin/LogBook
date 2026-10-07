"""배치 처리 진행 상황(정리 대기 화면의 '무엇을 하고 있나요') — 단계·n/N 보고, API 의 진행·대기 정보."""
from datetime import datetime, timedelta

from app import database, models
from app.ingest.process import process_batch
from app.ingest.progress import KEY, make_reporter, read_progress, write_progress
from app.ops.state import heartbeat, set_state


def _staged(db, storage, key="20261006-000000-prog", uploader="A100001"):
    b = models.Batch(key=key, source="web", original_name="모델 묶음", uploader=uploader)
    db.add(b)
    db.commit()
    (storage.staging / key).mkdir(parents=True)
    return b


def _write(path, data=b"GRID"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def test_process_batch_reports_steps_in_order(db, storage):
    b = _staged(db, storage)
    for n in ("a.bdf", "b.bdf", "r.pdf"):
        _write(storage.staging / b.key / "3496_검토" / n)
    calls = []
    process_batch(db, storage, b, progress=lambda step, done=0, total=0, force=False: calls.append((step, done, total)))
    steps = [c[0] for c in calls]
    assert steps[0] == "scan"
    assert steps[-2:] == ["propose", "queue"]
    files = [c for c in calls if c[0] == "files"]
    assert files[0] == ("files", 0, 3)
    assert {c[2] for c in files} == {3}
    assert ("propose", 3, 3) in calls
    assert db.get(models.Batch, b.id).state == "processed"


def test_reporter_throttles_but_keeps_step_changes(db):
    t = [0.0]
    report = make_reporter("k1", database.SessionLocal, min_interval=1.0, clock=lambda: t[0])
    report("files", 0, 10, force=True)
    report("files", 1, 10)            # 1초 안 — 쓰지 않는다
    db.expire_all()
    assert read_progress(db, "k1")["done"] == 0
    t[0] = 1.5
    report("files", 5, 10)
    db.expire_all()
    assert read_progress(db, "k1")["done"] == 5
    report("propose", 10, 10)         # 단계가 바뀌면 바로
    db.expire_all()
    assert read_progress(db, "k1")["step"] == "propose"


def test_read_progress_ignores_other_batch_and_stale(db):
    write_progress(db, "k1", "files", 2, 4)
    assert read_progress(db, "k2") is None
    assert read_progress(db, "k1", now=datetime.now() + timedelta(hours=1)) is None
    assert read_progress(db, "k1") == {"step": "files", "done": 2, "total": 4, "at": read_progress(db, "k1")["at"]}


def test_api_staged_batch_shows_progress_and_queue(client, db, storage, make_user, auth_headers):
    make_user("A100001")
    first = _staged(db, storage, key="20261006-000000-aaaa")
    b = _staged(db, storage, key="20261006-000001-bbbb")
    db.add_all([models.Job(type="process_batch", target_id=first.id),
                models.Job(type="process_batch", target_id=b.id),
                models.Job(type="convert_model", target_id=999, state="running")])
    db.commit()
    heartbeat(db)
    write_progress(db, b.key, "files", 3, 12)
    rows = {x["key"]: x for x in client.get("/api/batches", headers=auth_headers("A100001")).json()}
    got = rows[b.key]
    assert got["progress"]["step"] == "files" and (got["progress"]["done"], got["progress"]["total"]) == (3, 12)
    q = got["queue"]
    assert q["job_state"] == "queued" and q["ahead"] == 1 and q["worker_alive"] is True
    assert q["busy_with"] == ["convert_model"]
    assert rows[first.key]["progress"] is None and rows[first.key]["queue"]["ahead"] == 0


def test_api_worker_down(client, db, storage, make_user, auth_headers):
    make_user("A100001")
    b = _staged(db, storage)
    db.add(models.Job(type="process_batch", target_id=b.id))
    set_state(db, "worker_heartbeat", {"at": (datetime.now() - timedelta(hours=2)).replace(microsecond=0).isoformat(),
                                       "stats": {}})
    db.commit()
    [got] = client.get("/api/batches", headers=auth_headers("A100001")).json()
    assert got["queue"]["worker_alive"] is False
    assert got["queue"]["worker_at"] is not None


def test_api_processed_batch_marks_converting_models(client, db, storage, make_user, auth_headers):
    make_user("A100001")
    b = _staged(db, storage)
    _write(storage.staging / b.key / "3496_검토" / "a.bdf")
    _write(storage.staging / b.key / "3496_검토" / "b.bdf", b"GRID 2")
    process_batch(db, storage, b)
    db.expire_all()
    fa, fb = db.query(models.File).filter_by(batch_id=b.id).order_by(models.File.name).all()
    db.query(models.Job).filter(models.Job.type == "convert_model", models.Job.target_id == fa.id).update({"state": "running"})
    db.commit()
    [got] = client.get("/api/batches", headers=auth_headers("A100001")).json()
    assert got["state"] == "processed" and "progress" not in got
    files = {f["name"]: f for f in got["entries"][0]["files"]}
    assert files["a.bdf"]["model"]["running"] is True
    assert files["b.bdf"]["model"]["running"] is False


def test_progress_key_fits_system_state():
    assert len(KEY) <= 40
