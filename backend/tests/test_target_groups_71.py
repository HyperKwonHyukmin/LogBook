"""71 — 대상 묶음(한 단계): 묶음 지정과 검사, 검색 거르기와 건수, 낱말 검색, 분류 화면, 업무별 모음, registry 보존."""
from app import models, vocab
from app.ops.rebuild import _restore_vocab
from app.ops.registry import build_registry

ADMIN, OWNER = "A710001", "U710001"


def _term(db, value, kind="target"):
    t = db.query(models.Tag).filter_by(kind=kind, value=value).first()
    if t is None:
        t = models.Tag(kind=kind, value=value, listed=True)
        db.add(t)
        db.commit()
    return t


def _tag_entry(db, entry, value):
    db.add(models.EntryTag(entry_id=entry.id, tag_id=_term(db, value).id))
    db.commit()


def _setup(db, make_user, make_entry_file):
    make_user(ADMIN, level=3)
    make_user(OWNER, level=2)
    for v in ("배관", "Manifold", "Pipe", "Unit", "기타"):
        _term(db, v)
    _term(db, "상갑판", kind="zone")
    es = {}
    for key, title, target in (("m", "매니폴드 서포트", "Manifold"), ("p", "파이프 앵커", "Pipe"),
                               ("g", "블랭크 플레이트", "배관"), ("u", "유닛 권상", "Unit")):
        e, _f = make_entry_file(title=title, hulls=("3496",), name=f"{key}.pdf", kind="report", uploaded_by=OWNER)
        _tag_entry(db, e, target)
        es[key] = e
    return es


def _patch(client, h, db, value, parent):
    return client.patch(f"/api/vocab/terms/{_term(db, value).id}", json={"parent": parent}, headers=h)


def test_set_parent_and_rules(db, client, auth_headers, make_user, make_entry_file):
    _setup(db, make_user, make_entry_file)
    h = auth_headers(ADMIN)
    assert _patch(client, h, db, "Manifold", "배관").status_code == 200
    assert _patch(client, h, db, "Pipe", "배관").status_code == 200
    terms = {t["value"]: t for t in client.get("/api/vocab?kind=target", headers=h).json()["terms"]}
    assert terms["Manifold"]["parent"] == "배관" and terms["배관"]["children"] == ["Manifold", "Pipe"]
    assert terms["Unit"]["parent"] is None and terms["Unit"]["children"] == []
    # 검사: 자기 자신, 기타, 한 단계(묶음에 든 용어는 묶음이 못 되고 하위가 있는 용어는 다른 묶음에 못 든다), 없는 묶음, 구역
    assert _patch(client, h, db, "Unit", "Unit").json()["detail"] == "group_self"
    assert _patch(client, h, db, "Unit", "기타").json()["detail"] == "group_other"
    assert _patch(client, h, db, "Unit", "Manifold").json()["detail"] == "group_nested"
    assert _patch(client, h, db, "배관", "Unit").json()["detail"] == "group_has_children"
    assert _patch(client, h, db, "Unit", "없는 묶음").status_code == 404
    zone = _term(db, "상갑판", kind="zone")
    r = client.patch(f"/api/vocab/terms/{zone.id}", json={"parent": "배관"}, headers=h)
    assert r.json()["detail"] == "group_target_only"
    # 이름만 바꾸는 요청은 묶음을 건드리지 않는다
    assert client.patch(f"/api/vocab/terms/{_term(db, 'Pipe').id}", json={"active": True}, headers=h).status_code == 200
    db.expire_all()
    assert vocab.Vocab(db, "target").group_value("Pipe") == "배관"
    # 빈 글자 = 묶음에서 빼기, 기록에 전후가 남는다
    assert _patch(client, h, db, "Pipe", "").status_code == 200
    db.expire_all()
    assert vocab.Vocab(db, "target").group_value("Pipe") is None
    log = (db.query(models.AuditLog).filter_by(action="VOCAB_TERM_UPDATE").order_by(models.AuditLog.id.desc()).first())
    assert log.before["parent"] == "배관" and log.after["parent"] is None
    # 관리자만
    assert _patch(client, auth_headers(OWNER), db, "Pipe", "배관").status_code == 403
    # 묶음 용어를 지우면 하위 용어의 연결도 끊는다
    manifold_id = _term(db, "Manifold").id
    assert client.delete(f"/api/vocab/terms/{_term(db, '배관').id}", headers=h).status_code == 200
    db.expire_all()
    assert db.get(models.Tag, manifold_id).parent_id is None


def test_search_filter_facets_and_word(db, client, auth_headers, make_user, make_entry_file):
    es = _setup(db, make_user, make_entry_file)
    for v in ("Manifold", "Pipe"):
        _term(db, v).parent_id = _term(db, "배관").id
    db.commit()
    h = auth_headers(OWNER)
    ids = lambda r: sorted(i["entry_id"] for i in r["items"])   # noqa: E731
    r = client.get("/api/search", params={"target": "배관"}, headers=h).json()
    assert ids(r) == sorted(es[k].entry_id for k in "mpg")   # 묶음 = 직접 분류 + 하위 대상
    assert ids(client.get("/api/search", params={"target": "Manifold"}, headers=h).json()) == [es["m"].entry_id]
    facets = {f["value"]: f for f in client.get("/api/search", headers=h).json()["facets"]["target"]}
    assert facets["배관"]["count"] == 3 and facets["Manifold"]["count"] == 1 and facets["Unit"]["count"] == 1
    assert facets["Manifold"]["group"] == "배관" and facets["배관"]["children"] == ["Manifold", "Pipe"]
    # 결과 행의 대상은 자기 값 그대로(묶음으로 바꾸지 않는다)
    assert {i["target"] for i in r["items"]} == {"Manifold", "Pipe", "배관"}
    # 낱말 '배관' 도 하위 대상 자료를 찾는다
    assert set(ids(client.get("/api/search", params={"q": "배관"}, headers=h).json())) >= {es[k].entry_id for k in "mpg"}
    # 분류 화면 건수도 같은 셈법
    b = {f["value"]: f for f in client.get("/api/search/browse", headers=h).json()["facets"]["target"]}
    assert b["배관"]["count"] == 3 and b["Pipe"]["group"] == "배관"


def test_search_group_name_with_space(db, client, auth_headers, make_user, make_entry_file):
    make_user(OWNER, level=2)
    group, child = _term(db, "선체 구조"), _term(db, "블록")
    child.parent_id = group.id
    db.commit()
    e, _f = make_entry_file(title="E블록 강도", hulls=("3496",), name="b.pdf", kind="report", uploaded_by=OWNER)
    _tag_entry(db, e, "블록")
    h = auth_headers(OWNER)
    got = [i["entry_id"] for i in client.get("/api/search", params={"q": "선체 구조"}, headers=h).json()["items"]]
    assert e.entry_id in got   # 낱말로 나누면 '선체'·'구조' 둘 다 맞는 자료만 남아 빠진다
    assert e.entry_id in [i["entry_id"] for i in client.get("/api/search", params={"target": "선체 구조"}, headers=h).json()["items"]]


def test_targets_cards_and_page(db, client, auth_headers, make_user, make_entry_file):
    es = _setup(db, make_user, make_entry_file)
    for v in ("Manifold", "Pipe"):
        _term(db, v).parent_id = _term(db, "배관").id
    db.commit()
    h = auth_headers(OWNER)
    cards = {c["value"]: c for c in client.get("/api/targets", headers=h).json()["targets"]}
    assert cards["배관"]["entries"] == 3 and cards["배관"]["children"] in (["Manifold", "Pipe"], ["Pipe", "Manifold"])
    assert cards["Manifold"]["group"] == "배관" and cards["Manifold"]["entries"] == 1 and cards["Unit"]["group"] is None
    p = client.get("/api/targets/page", params={"value": "배관"}, headers=h).json()
    assert p["counts"]["entries"] == 3 and p["group"] is None
    assert {c["value"]: c["entries"] for c in p["children"]} == {"Manifold": 1, "Pipe": 1}
    child = client.get("/api/targets/page", params={"value": "Manifold"}, headers=h).json()
    assert child["group"] == "배관" and child["children"] == [] and child["counts"]["entries"] == 1
    assert es["u"].entry_id not in [r["entry_id"] for r in p["records"]]


def test_registry_keeps_groups_and_ignores_bad_links(db):
    for v in ("배관", "Manifold", "Pipe", "기타"):
        _term(db, v)
    _term(db, "Manifold").parent_id = _term(db, "배관").id
    _term(db, "Pipe").parent_id = _term(db, "Manifold").id      # 하위에 든 용어를 묶음으로 — 무시(한 단계)
    _term(db, "기타").parent_id = _term(db, "배관").id           # 기타는 하위가 못 됨 — 무시
    db.commit()
    v = vocab.Vocab(db, "target")
    assert v.group_value("Manifold") == "배관" and v.group_value("Pipe") is None and v.group_value("기타") is None
    assert v.family("배관") == {"배관", "Manifold"}
    reg = build_registry(db)
    by = {t["value"]: t for t in reg["vocab"] if t["kind"] == "target"}
    assert by["Manifold"]["parent"] == "배관" and "parent" not in by["Pipe"] and "parent" not in by["배관"]
    # 재구축: 묶음 용어가 뒤에 와도 잇는다
    for t in db.query(models.Tag).all():
        t.parent_id = None
    db.commit()
    rows = sorted(reg["vocab"], key=lambda t: t["value"] != "Manifold")   # Manifold 먼저, 배관은 뒤
    _restore_vocab(db, {"vocab": rows})
    db.commit()
    assert vocab.Vocab(db, "target").group_value("Manifold") == "배관"
