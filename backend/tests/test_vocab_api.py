"""08 — 분류 목록 API(/api/vocab)·입력 제한·CLI. 42 — 해석 종류(atype)는 없앴고, 용어 지우기(DELETE)가 생겼다."""
from app import models, vocab
from app.entries import service


def _setup(db, storage, make_user, auth_headers):
    make_user("A100001")
    make_user("A900001", is_admin=True)
    vocab.seed(db, storage)
    return auth_headers("A100001"), auth_headers("A900001")


def _with_zones(db, storage, make_user, make_entry_file, zones, **kw):
    e, _ = make_entry_file(**kw)
    service.set_zones(db, e, zones)
    db.commit()
    return e


def test_list_terms_for_everyone(client, db, storage, make_user, auth_headers, make_entry_file):
    h, _ = _setup(db, storage, make_user, auth_headers)
    _with_zones(db, storage, make_user, make_entry_file, ["FWD"])
    res = client.get("/api/vocab?kind=zone", headers=h)
    assert res.status_code == 200
    body = res.json()
    bow = next(t for t in body["terms"] if t["value"] == "선수부")
    assert bow["count"] == 1 and any(s["value"] == "FWD" for s in bow["synonyms"])
    assert body["kind"] == "zone" and body["other"] == "기타"
    assert client.get("/api/vocab?kind=bad", headers=h).status_code == 422
    assert client.get("/api/vocab?kind=atype", headers=h).status_code == 422   # 42


def test_admin_only_changes(client, db, storage, make_user, auth_headers, make_entry_file):
    h, ha = _setup(db, storage, make_user, auth_headers)
    assert client.post("/api/vocab/terms", json={"kind": "zone", "value": "펌프실"}, headers=h).status_code == 403
    assert client.get("/api/vocab/unlisted?kind=zone", headers=h).status_code == 403
    res = client.post("/api/vocab/terms", json={"kind": "zone", "value": "펌프실"}, headers=ha)
    assert res.status_code == 200 and res.json()["value"] == "펌프실"
    assert client.post("/api/vocab/terms", json={"kind": "zone", "value": "fwd"}, headers=ha).json()["detail"] == "vocab_is_synonym"
    assert client.post("/api/vocab/terms", json={"kind": "atype", "value": "충돌 해석"}, headers=ha).status_code == 422

    tid = res.json()["id"]
    res = client.patch(f"/api/vocab/terms/{tid}", json={"value": "펌프 룸", "active": False}, headers=ha)
    assert res.json()["value"] == "펌프 룸" and res.json()["active"] is False

    ids = [t["id"] for t in client.get("/api/vocab?kind=zone", headers=h).json()["terms"]]
    assert client.post("/api/vocab/reorder", json={"kind": "zone", "ids": ids[::-1]}, headers=ha).status_code == 200
    assert client.post("/api/vocab/reorder", json={"kind": "zone", "ids": ids[:2]}, headers=ha).json()["detail"] == "invalid_order"


def test_unlisted_merge_and_synonyms(client, db, storage, make_user, auth_headers, make_entry_file):
    h, ha = _setup(db, storage, make_user, auth_headers)
    e = _with_zones(db, storage, make_user, make_entry_file, ["Hold A"])
    res = client.get("/api/vocab/unlisted?kind=zone", headers=ha)
    assert res.json() == [{"value": "Hold A", "count": 1}]
    term_id = db.query(models.Tag).filter_by(kind="zone", value="화물창").one().id
    res = client.post(f"/api/vocab/terms/{term_id}/merge", json={"value": "Hold A"}, headers=ha)
    assert res.status_code == 200 and res.json()["entries"] == [e.entry_id]
    db.expire_all()
    assert service.zones_of(db, db.get(models.Entry, e.id)) == ["화물창"]

    res = client.post(f"/api/vocab/terms/{term_id}/synonyms", json={"value": "Hold"}, headers=ha)
    assert res.status_code == 200
    syn = db.query(models.Tag).filter_by(kind="zone", value="Hold").one()
    assert client.delete(f"/api/vocab/synonyms/{syn.id}", headers=h).status_code == 403
    assert client.delete(f"/api/vocab/synonyms/{syn.id}", headers=ha).status_code == 200


def test_delete_term_api(client, db, storage, make_user, auth_headers, make_entry_file):
    """42 — 용어 지우기: 관리자만, 그 값을 단 자료에서도 뺀다. 응답 {value, entries}."""
    h, ha = _setup(db, storage, make_user, auth_headers)
    e = _with_zones(db, storage, make_user, make_entry_file, ["선수부", "기관실"], status="confirmed")
    tid = db.query(models.Tag).filter_by(kind="zone", value="선수부").one().id
    assert client.delete(f"/api/vocab/terms/{tid}", headers=h).status_code == 403
    res = client.delete(f"/api/vocab/terms/{tid}", headers=ha)
    assert res.status_code == 200 and res.json() == {"value": "선수부", "entries": [e.entry_id]}
    assert client.get(f"/api/entries/{e.entry_id}", headers=ha).json()["zones"] == ["기관실"]
    assert all(t["value"] != "선수부" for t in client.get("/api/vocab?kind=zone", headers=h).json()["terms"])
    assert client.delete(f"/api/vocab/terms/{tid}", headers=ha).status_code == 404
    assert client.delete("/api/vocab/terms/999999", headers=ha).status_code == 404


def test_patch_entry_rejects_unlisted_for_users(client, db, storage, make_user, auth_headers, make_entry_file):
    h, ha = _setup(db, storage, make_user, auth_headers)
    e, _ = make_entry_file(status="confirmed")
    res = client.patch(f"/api/entries/{e.entry_id}", json={"version": e.version, "zones": ["FWD"],
                                                            "analysis_type": "아무거나"}, headers=h)
    assert res.status_code == 200 and res.json()["zones"] == ["선수부"] and "analysis_type" not in res.json()
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
    e, _ = make_entry_file()
    service.update_entry(db, storage, e, u, {"version": db.get(models.Entry, e.id).version, "zones": ["선 수 부", "X"]})

    assert cli.main(["vocab-report"]) == 0
    out = capsys.readouterr().out
    assert "선 수 부" in out and "→ 선수부" in out and "목록 밖" in out and "X" in out and "해석 종류" not in out
    db.expire_all()
    assert service.zones_of(db, db.get(models.Entry, e.id)) == ["X", "선 수 부"]

    assert cli.main(["vocab-normalize"]) == 0          # --apply 없으면 보고만
    db.expire_all()
    assert service.zones_of(db, db.get(models.Entry, e.id)) == ["X", "선 수 부"]

    assert cli.main(["vocab-normalize", "--apply"]) == 0
    out = capsys.readouterr().out
    assert "바꾼 Entry" in out
    db.expire_all()
    assert service.zones_of(db, db.get(models.Entry, e.id)) == ["X", "선수부"]
