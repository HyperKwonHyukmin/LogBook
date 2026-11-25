"""74 2단계 — 팀 관리 API(LV3 만), 로그인 정보의 내 팀, 팀원이 올린 묶음은 팀 자료, CAESAR 입력이면 대상 '배관'."""
from app import models
from app.entries import service as entry_service
from app.ingest.process import process_batch

ADMIN, M1, M2, OUT = "A741001", "T741001", "T741002", "M741001"


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def test_team_admin_api(db, client, auth_headers, make_user, wb):
    make_user(ADMIN, level=3)
    make_user(M1, name="배관 하나", level=1)
    make_user(OUT, level=2)
    wb(M2, name="배관 둘")   # LogBook 에 들어온 적 없어도 넣는다
    wb("N741009", name="떠난 사람", active=False)
    ha, ho = auth_headers(ADMIN), auth_headers(OUT)
    assert client.get("/api/admin/teams", headers=ho).status_code == 403
    assert client.post("/api/admin/teams", json={"name": "배관해석"}, headers=ho).status_code == 403
    r = client.post("/api/admin/teams", json={"name": " 배관해석 ", "description": "CAESAR II"}, headers=ha)
    assert r.status_code == 200 and r.json()["name"] == "배관해석" and r.json()["members"] == []
    tid = r.json()["id"]
    assert client.post("/api/admin/teams", json={"name": "배관해석"}, headers=ha).json()["detail"] == "team_name_taken"
    other = client.post("/api/admin/teams", json={"name": "다른팀"}, headers=ha).json()["id"]
    # 팀원 넣기 — 소문자 사번도, 없는 사번 404, 비활성 422, 다른 팀 사람 409
    r = client.post(f"/api/admin/teams/{tid}/members", json={"employee_ids": [M1.lower(), M2]}, headers=ha)
    assert r.status_code == 200
    assert [(m["employee_id"], m["name"]) for m in r.json()["members"]] == [(M1, "배관 하나"), (M2, "배관 둘")]
    assert client.post(f"/api/admin/teams/{tid}/members", json={"employee_ids": ["Z999999"]},
                       headers=ha).json()["detail"] == "user_not_found"
    assert client.post(f"/api/admin/teams/{tid}/members", json={"employee_ids": ["N741009"]},
                       headers=ha).json()["detail"] == "member_user_inactive"
    r = client.post(f"/api/admin/teams/{other}/members", json={"employee_ids": [M1]}, headers=ha)
    assert r.status_code == 409 and r.json()["detail"] == "member_in_other_team"
    # 로그인 정보에 내 팀
    assert client.get("/api/auth/me", headers=auth_headers(M1)).json()["team"] == {"id": tid, "name": "배관해석"}
    assert client.get("/api/auth/me", headers=ho).json()["team"] is None
    # 이름, 설명 고치기와 활동 로그
    r = client.patch(f"/api/admin/teams/{tid}", json={"description": "배관 응력해석"}, headers=ha)
    assert r.json()["description"] == "배관 응력해석"
    db.expire_all()
    acts = [a.action for a in db.query(models.AuditLog).filter_by(target_type="team").order_by(models.AuditLog.id)]
    assert acts == ["TEAM_CREATE", "TEAM_CREATE", "TEAM_MEMBER_ADD", "TEAM_UPDATE"]
    # 팀 자료가 있으면 지우지 못한다, 팀원 빼기
    e = models.Entry(title="팀 자료", status="confirmed", access="team", team_id=tid, uploaded_by=M1)
    db.add(e)
    db.commit()
    assert {t["id"]: t["entries"] for t in client.get("/api/admin/teams", headers=ha).json()} == {tid: 1, other: 0}
    r = client.delete(f"/api/admin/teams/{tid}", headers=ha)
    assert r.status_code == 409 and r.json()["detail"] == "team_has_entries"
    r = client.delete(f"/api/admin/teams/{tid}/members/{M2}", headers=ha)
    assert [m["employee_id"] for m in r.json()["members"]] == [M1]
    assert client.delete(f"/api/admin/teams/{tid}/members/{M2}", headers=ha).status_code == 404
    assert client.delete(f"/api/admin/teams/{other}", headers=ha).status_code == 200
    from app.ops.registry import build_registry
    assert [t["name"] for t in build_registry(db)["teams"]] == ["배관해석"]


def test_member_upload_is_team_and_caesar_is_pipe(db, storage, make_user):
    make_user(M1, level=1)
    make_user(OUT, level=2)
    pipe = models.Team(name="배관해석")
    db.add(pipe)
    db.flush()
    db.add(models.TeamMember(team_id=pipe.id, employee_id=M1))
    db.add(models.Tag(kind="target", value="배관", listed=True))
    db.commit()
    made = {}
    for who, key in ((M1, "20261125-000000-t741"), (OUT, "20261125-000001-t741")):
        b = models.Batch(key=key, source="web", original_name="pipe", uploader=who, split_top=True,
                         preset={"skip_hint": True})
        db.add(b)
        db.commit()
        _write(storage.staging / key / "pipe" / "line1" / "line1.c2", b"CAESAR")
        _write(storage.staging / key / "pipe" / "line1" / "report.pdf", b"%PDF 1")
        _write(storage.staging / key / "pipe" / "line2" / "only.pdf", b"%PDF 2")
        process_batch(db, storage, b)
        db.expire_all()
        made[who] = {e.title_source: e for e in db.query(models.Entry).filter_by(batch_id=b.id)}
    for e in made[M1].values():   # 팀원이 올리면 CAESAR 가 없어도 팀 자료(결정 9)
        assert (e.access, e.team_id) == ("team", pipe.id)
    for e in made[OUT].values():   # 팀 밖 사람이 올리면 일반(결정 6 답 — 관리자나 구조시스템도 CAESAR 를 올린다)
        assert (e.access, e.team_id) == ("normal", None)
    for who in (M1, OUT):   # 대상은 누가 올리든 CAESAR 가 든 초안만 '배관'(결정 10)
        targets = {src: entry_service.target_of(db, e) for src, e in made[who].items()}
        assert targets == {"line1": "배관", "line2": None}, (who, targets)


def test_caesar_needs_listed_term(db, storage, make_user):
    make_user(OUT, level=2)
    b = models.Batch(key="20261125-000002-t741", source="web", original_name="x", uploader=OUT,
                     preset={"skip_hint": True})
    db.add(b)
    db.commit()
    _write(storage.staging / b.key / "x" / "OLD._A", b"CAESAR")
    process_batch(db, storage, b)
    db.expire_all()
    e = db.query(models.Entry).filter_by(batch_id=b.id).one()
    assert entry_service.target_of(db, e) is None   # 분류 목록에 '배관' 이 없으면 비워 둔다


def test_team_space_api_and_search(db, client, auth_headers, make_user, make_entry_file):
    """74 3단계 — 업무별 모음 팀 줄(GET /api/teams), 팀 공간 머리(GET /api/teams/{id}), 검색 team= 거르기."""
    make_user(ADMIN, level=3)
    make_user(M1, name="배관 하나", level=1)
    make_user(OUT, level=2)
    pipe, other = models.Team(name="배관해석", description="CAESAR II"), models.Team(name="다른팀")
    db.add_all([pipe, other])
    db.flush()
    db.add(models.TeamMember(team_id=pipe.id, employee_id=M1))
    a, _ = make_entry_file(title="배관 응력 A", name="a.pdf", uploaded_by=M1)
    b, _ = make_entry_file(title="배관 응력 B", name="b.pdf", uploaded_by=M1)
    d, _ = make_entry_file(title="배관 초안", status="draft", name="d.pdf", uploaded_by=M1)
    o, _ = make_entry_file(title="다른 팀 자료", name="o.pdf", uploaded_by=ADMIN)
    n, _ = make_entry_file(title="일반 자료", name="n.pdf", uploaded_by=OUT)
    for e in (a, b, d):
        e.access, e.team_id = "team", pipe.id
    o.access, o.team_id = "team", other.id
    db.commit()
    h1, ho, ha = auth_headers(M1), auth_headers(OUT), auth_headers(ADMIN)
    rows = client.get("/api/teams", headers=h1).json()
    assert rows == [{"id": pipe.id, "name": "배관해석", "description": "CAESAR II", "entries": 2, "drafts": 1, "members": 1}]
    assert client.get("/api/teams", headers=ho).json() == []
    assert [r["name"] for r in client.get("/api/teams", headers=ha).json()] == ["다른팀", "배관해석"]
    s = client.get(f"/api/teams/{pipe.id}", headers=h1).json()
    assert (s["entries"], s["drafts"], s["is_member"]) == (2, 1, True)
    assert [m["employee_id"] for m in s["members"]] == [M1]
    assert client.get(f"/api/teams/{pipe.id}", headers=ho).status_code == 404   # 팀 밖 사람에게는 없는 팀
    assert client.get(f"/api/teams/{other.id}", headers=h1).status_code == 404
    assert client.get(f"/api/teams/{other.id}", headers=ha).json()["is_member"] is False
    got = {i["entry_id"] for i in client.get("/api/search", params={"team": pipe.id}, headers=h1).json()["items"]}
    assert got == {a.entry_id, b.entry_id}   # 확정 팀 자료만(초안, 다른 팀, 일반 자료 제외)
    got = {i["entry_id"] for i in client.get("/api/search", params={"team": pipe.id, "q": "응력 A"}, headers=h1).json()["items"]}
    assert got == {a.entry_id}
    assert client.get("/api/search", params={"team": pipe.id}, headers=ho).json()["total"] == 0
    assert client.get("/api/search", params={"team": other.id}, headers=h1).json()["total"] == 0
    item = client.get("/api/search", params={"team": pipe.id}, headers=h1).json()["items"][0]
    assert item["access"] == "team" and item["team"]["name"] == "배관해석"
