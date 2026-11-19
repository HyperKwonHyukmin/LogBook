"""2026-11-19 — 구조시스템연구실 설명회와 LogBook 오픈: 그 부서 사람은 LV2(일반 자료 열람, 남의 자료 수정·휴지통 불가).

- 로그인(auth.admit — 사번, Windows, WorkBench 자동 로그인 공통)에서 부서가 LV2 부서이고 LV1 이면 LV2 로 올린다.
  감사 USER_LEVEL(행위자 system). 내리지 않고 LV3 는 건드리지 않는다. 다른 부서는 그대로 LV1.
- CLI level-dept: 로그인을 기다리지 않고 한 번에(아직 LogBook 에 온 적 없는 사람은 행을 만든다).
- level-guest(31) 는 이 부서 사람을 내리지 않는다.
WorkBench 표는 logbook_test 안의 가짜 표다(conftest wb_put)."""
from app import models
from app.roles import department_to_lv2, reset_to_guest

DEPT = "구조시스템연구실"


def _level(db, eid):
    db.expire_all()
    return db.query(models.User).filter_by(employee_id=eid).one().level


def test_login_promotes_department_member_once(client, db, wb, make_entry_file):
    wb("A500001", name="김연구", department=DEPT)
    wb("A500002", name="박타부", department="선체설계부")
    entry, _ = make_entry_file(title="일반 자료")   # 공개 단계 기본 = 일반

    assert client.post("/api/auth/login", json={"employee_id": "A500001"}).status_code == 200
    assert client.post("/api/auth/login", json={"employee_id": "A500002"}).status_code == 200
    assert _level(db, "A500001") == 2 and _level(db, "A500002") == 1
    logs = db.query(models.AuditLog).filter_by(action="USER_LEVEL", target_id="A500001").all()
    assert len(logs) == 1 and logs[0].employee_id == "system"
    assert logs[0].before["level"] == 1 and logs[0].after["level"] == 2

    # 다시 로그인해도 감사 기록이 늘지 않는다
    client.post("/api/auth/login", json={"employee_id": "A500001"})
    assert db.query(models.AuditLog).filter_by(action="USER_LEVEL", target_id="A500001").count() == 1

    # LV2 = 일반 자료는 보이고, 남의 자료는 고치지 못한다
    tok = client.post("/api/auth/login", json={"employee_id": "A500001"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert client.get(f"/api/entries/{entry.entry_id}", headers=h).status_code == 200
    assert client.patch(f"/api/entries/{entry.entry_id}", headers=h, json={"title": "바꿈", "version": entry.version}).status_code == 403
    assert client.delete(f"/api/entries/{entry.entry_id}", headers=h).status_code == 403
    # 다른 부서(LV1)는 일반 자료가 없는 것처럼 보인다
    tok2 = client.post("/api/auth/login", json={"employee_id": "A500002"}).json()["token"]
    assert client.get(f"/api/entries/{entry.entry_id}", headers={"Authorization": f"Bearer {tok2}"}).status_code == 404


def test_login_never_lowers_or_touches_level3(client, db, wb, make_user):
    make_user("A500003", level=3)
    wb("A500003", name="관리", department=DEPT)
    client.post("/api/auth/login", json={"employee_id": "A500003"})
    assert _level(db, "A500003") == 3
    assert db.query(models.AuditLog).filter_by(action="USER_LEVEL", target_id="A500003").count() == 0


def test_cli_level_dept_preview_then_apply(db, storage, wb, make_user):
    wb("A500011", name="처음", department=DEPT)                 # LogBook 에 온 적 없음
    make_user("A500012", level=1)
    wb("A500012", name="게스트", department=DEPT)
    make_user("A500013", level=2)
    wb("A500013", name="이미", department=DEPT)                 # 이미 LV2 — 빠진다
    wb("A500014", name="관리자", department=DEPT, admin=True)   # WorkBench 관리자 — 빠진다
    wb("A500015", name="다른", department="선체설계부")

    preview = department_to_lv2(db, storage, apply=False)
    assert sorted(w.employee_id for w in preview) == ["A500011", "A500012"]
    assert db.query(models.User).filter_by(employee_id="A500011").first() is None   # 보고만

    done = department_to_lv2(db, storage, apply=True)
    assert sorted(w.employee_id for w in done) == ["A500011", "A500012"]
    assert _level(db, "A500011") == 2 and _level(db, "A500012") == 2
    assert db.query(models.AuditLog).filter_by(action="USER_JOIN", target_id="A500011").count() == 1
    assert department_to_lv2(db, storage, apply=True) == []   # 여러 번 해도 같다


def test_level_guest_keeps_department_members(db, storage, wb, make_user):
    make_user("A500021", level=2)
    wb("A500021", name="연구", department=DEPT)
    make_user("A500022", level=2)
    wb("A500022", name="다른", department="선체설계부")
    for eid, dept in (("A500021", DEPT), ("A500022", "선체설계부")):   # LogBook 행의 부서(로그인 때 WorkBench 값으로 채워진다)
        db.query(models.User).filter_by(employee_id=eid).update({"department": dept})
    db.commit()
    assert [u.employee_id for u in reset_to_guest(db, storage, apply=False)] == ["A500022"]
