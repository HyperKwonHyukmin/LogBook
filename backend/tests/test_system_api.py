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
    make_user("A100001")
    h = auth_headers("A100001")
    audit.record(db, storage, actor="A100001", action="USER_REGISTER", target_type="user", target_id="A1")
    audit.record(db, storage, actor="A100001", action="USER_APPROVE", target_type="user", target_id="A2")
    rows = client.get("/api/audit?limit=10", headers=h).json()
    assert [r["action"] for r in rows] == ["USER_APPROVE", "USER_REGISTER"]
    assert rows[0]["target"] == {"type": "user", "id": "A2"}
    only = client.get("/api/audit?action=USER_REGISTER", headers=h).json()
    assert [r["target"]["id"] for r in only] == ["A1"]
