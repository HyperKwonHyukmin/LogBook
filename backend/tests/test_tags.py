from app import models
from app.entries import service
from app.tags import group_ids, group_values, root_value


def _tag(db, value, kind="zone", alias_of=None):
    t = models.Tag(kind=kind, value=value, alias_of_id=alias_of.id if alias_of else None)
    db.add(t)
    db.commit()
    return t


def test_group_values_and_root(db):
    bow = _tag(db, "선수부")
    fwd = _tag(db, "FWD", alias_of=bow)
    _tag(db, "Fore", alias_of=bow)
    assert group_values(db, "zone", "fwd") == {"선수부", "FWD", "Fore"}
    assert group_values(db, "zone", "선수부") == {"선수부", "FWD", "Fore"}
    assert group_values(db, "zone", "없는값") == {"없는값"}
    assert root_value(db, "zone", "Fore") == "선수부"
    assert set(group_ids(db, [fwd.id])) == {t.id for t in db.query(models.Tag)}


def test_set_tags_keeps_other_kind(db, storage, make_user, make_entry_file):
    u = make_user()
    e, _f = make_entry_file(status="draft")
    service.update_entry(db, storage, e, u, {"version": e.version, "zones": ["선수부"], "tags": ["계류"]})
    e = db.get(models.Entry, e.id)
    service.update_entry(db, storage, e, u, {"version": e.version, "zones": ["선미부"]})
    d = service.entry_to_dict(db, db.get(models.Entry, e.id))
    assert d["zones"] == ["선미부"] and d["tags"] == ["계류"]


def test_confirmed_update_audits_tags(db, storage, make_user, make_entry_file):
    u = make_user()
    e, _f = make_entry_file(status="confirmed")
    service.update_entry(db, storage, e, u, {"version": e.version, "tags": ["피로", "계류"]})
    row = db.query(models.AuditLog).filter_by(action="ENTRY_UPDATE").one()
    assert row.before["tags"] == [] and row.after["tags"] == ["계류", "피로"]


def test_tags_api_list_alias_unalias(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001", is_admin=True)  # 구역 동의어는 관리자만(08)
    h = auth_headers("A100001")
    e, _f = make_entry_file(status="confirmed")
    bow, fwd = _tag(db, "선수부"), _tag(db, "FWD")
    db.add(models.EntryTag(entry_id=e.id, tag_id=fwd.id))
    db.commit()

    res = client.get("/api/tags?kind=zone", headers=h)
    assert res.status_code == 200
    by_value = {t["value"]: t for t in res.json()}
    assert by_value["FWD"]["count"] == 1 and by_value["선수부"]["count"] == 0

    res = client.post(f"/api/tags/{fwd.id}/alias", json={"target_id": bow.id}, headers=h)
    assert res.status_code == 200 and res.json()["alias_of"] == {"id": bow.id, "value": "선수부"}
    assert db.query(models.AuditLog).filter_by(action="TAG_ALIAS").count() == 1

    res = client.delete(f"/api/tags/{fwd.id}/alias", headers=h)
    assert res.status_code == 200 and res.json()["alias_of"] is None
    assert db.query(models.AuditLog).filter_by(action="TAG_UNALIAS").count() == 1


def test_alias_moves_children_to_new_root(client, db, make_user, auth_headers):
    make_user("A100001", is_admin=True)  # 구역 동의어는 관리자만(08)
    h = auth_headers("A100001")
    a, b, c = _tag(db, "A"), _tag(db, "B"), _tag(db, "C")
    client.post(f"/api/tags/{b.id}/alias", json={"target_id": a.id}, headers=h)
    res = client.post(f"/api/tags/{a.id}/alias", json={"target_id": c.id}, headers=h)
    assert res.status_code == 200
    db.expire_all()
    assert db.get(models.Tag, b.id).alias_of_id == c.id and db.get(models.Tag, a.id).alias_of_id == c.id


def test_alias_to_child_resolves_to_root(client, db, make_user, auth_headers):
    make_user("A100001", is_admin=True)  # 구역 동의어는 관리자만(08)
    h = auth_headers("A100001")
    a, b, c = _tag(db, "A"), _tag(db, "B"), _tag(db, "C")
    client.post(f"/api/tags/{b.id}/alias", json={"target_id": a.id}, headers=h)
    res = client.post(f"/api/tags/{c.id}/alias", json={"target_id": b.id}, headers=h)
    assert res.json()["alias_of"]["value"] == "A"


def test_alias_rejections(client, db, make_user, auth_headers):
    make_user("A100001", is_admin=True)  # 구역 동의어는 관리자만(08)
    h = auth_headers("A100001")
    z, f = _tag(db, "Z"), _tag(db, "F", kind="free")
    assert client.post(f"/api/tags/{z.id}/alias", json={"target_id": f.id}, headers=h).json()["detail"] == "kind_mismatch"
    assert client.post(f"/api/tags/{z.id}/alias", json={"target_id": z.id}, headers=h).json()["detail"] == "same_tag"
    child = _tag(db, "Y", alias_of=z)
    assert client.post(f"/api/tags/{z.id}/alias", json={"target_id": child.id}, headers=h).json()["detail"] == "same_tag"
    assert client.post("/api/tags/99999/alias", json={"target_id": z.id}, headers=h).status_code == 404


def test_suggest_free_tags(client, db, make_user, auth_headers):
    make_user("A100001")
    _tag(db, "계류", kind="free")
    _tag(db, "계류부", kind="zone")
    res = client.get("/api/suggest?kind=tag&q=계", headers=auth_headers("A100001"))
    assert res.json() == ["계류"]


def test_set_tags_case_duplicates_collapse(db, storage, make_user, make_entry_file):
    """FWD·fwd 는 MySQL 정렬 규칙상 같은 태그 — 한 번에 들어와도 IntegrityError 없이 하나로 합친다."""
    u = make_user()
    e, _f = make_entry_file(status="draft")
    service.update_entry(db, storage, e, u, {"version": e.version, "zones": ["FWD", "fwd"], "tags": ["계류", "계류 "]})
    d = service.entry_to_dict(db, db.get(models.Entry, e.id))
    assert d["zones"] == ["FWD"] and d["tags"] == ["계류"]
