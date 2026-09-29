# backend/tests/test_users_api.py
from app import models


def _admin(make_user, auth_headers):
    make_user("A900001", name="관리자", is_admin=True)
    return auth_headers("A900001")


def test_non_admin_is_forbidden(client, make_user, auth_headers):
    make_user("A100001")
    res = client.get("/api/admin/users", headers=auth_headers("A100001"))
    assert res.status_code == 403


def test_list_filters_by_status(client, make_user, auth_headers):
    h = _admin(make_user, auth_headers)
    make_user("A100002", status="pending")
    make_user("A100003", status="disabled")
    res = client.get("/api/admin/users?status=pending", headers=h)
    assert [u["employee_id"] for u in res.json()] == ["A100002"]
    assert len(client.get("/api/admin/users", headers=h).json()) == 3


def test_approve_activates_and_audits(client, make_user, auth_headers, db):
    h = _admin(make_user, auth_headers)
    make_user("A100004", status="pending")
    res = client.post("/api/admin/users/A100004/approve", headers=h)
    assert res.status_code == 200
    assert res.json()["status"] == "active"
    db.expire_all()
    log = db.query(models.AuditLog).filter_by(action="USER_APPROVE").one()
    assert log.employee_id == "A900001"
    assert log.before["status"] == "pending" and log.after["status"] == "active"
    assert client.post("/api/auth/login", json={"employee_id": "A100004"}).status_code == 200


def test_approve_requires_pending_status(client, make_user, auth_headers):
    h = _admin(make_user, auth_headers)
    make_user("A100010", status="active")
    res = client.post("/api/admin/users/A100010/approve", headers=h)
    assert res.status_code == 409
    assert res.json()["detail"] == "not_pending"


def test_enable_requires_disabled_status(client, make_user, auth_headers):
    h = _admin(make_user, auth_headers)
    make_user("A100011", status="active")
    res = client.post("/api/admin/users/A100011/enable", headers=h)
    assert res.status_code == 409
    assert res.json()["detail"] == "not_disabled"


def test_disable_requires_active_status(client, make_user, auth_headers):
    h = _admin(make_user, auth_headers)
    make_user("A100012", status="disabled")
    res = client.post("/api/admin/users/A100012/disable", headers=h)
    assert res.status_code == 409
    assert res.json()["detail"] == "not_active"


def test_reject_deletes_pending_only(client, make_user, auth_headers, db):
    h = _admin(make_user, auth_headers)
    make_user("A100005", status="pending")
    make_user("A100006", status="active")
    assert client.post("/api/admin/users/A100005/reject", headers=h).status_code == 200
    assert client.post("/api/admin/users/A100006/reject", headers=h).status_code == 409
    db.expire_all()
    assert db.query(models.User).filter_by(employee_id="A100005").count() == 0
    assert db.query(models.AuditLog).filter_by(action="USER_REJECT").count() == 1


def test_disable_revokes_sessions(client, make_user, auth_headers):
    h = _admin(make_user, auth_headers)
    make_user("A100007")
    user_headers = auth_headers("A100007")
    assert client.post("/api/admin/users/A100007/disable", headers=h).json()["status"] == "disabled"
    assert client.get("/api/auth/me", headers=user_headers).status_code == 401
    assert client.post("/api/admin/users/A100007/enable", headers=h).json()["status"] == "active"


def test_admin_cannot_disable_or_demote_self(client, make_user, auth_headers):
    h = _admin(make_user, auth_headers)
    assert client.post("/api/admin/users/A900001/disable", headers=h).status_code == 400
    res = client.put("/api/admin/users/A900001/admin", json={"is_admin": False}, headers=h)
    assert res.status_code == 400


def test_grant_admin(client, make_user, auth_headers, db):
    h = _admin(make_user, auth_headers)
    make_user("A100008")
    res = client.put("/api/admin/users/A100008/admin", json={"is_admin": True}, headers=h)
    assert res.json()["is_admin"] is True
    db.expire_all()
    assert db.query(models.AuditLog).filter_by(action="USER_ADMIN_GRANT").count() == 1


def test_unknown_user_404(client, make_user, auth_headers):
    h = _admin(make_user, auth_headers)
    assert client.post("/api/admin/users/Z000000/approve", headers=h).status_code == 404
