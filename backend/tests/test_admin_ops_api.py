from app import models
from app.ops.state import set_state


def _admin(client, make_user, auth_headers):
    make_user("A100001", is_admin=True)
    make_user("A100002")
    return auth_headers("A100001"), auth_headers("A100002")


def test_status_and_permissions(client, db, make_user, auth_headers, make_entry_file):
    ha, hu = _admin(client, make_user, auth_headers)
    assert client.get("/api/admin/ops/status", headers=hu).status_code == 403
    _e, f = make_entry_file(name="m.bdf", kind="model")
    db.add(models.Job(type="convert_model", target_id=f.id, state="failed", attempts=3, last_error="boom"))
    db.add(models.Job(type="extract_file", target_id=f.id, state="queued"))
    set_state(db, "last_backup", {"ok": True, "file": "logbook-x.sql.gz", "size": 10, "at": "2026-10-02T02:00:00", "error": None})
    db.commit()
    d = client.get("/api/admin/ops/status", headers=ha).json()
    assert d["worker"]["alive"] is False
    assert {"type": "convert_model", "state": "failed", "count": 1} in d["jobs"]
    assert d["failed"][0]["label"] == "m.bdf" and d["failed"][0]["last_error"] == "boom"
    assert d["backup"]["file"] == "logbook-x.sql.gz" and d["trash"]["days"] == 90


def test_retry(client, db, make_user, auth_headers, make_entry_file):
    ha, _ = _admin(client, make_user, auth_headers)
    # 리뷰 반영: 대상이 없으면 409 target_gone 이므로 실제 Entry 를 대상으로 둔다
    e1, _ = make_entry_file()
    e2, _ = make_entry_file()
    j = models.Job(type="write_meta", target_id=e1.id, state="failed", attempts=3, last_error="x")
    q = models.Job(type="write_meta", target_id=e2.id, state="queued")
    db.add_all([j, q])
    db.commit()
    assert client.post(f"/api/admin/ops/jobs/{j.id}/retry", headers=ha).status_code == 200
    db.expire_all()
    assert (db.get(models.Job, j.id).state, db.get(models.Job, j.id).attempts) == ("queued", 0)
    assert client.post(f"/api/admin/ops/jobs/{q.id}/retry", headers=ha).json()["detail"] == "not_failed"
    assert db.query(models.AuditLog).filter_by(action="JOB_RETRY").count() == 1


def test_reconvert_and_reextract(client, db, make_user, auth_headers, make_entry_file):
    ha, _ = _admin(client, make_user, auth_headers)
    make_entry_file(name="m.bdf", kind="model")
    make_entry_file(name="r.pdf")
    assert client.post("/api/admin/ops/reconvert", json={"force": False}, headers=ha).json() == {"queued": 1}
    assert client.post("/api/admin/ops/reextract", json={"force": False}, headers=ha).json() == {"queued": 1}


def test_backup_endpoint(client, db, make_user, auth_headers, monkeypatch):
    ha, _ = _admin(client, make_user, auth_headers)
    import app.routers.admin_ops as ops

    monkeypatch.setattr(ops, "_backup_runner", lambda out: out.write(b"-- dump"))
    d = client.post("/api/admin/ops/backup", headers=ha).json()
    assert d["ok"] is True and d["file"].startswith("logbook-")

    def bad(out):
        from app.ops.backup import BackupError
        raise BackupError("mysqldump_not_found")
    monkeypatch.setattr(ops, "_backup_runner", bad)
    res = client.post("/api/admin/ops/backup", headers=ha)
    assert res.status_code == 502 and res.json()["detail"]["code"] == "backup_failed"


def test_admin_purge(client, db, storage, make_user, auth_headers, make_entry_file):
    ha, hu = _admin(client, make_user, auth_headers)
    e, _ = make_entry_file(status="trashed")
    e.trash_rel = "E_x"
    db.commit()
    assert client.delete(f"/api/admin/trash/{e.entry_id}", headers=hu).status_code == 403
    assert client.delete(f"/api/admin/trash/{e.entry_id}", headers=ha).status_code == 204
    assert db.query(models.Entry).filter_by(entry_id=e.entry_id).first() is None


def test_status_labels_and_trash_counts(client, db, make_user, auth_headers, make_entry_file):
    """실패 작업 이름(배치 키·Entry 번호·#id)과 휴지통 비울 예정 수."""
    from datetime import datetime, timedelta

    ha, _ = _admin(client, make_user, auth_headers)
    e, _f = make_entry_file(status="trashed")
    e.trash_rel = "E_t"
    e.updated_at = datetime.now() - timedelta(days=85)
    db.commit()
    b = db.get(models.Batch, e.batch_id)
    db.add_all([models.Job(type="process_batch", target_id=b.id, state="failed", attempts=3, last_error="a"),
                models.Job(type="write_meta", target_id=e.id, state="failed", attempts=3, last_error="b"),
                models.Job(type="extract_file", target_id=999999, state="failed", attempts=3, last_error="c")])
    db.commit()
    d = client.get("/api/admin/ops/status", headers=ha).json()
    labels = {x["type"]: x["label"] for x in d["failed"]}
    assert labels == {"process_batch": b.key, "write_meta": e.entry_id, "extract_file": "#999999"}
    assert d["trash"] == {"count": 1, "expiring": 1, "days": 90}
    assert d["storage"]["reachable"] is True


def test_reconvert_requires_admin(client, make_user, auth_headers):
    _ha, hu = _admin(client, make_user, auth_headers)
    for path in ("/api/admin/ops/reconvert", "/api/admin/ops/reextract", "/api/admin/ops/backup"):
        res = client.post(path, json={"force": False}, headers=hu)
        assert res.status_code == 403 and res.json()["detail"] == "admin_required"


def test_status_reports_alive_seconds(client, make_user, auth_headers):
    from app.ops.state import WORKER_ALIVE_SECONDS

    ha, _ = _admin(client, make_user, auth_headers)
    d = client.get("/api/admin/ops/status", headers=ha).json()
    assert d["worker"]["alive_seconds"] == WORKER_ALIVE_SECONDS >= 300


def test_retry_batch_resets_state_and_target_gone(client, db, make_user, auth_headers):
    """process_batch 재시도는 배치를 staged 로 되돌린다(리뷰 I4). 대상이 사라졌으면 409 target_gone."""
    ha, _ = _admin(client, make_user, auth_headers)
    b = models.Batch(key="20261002-000000-rtry", source="inbox", original_name="x", state="failed", error="boom")
    db.add(b)
    db.flush()
    j = models.Job(type="process_batch", target_id=b.id, state="failed", attempts=3, last_error="boom")
    gone = models.Job(type="extract_file", target_id=987654, state="failed", attempts=3, last_error="x")
    db.add_all([j, gone])
    db.commit()
    assert client.post(f"/api/admin/ops/jobs/{j.id}/retry", headers=ha).status_code == 200
    db.expire_all()
    assert (db.get(models.Batch, b.id).state, db.get(models.Batch, b.id).error) == ("staged", None)
    res = client.post(f"/api/admin/ops/jobs/{gone.id}/retry", headers=ha)
    assert res.status_code == 409 and res.json()["detail"] == "target_gone"


def test_force_reconvert_does_not_duplicate_queued(client, db, make_user, auth_headers, make_entry_file):
    ha, _ = _admin(client, make_user, auth_headers)
    make_entry_file(name="m.bdf", kind="model")
    make_entry_file(name="r.pdf")
    assert client.post("/api/admin/ops/reconvert", json={"force": True}, headers=ha).json() == {"queued": 1}
    assert client.post("/api/admin/ops/reconvert", json={"force": True}, headers=ha).json() == {"queued": 0}
    assert client.post("/api/admin/ops/reextract", json={"force": True}, headers=ha).json() == {"queued": 1}
    assert client.post("/api/admin/ops/reextract", json={"force": True}, headers=ha).json() == {"queued": 0}


def test_manual_backup_name_and_purge_404(client, db, make_user, auth_headers, monkeypatch):
    ha, _ = _admin(client, make_user, auth_headers)
    import app.routers.admin_ops as ops

    monkeypatch.setattr(ops, "_backup_runner", lambda out: out.write(b"-- dump"))
    d = client.post("/api/admin/ops/backup", headers=ha).json()
    assert d["file"].endswith("-manual.sql.gz")
    assert client.delete("/api/admin/trash/E999999", headers=ha).status_code == 404
