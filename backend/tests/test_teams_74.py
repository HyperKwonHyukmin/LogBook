"""74 — 팀 공간: 공개 단계 'team'(그 팀원과 LV3 만), 팀원은 팀 자료에서 올린 사람과 같다, 새는 길, 재구축 보존.
합성 데이터만(가상 호선 9999)."""
from datetime import datetime, timedelta

import pytest

from app import access, models

M1, M2 = "T740001", "T740002"      # 배관팀 팀원(LV1, LV2)
OUT2, OUT1 = "M740001", "G740001"  # 팀 밖(LV2, LV1)
OTHER = "X740001"                  # 다른 팀 팀원(LV2)
ADMIN = "A740001"


def _target(db, entry, value):
    t = db.query(models.Tag).filter_by(kind="target", value=value).first()
    if t is None:
        t = models.Tag(kind="target", value=value, listed=True)
        db.add(t)
        db.flush()
    db.add(models.EntryTag(entry_id=entry.id, tag_id=t.id))


@pytest.fixture
def world(db, make_user, make_entry_file):
    make_user(M1, name="배관 하나", level=1)
    make_user(M2, name="배관 둘", level=2)
    make_user(OUT2, name="구조 일반", level=2)
    make_user(OUT1, name="구조 게스트", level=1)
    make_user(OTHER, name="다른 팀", level=2)
    make_user(ADMIN, name="관리자", level=3)
    pipe = models.Team(name="배관해석", description="CAESAR II 해석")
    other = models.Team(name="다른팀")
    db.add_all([pipe, other])
    db.flush()
    db.add_all([models.TeamMember(team_id=pipe.id, employee_id=M1), models.TeamMember(team_id=pipe.id, employee_id=M2),
                models.TeamMember(team_id=other.id, employee_id=OTHER)])
    now = datetime.now().replace(microsecond=0)
    team, _ = make_entry_file(title="배관 응력 해석 팀", hulls=("9999",), name="pipe.pdf", kind="report",
                              uploaded_by=M1, confirmed_at=now - timedelta(days=1))
    team.access, team.team_id = "team", pipe.id
    _target(db, team, "배관")
    normal, _ = make_entry_file(title="구조 해석 일반", hulls=("9999",), name="hull.pdf", kind="report",
                                uploaded_by=OUT2, confirmed_at=now - timedelta(days=1))
    mine, _ = make_entry_file(title="배관 하나 개인 자료", hulls=("9999",), name="mine.pdf", kind="report",
                              uploaded_by=M1)
    draft, _ = make_entry_file(title="배관 초안", status="draft", name="d.pdf", uploaded_by=M1)
    draft.access, draft.team_id = "team", pipe.id
    db.commit()
    return {"team": team.entry_id, "normal": normal.entry_id, "mine": mine.entry_id, "draft": draft.entry_id,
            "pipe": pipe.id, "other": other.id}


SEES_TEAM = {M1: True, M2: True, ADMIN: True, OUT2: False, OUT1: False, OTHER: False}


@pytest.mark.parametrize("who", list(SEES_TEAM))
def test_team_entry_hidden_everywhere(who, world, client, auth_headers):
    h = auth_headers(who)
    ok = SEES_TEAM[who]
    t = world["team"]
    r = client.get(f"/api/entries/{t}", headers=h)
    assert r.status_code == (200 if ok else 404), (who, r.text)
    if ok:
        assert r.json()["access"] == "team" and r.json()["label"] == "팀 전용"
        assert r.json()["team"] == {"id": world["pipe"], "name": "배관해석"}
    found = {i["entry_id"] for i in client.get("/api/search", headers=h).json()["items"]}
    assert (t in found) is ok
    found = {i["entry_id"] for i in client.get("/api/search", params={"q": "배관 응력"}, headers=h).json()["items"]}
    assert (t in found) is ok
    # 호선 화면 건수, 업무별 모음(대상 '배관' 은 이 자료에만 있다), 새 자료 숫자
    hl = {x["hull_no"]: x["entries"] for x in client.get("/api/hulls", headers=h).json()}
    base = {M1: 1, M2: 2, ADMIN: 2, OUT2: 2, OUT1: 0, OTHER: 2}[who]   # 일반 자료 2건(LV2), 자기 자료
    assert hl.get("9999", 0) == base + (1 if ok else 0), (who, hl)
    cards = [c["value"] for c in client.get("/api/targets", headers=h).json()["targets"]]
    assert ("배관" in cards) is ok
    new = {i["entry_id"] for i in client.get("/api/search", params={"new": "true"}, headers=h).json()["items"]}
    assert (t in new) is (ok and who != M1)   # 남의 확정 자료만 새 자료
    assert client.get("/api/me/news", headers=h).json()["count"] == len(new)
    # 팀 초안 — 팀원과 관리자만
    assert client.get(f"/api/entries/{world['draft']}", headers=h).status_code == (200 if ok else 404)


def test_filter_and_function_agree(world, db):
    rows = {e.entry_id: e for e in db.query(models.Entry)}
    for who in SEES_TEAM:
        u = db.query(models.User).filter_by(employee_id=who).one()
        by_sql = {eid for (eid,) in db.query(models.Entry.entry_id).filter(access.visible_entries_filter(u))}
        by_fn = {eid for eid, e in rows.items() if access.can_view_entry(u, e, db=db)}
        assert by_sql == by_fn, who


def test_lifting_reference_hides_team(world, db):
    from app.lifting_refs import reference_visible_filter

    for who, ok in SEES_TEAM.items():
        u = db.query(models.User).filter_by(employee_id=who).one()
        got = {eid for (eid,) in db.query(models.Entry.entry_id).filter(reference_visible_filter(u))}
        assert (world["team"] in got) is ok, who
        assert world["normal"] in got   # 권상 참조는 일반 자료를 LV1 에게도 연다(50) — 그대로


def test_team_member_acts_like_owner(world, client, auth_headers, db):
    t = world["team"]
    h2 = auth_headers(M2)   # 올린 사람이 아닌 팀원
    d = client.get(f"/api/entries/{t}", headers=h2).json()
    assert d["can_edit"] is True and d["can_manage_access"] is True
    r = client.patch(f"/api/entries/{t}", json={"version": d["version"], "title": "팀원이 고침"}, headers=h2)
    assert r.status_code == 200 and r.json()["title"] == "팀원이 고침"
    # 팀 밖 사람에게 한 건 보여 주기(개별 허락)
    ho = auth_headers(OUT1)
    assert client.get(f"/api/entries/{t}", headers=ho).status_code == 404
    assert client.put(f"/api/entries/{t}/grants", json={"employee_id": OUT1}, headers=h2).status_code == 200
    assert client.get(f"/api/entries/{t}", headers=ho).status_code == 200
    # 휴지통과 복원
    assert client.delete(f"/api/entries/{t}", headers=h2).status_code == 200
    assert client.post(f"/api/entries/{t}/restore", headers=h2).status_code == 200
    # 팀 밖 사람은 고치지 못한다(볼 수 없으면 404)
    r = client.patch(f"/api/entries/{t}", json={"version": 1, "title": "남이 고침"}, headers=auth_headers(OUT2))
    assert r.status_code == 404
    # 팀원 초안 확정 권한(올린 사람이 아니어도)
    from app.entries import service
    draft = db.query(models.Entry).filter_by(entry_id=world["draft"]).one()
    u2 = db.query(models.User).filter_by(employee_id=M2).one()
    service._check_confirmer(db, u2, draft)   # 403 이면 예외
    uo = db.query(models.User).filter_by(employee_id=OTHER).one()
    with pytest.raises(Exception):
        service._check_confirmer(db, uo, draft)


def test_access_change_rules(world, client, auth_headers, db, storage):
    from app.ops.registry import read_registry

    mine, normal, t = world["mine"], world["normal"], world["team"]
    h1, ho, ha, hx = auth_headers(M1), auth_headers(OUT2), auth_headers(ADMIN), auth_headers(OTHER)
    # 팀원이 자기 자료를 팀으로 — 팀을 고르지 않으면 자기 팀
    r = client.put(f"/api/entries/{mine}/access", json={"access": "team"}, headers=h1)
    assert r.status_code == 200 and r.json()["team"]["name"] == "배관해석"
    assert client.get(f"/api/entries/{mine}", headers=auth_headers(M2)).status_code == 200
    db.expire_all()
    row = db.query(models.AuditLog).filter_by(action="ENTRY_ACCESS", target_id=mine).one()
    assert row.after == {"access": "team", "team": "배관해석"}
    assert {"entry_id": mine, "access": "team", "team": "배관해석"} in read_registry(storage)["entry_access"]
    # 팀원은 다른 팀으로 못 옮긴다
    r = client.put(f"/api/entries/{mine}/access", json={"access": "team", "team_id": world["other"]}, headers=h1)
    assert r.status_code == 403 and r.json()["detail"] == "team_member_required"
    # 팀이 없는 사람은 자기 자료라도 팀으로 못 넣는다
    r = client.put(f"/api/entries/{normal}/access", json={"access": "team"}, headers=ho)
    assert r.status_code == 403 and r.json()["detail"] == "team_member_required"
    # 관리자는 아무 팀으로(팀 밖 사람의 자료도), 없는 팀은 404
    r = client.put(f"/api/entries/{normal}/access", json={"access": "team", "team_id": 99999}, headers=ha)
    assert r.status_code == 404 and r.json()["detail"] == "team_not_found"
    r = client.put(f"/api/entries/{normal}/access", json={"access": "team", "team_id": world["other"]}, headers=ha)
    assert r.status_code == 200 and r.json()["team"]["name"] == "다른팀"
    assert client.get(f"/api/entries/{normal}", headers=hx).status_code == 200
    assert client.get(f"/api/entries/{normal}", headers=auth_headers(M2)).status_code == 404
    # 올린 사람이라 팀 밖이어도 자기 자료는 계속 본다
    assert client.get(f"/api/entries/{normal}", headers=ho).status_code == 200
    # 팀원이 팀 자료를 일반으로 풀면 팀이 비워지고 LV2 가 본다
    r = client.put(f"/api/entries/{t}/access", json={"access": "normal"}, headers=auth_headers(M2))
    assert r.status_code == 200 and "team" not in r.json()
    db.expire_all()
    assert db.query(models.Entry).filter_by(entry_id=t).one().team_id is None
    assert client.get(f"/api/entries/{t}", headers=ho).status_code == 200


def test_bulk_classify_team(world, client, auth_headers):
    ids = [world["normal"], world["mine"]]
    r = client.post("/api/entries/bulk-classify", json={"entry_ids": ids, "access": "team"}, headers=auth_headers(M1))
    body = r.json()
    assert body["changed"] == [world["mine"]]   # 남의 일반 자료는 고칠 권한 없음
    assert [f["entry_id"] for f in body["failed"]] == [world["normal"]]


def test_registry_and_rebuild_restore(world, db, storage):
    from app.ops import rebuild
    from app.ops.registry import build_registry

    reg = build_registry(db)
    pipe = next(t for t in reg["teams"] if t["name"] == "배관해석")
    assert pipe["description"] == "CAESAR II 해석" and {m["employee_id"] for m in pipe["members"]} == {M1, M2}
    assert {"entry_id": world["team"], "access": "team", "team": "배관해석"} in reg["entry_access"]
    # 재구축처럼: 팀과 팀원과 공개 범위를 비운 뒤 registry 로 되살린다
    for e in db.query(models.Entry):
        e.access, e.team_id = "normal", None
    db.query(models.TeamMember).delete()
    db.query(models.Team).delete()
    db.commit()
    assert rebuild._restore_teams(db, reg) == (2, 3)
    rebuild._restore_access(db, reg)
    db.commit()
    e = db.query(models.Entry).filter_by(entry_id=world["team"]).one()
    t = db.query(models.Team).filter_by(name="배관해석").one()
    assert e.access == "team" and e.team_id == t.id and t.description == "CAESAR II 해석"
    # 팀 이름을 모르면 새지 않는 쪽(블록)
    rebuild._restore_access(db, {"entry_access": [{"entry_id": world["team"], "access": "team"}]})
    assert e.access == "blocked" and e.team_id is None


def test_full_rebuild_keeps_team(db, storage, make_user, make_entry_file):
    """entry.json 과 registry.json 만으로 팀, 팀원, 팀 자료가 되살아난다. registry 가 없어도 entry.json 의 팀 이름으로."""
    import json
    import os

    from app import database
    from app.entries.files import write_entry_files
    from app.ops.rebuild import rebuild
    from app.ops.registry import REGISTRY_FILE, write_registry
    from app.storage.paths import to_long

    make_user(ADMIN, level=3)
    pipe = models.Team(name="배관해석", description="CAESAR II 해석")
    db.add(pipe)
    db.flush()
    db.add(models.TeamMember(team_id=pipe.id, employee_id=M1))
    e, f = make_entry_file(title="배관 팀 자료", name="p.pdf", sha="d" * 64, uploaded_by=M1)
    e.access, e.team_id = "team", pipe.id
    db.commit()
    p = storage.vault / "2026" / e.entry_id / "files" / f.rel_path
    os.makedirs(to_long(p.parent), exist_ok=True)
    with open(to_long(p), "wb") as fh:
        fh.write(b"x")
    write_entry_files(db, storage, e)
    with open(to_long(storage.vault / "2026" / e.entry_id / "entry.json"), encoding="utf-8") as fh:
        meta = json.load(fh)
    assert meta["access"] == "team" and meta["team"] == "배관해석"
    write_registry(db, storage)
    eid = e.entry_id

    def wipe():
        db.rollback()
        database.Base.metadata.drop_all(database.engine)
        database.Base.metadata.create_all(database.engine)
        db.expunge_all()

    wipe()
    r = rebuild(db, storage)
    assert r["teams"] == 1 and r["team_members"] == 1
    got = db.query(models.Entry).filter_by(entry_id=eid).one()
    t = db.query(models.Team).one()
    assert (got.access, got.team_id, t.name, t.description) == ("team", t.id, "배관해석", "CAESAR II 해석")
    assert db.query(models.TeamMember).one().employee_id == M1
    # registry 를 잃어도 entry.json 의 팀 이름으로 팀을 만든다(설명과 팀원은 없다)
    os.remove(to_long(storage.system / REGISTRY_FILE))
    wipe()
    rebuild(db, storage)
    got = db.query(models.Entry).filter_by(entry_id=eid).one()
    assert got.access == "team" and db.get(models.Team, got.team_id).name == "배관해석"


def test_review_fixes(world, client, auth_headers, db, storage):
    """74 Codex 검토 후속: 팀 밖 담당자, 초안 목록 권한, 일괄 분류 제목, 자동 확정 결과, 초안 PATCH 의 registry, 기본값."""
    from app.ops.registry import read_registry
    from app.routers.batches import _visible_auto_result

    draft = db.query(models.Entry).filter_by(entry_id=world["draft"]).one()
    # 1) 팀 밖 사람을 팀 초안 담당자로 붙여도 보이지 않는다(개별 허락으로만)
    p = models.Person(employee_id=OUT2, name="구조 일반", source="wb")
    db.add(p)
    db.flush()
    db.add(models.EntryAssignee(entry_id=draft.id, person_id=p.id, sort_order=0))
    db.commit()
    assert client.get(f"/api/entries/{world['draft']}", headers=auth_headers(OUT2)).status_code == 404
    uo = db.query(models.User).filter_by(employee_id=OUT2).one()
    assert access.is_draft_assignee(uo, draft, db) is False
    # 7) 초안 목록 — 올린 사람도 담당자도 아닌 팀원에게 고치기와 확정이 열려 있다
    rows = client.get("/api/inbox/drafts", params={"scope": "all"}, headers=auth_headers(M2)).json()["rows"]
    row = next(r for r in rows if r["entry_id"] == world["draft"])
    assert row["can_edit"] is True and row["can_confirm"] is True
    assert world["draft"] not in {r["entry_id"] for r in client.get(
        "/api/inbox/drafts", params={"scope": "all"}, headers=auth_headers(OUT2)).json()["rows"]}
    # 6) 일괄 분류 실패 목록에 숨은 자료의 제목이 나오지 않는다
    r = client.post("/api/entries/bulk-classify", json={"entry_ids": [world["team"]], "dry_run": True},
                    headers=auth_headers(OUT2)).json()
    assert r["failed"] == [{"entry_id": world["team"], "title": "", "reason": "찾을 수 없음"}]
    # 5) 자동 확정 결과에서 볼 수 없는 자료 번호는 빠진다
    b = models.Batch(key="k-auto-74", source="web", original_name="배관 묶음", uploader=M1,
                     preset={"auto_result": {"confirmed": [world["team"], world["normal"]], "kept": []}})
    db.add(b)
    db.commit()
    assert _visible_auto_result(db, b, uo)["confirmed"] == [world["normal"]]
    u2 = db.query(models.User).filter_by(employee_id=M2).one()
    assert _visible_auto_result(db, b, u2)["confirmed"] == [world["team"], world["normal"]]
    # 3) 초안 공개 범위를 PATCH 로 바꾸면 registry 에도 남는다
    mine_draft, _ = None, None
    d2 = models.Entry(title="배관 둘 초안", status="draft", batch_id=draft.batch_id, uploaded_by=M2, access="normal")
    db.add(d2)
    db.flush()
    d2.entry_id = f"E{d2.id:06d}"
    db.commit()
    r = client.patch(f"/api/entries/{d2.entry_id}", json={"version": d2.version, "access": "team"},
                     headers=auth_headers(M2))
    assert r.status_code == 200 and r.json()["access"] == "team"
    assert {"entry_id": d2.entry_id, "access": "team", "team": "배관해석"} in read_registry(storage)["entry_access"]
    # 2) 새 초안 기본값 — 팀원이면 그 팀, 아니면 일반
    assert access.default_access(db, M1) == ("team", world["pipe"])
    assert access.default_access(db, OUT2) == ("normal", None)
    assert access.default_access(db, None) == ("normal", None)
