"""사용자 관리(15, LV3 전용) — WorkBench 활성 사용자 목록과 LogBook 등급 지정.

가입 승인·거절·비활성·활성은 없앴다(활성 여부는 WorkBench 가 정한다)."""
import dataclasses

from app import models, wb_users


def _admin(make_user, auth_headers):
    make_user("A900001", name="관리자", level=3)
    return auth_headers("A900001")


def _unavailable(monkeypatch):
    monkeypatch.setattr(wb_users, "settings", dataclasses.replace(
        wb_users.settings, wb_users_table=wb_users.settings.wb_users_table.rsplit(".", 1)[0] + ".no_such_wb"))
    wb_users.clear_cache()


def test_non_admin_is_forbidden(client, make_user, auth_headers):
    make_user("A100001", level=2)
    res = client.get("/api/admin/users", headers=auth_headers("A100001"))
    assert res.status_code == 403 and res.json()["detail"] == "admin_required"


def test_list_is_workbench_active_users(client, make_user, auth_headers, wb):
    h = _admin(make_user, auth_headers)
    make_user("A100002", name="일반", level=2)
    wb("A100003", name="처음", department="구조")          # LogBook 에 들어온 적 없는 WB 사용자
    wb("A100004", name="WB관리자", admin=True)
    make_user("A100005", name="떠난사람", level=2, wb_active=False)   # WorkBench 에서 비활성
    wb("A100006", name="대기", active=False)                 # WB 비활성 + LogBook 행 없음 → 목록에 없음
    rows = {r["employee_id"]: r for r in client.get("/api/admin/users", headers=h).json()}
    assert set(rows) == {"A900001", "A100002", "A100003", "A100004", "A100005"}
    assert rows["A100003"] == rows["A100003"] | {"name": "처음", "department": "구조", "level": 1, "known": False,
                                                 "wb_active": True, "wb_admin": False}
    assert rows["A100004"]["level"] == 3 and rows["A100004"]["wb_admin"] is True and rows["A100004"]["stored_level"] == 1
    assert rows["A100005"]["wb_active"] is False and rows["A100005"]["level"] == 2
    assert rows["A100002"]["level"] == 2 and rows["A100002"]["known"] is True
    # 찾기 — 이름·사번 앞부분
    got = [r["employee_id"] for r in client.get("/api/admin/users", params={"q": "처"}, headers=h).json()]
    assert got == ["A100003"]
    got = [r["employee_id"] for r in client.get("/api/admin/users", params={"q": "a10000"}, headers=h).json()]
    assert set(got) == {"A100002", "A100003", "A100004", "A100005"}


def test_set_level_audits_and_registry(client, make_user, auth_headers, db, storage):
    h = _admin(make_user, auth_headers)
    make_user("A100002", name="일반", level=2)
    res = client.put("/api/admin/users/A100002/level", json={"level": 1}, headers=h)
    assert res.status_code == 200 and res.json()["level"] == 1
    db.expire_all()
    log = db.query(models.AuditLog).filter_by(action="USER_LEVEL", target_id="A100002").one()
    assert log.employee_id == "A900001" and log.before["level"] == 2 and log.after["level"] == 1
    from app.ops.registry import read_registry
    assert {u["employee_id"]: u["level"] for u in read_registry(storage)["users"]}["A100002"] == 1
    # 같은 값은 감사 없이 그대로
    assert client.put("/api/admin/users/A100002/level", json={"level": 1}, headers=h).status_code == 200
    db.expire_all()
    assert db.query(models.AuditLog).filter_by(action="USER_LEVEL").count() == 1
    # 그 사람의 다음 요청부터 바로 반영
    assert client.get("/api/auth/me", headers=auth_headers("A100002")).json()["level"] == 1


def test_set_level_creates_local_row_for_new_workbench_user(client, make_user, auth_headers, wb, db):
    h = _admin(make_user, auth_headers)
    wb("A100003", name="처음", department="구조")
    res = client.put("/api/admin/users/A100003/level", json={"level": 2}, headers=h)
    assert res.status_code == 200 and res.json()["level"] == 2 and res.json()["name"] == "처음"
    db.expire_all()
    u = db.query(models.User).filter_by(employee_id="A100003").one()
    assert (u.level, u.department, u.status) == (2, "구조", "active")
    # 처음 로그인해도 지정한 등급 그대로(LV1 로 덮지 않는다)
    assert client.post("/api/auth/login", json={"employee_id": "A100003"}).json()["user"]["level"] == 2


def test_set_level_rules(client, make_user, auth_headers, wb):
    h = _admin(make_user, auth_headers)
    r = client.put("/api/admin/users/A900001/level", json={"level": 2}, headers=h)
    assert r.status_code == 400 and r.json()["detail"] == "cannot_change_self"
    wb("A100004", name="WB관리자", admin=True)
    r = client.put("/api/admin/users/A100004/level", json={"level": 1}, headers=h)
    assert r.status_code == 409 and r.json()["detail"] == "wb_admin_locked"
    wb("A100006", name="대기", active=False)
    r = client.put("/api/admin/users/A100006/level", json={"level": 2}, headers=h)
    assert r.status_code == 422 and r.json()["detail"] == "wb_user_inactive"
    r = client.put("/api/admin/users/Z999999/level", json={"level": 2}, headers=h)
    assert r.status_code == 404 and r.json()["detail"] == "user_not_found"
    assert client.put("/api/admin/users/A100004/level", json={"level": 4}, headers=h).status_code == 422
    # LV2 는 등급을 못 바꾼다
    make_user("A100002", level=2)
    r = client.put("/api/admin/users/A100004/level", json={"level": 2}, headers=auth_headers("A100002"))
    assert r.status_code == 403


def test_level3_can_be_given_and_used(client, make_user, auth_headers):
    """LV3 끼리 동등 — 새 LV3 도 등급을 바꿀 수 있고, 처음 LV3 를 내릴 수도 있다(자기 자신만 못 바꾼다)."""
    h = _admin(make_user, auth_headers)
    make_user("A100002", level=2)
    assert client.put("/api/admin/users/A100002/level", json={"level": 3}, headers=h).json()["level"] == 3
    h2 = auth_headers("A100002")
    assert client.put("/api/admin/users/A900001/level", json={"level": 2}, headers=h2).json()["level"] == 2
    assert client.get("/api/admin/users", headers=h).status_code == 403


def test_list_reports_workbench_unavailable(client, make_user, auth_headers, monkeypatch):
    h = _admin(make_user, auth_headers)
    client.get("/api/auth/me", headers=h)       # 캐시가 있어도 목록은 WorkBench 를 직접 읽는다
    _unavailable(monkeypatch)
    r = client.get("/api/admin/users", headers=h)
    assert r.status_code == 503 and r.json()["detail"] == "wb_unavailable"


def test_removed_endpoints(client, make_user, auth_headers):
    """가입 승인·거절·비활성·활성·13 등급 API 는 없다."""
    h = _admin(make_user, auth_headers)
    make_user("A100002", level=2)
    for path, body in (("approve", None), ("reject", None), ("disable", None), ("enable", None)):
        assert client.post(f"/api/admin/users/A100002/{path}", headers=h).status_code in (404, 405)
    assert client.put("/api/admin/users/A100002/role", json={"role": "admin"}, headers=h).status_code in (404, 405)
