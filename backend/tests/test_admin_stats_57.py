"""57 — 관리 › 자료 현황(통계)·자료 목록, 일괄 분류의 공개 범위."""
from datetime import datetime

from app import models
from app.admin_stats import category_of
from app.entries import service as entry_service


def _tag(db, value, kind):
    db.add(models.Tag(kind=kind, value=value, listed=True))
    db.commit()


def _entry(db, title, *, status="confirmed", when=datetime(2026, 10, 14, 9, 0), zones=(), target=None, hull=None,
           files=(), uploader="A100001", access="normal"):
    e = models.Entry(title=title, status=status, uploaded_by=uploader, confirmed_by=uploader,
                     confirmed_at=when if status == "confirmed" else None, access=access)
    db.add(e)
    db.flush()
    e.entry_id = f"E{e.id:06d}"
    if hull:
        db.add(models.EntryHull(entry_id=e.id, hull_no=hull, is_primary=True))
    batch = None
    if files:
        batch = models.Batch(key=f"20261106-000000-{e.id:04d}", source="web", original_name=title, uploader=uploader)
        db.add(batch)
        db.flush()
    for name, size in files:
        ext = "." + name.rsplit(".", 1)[1].lower()
        db.add(models.File(batch_id=batch.id, entry_id=e.id, name=name, rel_path=name, ext=ext, size=size, kind="other",
                           sha256="0" * 64, location="vault"))
    if zones:
        entry_service.set_zones(db, e, list(zones))
    if target:
        entry_service.set_tags(db, e, "target", [target])
    db.commit()
    return e


def test_category_of():
    assert category_of(".BDF") == "nastran" and category_of(".inp") == "abaqus" and category_of(".odb") == "result"
    assert category_of(".pptx") == "report" and category_of(".xlsx") == "excel" and category_of(".step") == "other"


def test_stats_requires_admin(client, make_user, auth_headers):
    make_user("A100001")
    assert client.get("/api/admin/stats", headers=auth_headers("A100001")).status_code == 403
    assert client.get("/api/admin/entry-table", headers=auth_headers("A100001")).status_code == 403


def test_stats_counts_confirmed_by_category_month_and_top(client, db, make_user, auth_headers):
    make_user("A900001", is_admin=True)
    for z in ("선미부", "Unit"):
        _tag(db, z, "zone")
    _tag(db, "Rudder", "target")
    _entry(db, "a", zones=["선미부"], target="Rudder", hull="3515",
           files=[("m.bdf", 100), ("j.inp", 50), ("j.odb", 900), ("r.pdf", 10), ("t.xlsx", 5)])
    _entry(db, "b", when=datetime(2026, 11, 2), zones=["Unit"], hull="3515", files=[("n.bdf", 200)])
    _entry(db, "draft", status="draft", files=[("x.bdf", 1)])
    _entry(db, "gone", status="trashed", files=[("y.bdf", 1)])
    body = client.get("/api/admin/stats", headers=auth_headers("A900001")).json()
    assert body["summary"] == {"confirmed": 2, "drafts": 1, "trashed": 1, "files": 6, "bytes": 1265, "hulls": 1}
    cats = {c["key"]: c for c in body["categories"]}
    assert (cats["nastran"]["files"], cats["nastran"]["entries"], cats["nastran"]["bytes"]) == (2, 2, 300)
    assert cats["abaqus"]["files"] == 1 and cats["result"]["files"] == 1
    assert cats["report"]["files"] == 1 and cats["excel"]["files"] == 1
    assert [c["key"] for c in body["categories"]] == ["nastran", "abaqus", "result", "report", "excel"]
    assert body["monthly"] == [{"month": "2026-10", "entries": 1, "files": 5}, {"month": "2026-11", "entries": 1, "files": 1}]
    assert body["top"]["hulls"] == [{"value": "3515", "entries": 2}]
    assert {z["value"] for z in body["top"]["zones"]} == {"선미부", "Unit"}
    assert body["top"]["targets"] == [{"value": "Rudder", "entries": 1}]


def test_entry_table_rows_and_drafts(client, db, make_user, auth_headers):
    make_user("A900001", is_admin=True)
    _tag(db, "선미부", "zone")
    _tag(db, "Rudder", "target")
    person = models.Person(name="김미희")
    db.add(person)
    db.commit()
    e = _entry(db, "3515 · 선미부 · Rudder", when=datetime(2026, 10, 20), zones=["선미부"], target="Rudder", hull="3515",
               files=[("m.bdf", 1), ("r.pdf", 1), ("s.pdf", 1)], access="shared")
    from app import people
    people.set_assignees(db, e, [person])
    db.commit()
    _entry(db, "빈 자료")
    _entry(db, "초안", status="draft")
    h = auth_headers("A900001")
    rows = client.get("/api/admin/entry-table", headers=h).json()["rows"]
    assert [r["title"] for r in rows] == ["3515 · 선미부 · Rudder", "빈 자료"]   # 최근 확정 먼저
    first = rows[0]
    assert first["hulls"] == ["3515"] and first["zones"] == ["선미부"] and first["target"] == "Rudder"
    assert [p["name"] for p in first["assignees"]] == ["김미희"] and first["access"] == "shared"
    assert first["files"] == {"nastran": 1, "report": 2}
    assert rows[1]["zones"] == [] and rows[1]["target"] is None and rows[1]["assignees"] == []
    with_drafts = client.get("/api/admin/entry-table?drafts=true", headers=h).json()["rows"]
    assert {r["status"] for r in with_drafts} == {"confirmed", "draft"}


def test_bulk_classify_changes_access(client, db, make_user, auth_headers):
    make_user("A900001", is_admin=True)
    a = _entry(db, "a")
    b = _entry(db, "b", access="shared")
    h = auth_headers("A900001")
    dry = client.post("/api/entries/bulk-classify", headers=h,
                      json={"entry_ids": [a.entry_id, b.entry_id], "access": "shared", "dry_run": True}).json()
    assert dry["changed"] == [a.entry_id] and dry["same"] == [b.entry_id]
    r = client.post("/api/entries/bulk-classify", headers=h,
                    json={"entry_ids": [a.entry_id, b.entry_id], "access": "blocked"}).json()
    assert sorted(r["changed"]) == sorted([a.entry_id, b.entry_id]) and r["failed"] == []
    db.expire_all()
    assert {e.access for e in db.query(models.Entry).filter(models.Entry.id.in_([a.id, b.id]))} == {"blocked"}
    actions = [x.action for x in db.query(models.AuditLog).filter_by(target_id=a.entry_id)]
    assert "ENTRY_ACCESS" in actions


def test_bulk_access_blocked_needs_admin(client, db, make_user, auth_headers):
    make_user("A100001")
    a = _entry(db, "mine", uploader="A100001")
    r = client.post("/api/entries/bulk-classify", headers=auth_headers("A100001"),
                    json={"entry_ids": [a.entry_id], "access": "blocked"}).json()
    assert r["changed"] == [] and r["failed"][0]["reason"] == "블록 공개 범위는 관리자만"
