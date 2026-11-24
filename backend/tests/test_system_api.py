# backend/tests/test_system_api.py
from app import audit


def test_health_needs_no_login_and_reports_storage(client):
    res = client.get("/api/system/health")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["storage"]["reachable"] is True
    assert body["version"] == "0.1.0"


def test_health_reports_unreachable_storage(client, tmp_path):
    from app.dependencies import get_storage
    from app.storage.paths import StoragePaths

    client.app.dependency_overrides[get_storage] = lambda: StoragePaths(tmp_path / "끊김")
    assert client.get("/api/system/health").json()["storage"]["reachable"] is False


def test_audit_list_requires_login(client):
    assert client.get("/api/audit").status_code == 401


def test_audit_list_newest_first_with_filters(client, make_user, auth_headers, db, storage):
    make_user("A900001", level=3)
    h = auth_headers("A900001")
    audit.record(db, storage, actor="A100001", action="USER_REGISTER", target_type="user", target_id="A1")
    audit.record(db, storage, actor="A100001", action="USER_APPROVE", target_type="user", target_id="A2")
    rows = client.get("/api/audit?limit=10", headers=h).json()
    assert [r["action"] for r in rows] == ["USER_APPROVE", "USER_REGISTER"]
    assert rows[0]["target"] == {"type": "user", "id": "A2"}
    only = client.get("/api/audit?action=USER_REGISTER", headers=h).json()
    assert [r["target"]["id"] for r in only] == ["A1"]


def test_audit_list_admin_only(client, make_user, auth_headers, db, storage):
    # 2026-11-24 — 활동 로그는 관리자(LV3)만. LV1·LV2 는 403, 관리자는 바뀐 내용까지 본다
    make_user("A100001")
    make_user("M100001", level=2)
    make_user("A900001", level=3)
    audit.record(db, storage, actor="A900001", action="ENTRY_UPDATE", target_type="entry", target_id="LB-GONE",
                 before={"title": "비공개 제목"}, after={"title": "바뀐 제목"})
    for eid in ("A100001", "M100001"):
        r = client.get("/api/audit", headers=auth_headers(eid))
        assert r.status_code == 403 and r.json()["detail"] == "admin_required", eid
    admin = client.get("/api/audit", headers=auth_headers("A900001")).json()
    assert admin[0]["before"] == {"title": "비공개 제목"} and admin[0]["after"] == {"title": "바뀐 제목"}
