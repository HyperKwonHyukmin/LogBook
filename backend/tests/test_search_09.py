"""09 — 분류 화면(속성별 값·건수)과 속성 값으로 찾기."""
from app.access import SYSTEM
from app import models, vocab
from app.search import SearchQuery, get_search


def _q(db, q="", **kw):
    return get_search().search(db, SearchQuery(q=q, filters=kw.pop("filters", {}), **({"user": SYSTEM} | kw)))


def _ids(res):
    return sorted(i["entry_id"] for i in res["items"])


def _zone(db, e, value):
    t = db.query(models.Tag).filter_by(kind="zone", value=value).first()
    if t is None:
        t = models.Tag(kind="zone", value=value)
        db.add(t)
        db.flush()
    db.add(models.EntryTag(entry_id=e.id, tag_id=t.id))
    db.commit()


def _free(db, e, value, alias_of=None):
    t = db.query(models.Tag).filter_by(kind="free", value=value).first()
    if t is None:
        t = models.Tag(kind="free", value=value, alias_of_id=alias_of.id if alias_of else None)
        db.add(t)
        db.flush()
    db.add(models.EntryTag(entry_id=e.id, tag_id=t.id))
    db.commit()
    return t


def test_query_by_zone_value_and_synonym(db, storage, make_entry_file):
    """본문·제목에 낱말이 없어도 구역 값(대표·동의어·표기 변형)으로 찾는다."""
    a, _ = make_entry_file(title="가")
    b, _ = make_entry_file(title="나")
    make_entry_file(title="다")
    vocab.seed(db, storage)
    _zone(db, a, "선미부")
    _zone(db, b, "AFT")   # 선미부의 동의어
    for q in ("선미부", "AFT", "선미", "aft"):
        assert _ids(_q(db, q)) == sorted([a.entry_id, b.entry_id]), q


def test_query_by_spacing_variant(db, storage, make_entry_file):
    a, _ = make_entry_file(title="가", analysis_type="강도평가")
    b, _ = make_entry_file(title="나")
    vocab.seed(db, storage)
    _zone(db, b, "기관실")
    assert _ids(_q(db, "강도평가")) == [a.entry_id]
    assert _ids(_q(db, "강도 평가")) != []          # 두 낱말 AND — '강도'·'평가' 모두 맞음
    assert _ids(_q(db, "engineroom")) == [b.entry_id]   # 'Engine Room' 의 표기 변형


def test_query_by_synonym_finds_unaliased_spacing_variant(db, storage, make_entry_file):
    """동의어로 찾으면, 묶이지 않은 표기 변형 값('선미 부')을 가진 자료도 맞는다(필터 건수와 같은 기준)."""
    a, _ = make_entry_file(title="가")
    vocab.seed(db, storage)
    _zone(db, a, "선미 부")
    assert _ids(_q(db, "AFT")) == [a.entry_id]
    assert _ids(_q(db, filters={"zone": "선미부"})) == [a.entry_id]


def test_query_by_ship_type_and_uploader(db, make_entry_file, make_user):
    a, _ = make_entry_file(title="가", hulls=("3001",), uploaded_by="B200002")
    b, _ = make_entry_file(title="나", hulls=("3002",))
    db.get(models.Hull, "3001").ship_type = "LNGC"
    db.get(models.Hull, "3002").ship_type = "VLCC"
    db.commit()
    make_user("B200002", name="홍길동")
    assert _ids(_q(db, "LNGC")) == [a.entry_id]
    assert _ids(_q(db, "홍길동")) == [a.entry_id]
    assert _ids(_q(db, "홍")) == []   # 이름은 정확히 같을 때만
    assert _ids(_q(db, "B200002")) == [a.entry_id]
    assert _ids(_q(db, "VLCC")) == [b.entry_id]


def test_browse_lists_every_property(db, storage, make_entry_file, make_user):
    a, _ = make_entry_file(title="가", analysis_type="FEM 해석", period="2025-03", hulls=("3001",))
    b, _ = make_entry_file(title="나", analysis_type="FE 해석", hulls=("3001", "3002"), kind="model", name="m.bdf")
    make_entry_file(title="초안", status="draft", analysis_type="진동 해석")
    vocab.seed(db, storage)
    _zone(db, a, "AFT")
    _zone(db, b, "선미부")
    root = _free(db, a, "계류")
    _free(db, b, "계류력", alias_of=root)
    db.get(models.Hull, "3001").ship_type = "LNGC"
    db.commit()
    make_user("A100001", name="김해석")

    res = get_search().browse(db, user=SYSTEM)
    f = res["facets"]
    assert res["total"] == 2
    zone = {x["value"]: x for x in f["zone"]}
    assert zone["선미부"]["count"] == 2 and "AFT" in zone["선미부"]["aliases"] and zone["선미부"]["listed"]
    assert zone["선수부"]["count"] == 0          # 아직 안 쓴 목록 용어도 보인다
    assert f["zone"][0]["value"] == "선미부"      # 건수순
    atype = {x["value"]: x["count"] for x in f["analysis_type"]}
    assert atype["FE 해석"] == 2 and atype["진동 해석"] == 0   # 초안은 기본에서 빠진다
    assert f["tag"] == [{"value": "계류", "count": 2, "aliases": ["계류력"]}]
    assert f["hull"][0] == {"value": "3001", "count": 2, "label": "LNGC"}
    assert "year" not in f                       # 15 — 해석 연도는 없앴다
    assert {x["value"] for x in f["kind"]} == {"report", "model"}
    assert f["uploaded_by"] == [{"value": "A100001", "count": 2, "label": "김해석"}]
    assert f["ship_type"] == [{"value": "LNGC", "count": 2}]

    drafts = get_search().browse(db, include_drafts=True, user=SYSTEM)
    assert {x["value"]: x["count"] for x in drafts["facets"]["analysis_type"]}["진동 해석"] == 1


def test_browse_api(client, db, make_entry_file, make_user, auth_headers):
    make_user("A100001")
    make_entry_file(title="가")
    assert client.get("/api/search/browse").status_code == 401
    res = client.get("/api/search/browse", headers=auth_headers("A100001"))
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 1 and set(body["facets"]) >= {"hull", "zone", "analysis_type", "tag", "kind"}
    assert "year" not in body["facets"]
