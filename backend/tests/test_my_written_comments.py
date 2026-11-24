"""2026-11-25 — 나의 메모 › 의견과 이슈: 내가 쓴 의견, 이슈, 답글을 모아 본다(GET /api/me/comments/written)."""
from app import models

ME, OTHER = "U251101", "U251102"


def test_written_lists_only_mine_with_filters(db, client, auth_headers, make_user, make_entry_file):
    make_user(ME, level=2)
    make_user(OTHER, level=2)
    a, _ = make_entry_file(title="유닛 권상 A", hulls=("3496",), name="a.pdf", uploaded_by=OTHER)
    b, _ = make_entry_file(title="매니폴드 B", hulls=(), name="b.pdf", uploaded_by=OTHER)
    b.no_hull = True
    db.commit()
    me, other = auth_headers(ME), auth_headers(OTHER)
    post = lambda h, e, **body: client.post(f"/api/entries/{e.entry_id}/comments", json=body, headers=h).json()   # noqa: E731
    c1 = post(me, a, kind="comment", body="러그 두께 확인 필요")
    i1 = post(me, b, kind="issue", body="경계조건 누락")
    i2 = post(me, a, kind="issue", body="하중 계수 재확인")
    theirs = post(other, a, kind="comment", body="남의 글")
    r1 = post(me, a, kind="comment", body="답글 내용", parent_id=theirs["id"])
    gone = post(me, b, kind="comment", body="지울 글")
    client.delete(f"/api/comments/{gone['id']}", headers=me)
    client.post(f"/api/comments/{i2['id']}/resolve", headers=me)
    post(other, a, kind="comment", body="내 의견에 단 답", parent_id=c1["id"])

    d = client.get("/api/me/comments/written", headers=me).json()
    assert [x["id"] for x in d["items"]] == [r1["id"], i2["id"], i1["id"], c1["id"]]   # 최근 순, 남의 글과 지운 글 없음
    assert d["counts"] == {"total": 4, "comment": 2, "issue": 2, "open": 1}
    rows = {x["id"]: x for x in d["items"]}
    assert rows[r1["id"]]["reply_to"]["body"] == "남의 글" and rows[r1["id"]]["reply_to"]["mine"] is False
    assert rows[c1["id"]]["replies"] == 1 and rows[c1["id"]]["reply_to"] is None
    assert rows[i2["id"]]["status"] == "resolved" and rows[i1["id"]]["status"] == "open"
    assert rows[i1["id"]]["entry"] == {"entry_id": b.entry_id, "title": "매니폴드 B", "hulls": [], "no_hull": True}
    assert rows[c1["id"]]["entry"]["hulls"] == ["3496"]
    # 거르기
    ids = lambda **p: [x["id"] for x in client.get("/api/me/comments/written", params=p, headers=me).json()["items"]]   # noqa: E731
    assert ids(kind="issue") == [i2["id"], i1["id"]]
    assert ids(status="open") == [i1["id"]]
    assert ids(status="resolved") == [i2["id"]]
    assert ids(kind="comment") == [r1["id"], c1["id"]]
    assert ids(q="경계") == [i1["id"]]
    assert ids(q="매니폴드") == [i1["id"]]     # 자료 제목으로도
    assert ids(q=a.entry_id.lower()) == [r1["id"], i2["id"], c1["id"]]
    # 지금 볼 수 없게 된 자료(휴지통)의 글은 뺀다
    a.status = "trashed"
    db.commit()
    assert ids() == [i1["id"]]
    assert client.get("/api/me/comments/written", params={"kind": "x"}, headers=me).status_code == 422
    assert db.query(models.EntryComment).count() >= 6
