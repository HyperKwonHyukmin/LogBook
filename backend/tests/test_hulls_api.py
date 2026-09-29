from datetime import datetime

from app import models


def _setup(db, make_entry_file, make_user):
    make_user("A100001", name="홍길동")
    make_user("A100002", name="김해석")
    e1, _ = make_entry_file(title="계류 검토", hulls=("9999",), name="a.pptx", analysis_type="Mooring",
                            period="2026-08", confirmed_at=datetime(2026, 9, 2))
    make_entry_file(entry=e1, name="m.bdf", kind="model")
    e2, _ = make_entry_file(title="갑판 강도", hulls=("9999", "9998"), name="b.pdf", uploaded_by="A100002",
                            analysis_type="Strength", confirmed_at=datetime(2026, 9, 5))
    make_entry_file(status="draft", title="초안", hulls=("9999",), name="c.pdf")
    zone = models.Tag(kind="zone", value="선수부")
    db.add(zone)
    db.flush()
    db.add(models.EntryTag(entry_id=e1.id, tag_id=zone.id))
    db.commit()
    return e1, e2


def test_hull_detail(client, db, make_entry_file, make_user, auth_headers):
    e1, e2 = _setup(db, make_entry_file, make_user)
    res = client.get("/api/hulls/9999", headers=auth_headers("A100001"))
    assert res.status_code == 200
    d = res.json()
    assert d["hull_no"] == "9999" and d["drafts"] == 1
    assert d["stats"]["entries"] == 2 and d["stats"]["files"] == 3
    assert d["stats"]["kinds"] == {"report": 2, "model": 1}
    assert {x["value"] for x in d["stats"]["analysis_types"]} == {"Mooring", "Strength"}
    assert d["stats"]["zones"] == [{"value": "선수부", "count": 1}]
    people = {p["employee_id"]: p for p in d["stats"]["people"]}
    assert people["A100002"]["name"] == "김해석" and people["A100002"]["count"] == 1
    assert [m["month"] for m in d["timeline"]] == ["2026-09", "2026-08"]
    assert d["timeline"][0]["entries"][0]["entry_id"] == e2.entry_id
    assert d["timeline"][1]["entries"][0]["zones"] == ["선수부"]


def test_hull_detail_404(client, make_user, auth_headers):
    make_user("A100001")
    assert client.get("/api/hulls/1234", headers=auth_headers("A100001")).status_code == 404


def test_hull_list(client, db, make_entry_file, make_user, auth_headers):
    _setup(db, make_entry_file, make_user)
    rows = client.get("/api/hulls", headers=auth_headers("A100001")).json()
    by_no = {r["hull_no"]: r for r in rows}
    assert by_no["9999"]["entries"] == 2 and by_no["9998"]["entries"] == 1
    assert rows[0]["last_at"] >= rows[-1]["last_at"]
    only = client.get("/api/hulls?q=99", headers=auth_headers("A100001")).json()
    assert {r["hull_no"] for r in only} == {"9999", "9998"}


def test_hull_patch(client, db, make_entry_file, make_user, auth_headers):
    _setup(db, make_entry_file, make_user)
    h = auth_headers("A100001")
    res = client.patch("/api/hulls/9999", json={"ship_type": "LNGC", "memo": "174K"}, headers=h)
    assert res.status_code == 200 and res.json()["ship_type"] == "LNGC"
    assert db.query(models.AuditLog).filter_by(action="HULL_UPDATE").count() == 1
    assert db.query(models.Job).filter_by(type="write_meta").count() == 2
    assert client.patch("/api/hulls/12ab", json={"ship_type": "x"}, headers=h).status_code == 422


def _count_queries(fn):
    from sqlalchemy import event

    from app.database import engine

    n = {"q": 0}

    def before(*_a, **_k):
        n["q"] += 1

    event.listen(engine, "before_cursor_execute", before)
    try:
        fn()
    finally:
        event.remove(engine, "before_cursor_execute", before)
    return n["q"]


def test_hull_detail_query_count_does_not_grow_with_entries(db, make_entry_file):
    """Entry 마다 구역 태그를 따로 묻지 않는다(N+1) — Entry 수가 늘어도 쿼리 수는 같다."""
    from app import hull_info

    for _ in range(2):
        make_entry_file(hulls=("9999",))
    few = _count_queries(lambda: hull_info.hull_detail(db, "9999"))
    for _ in range(4):
        make_entry_file(hulls=("9999",))
    many = _count_queries(lambda: hull_info.hull_detail(db, "9999"))
    assert many == few
