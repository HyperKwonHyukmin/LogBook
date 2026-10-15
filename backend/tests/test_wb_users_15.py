"""15 — WorkBench 사용자 표(읽기 전용)·로그인·세션 끊김·WorkBench 관리자 자동 LV3·등급/단계 이전·CLI.

WorkBench 표는 logbook_test 안의 가짜 표(wb_users)다 — 실제 hitessworkbench 에 접속하지 않는다."""
import dataclasses
import re
from pathlib import Path

import pytest
from sqlalchemy import event, text

from app import access, database, models, wb_users


def _unavailable(monkeypatch):
    monkeypatch.setattr(wb_users, "settings", dataclasses.replace(
        wb_users.settings, wb_users_table=wb_users.settings.wb_users_table.rsplit(".", 1)[0] + ".no_such_wb"))
    wb_users.clear_cache()


# ---- 읽기 전용 ----

def test_workbench_table_is_never_written(client, make_user, auth_headers, wb, db, storage, make_entry_file):
    """로그인·매 요청 확인·사용자 관리·등급 지정·열람 허락·사용자 찾기 동안 WorkBench 표에 닿은 SQL 은 모두 SELECT."""
    table = wb_users.settings.wb_users_table.rsplit(".", 1)[1]
    seen: list[str] = []

    def spy(_conn, _cursor, statement, _params, _context, _many):
        if table in statement:
            seen.append(statement)

    event.listen(database.engine, "before_cursor_execute", spy)
    try:
        make_user("A900001", level=3)
        wb("A100003", name="처음")
        wb("A100004", name="WB관리자", admin=True)
        e, _f = make_entry_file(uploaded_by="A900001")
        seen.clear()   # 위 준비(테스트가 가짜 표를 채움)는 빼고, 앱이 낸 SQL 만 본다
        h = auth_headers("A900001")
        client.get("/api/auth/me", headers=h)
        client.get("/api/admin/users", headers=h)
        client.get("/api/admin/users", params={"q": "처"}, headers=h)
        client.put("/api/admin/users/A100003/level", json={"level": 2}, headers=h)
        client.put("/api/admin/users/A100004/level", json={"level": 1}, headers=h)
        client.get("/api/users/lookup", params={"q": "처"}, headers=h)
        client.put(f"/api/entries/{e.entry_id}/grants", json={"employee_id": "A100003"}, headers=h)
        client.get(f"/api/entries/{e.entry_id}", headers=h)
        client.get(f"/api/entries/{e.entry_id}/history", headers=h)
        client.get("/api/admin/ops/status", headers=h)
        client.post("/api/auth/login", json={"employee_id": "A100004"})
        client.post("/api/auth/login", json={"employee_id": "Z999999"})
    finally:
        event.remove(database.engine, "before_cursor_execute", spy)
    assert seen, "WorkBench 표를 읽은 SQL 이 하나도 없다 — 검사 대상이 틀렸다"
    assert all(s.lstrip().upper().startswith("SELECT") for s in seen), [s for s in seen if not s.lstrip().upper().startswith("SELECT")]


def test_workbench_module_has_no_write_statements():
    """모듈 글자에도 쓰기 구문이 없고, 표 정의는 앱 Base(만들기·지우기 대상)에 없다."""
    src = (Path(wb_users.__file__)).read_text(encoding="utf-8")
    code = "\n".join(line.split("#", 1)[0] for line in src.splitlines())
    code = re.sub(r'"""[\s\S]*?"""', "", code)
    for word in ("insert(", "update(", "delete(", ".insert", ".update", ".delete", "create_all", "drop_all",
                 "INSERT ", "UPDATE ", "DELETE ", "ALTER ", "CREATE ", "DROP ", "TRUNCATE", "text(", "execute(text"):
        assert word not in code, word
    table = wb_users.settings.wb_users_table.rsplit(".", 1)[1]
    assert table not in database.Base.metadata.tables
    assert "users" in database.Base.metadata.tables   # LogBook 자신의 표는 따로 있다


def test_table_name_is_validated(monkeypatch):
    monkeypatch.setattr(wb_users, "settings", dataclasses.replace(wb_users.settings,
                                                                  wb_users_table="x; DROP TABLE users"))
    with pytest.raises(wb_users.WbUnavailable):
        wb_users._table()


# ---- 로그인·세션 ----

def test_login_fails_clearly_when_workbench_unreadable(client, make_user, monkeypatch):
    make_user("A100001")
    _unavailable(monkeypatch)
    r = client.post("/api/auth/login", json={"employee_id": "A100001"})
    assert r.status_code == 503 and r.json()["detail"] == "wb_unavailable"


def test_requests_fail_when_workbench_unreadable_but_admin_can_see_status(client, make_user, auth_headers,
                                                                         monkeypatch):
    make_user("A100001", level=2)
    make_user("A900001", level=3)
    h, ha = auth_headers("A100001"), auth_headers("A900001")
    _unavailable(monkeypatch)
    r = client.get("/api/search", headers=h)
    assert r.status_code == 503 and r.json()["detail"] == "wb_unavailable"
    assert client.get("/api/auth/me", headers=h).status_code == 503     # 토큰은 지우지 않는다(401 아님)
    # LV3 는 운영 화면에서 원인을 본다
    assert client.get("/api/auth/me", headers=ha).status_code == 200
    st = client.get("/api/admin/ops/status", headers=ha).json()["wb_users"]
    assert st["ok"] is False and st["error"] == "표 없음" and st["table"].endswith(".no_such_wb")
    assert client.get("/api/search", headers=ha).status_code == 503
    # 로그아웃은 누구나
    assert client.post("/api/auth/logout", headers=h).status_code == 200


def test_ops_status_reports_workbench_table(client, make_user, auth_headers, wb):
    make_user("A900001", level=3)
    wb("A100004", admin=True)
    wb("A100006", active=False)
    st = client.get("/api/admin/ops/status", headers=auth_headers("A900001")).json()["wb_users"]
    assert st == st | {"ok": True, "active": 2, "admins": 1, "error": None}


def test_deactivated_in_workbench_cuts_session(client, make_user, auth_headers, wb, db):
    make_user("A100001", name="떠날사람", level=2)
    h = auth_headers("A100001")
    assert client.get("/api/auth/me", headers=h).status_code == 200
    wb("A100001", name="떠날사람", active=False)      # wb fixture 는 캐시도 비운다(시간이 지난 것과 같다)
    r = client.get("/api/search", headers=h)
    assert r.status_code == 401 and r.json()["detail"] == "wb_inactive"
    db.expire_all()
    assert db.query(models.UserSession).filter_by(employee_id="A100001").count() == 0
    # 다시 활성화돼도 끊긴 세션은 돌아오지 않는다 — 다시 로그인
    wb("A100001", name="떠날사람", active=True)
    assert client.get("/api/auth/me", headers=h).status_code == 401
    assert client.post("/api/auth/login", json={"employee_id": "A100001"}).status_code == 200


def test_activity_check_is_cached(client, make_user, auth_headers, db, monkeypatch):
    """매 요청 확인은 사번별로 캐시한다(기본 60초) — 그 사이 비활성화는 캐시가 끝난 뒤 반영된다."""
    make_user("A100001", level=2)
    h = auth_headers("A100001")
    calls = []
    real = wb_users.fetch

    def counting(db_, eid):
        calls.append(eid)
        return real(db_, eid)

    monkeypatch.setattr(wb_users, "fetch", counting)
    for _ in range(3):
        assert client.get("/api/auth/me", headers=h).status_code == 200
    assert calls == []          # 로그인에서 읽은 값이 캐시에 있다
    with database.engine.begin() as conn:
        conn.execute(text("UPDATE wb_users SET is_active = 0 WHERE employee_id = 'A100001'"))
    assert client.get("/api/auth/me", headers=h).status_code == 200      # 아직 캐시
    monkeypatch.setattr(wb_users, "settings", dataclasses.replace(wb_users.settings, wb_cache_seconds=0))
    assert client.get("/api/auth/me", headers=h).status_code == 401
    assert calls == ["A100001"]


def test_workbench_admin_is_level3_automatically(client, make_user, auth_headers, wb, db):
    make_user("A100001", name="관리자될사람", level=1)
    h = auth_headers("A100001")
    assert client.get("/api/admin/users", headers=h).status_code == 403
    wb("A100001", name="관리자될사람", admin=True)
    me = client.get("/api/auth/me", headers=h).json()
    assert (me["level"], me["stored_level"], me["wb_admin"], me["is_admin"]) == (3, 1, True, True)
    assert client.get("/api/admin/users", headers=h).status_code == 200
    db.expire_all()
    assert db.query(models.User).filter_by(employee_id="A100001").one().wb_admin is True
    # WorkBench 에서 관리자가 풀리면 저장값으로 돌아간다
    wb("A100001", name="관리자될사람", admin=False)
    assert client.get("/api/auth/me", headers=h).json()["level"] == 1


def test_level_of_rules():
    class U:
        def __init__(self, level, wb_admin=False):
            self.level, self.wb_admin, self.employee_id = level, wb_admin, "X"

    assert access.level_of(None) == 0
    assert [access.level_of(U(x)) for x in (None, 1, 2, 3, 9)] == [1, 1, 2, 3, 1]
    assert access.level_of(U(1, wb_admin=True)) == 3
    assert access.level_of(access.SYSTEM) == 3


# ---- 이전 ----

def test_migrate_levels_idempotent(db):
    """13 등급(또는 13 이전 is_admin)·상태 → LV. level 이 빈 행만, 두 번째부터 0행."""
    rows = [("M1", "master", 0, "active"), ("A1", "admin", 1, "active"), ("V1", "viewer_all", 0, "active"),
            ("B1", "member", 0, "active"), ("G1", "guest", 0, "active"), ("P1", "member", 0, "pending"),
            ("D1", "member", 0, "disabled"), ("O1", "member", 1, "active"),   # 13 이전 관리자(role 기본값 member)
            ("K1", "member", 0, "active")]
    for eid, role, adm, st in rows:
        db.add(models.User(employee_id=eid, name=eid, status=st, level=1))
    db.commit()
    with database.engine.begin() as conn:
        for eid, role, adm, st in rows:
            conn.execute(text("UPDATE users SET role = :r, is_admin = :a, level = NULL WHERE employee_id = :e"),
                         {"r": role, "a": adm, "e": eid})
        conn.execute(text("UPDATE users SET level = 2 WHERE employee_id = 'K1'"))   # 이미 정한 사람은 그대로
    assert database.migrate_levels() == 8
    assert database.migrate_levels() == 0
    db.expire_all()
    got = dict(db.query(models.User.employee_id, models.User.level))
    assert got == {"M1": 3, "A1": 3, "V1": 2, "B1": 2, "G1": 1, "P1": 1, "D1": 1, "O1": 3, "K1": 2}


def test_migrate_access_idempotent(db, make_entry_file):
    e1, _ = make_entry_file(title="공개")
    e2, _ = make_entry_file(title="비공개 전체")
    e3, _ = make_entry_file(title="비공개 관리자")
    e4, _ = make_entry_file(title="이미 공유")
    with database.engine.begin() as conn:
        for e, acc, mr in ((e1, "public", "viewer_all"), (e2, "private", "viewer_all"), (e3, "private", "admin"),
                           (e4, "shared", "viewer_all")):
            conn.execute(text("UPDATE entries SET access = :a, private_min_role = :m WHERE id = :i"),
                         {"a": acc, "m": mr, "i": e.id})
    assert database.migrate_access() == 3
    assert database.migrate_access() == 0
    db.expire_all()
    got = {e.title: e.access for e in db.query(models.Entry)}
    assert got == {"공개": "normal", "비공개 전체": "normal", "비공개 관리자": "blocked", "이미 공유": "shared"}


@pytest.mark.fresh_schema   # 스키마를 바꾼다(conftest 'DB 초기화')
def test_init_schema_adds_columns_and_migrates(db):
    """기존 DB(15 이전): level·wb_admin 열이 없다 → 시작 때 더하고 채운다."""
    db.add(models.User(employee_id="A1", name="a", status="active", level=3))
    db.commit()
    db.rollback()
    with database.engine.begin() as conn:
        conn.execute(text("ALTER TABLE users DROP COLUMN level"))
        conn.execute(text("ALTER TABLE users DROP COLUMN wb_admin"))
        conn.execute(text("UPDATE users SET role = 'admin'"))
    added = database.init_schema()
    assert "users.level" in added and "users.wb_admin" in added
    assert any(a.startswith("users.level(13 등급") for a in added)
    db.expire_all()
    assert db.query(models.User).one().level == 3
    assert database.init_schema() == []


# ---- CLI ----

def test_cli_set_level(db, storage, make_user, wb):
    from app.cli import create_admin, main, set_level_cli

    make_user("A100001", level=2)
    u = set_level_cli(db, storage, "a100001", 1)
    assert u.level == 1
    wb("A100009", name="처음")      # LogBook 에 들어온 적 없는 WorkBench 사용자도 된다
    assert set_level_cli(db, storage, "A100009", 3).level == 3
    with pytest.raises(ValueError, match="마지막 LV3"):
        set_level_cli(db, storage, "A100009", 2)     # 실효 LV3 가 0명이 된다
    wb("A100004", admin=True)
    assert set_level_cli(db, storage, "A100009", 2).level == 2   # WorkBench 관리자가 있으니 된다
    with pytest.raises(ValueError, match="WorkBench 관리자"):
        set_level_cli(db, storage, "A100004", 1)
    with pytest.raises(ValueError, match="없는 사번"):
        set_level_cli(db, storage, "Z999999", 1)
    wb("A100006", active=False)
    with pytest.raises(ValueError, match="활성 사용자가 아닙니다"):
        set_level_cli(db, storage, "A100006", 2)
    assert db.query(models.AuditLog).filter_by(action="USER_LEVEL").count() == 3
    c = create_admin(db, storage, "A100007", "부트", None)
    assert c.level == 3 and c.is_admin is True
    assert main(["set-level", "A100001", "2"]) == 0
    assert main(["set-level", "Z999999", "2"]) == 2


def test_registry_and_rebuild_keep_levels(db, storage, make_user, make_entry_file):
    from app.ops.rebuild import rebuild
    from app.ops.registry import read_registry, write_registry
    from app.entries.files import write_entry_files

    make_user("A100001", level=1)
    make_user("A100002", level=2)
    make_user("A100003", level=3)
    make_user("A100004", level=1, wb_admin=True)
    e, _ = make_entry_file(title="공유 자료", uploaded_by="A100001")
    e.access = "shared"
    db.commit()
    write_entry_files(db, storage, e)
    write_registry(db, storage)
    reg = read_registry(storage)
    assert {u["employee_id"]: (u["level"], u["wb_admin"]) for u in reg["users"]} == {
        "A100001": (1, False), "A100002": (2, False), "A100003": (3, False), "A100004": (1, True)}
    assert "role" not in reg["users"][0] and "is_admin" not in reg["users"][0]
    eid = e.entry_id
    assert reg["entry_access"] == [{"entry_id": eid, "access": "shared"}]
    db.rollback()
    database.Base.metadata.drop_all(database.engine)
    database.Base.metadata.create_all(database.engine)
    db.expire_all()
    rebuild(db, storage, force=True)
    assert dict(db.query(models.User.employee_id, models.User.level)) == {
        "A100001": 1, "A100002": 2, "A100003": 3, "A100004": 1}
    assert db.query(models.Entry).filter_by(entry_id=eid).one().access == "shared"


def test_rebuild_maps_13_registry_levels(db, storage):
    """13(또는 그 이전) registry — role·is_admin·status 로 등급을 정한다(이전 규칙과 같다)."""
    import json

    from app.ops.rebuild import _level_of, access_value

    assert [_level_of(u) for u in (
        {"role": "master"}, {"role": "admin"}, {"role": "viewer_all"}, {"role": "member"}, {"role": "guest"},
        {"is_admin": True}, {}, {"status": "pending"}, {"status": "disabled", "role": "admin"}, {"level": 2},
    )] == [3, 3, 2, 2, 1, 3, 2, 1, 1, 2]
    assert [access_value(*a) for a in (("public", None), ("private", "viewer_all"), ("private", "admin"),
                                       ("shared", None), ("blocked", None), (None, None))] == [
        "normal", "normal", "blocked", "shared", "blocked", "normal"]
    json.dumps({})  # (형식 확인용 — 아무것도 쓰지 않는다)
