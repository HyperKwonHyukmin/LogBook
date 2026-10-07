"""08 — 검색: 통제 어휘 대표 값, 태그 필터, 해석 연도, 정렬, 결과 행 필드."""
from datetime import datetime

from app import models, vocab
from app.search import SearchQuery, get_search


def _q(db, q="", **kw):
    filters = kw.pop("filters", {})
    return get_search().search(db, SearchQuery(q=q, filters=filters, **kw))


def _ids(res):
    return [i["entry_id"] for i in res["items"]]


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


def test_facets_use_canonical_terms(db, storage, make_entry_file):
    a, _ = make_entry_file(title="가", analysis_type="FEM 해석")
    b, _ = make_entry_file(title="나", analysis_type="FE 해석")
    c, _ = make_entry_file(title="다", analysis_type="강도평가")
    _zone(db, a, "선미 부")
    _zone(db, b, "선미부")
    vocab.seed(db, storage)
    res = _q(db)
    assert {f["value"]: f["count"] for f in res["facets"]["analysis_type"]} == {"FE 해석": 2, "강도 평가": 1}
    assert res["facets"]["zone"] == [{"value": "선미부", "count": 2}]
    items = {i["entry_id"]: i for i in res["items"]}
    assert items[a.entry_id]["analysis_type"] == "FE 해석" and items[a.entry_id]["zones"] == ["선미부"]
    # 용어로 거르면 동의어·표기 변형 값도, 동의어로 거르면 그 용어 전체가 걸린다
    assert sorted(_ids(_q(db, filters={"analysis_type": "FE 해석"}))) == sorted([a.entry_id, b.entry_id])
    r = _q(db, filters={"analysis_type": "FEM"})
    assert sorted(_ids(r)) == sorted([a.entry_id, b.entry_id]) and r["applied_filters"]["analysis_type"] == "FE 해석"
    assert _ids(_q(db, filters={"analysis_type": "강도 평가"})) == [c.entry_id]
    assert sorted(_ids(_q(db, filters={"zone": "선미부"}))) == sorted([a.entry_id, b.entry_id])


def test_query_by_synonym_finds_term(db, storage, make_entry_file):
    a, _ = make_entry_file(title="가", analysis_type="FE 해석")
    make_entry_file(title="나", analysis_type="진동 해석")
    vocab.seed(db, storage)
    res = _q(db, "FEM")
    assert _ids(res) == [a.entry_id] and res["items"][0]["matched"] == ["analysis_type"]


def test_tag_filter_and_facet(db, make_entry_file):
    a, _ = make_entry_file(title="가")
    b, _ = make_entry_file(title="나")
    root = _free(db, a, "계류")
    _free(db, b, "계류력", alias_of=root)
    res = _q(db)
    assert res["facets"]["tag"] == [{"value": "계류", "count": 2}]
    r = _q(db, filters={"tag": "계류력"})
    assert sorted(_ids(r)) == sorted([a.entry_id, b.entry_id]) and r["applied_filters"]["tag"] == "계류"
    assert res["items"][0]["tags"] in (["계류"], ["계류력"])


def test_year_is_analysis_year_only(db, make_entry_file):
    a, _ = make_entry_file(title="가", period="2025-11", confirmed_at=datetime(2026, 9, 1))
    b, _ = make_entry_file(title="나", period=None, confirmed_at=datetime(2026, 9, 2))
    res = _q(db)
    assert {f["value"]: f["count"] for f in res["facets"]["year"]} == {"2025": 1, "unknown": 1}
    assert _ids(_q(db, filters={"year": "2026"})) == []
    assert _ids(_q(db, filters={"year": "unknown"})) == [b.entry_id]


def test_sort_default_and_choices(db, make_entry_file):
    old = make_entry_file(title="강도 옛", period="2019-03", confirmed_at=datetime(2026, 9, 9))[0]
    new = make_entry_file(title="강도 새", period="2025-11", confirmed_at=datetime(2026, 9, 1))[0]
    none = make_entry_file(title="강도", period=None, confirmed_at=datetime(2026, 9, 20))[0]
    res = _q(db)
    assert res["sort"] == "period" and _ids(res) == [new.entry_id, old.entry_id, none.entry_id]
    res = _q(db, sort="recent")
    assert res["sort"] == "recent" and _ids(res) == [none.entry_id, old.entry_id, new.entry_id]
    res = _q(db, "강도")
    assert res["sort"] == "relevance" and _ids(res)[0] == none.entry_id   # 제목이 정확히 같음
    res = _q(db, "강도", sort="period")
    assert _ids(res) == [new.entry_id, old.entry_id, none.entry_id]
    files = _q(db, unit="file", sort="period")
    assert [i["entry_id"] for i in files["items"]] == [new.entry_id, old.entry_id, none.entry_id]


def test_row_fields_kind_counts_and_thumb(db, make_entry_file):
    e, report = make_entry_file(title="선미 구조", name="r.pdf", kind="report")
    _e, small = make_entry_file(entry=e, name="small.bdf", kind="model")
    _e, big = make_entry_file(entry=e, name="main.bdf", kind="model")
    _e, inc = make_entry_file(entry=e, name="mesh.bdf", kind="model")
    db.add_all([
        models.ModelSummary(file_id=small.id, state="done", key="k1", counts={"GRID": 10}),
        models.ModelSummary(file_id=big.id, state="done", key="k2", counts={"GRID": 900}),
        models.ModelSummary(file_id=inc.id, state="include", key=None, counts=None),
    ])
    db.commit()
    item = _q(db)["items"][0]
    assert item["kind_counts"] == {"model": 3, "report": 1, "drawing": 0, "result": 0, "other": 0}
    assert item["thumb"] == {"file_id": big.id, "model_key": "k2"}
    plain, _ = make_entry_file(title="모델 없음")
    row = next(i for i in _q(db)["items"] if i["entry_id"] == plain.entry_id)
    assert row["thumb"] is None
