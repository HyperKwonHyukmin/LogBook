"""46 — 담당자(과제를 한 사람)를 올린 사람과 따로: 명부 찾기·만들기·고치기, 자료에 붙이기, entry.json·재구축, 검색."""
import json

import pytest

from app import models, people
from app.entries.files import entry_dir

OWNER, LV1, LV2 = "U460001", "G460001", "M460001"


@pytest.fixture
def users(make_user, wb):
    make_user(OWNER, name="올린 사람", level=2)
    make_user(LV1, name="게스트", level=1)
    make_user(LV2, name="일반", level=2)
    wb("N460001", name="구조가", department="구조설계부", position="책임")
    wb("N460002", name="구조나", department="구조설계부")


@pytest.fixture
def entry(users, make_entry_file):
    e, _f = make_entry_file(title="담당자 시험", hulls=("9999",), name="r.pdf", uploaded_by=OWNER)
    return e


def _patch(client, h, entry, body):
    cur = client.get(f"/api/entries/{entry.entry_id}", headers=h).json()
    return client.patch(f"/api/entries/{entry.entry_id}", json={"version": cur["version"], **body}, headers=h)


def test_search_merges_roster_and_workbench(users, client, auth_headers, db):
    h = auth_headers(LV1)
    rows = client.get("/api/people", params={"q": "구조"}, headers=h).json()["rows"]
    assert [(r["id"], r["employee_id"]) for r in rows] == [(None, "N460001"), (None, "N460002")]
    # 손 입력 사람을 만들면 명부에서 먼저 나오고, 같은 값으로 다시 만들면 같은 행
    p = client.post("/api/people", json={"name": "구조옛", "department": "구조설계부", "employed": False}, headers=h).json()
    assert p["source"] == "manual" and p["employed"] is False and p["employee_id"] is None
    again = client.post("/api/people", json={"name": "구조옛", "department": "구조설계부"}, headers=h).json()
    assert again["id"] == p["id"]
    rows = client.get("/api/people", params={"q": "구조"}, headers=h).json()["rows"]
    assert [r["name"] for r in rows] == ["구조옛", "구조가", "구조나"]


def test_assign_from_workbench_and_manual(entry, client, auth_headers, db, storage):
    ho = auth_headers(OWNER)
    manual = client.post("/api/people", json={"name": "퇴사자", "department": "선체설계부", "position": "수석",
                                              "employed": False}, headers=ho).json()
    r = _patch(client, ho, entry, {"assignees": [{"employee_id": "n460001"}, {"id": manual["id"]},
                                                 {"employee_id": "N460001"}]})
    assert r.status_code == 200, r.text
    got = r.json()["assignees"]
    assert [(a["name"], a["source"], a["employed"]) for a in got] == [("구조가", "wb", True), ("퇴사자", "manual", False)]
    assert got[0]["position"] == "책임"
    assert r.json()["uploaded_by"] == OWNER   # 올린 사람은 그대로
    # 감사 스냅숏 — 사람 한 줄
    db.expire_all()
    row = db.query(models.AuditLog).filter_by(action="ENTRY_UPDATE", target_id=entry.entry_id).one()
    assert row.after["assignees"] == ["구조가(구조설계부, 책임)", "퇴사자(선체설계부, 수석, 퇴사)"]
    # entry.json·_INFO.txt
    meta = json.loads((entry_dir(storage, entry) / "entry.json").read_text(encoding="utf-8"))
    assert meta["assignees"] == [
        {"employee_id": "N460001", "name": "구조가", "department": "구조설계부", "position": "책임", "employed": True},
        {"name": "퇴사자", "department": "선체설계부", "position": "수석", "employed": False}]
    assert "담당자: 구조가(구조설계부, 책임), 퇴사자(선체설계부, 수석, 퇴사)" in \
        (entry_dir(storage, entry) / "_INFO.txt").read_text(encoding="utf-8")
    # 비우기
    r = _patch(client, ho, entry, {"assignees": []})
    assert r.json()["assignees"] == []


def test_assign_unknown_is_422(entry, client, auth_headers):
    ho = auth_headers(OWNER)
    assert _patch(client, ho, entry, {"assignees": [{"employee_id": "X999999"}]}).json()["detail"] == "person_not_found"
    assert _patch(client, ho, entry, {"assignees": [{"id": 9999}]}).status_code == 422


def test_update_person_level_and_requeues_meta(entry, client, auth_headers, db):
    ho = auth_headers(OWNER)
    p = client.post("/api/people", json={"name": "구조다"}, headers=ho).json()
    _patch(client, ho, entry, {"assignees": [{"id": p["id"]}]})
    # LV1 은 명부를 고치지 못한다(공용 데이터)
    assert client.patch(f"/api/people/{p['id']}", json={"employed": False},
                        headers=auth_headers(LV1)).status_code == 403
    r = client.patch(f"/api/people/{p['id']}", json={"employed": False, "department": "구조설계부"},
                     headers=auth_headers(LV2))
    assert r.status_code == 200 and r.json()["employed"] is False
    db.expire_all()
    log = db.query(models.AuditLog).filter_by(action="PERSON_UPDATE").one()
    assert log.before == {"name": "구조다", "employed": True, "department": None}
    assert log.after == {"employed": False, "department": "구조설계부"}
    assert db.query(models.Job).filter_by(type="write_meta", target_id=entry.id).count() == 1
    # 자료 화면에 새 값
    a = client.get(f"/api/entries/{entry.entry_id}", headers=ho).json()["assignees"][0]
    assert a["employed"] is False and a["department"] == "구조설계부"


def test_search_term_finds_assignee(entry, client, auth_headers):
    ho = auth_headers(OWNER)
    _patch(client, ho, entry, {"assignees": [{"employee_id": "N460002"}]})
    r = client.get("/api/search", params={"q": "구조나"}, headers=ho).json()
    hit = [x for x in r["items"] if x["entry_id"] == entry.entry_id]
    assert hit and "assignee" in hit[0]["matched"]


def test_split_and_merge_keep_assignees(db, users, setup_entry_with_files):
    from app.entries import service

    _b, e = setup_entry_with_files(uploader=OWNER)
    p1 = people.create(db, db.query(models.User).filter_by(employee_id=OWNER).one(), {"name": "가"})
    people.set_assignees(db, e, [p1])
    db.commit()
    owner = db.query(models.User).filter_by(employee_id=OWNER).one()
    fid = db.query(models.File).filter_by(entry_id=e.id).first().id
    new = service.split(db, e, owner, [fid])
    assert [a["name"] for a in people.assignees_of(db, new)] == ["가"]
    p2 = people.create(db, owner, {"name": "나"})
    people.set_assignees(db, new, [p2, p1])
    db.commit()
    merged = service.merge(db, e, new, owner)
    assert [a["name"] for a in people.assignees_of(db, merged)] == ["가", "나"]


def test_restore_assignees_reuses_roster(db, users):
    e = models.Entry(title="재구축", status="confirmed")
    db.add(e)
    db.flush()
    data = [{"employee_id": "n460001", "name": "구조가", "department": "구조설계부"},
            {"name": "퇴사자", "department": "선체설계부", "employed": False}, {"name": ""}, "x"]
    assert people.restore_assignees(db, e, data) == 2
    e2 = models.Entry(title="재구축2", status="confirmed")
    db.add(e2)
    db.flush()
    assert people.restore_assignees(db, e2, data[1:2]) == 1
    db.commit()
    assert db.query(models.Person).count() == 2
    got = people.assignees_of(db, e)
    assert [(a["employee_id"], a["source"], a["employed"]) for a in got] == [("N460001", "wb", True),
                                                                            (None, "manual", False)]


def test_search_filter_facet_group_by_assignee(entry, client, auth_headers, make_entry_file, db):
    """46 — 담당자별로 거르고(필터)·세고(건수)·묶고(보기 기준)·분류 화면에서 본다. 값은 명부 번호."""
    ho = auth_headers(OWNER)
    other, _f = make_entry_file(title="담당자 없는 자료", hulls=("9998",), name="o.pdf", uploaded_by=OWNER)
    p = client.post("/api/people", json={"name": "구조옛", "department": "선체설계부", "employed": False}, headers=ho).json()
    _patch(client, ho, entry, {"assignees": [{"employee_id": "N460001"}, {"id": p["id"]}]})
    kim = client.get(f"/api/entries/{entry.entry_id}", headers=ho).json()["assignees"][0]["id"]

    r = client.get("/api/search", headers=ho).json()
    facet = {f["value"]: f for f in r["facets"]["assignee"]}
    assert facet[str(kim)] == {"value": str(kim), "count": 1, "label": "구조가", "detail": "구조설계부 · 책임"}
    assert facet[str(p["id"])]["detail"] == "선체설계부 · 퇴사"

    r = client.get("/api/search", params={"assignee": str(p["id"])}, headers=ho).json()
    assert [i["entry_id"] for i in r["items"]] == [entry.entry_id]

    r = client.get("/api/search", params={"group": "assignee"}, headers=ho).json()
    groups = {g["value"]: (g["label"], g["count"]) for g in r["groups"]}
    assert groups[str(kim)] == ("구조가", 1) and groups[None] == (None, 1)   # 담당자 없는 자료는 '없음' 묶음

    b = client.get("/api/search/browse", headers=ho).json()["facets"]["assignee"]
    assert {f["label"] for f in b} == {"구조가", "구조옛"}
    assert other.entry_id
