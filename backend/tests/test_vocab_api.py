"""08 — 분류 목록 API(/api/vocab)·입력 제한·CLI."""
from app import models, vocab
from app.entries import service


def _setup(db, storage, make_user, auth_headers):
    make_user("A100001")
    make_user("A900001", is_admin=True)
    vocab.seed(db, storage)
    return auth_headers("A100001"), auth_headers("A900001")


def test_list_terms_for_everyone(client, db, storage, make_user, auth_headers, make_entry_file):
    h, _ = _setup(db, storage, make_user, auth_headers)
    make_entry_file(analysis_type="FEM 해석")
    res = client.get("/api/vocab?kind=atype", headers=h)
    assert res.status_code == 200
    body = res.json()
    fe = next(t for t in body["terms"] if t["value"] == "FE 해석")
    assert fe["count"] == 1 and {"id": fe["synonyms"][0]["id"], "value": "FEA"} in fe["synonyms"]
    assert body["kind"] == "atype" and body["other"] == "기타"
    assert client.get("/api/vocab?kind=bad", headers=h).status_code == 422


def test_admin_only_changes(client, db, storage, make_user, auth_headers, make_entry_file):
    h, ha = _setup(db, storage, make_user, auth_headers)
    assert client.post("/api/vocab/terms", json={"kind": "atype", "value": "충돌 해석"}, headers=h).status_code == 403
    assert client.get("/api/vocab/unlisted?kind=atype", headers=h).status_code == 403
    res = client.post("/api/vocab/terms", json={"kind": "atype", "value": "충돌 해석"}, headers=ha)
    assert res.status_code == 200 and res.json()["value"] == "충돌 해석"
    assert client.post("/api/vocab/terms", json={"kind": "atype", "value": "fem 해석"}, headers=ha).json()["detail"] == "vocab_is_synonym"

    tid = res.json()["id"]
    res = client.patch(f"/api/vocab/terms/{tid}", json={"value": "충돌 강도 해석", "active": False}, headers=ha)
    assert res.json()["value"] == "충돌 강도 해석" and res.json()["active"] is False

    ids = [t["id"] for t in client.get("/api/vocab?kind=atype", headers=h).json()["terms"]]
    assert client.post("/api/vocab/reorder", json={"kind": "atype", "ids": ids[::-1]}, headers=ha).status_code == 200
    assert client.post("/api/vocab/reorder", json={"kind": "atype", "ids": ids[:2]}, headers=ha).json()["detail"] == "invalid_order"


def test_unlisted_merge_and_synonyms(client, db, storage, make_user, auth_headers, make_entry_file):
    h, ha = _setup(db, storage, make_user, auth_headers)
    e, _ = make_entry_file(analysis_type="구조강도")
    res = client.get("/api/vocab/unlisted?kind=atype", headers=ha)
    assert res.json() == [{"value": "구조강도", "count": 1}]
    term_id = db.query(models.Tag).filter_by(kind="atype", value="강도 평가").one().id
    res = client.post(f"/api/vocab/terms/{term_id}/merge", json={"value": "구조강도"}, headers=ha)
    assert res.status_code == 200 and res.json()["entries"] == [e.entry_id]
    db.expire_all()
    assert db.get(models.Entry, e.id).analysis_type == "강도 평가"

    res = client.post(f"/api/vocab/terms/{term_id}/synonyms", json={"value": "Strength"}, headers=ha)
    assert res.status_code == 200
    syn = db.query(models.Tag).filter_by(kind="atype", value="Strength").one()
    assert client.delete(f"/api/vocab/synonyms/{syn.id}", headers=h).status_code == 403
    assert client.delete(f"/api/vocab/synonyms/{syn.id}", headers=ha).status_code == 200


def test_patch_entry_rejects_unlisted_for_users(client, db, storage, make_user, auth_headers, make_entry_file):
    h, ha = _setup(db, storage, make_user, auth_headers)
    e, _ = make_entry_file(status="confirmed")
    res = client.patch(f"/api/entries/{e.entry_id}", json={"version": e.version, "analysis_type": "FEM"}, headers=h)
    assert res.status_code == 200 and res.json()["analysis_type"] == "FE 해석"
    res = client.patch(f"/api/entries/{e.entry_id}", json={"version": res.json()["version"], "zones": ["엉뚱한 곳"]},
                       headers=h)
    assert res.status_code == 422 and res.json()["detail"] == "vocab_not_listed"


def test_zone_alias_requires_admin(client, db, storage, make_user, auth_headers):
    h, ha = _setup(db, storage, make_user, auth_headers)
    a = models.Tag(kind="zone", value="Hold A")
    b = models.Tag(kind="free", value="계류")
    c = models.Tag(kind="free", value="계류력")
    db.add_all([a, b, c])
    db.commit()
    bow = db.query(models.Tag).filter_by(kind="zone", value="선수부").one()
    assert client.post(f"/api/tags/{a.id}/alias", json={"target_id": bow.id}, headers=h).status_code == 403
    assert client.post(f"/api/tags/{c.id}/alias", json={"target_id": b.id}, headers=h).status_code == 200


def test_cli_report_and_normalize(db, storage, make_user, make_entry_file, capsys, monkeypatch):
    from app import cli

    monkeypatch.setattr(cli, "get_storage", lambda: storage)
    u = make_user()
    e, _ = make_entry_file(analysis_type="FEM 해석")
    service.update_entry(db, storage, e, u, {"version": db.get(models.Entry, e.id).version, "zones": ["선 수 부", "X"]})

    assert cli.main(["vocab-report"]) == 0
    out = capsys.readouterr().out
    assert "FEM 해석" in out and "→ FE 해석" in out and "목록 밖" in out and "X" in out
    db.expire_all()
    assert db.get(models.Entry, e.id).analysis_type == "FEM 해석"

    assert cli.main(["vocab-normalize"]) == 0          # --apply 없으면 보고만
    db.expire_all()
    assert db.get(models.Entry, e.id).analysis_type == "FEM 해석"

    assert cli.main(["vocab-normalize", "--apply"]) == 0
    out = capsys.readouterr().out
    assert "바꾼 Entry" in out
    db.expire_all()
    assert db.get(models.Entry, e.id).analysis_type == "FE 해석"
    assert service.zones_of(db, db.get(models.Entry, e.id)) == ["X", "선수부"]
