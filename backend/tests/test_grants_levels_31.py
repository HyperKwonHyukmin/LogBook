"""31 — 열람 허락 사용자 고르기(부서 검색·여러 명 한 번에) · WorkBench 에 등급 알려 주기 · 관리자 외 LV1 일괄 정리."""
import dataclasses

import pytest

from app import models
from app.routers import integration

SECRET = "test-integration-secret-31"
H = {"X-HiTESS-Integration": SECRET}
OWNER, LV1, LV2, LV3, WBA = "U310001", "G310001", "M310001", "A310001", "W310001"


@pytest.fixture
def people(make_user, wb):
    make_user(OWNER, name="올린 사람", level=2)
    make_user(LV1, name="게스트", level=1)
    make_user(LV2, name="일반", level=2)
    make_user(LV3, name="지정관리자", level=3)
    make_user(WBA, name="WB관리자", level=2, wb_admin=True)
    wb("N310001", name="구조가", department="구조설계부")
    wb("N310002", name="구조나", department="구조설계부")
    wb("N310003", name="의장가", department="의장설계부")
    wb("N310009", name="떠난사람", department="구조설계부", active=False)


@pytest.fixture
def entry(people, make_entry_file):
    e, _f = make_entry_file(title="허락 시험", hulls=("9999",), name="m.bdf", kind="model", uploaded_by=OWNER)
    return e


def test_lookup_by_department_and_id(people, client, auth_headers):
    h = auth_headers(LV1)
    r = client.get("/api/users/lookup", params={"q": "구조설계"}, headers=h).json()
    assert [u["employee_id"] for u in r] == ["N310001", "N310002"]
    assert r[0]["department"] == "구조설계부"
    r = client.get("/api/users/lookup", params={"q": "310003"}, headers=h).json()   # 사번 가운데 글자
    assert [u["employee_id"] for u in r] == ["N310003"]


def test_grant_many_and_list(entry, client, auth_headers, db):
    ho = auth_headers(OWNER)
    url = f"/api/entries/{entry.entry_id}/grants"
    r = client.post(url, json={"employee_ids": ["n310001", "N310002", "N310001"]}, headers=ho)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["added"] == ["N310001", "N310002"]
    assert {g["employee_id"]: g["department"] for g in body["grants"]} == {"N310001": "구조설계부", "N310002": "구조설계부"}
    # 이미 있는 사람은 다시 더하지 않는다
    r = client.post(url, json={"employee_ids": ["N310002", "N310003"]}, headers=ho).json()
    assert r["added"] == ["N310003"] and len(r["grants"]) == 3
    db.expire_all()
    assert db.query(models.AuditLog).filter_by(action="ENTRY_GRANT", target_id=entry.entry_id).count() == 3


def test_grant_many_all_or_nothing(entry, client, auth_headers, db):
    ho = auth_headers(OWNER)
    url = f"/api/entries/{entry.entry_id}/grants"
    r = client.post(url, json={"employee_ids": ["N310001", "N310009"]}, headers=ho)
    assert r.status_code == 422 and r.json()["detail"] == "grant_user_inactive"
    r = client.post(url, json={"employee_ids": ["N310001", "X999999"]}, headers=ho)
    assert r.status_code == 404
    db.expire_all()
    assert db.query(models.EntryGrant).filter_by(entry_id=entry.id).count() == 0
    # 남의 자료에는 허락을 줄 수 없다(LV2 일반은 볼 수는 있지만 관리는 못 한다)
    assert client.post(url, json={"employee_ids": ["N310001"]}, headers=auth_headers(LV2)).status_code == 403


def test_levels_for_workbench(people, client, monkeypatch):
    monkeypatch.setattr(integration, "settings", dataclasses.replace(integration.settings, wb_integration_secret=SECRET))
    assert client.get("/api/integration/levels").status_code == 401
    r = client.get("/api/integration/levels", headers=H).json()
    assert r["labels"] == {"1": "게스트", "2": "일반", "3": "관리자"}
    assert r["levels"][LV1]["level"] == 1 and r["levels"][LV2]["level"] == 2 and r["levels"][LV3]["level"] == 3
    assert "N310001" not in r["levels"]   # LogBook 에 들어온 적 없는 사람은 WorkBench 가 LV1 로 본다


def test_reset_to_guest(people, db, storage):
    from app.roles import reset_to_guest

    preview = reset_to_guest(db, storage, apply=False)
    assert {u.employee_id for u in preview} == {OWNER, LV2}       # LV3 지정자·WorkBench 관리자는 빠진다
    db.expire_all()
    assert db.query(models.User).filter_by(employee_id=LV2).one().level == 2   # 보고만
    done = reset_to_guest(db, storage, apply=True)
    assert {u.employee_id for u in done} == {OWNER, LV2}
    db.expire_all()
    levels = dict(db.query(models.User.employee_id, models.User.level))
    assert levels[OWNER] == levels[LV2] == 1 and levels[LV3] == 3 and levels[WBA] == 2
    assert db.query(models.AuditLog).filter_by(action="USER_LEVEL").count() == 2
    assert reset_to_guest(db, storage, apply=True) == []           # 여러 번 해도 같다
