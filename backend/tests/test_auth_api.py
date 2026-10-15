"""로그인·로그아웃·내 정보(15 — 사용자는 WorkBench 가입자, 자체 가입 없음).

WorkBench 사용자 표는 가짜 표(conftest wb fixture)다. 표 읽기 전용·세션 끊김·LV 규칙은 test_wb_users_15.py."""
from app import models


def test_register_is_gone(client, db):
    """15 — LogBook 자체 가입은 없앴다(WorkBench 에서 가입·승인)."""
    res = client.post("/api/auth/register",
                      json={"employee_id": "a476854", "name": "권혁민", "department": "구조시스템연구실"})
    assert res.status_code == 410
    assert res.json()["detail"] == "register_moved"
    db.expire_all()
    assert db.query(models.User).count() == 0


def test_login_rejects_bad_format(client):
    res = client.post("/api/auth/login", json={"employee_id": "12345"})
    assert res.status_code == 422
    assert res.json()["detail"] == "invalid_employee_id"


def test_login_rejects_arabic_indic_digits(client, make_user):
    make_user("A300002")
    res = client.post("/api/auth/login", json={"employee_id": "A٣٠٠٠٠٢"})
    assert res.status_code == 422
    assert res.json()["detail"] == "invalid_employee_id"


def test_login_rejects_fullwidth_digits(client):
    # \d 가 유니코드 숫자 전체를 매치하던 시절엔 이 값이 통과했다 — ASCII 숫자만 허용해야 한다.
    res = client.post("/api/auth/login", json={"employee_id": "B１２３４５"})
    assert res.status_code == 422
    assert res.json()["detail"] == "invalid_employee_id"


def test_login_not_registered(client):
    """WorkBench 표에 없는 사번."""
    res = client.post("/api/auth/login", json={"employee_id": "Z999999"})
    assert res.status_code == 404
    assert res.json()["detail"] == "not_registered"


def test_login_inactive_in_workbench(client, wb):
    """WorkBench 승인 대기·비활성(is_active=0)은 들어올 수 없다."""
    wb("A200001", name="대기중", active=False)
    res = client.post("/api/auth/login", json={"employee_id": "A200001"})
    assert res.status_code == 403
    assert res.json()["detail"] == "wb_inactive"


def test_login_success_returns_token_and_user(client, make_user, db):
    make_user("A200003", name="김철수")
    res = client.post("/api/auth/login", json={"employee_id": "a200003"})
    assert res.status_code == 200
    body = res.json()
    assert len(body["token"]) == 36
    assert body["user"]["employee_id"] == "A200003"
    assert body["user"]["login_count"] == 1


def test_first_login_creates_level1_user(client, wb, db):
    """처음 들어온 WorkBench 가입자 — LogBook 행을 LV1 로 만들고 감사 USER_JOIN."""
    wb("A200007", name="새사람", department="구조", position="연구원")
    res = client.post("/api/auth/login", json={"employee_id": "A200007"})
    assert res.status_code == 200
    u = res.json()["user"]
    assert (u["level"], u["stored_level"], u["wb_admin"], u["is_admin"]) == (1, 1, False, False)
    assert (u["name"], u["department"], u["position"]) == ("새사람", "구조", "연구원")
    db.expire_all()
    row = db.query(models.User).filter_by(employee_id="A200007").one()
    assert row.level == 1 and row.status == "active"
    assert db.query(models.AuditLog).filter_by(action="USER_JOIN", target_id="A200007").count() == 1
    # 두 번째 로그인은 새로 만들지 않는다
    assert client.post("/api/auth/login", json={"employee_id": "A200007"}).status_code == 200
    db.expire_all()
    assert db.query(models.AuditLog).filter_by(action="USER_JOIN").count() == 1


def test_login_refreshes_name_from_workbench(client, make_user, wb, db):
    make_user("A200008", name="옛이름")
    wb("A200008", name="새이름", department="새부서", position="책임")
    u = client.post("/api/auth/login", json={"employee_id": "A200008"}).json()["user"]
    assert (u["name"], u["department"], u["position"]) == ("새이름", "새부서", "책임")
    db.expire_all()
    assert db.query(models.User).filter_by(employee_id="A200008").one().name == "새이름"


def test_login_cleans_up_this_users_expired_sessions(client, make_user, db):
    from datetime import datetime, timedelta

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
