from app import models


def test_register_creates_pending_user_and_audit(client, db):
    res = client.post("/api/auth/register",
                      json={"employee_id": "a476854", "name": "권혁민", "department": "구조시스템연구실"})
    assert res.status_code == 201
    assert res.json() == {"employee_id": "A476854", "status": "pending"}
    db.expire_all()
    assert db.query(models.User).filter_by(employee_id="A476854").one().status == "pending"
    assert db.query(models.AuditLog).filter_by(action="USER_REGISTER").count() == 1


def test_register_audit_after_includes_position(client, db):
    res = client.post(
        "/api/auth/register",
        json={"employee_id": "A300009", "name": "홍길동", "department": "구조", "position": "책임연구원"},
    )
    assert res.status_code == 201
    db.expire_all()
    log = db.query(models.AuditLog).filter_by(action="USER_REGISTER", target_id="A300009").one()
    assert log.after["position"] == "책임연구원"
    assert log.after["status"] == "pending"


def test_register_rejects_blank_name_after_strip(client):
    res = client.post("/api/auth/register", json={"employee_id": "A300010", "name": "   "})
    assert res.status_code == 422


def test_register_rejects_bad_format(client):
    res = client.post("/api/auth/register", json={"employee_id": "12345", "name": "x"})
    assert res.status_code == 422
    assert res.json()["detail"] == "invalid_employee_id"


def test_register_rejects_duplicate(client, make_user):
    make_user("A476854")
    res = client.post("/api/auth/register", json={"employee_id": "A476854", "name": "x"})
    assert res.status_code == 409
    assert res.json()["detail"] == "already_registered"


def test_register_rejects_arabic_indic_digits(client):
    # \d 가 유니코드 숫자 전체를 매치하던 시절엔 이 값이 통과했다 — ASCII 숫자만 허용해야 한다.
    res = client.post("/api/auth/register", json={"employee_id": "B١٢٣٤٥", "name": "x"})
    assert res.status_code == 422
    assert res.json()["detail"] == "invalid_employee_id"


def test_register_rejects_fullwidth_digits(client):
    res = client.post("/api/auth/register", json={"employee_id": "B１２３４５", "name": "x"})
    assert res.status_code == 422
    assert res.json()["detail"] == "invalid_employee_id"


def test_register_rejects_duplicate_on_concurrent_commit(client, monkeypatch, make_user):
    """동시에 같은 사번이 들어오면 사전 조회는 통과해도 커밋 시점에 unique 제약이 막는다."""
    from sqlalchemy.exc import IntegrityError

    from app import audit as audit_module

    def _boom(*a, **kw):
        raise IntegrityError("stmt", {}, Exception("duplicate"))

    monkeypatch.setattr(audit_module, "record", _boom)
    res = client.post("/api/auth/register", json={"employee_id": "A300001", "name": "x"})
    assert res.status_code == 409
    assert res.json()["detail"] == "already_registered"


def test_login_rejects_bad_format(client):
    res = client.post("/api/auth/login", json={"employee_id": "12345"})
    assert res.status_code == 422
    assert res.json()["detail"] == "invalid_employee_id"


def test_login_rejects_arabic_indic_digits(client, make_user):
    make_user("A300002")
    res = client.post("/api/auth/login", json={"employee_id": "A٣٠٠٠٠٢"})
    assert res.status_code == 422
    assert res.json()["detail"] == "invalid_employee_id"


def test_login_not_registered(client):
    res = client.post("/api/auth/login", json={"employee_id": "Z999999"})
    assert res.status_code == 404
    assert res.json()["detail"] == "not_registered"


def test_login_pending(client, make_user):
    make_user("A200001", status="pending")
    res = client.post("/api/auth/login", json={"employee_id": "A200001"})
    assert res.status_code == 403
    assert res.json()["detail"] == "pending_approval"


def test_login_disabled(client, make_user):
    make_user("A200002", status="disabled")
    res = client.post("/api/auth/login", json={"employee_id": "A200002"})
    assert res.status_code == 403
    assert res.json()["detail"] == "account_disabled"


def test_login_success_returns_token_and_user(client, make_user, db):
    make_user("A200003", name="김철수")
    res = client.post("/api/auth/login", json={"employee_id": "a200003"})
    assert res.status_code == 200
    body = res.json()
    assert len(body["token"]) == 36
    assert body["user"]["employee_id"] == "A200003"
    assert body["user"]["login_count"] == 1


def test_login_cleans_up_this_users_expired_sessions(client, make_user, db):
    from datetime import datetime, timedelta

    from app import models

    make_user("A200005", name="정만수")
    res1 = client.post("/api/auth/login", json={"employee_id": "A200005"})
    old_token = res1.json()["token"]
    db.query(models.UserSession).filter_by(token=old_token).update(
        {"expires_at": datetime.now() - timedelta(hours=1)}
    )
    db.commit()

    client.post("/api/auth/login", json={"employee_id": "A200005"})

    db.expire_all()
    assert db.query(models.UserSession).filter_by(token=old_token).count() == 0


def test_me_requires_token(client):
    assert client.get("/api/auth/me").status_code == 401


def test_me_and_logout(client, make_user, auth_headers):
    make_user("A200004", name="이영희")
    headers = auth_headers("A200004")
    assert client.get("/api/auth/me", headers=headers).json()["name"] == "이영희"
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_me_accepts_lowercase_bearer_scheme(client, make_user, auth_headers):
    make_user("A200006", name="최수아")
    token = auth_headers("A200006")["Authorization"].removeprefix("Bearer ")
    res = client.get("/api/auth/me", headers={"Authorization": f"bearer {token}"})
    assert res.status_code == 200
    assert res.json()["name"] == "최수아"
