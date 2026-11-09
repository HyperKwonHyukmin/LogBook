from app import models


def _batch(db, key, uploader):
    b = models.Batch(key=key, source="inbox", original_name=key, uploader=uploader, state="processed")
    db.add(b)
    db.flush()
    e = models.Entry(title=f"t-{key}", status="draft", batch_id=b.id, uploaded_by=uploader)
    db.add(e)
    db.flush()
    e.entry_id = f"E{e.id:06d}"
    db.commit()
    return b, e


def test_list_mine_and_unclaimed(client, db, make_user, auth_headers):
    make_user("A100001")
    _batch(db, "k-mine", "A100001")
    _batch(db, "k-none", None)
    _batch(db, "k-other", "B200002")
    h = auth_headers("A100001")
    mine = client.get("/api/batches?scope=mine", headers=h).json()
    assert [b["key"] for b in mine] == ["k-mine"]
    assert mine[0]["entries"][0]["title"] == "t-k-mine"
    unclaimed = client.get("/api/batches?scope=unclaimed", headers=h).json()
    assert [b["key"] for b in unclaimed] == ["k-none"]


def test_claim(client, db, make_user, auth_headers):
    make_user("A100001")
    b, e = _batch(db, "k-none", None)
    h = auth_headers("A100001")
    assert client.post("/api/batches/k-none/claim", headers=h).status_code == 200
    db.expire_all()
    assert db.get(models.Batch, b.id).uploader == "A100001"
    assert db.get(models.Entry, e.id).uploaded_by == "A100001"
    assert client.post("/api/batches/k-none/claim", headers=h).status_code == 409


def test_claim_only_updates_draft_entries(client, db, make_user, auth_headers):
    """I5: 같은 배치 안의 확정된 Entry 는 claim 이 uploaded_by 를 건드리면 안 된다."""
    make_user("A100001")
    b, draft = _batch(db, "k-mixed", None)
    confirmed = models.Entry(title="이미 확정", status="confirmed", batch_id=b.id, uploaded_by="Z000000")
    db.add(confirmed)
    db.commit()

    h = auth_headers("A100001")
    assert client.post("/api/batches/k-mixed/claim", headers=h).status_code == 200
    db.expire_all()
    assert db.get(models.Entry, draft.id).uploaded_by == "A100001"
    assert db.get(models.Entry, confirmed.id).uploaded_by == "Z000000"  # 그대로


def test_claim_unknown_batch_404(client, make_user, auth_headers):
    make_user("A100001")
    h = auth_headers("A100001")
    assert client.post("/api/batches/no-such-key/claim", headers=h).status_code == 404


def test_get_one_batch(client, db, make_user, auth_headers):
    make_user("A100001")
    _batch(db, "k-one", "A100001")
    h = auth_headers("A100001")
    r = client.get("/api/batches/k-one", headers=h)
    assert r.status_code == 200 and r.json()["key"] == "k-one" and r.json()["state"] == "processed"
    assert client.get("/api/batches/nope", headers=h).status_code == 404
    assert client.get("/api/batches/k-one").status_code == 401


def test_summary_counts_my_drafts_and_in_flight(client, db, make_user, auth_headers):
    """62 — 메뉴 배지·다른 창 안내·같은 이름 경고용 요약. 남의 것·오래된 올리기·확정만 남은 묶음은 세지 않는다."""
    from datetime import datetime, timedelta
    make_user("A100001")
    _batch(db, "k-mine", "A100001")                       # 초안 1
    b2, e2 = _batch(db, "k-done", "A100001")              # 초안을 확정해 할 일 없음
    e2.status = "confirmed"
    _batch(db, "k-other", "B200002")
    db.add(models.Batch(key="k-staged", source="web", original_name="6_Rudder", uploader="A100001", state="staged"))
    db.add(models.Batch(key="k-up", source="web", original_name="7_Skeg", uploader="A100001", state="uploading"))
    db.add(models.Batch(key="k-old", source="web", original_name="old", uploader="A100001", state="uploading",
                        received_at=datetime.now() - timedelta(hours=30)))
    db.commit()
    r = client.get("/api/batches/summary", headers=auth_headers("A100001"))
    assert r.status_code == 200
    d = r.json()
    assert (d["drafts"], d["staged"], d["uploading"]) == (1, 1, 1)
    assert sorted(n["name"] for n in d["names"]) == ["6_Rudder", "7_Skeg", "k-mine"]
    assert client.get("/api/batches/summary").status_code == 401
