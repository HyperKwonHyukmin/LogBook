"""54 — 여러 자료의 분류를 한꺼번에 바꾸기(POST /api/entries/bulk-classify)."""
from app import models
from app.entries import service


def _tag(db, value, kind):
    db.add(models.Tag(kind=kind, value=value, listed=True))
    db.commit()


def _zones(db, e):
    return service.zones_of(db, db.get(models.Entry, e.id))


def test_add_and_remove_zone_target_and_audit(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    _tag(db, "선수부", "zone")
    _tag(db, "선미부", "zone")
    _tag(db, "Closed chock", "target")
    e1, _ = make_entry_file(title="가")
    e2, _ = make_entry_file(title="나")
    service.set_zones(db, e2, ["선미부"])
    db.commit()
    h = auth_headers("A100001")
    body = {"entry_ids": [e1.entry_id, e2.entry_id], "zones_add": ["선수부"], "zones_remove": ["선미부"],
            "set_target": True, "target": "closed chock"}
    # 미리보기 — 바꾸지 않는다
    r = client.post("/api/entries/bulk-classify", json={**body, "dry_run": True}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json() == {"changed": [e1.entry_id, e2.entry_id], "same": [], "failed": []}
    db.expire_all()
    assert _zones(db, e2) == ["선미부"]
    r = client.post("/api/entries/bulk-classify", json=body, headers=h)
    assert r.json()["changed"] == [e1.entry_id, e2.entry_id]
    db.expire_all()
    for e in (e1, e2):
        e = db.get(models.Entry, e.id)
        assert service.zones_of(db, e) == ["선수부"] and service.target_of(db, e) == "Closed chock"
        assert e.version == 2
    # 한 건씩 고친 것과 같은 감사 기록
    assert db.query(models.AuditLog).filter_by(action="ENTRY_UPDATE", target_id=e1.entry_id).count() == 1
    # 다시 보내면 이미 그 값
    r = client.post("/api/entries/bulk-classify", json=body, headers=h)
    assert r.json() == {"changed": [], "same": [e1.entry_id, e2.entry_id], "failed": []}


def test_skips_entries_without_permission(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    make_user("A100002")
    _tag(db, "선수부", "zone")
    mine, _ = make_entry_file(title="내 것", uploaded_by="A100001")
    other, _ = make_entry_file(title="남의 것", uploaded_by="A100002")
    r = client.post("/api/entries/bulk-classify", headers=auth_headers("A100001"),
                    json={"entry_ids": [mine.entry_id, other.entry_id, "E999999"], "zones_add": ["선수부"]})
    body = r.json()
    assert body["changed"] == [mine.entry_id]
    assert [(f["entry_id"], f["reason"]) for f in body["failed"]] == [
        (other.entry_id, "고칠 권한 없음"), ("E999999", "찾을 수 없음")]


def test_assignees_add_remove(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    a, b = models.Person(name="김가"), models.Person(name="이나")
    db.add_all([a, b])
    db.commit()
    e, _ = make_entry_file()
    from app import people
    people.set_assignees(db, e, [a])
    db.commit()
    r = client.post("/api/entries/bulk-classify", headers=auth_headers("A100001"),
                    json={"entry_ids": [e.entry_id], "assignees_add": [{"id": b.id}], "assignees_remove": [a.id]})
    assert r.json()["changed"] == [e.entry_id]
    db.expire_all()
    assert [p["name"] for p in people.assignees_of(db, db.get(models.Entry, e.id))] == ["이나"]


def test_no_hull_does_not_wipe_hulls(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    with_hull, _ = make_entry_file(hulls=("3496",))
    without, _ = make_entry_file(hulls=())
    r = client.post("/api/entries/bulk-classify", headers=auth_headers("A100001"),
                    json={"entry_ids": [with_hull.entry_id, without.entry_id], "no_hull": True})
    body = r.json()
    assert body["changed"] == [without.entry_id]
    assert body["failed"] == [{"entry_id": with_hull.entry_id, "title": "구조 검토", "reason": "호선이 있어 공용으로 바꾸지 않음"}]
    db.expire_all()
    assert [h.hull_no for h in service.hulls_of(db, db.get(models.Entry, with_hull.id))] == ["3496"]


def test_unlisted_zone_rejected_for_non_admin(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    _tag(db, "선수부", "zone")
    e, _ = make_entry_file()
    r = client.post("/api/entries/bulk-classify", headers=auth_headers("A100001"),
                    json={"entry_ids": [e.entry_id], "zones_add": ["없는구역"]})
    assert r.status_code == 422
