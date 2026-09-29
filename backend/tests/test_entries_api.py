from app import models


def test_entry_lifecycle_via_api(client, db, storage, make_user, auth_headers, setup_entry_with_files):
    make_user("A100001")
    _, e = setup_entry_with_files()
    h = auth_headers("A100001")
    eid = e.entry_id
    got = client.get(f"/api/entries/{eid}", headers=h).json()
    assert got["status"] == "draft" and len(got["files"]) == 2
    res = client.patch(f"/api/entries/{eid}", headers=h,
                       json={"version": got["version"], "title": "3496 Mooring 검토", "zones": ["Fore Deck"]})
    assert res.status_code == 200 and res.json()["version"] == 2
    assert client.patch(f"/api/entries/{eid}", headers=h, json={"version": 1, "title": "x"}).status_code == 409
    assert client.post(f"/api/entries/{eid}/confirm", headers=h).json()["status"] == "confirmed"
    assert client.delete(f"/api/entries/{eid}", headers=h).json()["status"] == "trashed"
    assert [t["entry_id"] for t in client.get("/api/trash", headers=h).json()] == [eid]
    assert client.post(f"/api/entries/{eid}/restore", headers=h).json()["status"] == "confirmed"


def test_split_merge_move_via_api(client, db, storage, make_user, auth_headers, setup_entry_with_files):
    make_user("A100001")
    _, e = setup_entry_with_files()
    h = auth_headers("A100001")
    f1, f2 = db.query(models.File).order_by(models.File.rel_path).all()
    new = client.post(f"/api/entries/{e.entry_id}/split", headers=h, json={"file_ids": [f2.id]}).json()
    assert [f["id"] for f in new["files"]] == [f2.id]
    assert client.post(f"/api/files/{f1.id}/move", headers=h, json={"to_entry_id": new["entry_id"]}).status_code == 200
    merged = client.post(f"/api/entries/{e.entry_id}/merge", headers=h, json={"from_entry_id": new["entry_id"]}).json()
    assert len(merged["files"]) == 2


def test_unknown_entry_404_and_auth(client, make_user, auth_headers):
    assert client.get("/api/entries/E999999").status_code == 401
    make_user("A100001")
    assert client.get("/api/entries/E999999", headers=auth_headers("A100001")).status_code == 404
