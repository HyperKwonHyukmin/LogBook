"""해석 검증 API(06 §5)."""
import os
from pathlib import Path

from app import models
from app.convert.job import run_convert
from app.entries.locate import file_path
from app.solve.job import run_solve_check
from app.solve.runner import RunResult

FIX = Path(__file__).parent / "fixtures" / "solve_f06"
MESH = ("GRID,1,,0.,0.,0.\nGRID,2,,1000.,0.,0.\nGRID,3,,1000.,1000.,0.\nGRID,4,,0.,1000.,0.\n"
        "CQUAD4,1,5,1,2,3,4\nPSHELL,5,1,10.\nMAT1,1,206000.,,0.3,7.85-9\n")
SHAPE = {"state", "error_types", "fatals", "warning_count", "message", "spc_nodes", "groups", "fixed_node_ids",
         "elapsed", "stale", "has_f06", "requested_by", "requested_by_name", "requested_at", "finished_at"}


def _converted(db, storage, make_entry_file, name="m.bdf"):
    _e, f = make_entry_file(name=name, kind="model")
    p = file_path(db, storage, f)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as fh:
        fh.write(MESH)
    run_convert(db, storage, f)
    return f


def _fake(f06_name: str):
    text = (FIX / f"{f06_name}.f06").read_text(encoding="latin-1")

    def run(exe, workdir, deck_name, *, timeout, heartbeat=None):
        path = os.path.join(workdir, "deck.f06")
        with open(path, "w", encoding="latin-1") as fh:
            fh.write(text)
        return RunResult(0, False, path, "")
    return run


def test_auth_and_not_ready(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    _e, f = make_entry_file(name="q.bdf", kind="model")
    assert client.get(f"/api/files/{f.id}/solve-check").status_code == 401
    assert client.post(f"/api/files/{f.id}/solve-check").status_code == 401
    res = client.post(f"/api/files/{f.id}/solve-check", headers=h)
    assert res.status_code == 409 and res.json() == {"detail": "model_not_ready"}
    assert client.post("/api/files/999999/solve-check", headers=h).status_code == 404


def test_empty_shape(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    f = _converted(db, storage, make_entry_file)
    d = client.get(f"/api/files/{f.id}/solve-check", headers=h).json()
    assert set(d) == SHAPE
    assert d["state"] is None and d["error_types"] == [] and d["fixed_node_ids"] == [] and d["stale"] is False
    assert d["has_f06"] is False and d["requested_by"] is None
    assert client.get(f"/api/files/{f.id}/model", headers=h).json()["solve"] == {
        "state": None, "error_types": [], "stale": False}


def test_request_is_idempotent_and_audited(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001", name="홍길동")
    make_user("A100002")
    f = _converted(db, storage, make_entry_file)
    d = client.post(f"/api/files/{f.id}/solve-check", headers=auth_headers("A100001")).json()
    assert set(d) == SHAPE and d["state"] == "queued" and d["requested_by"] == "A100001"
    assert d["requested_by_name"] == "홍길동" and d["requested_at"]
    again = client.post(f"/api/files/{f.id}/solve-check", headers=auth_headers("A100002")).json()
    assert again["state"] == "queued" and again["requested_by"] == "A100001"
    db.expire_all()
    assert db.query(models.Job).filter_by(type="solve_check").count() == 1
    [a] = db.query(models.AuditLog).filter_by(action="SOLVE_CHECK").all()
    assert a.employee_id == "A100001" and a.target_id == str(f.id)


def test_result_f06_and_stale(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    f = _converted(db, storage, make_entry_file)
    client.post(f"/api/files/{f.id}/solve-check", headers=h)
    assert client.get(f"/api/files/{f.id}/solve-check.f06", headers=h).status_code == 404
    run_solve_check(db, storage, f.id, runner=_fake("mech"), nastran_exe="x.exe")
    d = client.get(f"/api/files/{f.id}/solve-check", headers=h).json()
    assert d["state"] == "fail" and d["error_types"] == ["mechanism"] and d["fatals"][0]["code"] == 9050
    assert d["fixed_node_ids"] == [1, 2, 3, 4] and d["spc_nodes"] == 4 and d["groups"] == 1
    assert d["has_f06"] and d["stale"] is False and isinstance(d["elapsed"], float) and d["finished_at"]
    res = client.get(f"/api/files/{f.id}/solve-check.f06", headers=h)
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/plain")
    assert "attachment" in res.headers["content-disposition"] and b"9050" in res.content
    assert int(res.headers["content-length"]) == len(res.content)
    assert client.get(f"/api/files/{f.id}/model", headers=h).json()["solve"] == {
        "state": "fail", "error_types": ["mechanism"], "stale": False}
    # 다시 변환돼 key 가 바뀌면 '다시 검증 필요'
    s = db.get(models.ModelSummary, f.id)
    s.key = "f" * 64
    db.commit()
    assert client.get(f"/api/files/{f.id}/solve-check", headers=h).json()["stale"] is True
    assert client.get(f"/api/files/{f.id}/model", headers=h).json()["solve"]["stale"] is True
    # 다시 검증을 누르면 이전 결과는 지워지고 대기로
    d = client.post(f"/api/files/{f.id}/solve-check", headers=h).json()
    assert d["state"] == "queued" and d["fatals"] == [] and d["has_f06"] is False and d["stale"] is False


def test_admin_bulk(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    make_user("A900001", is_admin=True)
    f1 = _converted(db, storage, make_entry_file, "a.bdf")
    f2 = _converted(db, storage, make_entry_file, "b.bdf")
    _e, q = make_entry_file(name="c.bdf", kind="model")          # 변환 안 됨 — 넣지 않는다
    assert client.post("/api/admin/ops/solve-check", headers=auth_headers("A100001"), json={}).status_code == 403
    ha = auth_headers("A900001")
    run_solve_check(db, storage, f1.id, runner=_fake("pass"), nastran_exe="x.exe")
    assert client.post("/api/admin/ops/solve-check", headers=ha, json={}).json() == {"queued": 1}   # f2 만
    assert client.post("/api/admin/ops/solve-check", headers=ha, json={}).json() == {"queued": 0}
    # force: 검증 중(f2)이 아닌 것 전부 → f1
    assert client.post("/api/admin/ops/solve-check", headers=ha, json={"force": True}).json() == {"queued": 1}
    db.expire_all()
    assert db.query(models.Job).filter_by(type="solve_check").count() == 2
    assert db.query(models.AuditLog).filter_by(action="OPS_SOLVE_CHECK").count() == 3
    assert db.get(models.SolveCheck, q.id) is None and db.get(models.SolveCheck, f2.id).requested_by == "A900001"


def test_failed_job_label_and_retry(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A900001", is_admin=True)
    ha = auth_headers("A900001")
    f = _converted(db, storage, make_entry_file, "lbl.bdf")
    db.add(models.SolveCheck(file_id=f.id, state="error", message="x"))
    job = models.Job(type="solve_check", target_id=f.id, state="failed", attempts=3, last_error="boom")
    db.add(job)
    db.commit()
    failed = client.get("/api/admin/ops/status", headers=ha).json()["failed"]
    assert failed[0]["type"] == "solve_check" and failed[0]["label"] == "lbl.bdf"
    assert client.post(f"/api/admin/ops/jobs/{job.id}/retry", headers=ha).json() == {"ok": True}
    db.expire_all()
    assert db.get(models.SolveCheck, f.id).state == "queued"


def test_cli_enqueue_all(db, storage, make_entry_file):
    from app.solve.job import enqueue_solve_all

    f = _converted(db, storage, make_entry_file)
    assert enqueue_solve_all(db) == 1 and enqueue_solve_all(db) == 0
    assert db.get(models.SolveCheck, f.id).state == "queued"
