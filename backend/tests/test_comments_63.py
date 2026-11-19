"""63 — 자료 의견과 이슈(댓글)."""
from datetime import datetime, timedelta

from app import comments, models
from app.ops.purge import purge_entry
from app.ops.registry import read_registry, write_registry


def _post(client, h, entry_id, body="경계조건이 다릅니다", kind="comment", parent_id=None):
    payload = {"kind": kind, "body": body}
    if parent_id is not None:
        payload["parent_id"] = parent_id
    return client.post(f"/api/entries/{entry_id}/comments", json=payload, headers=h)


def _users(make_user):
    make_user("A100001", name="올린이")          # 자료를 올린 사람(LV2)
    make_user("B200002", name="동료")            # 다른 사람(LV2)
    make_user("C300003", name="손님", level=1)   # LV1 — 일반 자료는 못 본다
    make_user("Z900009", name="관리자", is_admin=True)


# ---- 쓰기와 목록 ----

def test_post_list_and_reply(client, db, make_user, auth_headers, make_entry_file, storage):
    _users(make_user)
    e, _ = make_entry_file()
    hb, ha = auth_headers("B200002"), auth_headers("A100001")
    r = _post(client, hb, e.entry_id, kind="issue")
    assert r.status_code == 201, r.text
    issue = r.json()
    assert issue["kind"] == "issue" and issue["status"] == "open" and issue["author"]["name"] == "동료"
    assert issue["can_edit"] and issue["can_delete"] and issue["can_resolve"]
    # 답글은 늘 '의견', 답글에 답글은 없다
    rep = _post(client, ha, e.entry_id, body="확인하겠습니다", kind="issue", parent_id=issue["id"]).json()
    assert rep["kind"] == "comment" and rep["parent_id"] == issue["id"]
    assert _post(client, hb, e.entry_id, parent_id=rep["id"]).json()["detail"] == "reply_depth"
    data = client.get(f"/api/entries/{e.entry_id}/comments", headers=hb).json()
    assert data["total"] == 2 and data["open_issues"] == 1 and data["can_comment"] is True
    assert [i["id"] for i in data["items"]] == [issue["id"]]
    assert [x["body"] for x in data["items"][0]["replies"]] == ["확인하겠습니다"]
    # 남의 글은 고치지 못한다(표시도)
    assert data["items"][0]["replies"][0]["can_edit"] is False
    # registry.json 에 남는다
    reg = read_registry(storage)["comments"]
    assert [(c["key"], c["parent_key"], c["entry_id"]) for c in reg] == [
        (issue["id"], None, e.entry_id), (rep["id"], issue["id"], e.entry_id)]


def test_body_rules(client, db, make_user, auth_headers, make_entry_file):
    _users(make_user)
    e, _ = make_entry_file()
    h = auth_headers("B200002")
    assert _post(client, h, e.entry_id, body="   ").json()["detail"] == "comment_empty"
    assert _post(client, h, e.entry_id, body="가" * 2001).json()["detail"] == "comment_too_long"
    assert _post(client, h, e.entry_id, body="  앞뒤 공백  ").json()["body"] == "앞뒤 공백"
    assert _post(client, h, e.entry_id, kind="note").status_code == 422


def test_access_rules(client, db, make_user, auth_headers, make_entry_file):
    _users(make_user)
    e, _ = make_entry_file()                       # 일반 자료 — LV1 은 못 본다
    d, _ = make_entry_file(status="draft")
    t, _ = make_entry_file(status="trashed")
    hb, hc = auth_headers("B200002"), auth_headers("C300003")
    assert client.get(f"/api/entries/{e.entry_id}/comments", headers=hc).status_code == 404
    assert _post(client, hc, e.entry_id).status_code == 404
    assert client.get(f"/api/entries/{e.entry_id}/comments").status_code == 401
    assert client.get("/api/entries/E999999/comments", headers=hb).status_code == 404
    # 초안(남의 초안은 숨김), 휴지통은 쓰지 못한다
    ha = auth_headers("A100001")
    assert _post(client, ha, d.entry_id).json()["detail"] == "entry_not_confirmed"
    assert client.get(f"/api/entries/{d.entry_id}/comments", headers=ha).json()["can_comment"] is False
    assert _post(client, ha, t.entry_id).json()["detail"] == "entry_trashed"
    # 공유 자료면 LV1 도 쓴다
    e.access = "shared"
    db.commit()
    assert _post(client, hc, e.entry_id).status_code == 201
    # 볼 수 없게 되면 글 주소도 404
    cid = _post(client, hb, e.entry_id).json()["id"]
    e.access = "normal"
    db.commit()
    assert client.patch(f"/api/comments/{cid}", json={"body": "x"}, headers=hc).status_code == 404


def test_edit_and_delete_permissions(client, db, make_user, auth_headers, make_entry_file):
    _users(make_user)
    e, _ = make_entry_file()
    ha, hb, hz = auth_headers("A100001"), auth_headers("B200002"), auth_headers("Z900009")
    cid = _post(client, hb, e.entry_id).json()["id"]
    assert client.patch(f"/api/comments/{cid}", json={"body": "남이 고침"}, headers=ha).json()["detail"] == "not_comment_author"
    r = client.patch(f"/api/comments/{cid}", json={"body": "고친 글"}, headers=hb).json()
    assert r["body"] == "고친 글" and r["edited_at"]
    assert client.delete(f"/api/comments/{cid}", headers=ha).json()["detail"] == "not_comment_author"
    assert client.delete(f"/api/comments/{cid}", headers=hb).status_code == 200
    assert db.query(models.EntryComment).count() == 0
    # 관리자가 남의 글을 지우면 감사에 남는다
    cid2 = _post(client, hb, e.entry_id, body="지울 글").json()["id"]
    assert client.delete(f"/api/comments/{cid2}", headers=hz).status_code == 200
    log = db.query(models.AuditLog).filter_by(action="COMMENT_DELETE").one()
    assert log.target_id == e.entry_id and log.before["author"] == "B200002" and log.before["body"] == "지울 글"


def test_delete_with_replies_leaves_marker(client, db, make_user, auth_headers, make_entry_file):
    _users(make_user)
    e, _ = make_entry_file()
    ha, hb = auth_headers("A100001"), auth_headers("B200002")
    top = _post(client, hb, e.entry_id, body="원글").json()["id"]
    rep = _post(client, ha, e.entry_id, body="답글", parent_id=top).json()["id"]
    client.delete(f"/api/comments/{top}", headers=hb)
    items = client.get(f"/api/entries/{e.entry_id}/comments", headers=hb).json()["items"]
    assert items[0]["deleted"] is True and items[0]["body"] == "" and len(items[0]["replies"]) == 1
    assert items[0]["can_delete"] is False
    # 삭제 표시에는 답글을 달지 못하고, 마지막 답글이 지워지면 표시도 사라진다
    assert _post(client, ha, e.entry_id, parent_id=top).json()["detail"] == "comment_deleted"
    client.delete(f"/api/comments/{rep}", headers=ha)
    assert db.query(models.EntryComment).count() == 0
    assert client.get(f"/api/entries/{e.entry_id}/comments", headers=hb).json()["items"] == []


def test_resolve_rules(client, db, make_user, auth_headers, make_entry_file):
    _users(make_user)
    make_user("D400004", name="제삼자")
    e, _ = make_entry_file()
    ha, hb, hd = auth_headers("A100001"), auth_headers("B200002"), auth_headers("D400004")
    issue = _post(client, hb, e.entry_id, kind="issue").json()["id"]
    note = _post(client, hb, e.entry_id).json()["id"]
    assert client.post(f"/api/comments/{note}/resolve", headers=hb).json()["detail"] == "not_issue"
    assert client.post(f"/api/comments/{issue}/resolve", headers=hd).json()["detail"] == "cannot_resolve"
    # 자료를 올린 사람이 해결
    r = client.post(f"/api/comments/{issue}/resolve", headers=ha).json()
    assert r["status"] == "resolved" and r["resolved"]["employee_id"] == "A100001"
    assert client.get(f"/api/entries/{e.entry_id}/comments", headers=hb).json()["open_issues"] == 0
    # 이슈를 쓴 사람이 다시 연다
    assert client.delete(f"/api/comments/{issue}/resolve", headers=hb).json()["status"] == "open"
    # 보완할 자료 — 열린 이슈 수
    row = next(x for x in client.get("/api/coverage", headers=hb).json()["entries"] if x["id"] == e.entry_id)
    assert row["open_issues"] == 1


# ---- 새 의견(알림) ----

def test_inbox_and_seen(client, db, make_user, auth_headers, make_entry_file):
    _users(make_user)
    mine, _ = make_entry_file(title="내 자료")                       # A100001 이 올림
    other, _ = make_entry_file(title="남의 자료", uploaded_by="B200002")
    ha, hb, hz = auth_headers("A100001"), auth_headers("B200002"), auth_headers("Z900009")
    _post(client, hb, mine.entry_id, body="내 자료에 남이 쓴 글")
    _post(client, ha, mine.entry_id, body="내가 내 자료에 쓴 글")       # 내 글은 세지 않는다
    mytop = _post(client, ha, other.entry_id, body="남의 자료에 내가 쓴 글").json()["id"]
    _post(client, hz, other.entry_id, body="내 글에 단 답글", parent_id=mytop)
    _post(client, hz, other.entry_id, body="남의 자료의 다른 글")      # 나와 무관
    assert client.get("/api/me/comments/summary", headers=ha).json() == {"unread": 2}
    box = client.get("/api/me/comments", headers=ha).json()
    assert [i["body"] for i in box["items"]] == ["내 글에 단 답글", "내 자료에 남이 쓴 글"]
    assert box["items"][0]["reply_to_me"] is True and box["items"][0]["entry"]["title"] == "남의 자료"
    assert all(i["is_new"] for i in box["items"]) and box["seen_at"] is None
    # 읽은 뒤에는 0, 목록은 그대로(새 글 표시만 꺼짐)
    assert client.post("/api/me/comments/seen", headers=ha).status_code == 200
    pref = db.get(models.UserPref, ("A100001", comments.SEEN_KEY))
    pref.value = (datetime.now() + timedelta(seconds=1)).replace(microsecond=0).isoformat()   # 같은 초에 쓴 글과 겹치지 않게
    db.commit()
    assert client.get("/api/me/comments/summary", headers=ha).json() == {"unread": 0}
    box = client.get("/api/me/comments", headers=ha).json()
    assert len(box["items"]) == 2 and not any(i["is_new"] for i in box["items"])
    # 설정 API 에는 보이지 않는다
    assert comments.SEEN_KEY not in client.get("/api/me/prefs", headers=ha).json()


def test_inbox_hides_trashed_and_deleted(client, db, make_user, auth_headers, make_entry_file):
    _users(make_user)
    mine, _ = make_entry_file()
    ha, hb = auth_headers("A100001"), auth_headers("B200002")
    cid = _post(client, hb, mine.entry_id).json()["id"]
    _post(client, hb, mine.entry_id, body="둘째")
    client.delete(f"/api/comments/{cid}", headers=hb)
    assert client.get("/api/me/comments/summary", headers=ha).json() == {"unread": 1}
    mine.status = "trashed"
    db.commit()
    assert client.get("/api/me/comments/summary", headers=ha).json() == {"unread": 0}


# ---- 영구 삭제와 재구축 ----

def test_purge_removes_comments(client, db, make_user, auth_headers, make_entry_file, storage):
    _users(make_user)
    e, _ = make_entry_file()
    hb = auth_headers("B200002")
    top = _post(client, hb, e.entry_id).json()["id"]
    _post(client, hb, e.entry_id, parent_id=top)
    e.status, e.trash_rel = "trashed", f"{e.entry_id}_20261001-120000"
    db.commit()
    purge_entry(db, storage, e, actor="Z900009")
    db.commit()
    assert db.query(models.EntryComment).count() == 0


def test_registry_round_trip(client, db, make_user, auth_headers, make_entry_file, storage):
    _users(make_user)
    e, _ = make_entry_file()
    ha, hb = auth_headers("A100001"), auth_headers("B200002")
    top = _post(client, hb, e.entry_id, kind="issue", body="이슈").json()["id"]
    _post(client, ha, e.entry_id, body="답글", parent_id=top)
    client.post(f"/api/comments/{top}/resolve", headers=ha)
    write_registry(db, storage)
    reg = read_registry(storage)
    db.query(models.EntryComment).filter(models.EntryComment.parent_id.isnot(None)).delete()
    db.query(models.EntryComment).delete()
    db.commit()
    assert comments.restore_from_registry(db, reg) == 2
    db.commit()
    rows = db.query(models.EntryComment).order_by(models.EntryComment.id).all()
    assert [(r.kind, r.body, r.employee_id) for r in rows] == [("issue", "이슈", "B200002"), ("comment", "답글", "A100001")]
    assert rows[1].parent_id == rows[0].id and rows[0].resolved_by == "A100001" and rows[0].resolved_at
    # 없는 자료, 부모 없는 답글은 건너뛴다
    assert comments.restore_from_registry(db, {"comments": [
        {"key": 1, "entry_id": "E999999", "employee_id": "A", "body": "x"},
        {"key": 2, "parent_key": 777, "entry_id": e.entry_id, "employee_id": "A", "body": "x"}]}) == 0
