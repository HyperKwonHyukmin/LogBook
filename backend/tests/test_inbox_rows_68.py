"""68 1단계 — '올리기와 확정' 줄 목록(상태를 서버 한 곳에서), 묶음 lite 응답, 결정 1(사번이 연결된 담당자의 초안 권한)."""
import pytest

from app import access, models
from app.entries.inbox_rows import draft_state, needs_wire

OWNER, ASSIGNEE, OTHER, ADMIN = "U680001", "G680001", "G680002", "A680001"


def _state(**kw):
    base = dict(batch_state="processed", pending=[], live_files=1, title="제목", blocked=False, wire=False)
    return draft_state(**{**base, **kw})


def test_draft_state_rules():
    assert _state() == ("ready", "")
    assert _state(batch_state="staged") == ("processing", "")
    assert _state(pending=["processed"]) == ("attaching", "")
    assert _state(pending=["staged", "failed"]) == ("attach_failed", "")
    assert _state(live_files=0) == ("waiting_files", "")
    assert _state(title="  ") == ("needs_check", "제목 없음")
    assert _state(blocked=True) == ("needs_check", "똑같은 BDF 가 이미 있음")
    assert _state(wire=True) == ("needs_check", "권상 Wire 모델 확인")
    # 앞의 것이 이긴다: 첨부 중이면 제목이 없어도 '첨부 중'
    assert _state(pending=["staged"], title="")[0] == "attaching"
    # 화면 needsLiftingWire 와 같은 규칙
    assert needs_wire(merge_into=False, needed=True, has_wire=False, blocked_wire=False)
    assert not needs_wire(merge_into=True, needed=True, has_wire=False, blocked_wire=False)
    assert not needs_wire(merge_into=False, needed=True, has_wire=True, blocked_wire=False)
    assert not needs_wire(merge_into=False, needed=True, has_wire=False, blocked_wire=True)


@pytest.fixture
def users(make_user):
    make_user(OWNER, name="올린 사람", level=2)
    make_user(ASSIGNEE, name="담당 게스트", level=1)
    make_user(OTHER, name="다른 게스트", level=1)
    make_user(ADMIN, name="관리자", level=3)


def _assign(db, entry, employee_id, name="담당 게스트"):
    p = db.query(models.Person).filter_by(employee_id=employee_id).first()
    if p is None:
        p = models.Person(employee_id=employee_id, name=name, source="wb")
        db.add(p)
        db.flush()
    db.add(models.EntryAssignee(entry_id=entry.id, person_id=p.id, sort_order=0))
    db.commit()


def _processed(db, entry):
    b = db.get(models.Batch, entry.batch_id)
    b.state = "processed"
    db.commit()
    return b


def test_rows_states_counts_and_order(users, db, client, auth_headers, make_entry_file):
    ready, _ = make_entry_file(status="draft", title="보고서 초안", name="r.pdf", uploaded_by=OWNER)
    b = _processed(db, ready)
    untitled, _ = make_entry_file(status="draft", title="", name="u.pdf", uploaded_by=OWNER)
    _processed(db, untitled)
    # 파일 0개 초안(과제 엑셀 초안의 모양) — 파일을 휴지통 위치로 돌려 '살아 있는 파일 0개'를 만든다
    empty, f = make_entry_file(status="draft", title="파일 없는 과제", name="x.pdf", uploaded_by=OWNER)
    _processed(db, empty)
    f.location = "trash"
    db.commit()
    h = auth_headers(OWNER)
    res = client.get("/api/inbox/drafts", headers=h)
    assert res.status_code == 200, res.text
    body = res.json()
    by = {r["entry_id"]: r for r in body["rows"]}
    assert by[ready.entry_id]["state"] == "ready"
    assert by[untitled.entry_id]["state"] == "needs_check" and by[untitled.entry_id]["reason"] == "제목 없음"
    assert by[empty.entry_id]["state"] == "waiting_files" and by[empty.entry_id]["file_count"] == 0
    assert body["counts"]["ready"] == 1 and body["counts"]["needs_check"] == 1 and body["counts"]["waiting_files"] == 1
    assert by[ready.entry_id]["batch"]["key"] == b.key and by[ready.entry_id]["can_confirm"] is True
    assert "files" not in by[ready.entry_id]   # 가벼운 줄 — 파일 목록은 상세에서
    # 상태 거르기: 숫자는 거르기 전 그대로
    only = client.get("/api/inbox/drafts", params={"state": "ready,needs_check"}, headers=h).json()
    assert {r["entry_id"] for r in only["rows"]} == {ready.entry_id, untitled.entry_id}
    assert only["counts"] == body["counts"] and only["total"] == 2
    # 찾기(제목, 자료 번호, 호선)
    assert [r["entry_id"] for r in client.get("/api/inbox/drafts", params={"q": "보고서"}, headers=h).json()["rows"]] == [ready.entry_id]
    assert [r["entry_id"] for r in client.get("/api/inbox/drafts", params={"q": ready.entry_id.lower()}, headers=h).json()["rows"]] == [ready.entry_id]
    assert len(client.get("/api/inbox/drafts", params={"q": "9999"}, headers=h).json()["rows"]) == 3
    # 남의 목록에는 없다(mine), 잘못된 상태 값은 422
    assert client.get("/api/inbox/drafts", headers=auth_headers(OTHER)).json()["rows"] == []
    assert client.get("/api/inbox/drafts", params={"state": "nope"}, headers=h).status_code == 422


def test_rows_match_bulk_confirm_reasons(users, db, client, auth_headers, make_entry_file):
    """화면 bulkConfirmPlan 이 건너뛰던 이유(똑같은 BDF, 권상 Wire)를 서버가 같은 이름으로 준다."""
    blocked, _ = make_entry_file(status="draft", title="동일 BDF 묶음", name="m.bdf", kind="model", uploaded_by=OWNER)
    b = _processed(db, blocked)
    b.excluded = [{"name": "dup.bdf", "reason": "duplicate_model", "same_as_files": []}]
    unit, _ = make_entry_file(status="draft", title="유닛 권상", name="u.bdf", kind="model", uploaded_by=OWNER)
    _processed(db, unit)
    tag = db.query(models.Tag).filter_by(kind="target", value="Unit").first() or models.Tag(kind="target", value="Unit")
    db.add(tag)
    db.flush()
    db.add(models.EntryTag(entry_id=unit.id, tag_id=tag.id))
    db.commit()
    rows = {r["entry_id"]: r for r in client.get("/api/inbox/drafts", headers=auth_headers(OWNER)).json()["rows"]}
    assert rows[blocked.entry_id]["reason"] == "똑같은 BDF 가 이미 있음"
    assert rows[unit.entry_id]["reason"] == "권상 Wire 모델 확인"


def test_attachment_proposals_hidden_and_target_attaching(users, db, client, auth_headers, make_entry_file):
    target, _ = make_entry_file(status="draft", title="대상 초안", name="t.pdf", uploaded_by=OWNER)
    _processed(db, target)
    child, _ = make_entry_file(status="draft", title="첨부 제안", name="c.pdf", uploaded_by=OWNER)
    cb = db.get(models.Batch, child.batch_id)
    cb.state, cb.target_entry_id = "processed", target.id
    child.merge_into_id = target.id
    db.commit()
    h = auth_headers(OWNER)
    rows = client.get("/api/inbox/drafts", headers=h).json()["rows"]
    assert [(r["entry_id"], r["state"]) for r in rows] == [(target.entry_id, "attaching")]
    # 배지도 임시 첨부 초안은 세지 않는다
    assert client.get("/api/batches/summary", headers=h).json()["drafts"] == 1


def test_batches_lite(users, db, client, auth_headers, make_entry_file):
    e, _ = make_entry_file(status="draft", title="가벼운 묶음", name="a.pdf", uploaded_by=OWNER)
    b = _processed(db, e)
    h = auth_headers(OWNER)
    lite = client.get("/api/batches", params={"lite": 1}, headers=h).json()
    got = next(x for x in lite if x["key"] == b.key)
    assert "entries" not in got and got["draft_count"] == 1
    full = next(x for x in client.get("/api/batches", headers=h).json() if x["key"] == b.key)
    assert len(full["entries"]) == 1 and full["draft_count"] == 1


def test_assignee_can_view_edit_confirm_but_not_discard(users, db, client, auth_headers, setup_entry_with_files,
                                                        storage):
    b, e = setup_entry_with_files(uploader=OWNER)
    b.state = "processed"
    db.commit()
    _assign(db, e, ASSIGNEE)
    ha, ho = auth_headers(ASSIGNEE), auth_headers(OTHER)
    # LV1 이라 일반 자료는 못 보지만 담당한 초안은 본다. 담당하지 않은 LV1 은 여전히 못 본다
    d = client.get(f"/api/entries/{e.entry_id}", headers=ha)
    assert d.status_code == 200, d.text
    assert d.json()["can_edit"] is True and d.json()["can_manage_access"] is False
    assert client.get(f"/api/entries/{e.entry_id}", headers=ho).status_code == 404
    # 목록: 내가 올린 묶음 탭에 담당한 초안이 보이고, 거르기 '담당: 나'
    rows = client.get("/api/inbox/drafts", headers=ha).json()["rows"]
    assert [(r["entry_id"], r["assigned_to_me"], r["can_confirm"]) for r in rows] == [(e.entry_id, True, True)]
    assert client.get("/api/inbox/drafts", params={"who": "uploaded"}, headers=ha).json()["rows"] == []
    assert len(client.get("/api/inbox/drafts", params={"who": "assigned"}, headers=ha).json()["rows"]) == 1
    assert client.get("/api/batches/summary", headers=ha).json()["drafts"] == 1
    # 고치기
    r = client.patch(f"/api/entries/{e.entry_id}", json={"version": d.json()["version"], "title": "담당자가 고친 제목"},
                     headers=ha)
    assert r.status_code == 200, r.text
    # 공개 범위와 버리기는 못 한다(올린 사람과 LV3)
    r = client.patch(f"/api/entries/{e.entry_id}", json={"version": r.json()["version"], "access": "shared"}, headers=ha)
    assert r.status_code == 403
    assert client.delete(f"/api/entries/{e.entry_id}", headers=ha).status_code == 403
    # 확정
    r = client.post(f"/api/entries/{e.entry_id}/confirm", headers=ha)
    assert r.status_code == 200, r.text
    db.expire_all()
    done = db.get(models.Entry, e.id)
    assert done.status == "confirmed" and done.confirmed_by == ASSIGNEE and done.uploaded_by == OWNER
    # 확정된 뒤에는 담당자 권한이 없다(LV1 은 일반 자료를 못 본다)
    assert client.get(f"/api/entries/{e.entry_id}", headers=ha).status_code == 404


def test_assignee_without_employee_id_gets_nothing(users, db, client, auth_headers, make_entry_file):
    e, _ = make_entry_file(status="draft", title="손 입력 담당자", name="a.pdf", uploaded_by=OWNER)
    _processed(db, e)
    p = models.Person(employee_id=None, name="담당 게스트", source="manual")
    db.add(p)
    db.flush()
    db.add(models.EntryAssignee(entry_id=e.id, person_id=p.id, sort_order=0))
    db.commit()
    assert client.get(f"/api/entries/{e.entry_id}", headers=auth_headers(ASSIGNEE)).status_code == 404


def test_assignee_filter_and_function_agree(users, db, make_entry_file):
    draft, _ = make_entry_file(status="draft", title="담당 초안", name="a.pdf", uploaded_by=OWNER)
    conf, _ = make_entry_file(status="confirmed", title="담당 확정", name="b.pdf", uploaded_by=OWNER)
    for x in (draft, conf):
        _assign(db, x, ASSIGNEE)
    u = db.query(models.User).filter_by(employee_id=ASSIGNEE).one()
    seen = {i for (i,) in db.query(models.Entry.id).filter(models.Entry.id.in_([draft.id, conf.id]),
                                                            access.visible_entries_filter(u))}
    assert seen == {draft.id}
    assert access.can_view_entry(u, draft, db=db) and not access.can_view_entry(u, conf, db=db)
    assert access.can_edit_entry(u, draft) and not access.can_edit_entry(u, conf)


def test_assignee_cannot_move_or_merge_between_drafts(users, db, client, auth_headers, make_entry_file):
    """Codex 검토 2026-11-23 — 담당자가 공개 범위가 다른 초안 사이로 파일을 옮기거나 합치면 공개 범위를 넓히는 셈이다."""
    a, fa = make_entry_file(status="draft", title="블록 초안", name="a.pdf", uploaded_by=OWNER)
    b = _processed(db, a)
    other = models.Entry(title="공유 초안", status="draft", batch_id=b.id, uploaded_by=OWNER, access="shared")
    db.add(other)
    db.flush()
    other.entry_id = f"E{other.id:06d}"
    a.access = "blocked"
    db.commit()
    for x in (a, other):
        _assign(db, x, ASSIGNEE)
    h = auth_headers(ASSIGNEE)
    r = client.post(f"/api/files/{fa.id}/move", json={"to_entry_id": other.entry_id}, headers=h)
    assert r.status_code == 403 and r.json()["detail"] == "owner_required"
    r = client.post(f"/api/entries/{other.entry_id}/merge", json={"from_entry_id": a.entry_id}, headers=h)
    assert r.status_code == 403 and r.json()["detail"] == "owner_required"
    # 올린 사람은 그대로 된다
    assert client.post(f"/api/files/{fa.id}/move", json={"to_entry_id": other.entry_id},
                       headers=auth_headers(OWNER)).status_code == 200


def test_hidden_merge_target_does_not_skip_wire_check(users, db, client, auth_headers, make_entry_file):
    """상세 응답이 볼 수 없는 합치기 대상을 숨기듯, 줄 상태도 그 대상을 없는 것으로 친다(예전 화면 needsLiftingWire 와 같게)."""
    target, _ = make_entry_file(status="confirmed", title="숨은 확정 자료", name="t.pdf", uploaded_by=OWNER)
    target.access = "normal"
    unit, _ = make_entry_file(status="draft", title="유닛 권상 추가", name="u.bdf", kind="model", uploaded_by=OWNER)
    _processed(db, unit)
    unit.merge_into_id = target.id
    tag = db.query(models.Tag).filter_by(kind="target", value="Unit").first() or models.Tag(kind="target", value="Unit")
    db.add(tag)
    db.flush()
    db.add(models.EntryTag(entry_id=unit.id, tag_id=tag.id))
    db.commit()
    _assign(db, unit, ASSIGNEE)
    lv1 = {r["entry_id"]: r for r in client.get("/api/inbox/drafts", headers=auth_headers(ASSIGNEE)).json()["rows"]}
    assert lv1[unit.entry_id]["reason"] == "권상 Wire 모델 확인" and lv1[unit.entry_id]["merge_into"] is False
    own = {r["entry_id"]: r for r in client.get("/api/inbox/drafts", headers=auth_headers(OWNER)).json()["rows"]}
    assert own[unit.entry_id]["state"] == "ready" and own[unit.entry_id]["merge_into"] is True
