from datetime import datetime

import pytest

from app import models
from app.search import SearchQuery, get_search


def _q(db, q="", **kw):
    filters = kw.pop("filters", {})
    return get_search().search(db, SearchQuery(q=q, filters=filters, **kw))


def _ids(res):
    return [i["entry_id"] for i in res["items"]]


def _text(db, f, text, locator="page:1"):
    db.add(models.FileText(file_id=f.id, seq=0, locator=locator, text=text))
    db.commit()


@pytest.fixture
def corpus(db, make_entry_file):
    """E1: 9999 계류 검토(보고서 본문 '선체 구조 강도'), E2: 9998 갑판 강도, E3: 초안, E4: 휴지통."""
    e1, f1 = make_entry_file(title="계류 구조 검토", hulls=("9999",), name="9999_mooring.pptx",
                             analysis_type="Mooring", period="2026-08", confirmed_at=datetime(2026, 9, 2))
    make_entry_file(entry=e1, name="model.bdf", kind="model")
    _text(db, f1, "보고서 표지\n선체 구조 강도 평가 결과 허용응력 이내", locator="slide:3")
    e2, f2 = make_entry_file(title="갑판 강도", hulls=("9998",), name="deck.xlsx", uploaded_by="A100002",
                             analysis_type="Strength", confirmed_at=datetime(2026, 9, 5))
    e3, _ = make_entry_file(status="draft", title="계류 초안", hulls=("9999",), name="draft.pdf")
    e4, _ = make_entry_file(status="trashed", title="계류 버림", hulls=("9999",), name="trash.pdf")
    if db.get(models.Hull, "9998") is None:
        db.add(models.Hull(hull_no="9998"))
    db.get(models.Hull, "9998").ship_type = "LNGC"
    db.commit()
    return {"e1": e1, "e2": e2, "e3": e3, "e4": e4, "f1": f1, "f2": f2}


def test_empty_query_lists_confirmed_by_analysis_period(db, corpus):
    # 08 — 검색어가 없으면 해석 시기 순(시기 없는 E2 는 뒤로). 최근 등록 순은 sort=recent
    res = _q(db)
    assert _ids(res) == [corpus["e1"].entry_id, corpus["e2"].entry_id]
    assert res["total"] == 2 and res["sort"] == "period"
    assert _ids(_q(db, sort="recent")) == [corpus["e2"].entry_id, corpus["e1"].entry_id]


def test_drafts_included_on_request_never_trash(db, corpus):
    ids = _ids(_q(db, include_drafts=True))
    assert corpus["e3"].entry_id in ids and corpus["e4"].entry_id not in ids


def test_hull_exact_ranks_first(db, corpus):
    res = _q(db, "9999")
    assert _ids(res) == [corpus["e1"].entry_id]
    assert "hull" in res["items"][0]["matched"]


def test_body_match_with_snippet(db, corpus):
    res = _q(db, "강도")
    assert _ids(res) == [corpus["e2"].entry_id, corpus["e1"].entry_id]  # 제목 70 > 본문 10
    item = next(i for i in res["items"] if i["entry_id"] == corpus["e1"].entry_id)
    snip = item["snippets"][0]
    assert snip["file_id"] == corpus["f1"].id and snip["locator"] == "slide:3"
    a, b = snip["highlights"][0]
    assert snip["text"][a:b] == "강도"


def test_all_terms_must_match(db, corpus):
    assert _ids(_q(db, "9999 강도")) == [corpus["e1"].entry_id]
    assert _ids(_q(db, "9998 계류")) == []


def test_filename_match(db, corpus):
    # "mooring" 만 찾으면 해석 종류 Mooring(50)이 파일명(30)보다 높아 matched 가 analysis_type 이 된다
    res = _q(db, "mooring.pptx")
    assert _ids(res) == [corpus["e1"].entry_id] and res["items"][0]["matched"] == ["file"]


def test_like_wildcards_are_literal(db, corpus):
    assert _q(db, "%")["total"] == 0
    # "_" 가 와일드카드면 모든 Entry 가 맞는다. 글자 그대로면 파일명 9999_mooring.pptx 인 E1 만 맞는다.
    assert _ids(_q(db, "_")) == [corpus["e1"].entry_id]


def test_tag_alias_expansion(db, corpus):
    bow = models.Tag(kind="zone", value="선수부")
    db.add(bow)
    db.flush()
    fwd = models.Tag(kind="zone", value="FWD", alias_of_id=bow.id)
    db.add(fwd)
    db.flush()
    db.add(models.EntryTag(entry_id=corpus["e2"].id, tag_id=fwd.id))
    db.commit()
    assert _ids(_q(db, "선수부")) == [corpus["e2"].entry_id]
    assert _ids(_q(db, filters={"zone": "선수부"})) == [corpus["e2"].entry_id]
    zone_facet = _q(db)["facets"]["zone"]
    assert zone_facet == [{"value": "선수부", "count": 1}]


def test_filters_and_disjunctive_facets(db, corpus):
    res = _q(db, filters={"hull": "9999"})
    assert _ids(res) == [corpus["e1"].entry_id]
    hull_counts = {f["value"]: f["count"] for f in res["facets"]["hull"]}
    assert hull_counts == {"9999": 1, "9998": 1}  # 자기 필터는 빼고 센다
    assert res["facets"]["analysis_type"] == [{"value": "Mooring", "count": 1}]
    kinds = {f["value"]: f["count"] for f in res["facets"]["kind"]}
    assert kinds == {"report": 1, "model": 1}


def test_other_filters(db, corpus):
    assert _ids(_q(db, filters={"ship_type": "LNGC"})) == [corpus["e2"].entry_id]
    # 08 — 해석 연도는 해석 시기만 본다(E2 는 시기가 없어 확정일 2026 이어도 걸리지 않는다)
    assert _ids(_q(db, filters={"year": "2026"})) == [corpus["e1"].entry_id]
    assert _ids(_q(db, filters={"uploaded_by": "A100002"})) == [corpus["e2"].entry_id]
    assert _ids(_q(db, filters={"kind": "model"})) == [corpus["e1"].entry_id]
    assert _ids(_q(db, filters={"analysis_type": "Strength"})) == [corpus["e2"].entry_id]


def test_year_prefers_analysis_period(db, corpus, make_entry_file):
    e, _ = make_entry_file(title="옛 해석", period="2019-03", confirmed_at=datetime(2026, 9, 9))
    assert _ids(_q(db, filters={"year": "2019"})) == [e.entry_id]


def test_uploaded_by_facet_has_name(db, corpus, make_user):
    make_user("A100002", name="김해석")
    labels = {f["value"]: f.get("label") for f in _q(db)["facets"]["uploaded_by"]}
    assert labels["A100002"] == "김해석"


def test_hull_suggestion(db, corpus):
    assert _q(db, "9999 강도")["hull_suggestion"] == {"hull_no": "9999", "known": True}
    assert _q(db, "1234")["hull_suggestion"] == {"hull_no": "1234", "known": False}
    assert _q(db, "9999", filters={"hull": "9999"})["hull_suggestion"] is None
    assert _q(db, "강도")["hull_suggestion"] is None


def test_paging(db, corpus):
    res = _q(db, limit=1, offset=1)
    assert res["total"] == 2 and _ids(res) == [corpus["e2"].entry_id]  # 해석 시기 순의 두 번째


def test_file_unit(db, corpus):
    res = _q(db, "강도", unit="file")
    # deck.xlsx 는 Entry 제목만 맞고 파일 자체(이름·본문)는 안 맞아서 빠진다(규칙 9).
    assert [i["name"] for i in res["items"]] == ["9999_mooring.pptx"]
    item = res["items"][0]
    assert item["entry_id"] == corpus["e1"].entry_id and item["snippets"]
    assert [i["name"] for i in _q(db, "", unit="file", filters={"kind": "model"})["items"]] == ["model.bdf"]


def test_item_shape(db, corpus):
    item = _q(db, "9999")["items"][0]
    for key in ("entry_id", "title", "status", "analysis_type", "analysis_period", "hulls", "zones", "tags",
                "uploaded_by", "confirmed_at", "file_count", "kinds", "score", "matched", "snippets"):
        assert key in item
    assert item["file_count"] == 2 and sorted(item["kinds"]) == ["model", "report"]


def test_search_api(client, db, corpus, make_user, auth_headers):
    make_user("A100001")
    assert client.get("/api/search?q=9999").status_code == 401
    res = client.get("/api/search?q=9999&drafts=true", headers=auth_headers("A100001"))
    assert res.status_code == 200
    assert {i["entry_id"] for i in res.json()["items"]} == {corpus["e1"].entry_id, corpus["e3"].entry_id}
    res = client.get("/api/search?hull=9998&unit=file", headers=auth_headers("A100001"))
    assert [i["name"] for i in res.json()["items"]] == ["deck.xlsx"]
    assert client.get("/api/search?unit=bad", headers=auth_headers("A100001")).status_code == 422


def test_english_body_with_stopword_ngrams(db, make_entry_file):
    """ngram 파서는 불용어(a·at·is…)를 품은 토큰을 버린다 — 불용어 목록을 끄지 않으면
    'data'(da·at·ta 모두 불용어 포함)가 본문에서 한 건도 안 잡힌다."""
    e, f = make_entry_file(title="보고서", name="r.pdf")
    _text(db, f, "structural data analysis")
    assert _ids(_q(db, "data")) == [e.entry_id]
    assert _ids(_q(db, "at")) == [e.entry_id]


def test_file_unit_does_not_inherit_sibling_file_hits(db, make_entry_file):
    """파일 보기에서 파일이 물려받는 'Entry 적중' 은 Entry 메타데이터(번호·호선·제목·태그·해석 종류·
    설명)에서만 온다. 같은 Entry 의 다른 파일 이름·본문 적중을 물려받으면 안 된다."""
    a, _ = make_entry_file(title="검토", name="a_mooring.pptx")
    make_entry_file(entry=a, name="model.bdf", kind="model")
    b, _ = make_entry_file(title="mooring 검토", name="m.bdf", kind="model")
    names = [i["name"] for i in _q(db, "mooring bdf", unit="file")["items"]]
    assert names == ["m.bdf"]


def _count_queries(fn):
    from sqlalchemy import event

    from app.database import engine

    n = {"q": 0}

    def before(*_a, **_k):
        n["q"] += 1

    event.listen(engine, "before_cursor_execute", before)
    try:
        fn()
    finally:
        event.remove(engine, "before_cursor_execute", before)
    return n["q"]


def _body_entries(db, make_entry_file, n):
    for i in range(n):
        e, f = make_entry_file(title=f"검토 {i}", name=f"r{i}.pdf")
        make_entry_file(entry=e, name=f"m{i}.bdf", kind="model")
        _text(db, f, "선체 구조 강도 평가")
        tag = models.Tag(kind="free", value=f"태그{e.id}")
        db.add(tag)
        db.flush()
        db.add(models.EntryTag(entry_id=e.id, tag_id=tag.id))
    db.commit()


@pytest.mark.parametrize("unit", ["entry", "file"])
@pytest.mark.parametrize("q", ["", "강도"])
def test_search_query_count_does_not_grow_with_page(db, make_entry_file, unit, q):
    """페이지 항목마다 태그·발췌문을 따로 묻지 않는다 — 결과가 늘어도 쿼리 수가 같다."""
    _body_entries(db, make_entry_file, 2)
    few = _count_queries(lambda: _q(db, q, unit=unit))
    _body_entries(db, make_entry_file, 5)
    many = _count_queries(lambda: _q(db, q, unit=unit))
    assert many == few


def test_applied_filters_normalizes_zone_alias(db, corpus):
    """공유 URL 에 동의어(zone=ER)가 실려 와도 서버가 실제 적용한 대표값을 돌려준다(화면이 필터 항목을 칠할 수 있게)."""
    root = models.Tag(kind="zone", value="Engine Room")
    db.add(root)
    db.flush()
    er = models.Tag(kind="zone", value="ER", alias_of_id=root.id)
    db.add(er)
    db.flush()
    db.add(models.EntryTag(entry_id=corpus["e1"].id, tag_id=er.id))
    db.commit()
    res = _q(db, filters={"zone": "ER", "hull": "9999", "bogus": "x"})
    assert res["applied_filters"] == {"zone": "Engine Room", "hull": "9999"}
    assert _ids(res) == [corpus["e1"].entry_id]
    assert _q(db)["applied_filters"] == {}
