"""64 — 나의 메모(개인 지식 노트): 자료마다 내 메모 하나(마크다운), 쓴 사람만 본다. 왼쪽 메뉴 '나의 메모'에서 모아 본다."""
from app import models
from app.ops.purge import purge_entry


def _put(client, h, entry_id, body):
    return client.put(f"/api/entries/{entry_id}/note", json={"body": body}, headers=h)


def test_save_read_update_and_clear(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    e, _ = make_entry_file(title="3503 · 기타 · Unit · M03")
    h = auth_headers("A100001")
    assert client.get(f"/api/entries/{e.entry_id}/note", headers=h).json() == {"body": "", "updated_at": None}

    r = _put(client, h, e.entry_id, "  ## 경계조건\r\n- SPC 123456 은 **갑판 쪽**만  ")
    assert r.status_code == 200
    assert r.json()["body"] == "## 경계조건\n- SPC 123456 은 **갑판 쪽**만"   # 앞뒤 공백과 CRLF 정리
    first = r.json()["updated_at"]
    assert client.get(f"/api/entries/{e.entry_id}/note", headers=h).json()["body"].startswith("## 경계조건")
    # 같은 본문이면 고친 시각이 바뀌지 않는다(칸을 벗어날 때마다 저장해도 목록 순서가 흔들리지 않게)
    assert _put(client, h, e.entry_id, "## 경계조건\n- SPC 123456 은 **갑판 쪽**만").json()["updated_at"] == first
    assert db.query(models.EntryNote).count() == 1

    # 빈 본문 = 지우기
    assert _put(client, h, e.entry_id, "   ").json() == {"body": "", "updated_at": None}
    assert db.query(models.EntryNote).count() == 0
    assert _put(client, h, e.entry_id, "x" * 20001).status_code == 422


def test_private_to_writer(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    make_user("B200002")
    make_user("Z900009", is_admin=True)
    e, _ = make_entry_file()
    _put(client, auth_headers("A100001"), e.entry_id, "내 메모")
    # 다른 사람도, 관리자도 내 메모를 보지 못한다(자기 메모 칸은 비어 있다)
    for who in ("B200002", "Z900009"):
        assert client.get(f"/api/entries/{e.entry_id}/note", headers=auth_headers(who)).json()["body"] == ""
        assert client.get("/api/me/notes", headers=auth_headers(who)).json()["items"] == []
    # 볼 수 없는 자료에는 쓸 수도 없다(존재를 숨긴다)
    make_user("C300003", level=1)
    assert _put(client, auth_headers("C300003"), e.entry_id, "x").status_code == 404


def test_listing_order_search_and_trash(client, db, make_user, auth_headers, make_entry_file, storage):
    make_user("A100001")
    h = auth_headers("A100001")
    a, _ = make_entry_file(title="M03 Upper stand", hulls=("3503",))
    b, _ = make_entry_file(title="함미 축전지 트렁크", hulls=())
    c, _ = make_entry_file(title="버릴 자료")
    _put(client, h, a.entry_id, "SOL 101 해석 조건은 **보고서 3쪽**")
    _put(client, h, b.entry_id, "트렁크 관통구 보강 참고")
    _put(client, h, c.entry_id, "휴지통 갈 메모")
    # a 를 가장 오래된 메모로. MySQL 의 'updated_at - 60' 은 날짜가 아니라 숫자 빼기라 시각에 따라 없는 값이 된다(2026-11-20 실패)
    from datetime import datetime, timedelta

    db.query(models.EntryNote).filter_by(entry_id=a.id).update(
        {"updated_at": datetime.now().replace(microsecond=0) - timedelta(hours=1)})
    db.commit()

    box = client.get("/api/me/notes", headers=h).json()
    assert [i["entry"]["entry_id"] for i in box["items"]] == [c.entry_id, b.entry_id, a.entry_id]   # 최근 고친 순
    assert box["items"][2]["entry"]["hulls"] == ["3503"] and box["total"] == 3

    # 찾기: 메모 본문, 자료 제목, 자료 번호(낱말 모두)
    find = lambda q: [i["entry"]["entry_id"] for i in client.get("/api/me/notes", params={"q": q}, headers=h).json()["items"]]
    assert find("보고서") == [a.entry_id]
    assert find("트렁크 보강") == [b.entry_id]
    assert find("upper") == [a.entry_id]
    assert find(a.entry_id.lower()) == [a.entry_id]

    # 휴지통 자료의 메모는 목록에서 숨고, 새로 쓰지 못한다. 영구 삭제하면 메모도 지운다
    c.status, c.trash_rel = "trashed", f"{c.entry_id}_20261001-120000"
    db.commit()
    assert c.entry_id not in find("")
    assert _put(client, h, c.entry_id, "새로").status_code == 409
    purge_entry(db, storage, c, actor="system")
    db.commit()
    assert db.query(models.EntryNote).filter_by(entry_id=c.id).count() == 0
    assert db.query(models.EntryNote).count() == 2
