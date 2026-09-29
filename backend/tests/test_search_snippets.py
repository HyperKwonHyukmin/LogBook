from app.search.snippets import make_snippet


def test_snippet_centers_on_first_hit_with_highlights():
    text = "가" * 200 + "구조 강도 평가" + "나" * 200
    s = make_snippet(text, ["강도"], width=10)
    assert s["text"].startswith("…") and s["text"].endswith("…")
    start, end = s["highlights"][0]
    assert s["text"][start:end] == "강도"


def test_snippet_multiple_terms_and_case_insensitive():
    s = make_snippet("HULL No 9999 strength\nreview", ["hull", "REVIEW"], width=80)
    assert s["text"] == "HULL No 9999 strength review"
    assert [s["text"][a:b] for a, b in s["highlights"]] == ["HULL", "review"]


def test_snippet_merges_overlaps():
    s = make_snippet("aaaa", ["aa", "aaa"], width=10)
    assert s["highlights"] == [[0, 4]]


def test_snippet_without_hit_uses_head():
    s = make_snippet("x" * 500, ["없음"], width=80)
    assert s["text"] == "x" * 160 + "…" and s["highlights"] == []
