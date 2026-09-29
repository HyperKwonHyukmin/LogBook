from app import audit, models
from app.entries import service


def test_files_include_extract(db, make_entry_file):
    e, f = make_entry_file(name="r.pdf")
    make_entry_file(entry=e, name="m.bdf", kind="model")
    db.add(models.FileExtract(file_id=f.id, state="done", summary={"unit": "page", "count": 3}))
    db.commit()
    d = service.entry_to_dict(db, e)
    by_name = {x["name"]: x for x in d["files"]}
    assert by_name["r.pdf"]["extract"] == {"state": "done", "error": None, "summary": {"unit": "page", "count": 3}}
    assert by_name["m.bdf"]["extract"] is None


def test_get_entry_has_vault_unc(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    e, _f = make_entry_file(status="confirmed")
    d, _ = make_entry_file(status="draft")
    h = auth_headers("A100001")
    res = client.get(f"/api/entries/{e.entry_id}", headers=h)
    assert res.json()["vault_unc"] == str(storage.vault / "2026" / e.entry_id)
    assert client.get(f"/api/entries/{d.entry_id}", headers=h).json()["vault_unc"] is None


def test_history(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001", name="홍길동")
    e, _f = make_entry_file(status="confirmed")
    audit.record(db, storage, actor="A100001", action="ENTRY_CONFIRM", target_type="entry", target_id=e.entry_id)
    audit.record(db, storage, actor="A100001", action="ENTRY_UPDATE", target_type="entry", target_id=e.entry_id,
                 before={"title": "a"}, after={"title": "b"})
    audit.record(db, storage, actor="A100001", action="ENTRY_UPDATE", target_type="entry", target_id="E999999")
    res = client.get(f"/api/entries/{e.entry_id}/history", headers=auth_headers("A100001"))
    rows = res.json()
    assert [r["action"] for r in rows] == ["ENTRY_UPDATE", "ENTRY_CONFIRM"]
    assert rows[0]["name"] == "홍길동" and rows[0]["before"] == {"title": "a"} and rows[0]["at"]


def test_history_404(client, make_user, auth_headers):
    make_user("A100001")
    assert client.get("/api/entries/E999999/history", headers=auth_headers("A100001")).status_code == 404
