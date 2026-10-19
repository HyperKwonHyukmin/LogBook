"""19 — 검색 화면 개선: 한 칸 여러 값(같은 칸 OR·칸끼리 AND), 필터 건수 개수 제한 해제, 호선 앞부분 일치,
호선순·제목순 정렬, 태그별 묶기, 상단 검색창 자동완성(/api/suggest/all). 합성 데이터만(가상 호선 9xxx)."""
from datetime import datetime

import pytest

from app import models
from app.access import SYSTEM
from app.search import SearchQuery, get_search
from app.search import mysql_backend


def _q(db, q="", **kw):
    filters = kw.pop("filters", {})
    return get_search().search(db, SearchQuery(q=q, filters=filters, **({"user": SYSTEM} | kw)))


def _ids(res):
    return [i["entry_id"] for i in res["items"]]


def _tag(db, e, value, kind="free", alias_of=None):
    t = db.query(models.Tag).filter_by(kind=kind, value=value).first()
    if t is None:
        t = models.Tag(kind=kind, value=value, alias_of_id=alias_of.id if alias_of else None)
        db.add(t)
        db.flush()
    db.add(models.EntryTag(entry_id=e.id, tag_id=t.id))
    db.commit()
    return t


@pytest.fixture
def corpus(db, make_entry_file):
    """a: 9496 선수부 Truss · b: 9497 선미부 Truss · c: 9497 선수부 Frame · d: 호선 없음 태그 없음."""
    a, _ = make_entry_file(title="나 선수 구조", hulls=("9496",), name="a.pdf", confirmed_at=datetime(2026, 9, 1))
    b, _ = make_entry_file(title="가 선미 구조", hulls=("9497",), name="b.pdf", confirmed_at=datetime(2026, 9, 2))
    c, _ = make_entry_file(title="다 선수 프레임", hulls=("9497",), name="c.pdf", kind="model",
                           confirmed_at=datetime(2026, 9, 3))
    d, _ = make_entry_file(title="라 기타", hulls=(), name="d.pdf", confirmed_at=datetime(2026, 9, 4))
    _tag(db, a, "선수부", kind="zone")
    _tag(db, b, "선미부", kind="zone")
    _tag(db, c, "선수부", kind="zone")
    _tag(db, a, "Truss")
    _tag(db, b, "Truss")
    _tag(db, c, "Frame")
    return {"a": a, "b": b, "c": c, "d": d}


def test_multi_values_or_within_key_and_across_keys(db, corpus):
    e = {k: v.entry_id for k, v in corpus.items()}
    # 같은 칸 안은 OR
    assert set(_ids(_q(db, filters={"hull": ["9496", "9497"]}))) == {e["a"], e["b"], e["c"]}
    # 칸끼리는 AND — 호선(9496 또는 9497) 이면서 구역 선수부
    assert set(_ids(_q(db, filters={"hull": ["9496", "9497"], "zone": ["선수부"]}))) == {e["a"], e["c"]}
    # 태그 OR + 구역 AND
    assert set(_ids(_q(db, filters={"tag": ["Truss", "Frame"], "zone": "선미부"}))) == {e["b"]}
    # 옛 호출(문자열 하나)도 그대로
    assert set(_ids(_q(db, filters={"tag": "Truss"}))) == {e["a"], e["b"]}
    res = _q(db, filters={"hull": ["9496", "9497", "9496", " "]})
    assert res["applied_filters"] == {"hull": ["9496", "9497"]}   # 빈 값·중복은 뺀다


def test_facet_counts_skip_own_key_with_multi_values(db, corpus):
    res = _q(db, filters={"hull": ["9496"], "tag": ["Truss"]})
    hull = {f["value"]: f["count"] for f in res["facets"]["hull"]}
    # 자기 칸(호선)은 빼고 센다 — 태그 Truss 인 자료의 호선 분포
    assert hull == {"9496": 1, "9497": 1}
    tag = {f["value"]: f["count"] for f in res["facets"]["tag"]}
    assert tag == {"Truss": 1}                    # 호선 9496 인 자료의 태그 분포
    zone = {f["value"]: f["count"] for f in res["facets"]["zone"]}
    assert zone == {"선수부": 1}                   # 두 칸 모두 걸린 결과(a)


def test_synonym_values_canonicalized_each(db, corpus):
    root = db.query(models.Tag).filter_by(kind="free", value="Truss").one()
    db.add(models.Tag(kind="free", value="트러스", alias_of_id=root.id))
    db.commit()
    res = _q(db, filters={"tag": ["트러스", "Truss", "Frame"]})
    assert res["applied_filters"]["tag"] == ["Truss", "Frame"]   # 같은 대표 값은 하나로
    assert res["total"] == 3
    truss = next(f for f in res["facets"]["tag"] if f["value"] == "Truss")
    assert truss["aliases"] == ["트러스"]                          # 칸 안 찾기용 동의어


def test_facet_limit_lifted_and_selected_always_kept(db, make_entry_file, monkeypatch):
    for i in range(40):
        make_entry_file(title=f"t{i}", hulls=(f"{9100 + i}",), name=f"{i}.pdf")
    res = _q(db)
    assert len(res["facets"]["hull"]) == 40      # 예전 30 개 자르기 없음
    # 상한에 걸려도 고른 값은 실린다
    monkeypatch.setattr(mysql_backend, "FACET_LIMIT", 5)
    res = _q(db, filters={"hull": ["9139"]})
    values = [f["value"] for f in res["facets"]["hull"]]
    assert len(values) == 6 and "9139" in values


def test_hull_label_in_facets(db, corpus):
    db.get(models.Hull, "9496").ship_type = "LNGC"   # 호선 행은 make_entry_file 이 만든다
    db.commit()
    hull = {f["value"]: f.get("label") for f in _q(db)["facets"]["hull"]}
    assert hull["9496"] == "LNGC" and hull["9497"] is None


def test_hull_prefix_match_ranks_below_exact(db, corpus, make_entry_file):
    e = {k: v.entry_id for k, v in corpus.items()}
    exact, _ = make_entry_file(title="정확", hulls=("949",), name="x.pdf", confirmed_at=datetime(2026, 8, 1))
    res = _q(db, "949")
    ids = _ids(res)
    assert ids[0] == exact.entry_id                       # 정확 일치가 먼저(점수 100 > 앞부분 60)
    assert set(ids) == {exact.entry_id, e["a"], e["b"], e["c"]}
    assert all("hull" in it["matched"] for it in res["items"])
    assert _ids(_q(db, "9")) == []                         # 한 자리는 앞부분 일치하지 않는다
    assert _ids(_q(db, "94a")) == []                       # 숫자만일 때만
    # 4자리 호선 제안 배너는 그대로
    assert _q(db, "9496")["hull_suggestion"] == {"hull_no": "9496", "known": True}
    assert _q(db, "9496", filters={"hull": ["9497", "9496"]})["hull_suggestion"] is None


def test_sort_by_hull_and_title(db, corpus, make_entry_file):
    e = {k: v.entry_id for k, v in corpus.items()}
    small, _ = make_entry_file(title="Abc", hulls=("950",), name="s.pdf", confirmed_at=datetime(2026, 8, 1))
    res = _q(db, sort="hull")
    assert res["sort"] == "hull"
    # 숫자로 비교(950 < 9496), 같은 호선은 최신순, 호선 없는 자료는 맨 뒤
    assert _ids(res) == [small.entry_id, e["a"], e["c"], e["b"], e["d"]]
    res = _q(db, sort="title")
    assert _ids(res) == [small.entry_id, e["b"], e["a"], e["c"], e["d"]]   # Abc · 가 · 나 · 다 · 라


def test_sort_applies_to_file_unit(db, corpus):
    names = [i["name"] for i in _q(db, unit="file", sort="title")["items"]]
    assert names == ["a.pdf", "b.pdf", "c.pdf", "d.pdf"]
    names = [i["name"] for i in _q(db, unit="file", sort="hull")["items"]]
    assert names == ["a.pdf", "c.pdf", "b.pdf", "d.pdf"]   # 9496 · 9497(최신 c 먼저) · 호선 없음
    # 파일 보기 종류 필터도 여러 값
    names = {i["name"] for i in _q(db, unit="file", filters={"kind": ["model", "report"]})["items"]}
    assert names == {"a.pdf", "b.pdf", "c.pdf", "d.pdf"}


def test_group_by_tag_multi_valued(db, corpus):
    _tag(db, corpus["a"], "Frame")                         # a 는 태그 2개 → 두 묶음에 나온다
    res = _q(db, group="tag")
    groups = {g["value"]: g["count"] for g in res["groups"]}
    assert groups == {"Truss": 2, "Frame": 2, None: 1}     # None = 태그 없음(d)
    assert res["multi_valued"] == 1
    # 묶음 하나 더 보기
    more = _q(db, group="tag", group_value="Frame")
    assert set(_ids(more)) == {corpus["a"].entry_id, corpus["c"].entry_id}
    none = _q(db, group="tag", group_value="__none__")
    assert _ids(none) == [corpus["d"].entry_id]


def test_search_api_repeated_params(client, db, corpus, make_user, auth_headers):
    make_user("A100001")
    h = auth_headers("A100001")
    e = {k: v.entry_id for k, v in corpus.items()}
    res = client.get("/api/search?hull=9496&hull=9497&zone=%EC%84%A0%EC%88%98%EB%B6%80", headers=h).json()
    assert {i["entry_id"] for i in res["items"]} == {e["a"], e["c"]}
    assert res["applied_filters"] == {"hull": ["9496", "9497"], "zone": ["선수부"]}
    # 옛 단일값 주소
    res = client.get("/api/search?zone=%EC%84%A0%EB%AF%B8%EB%B6%80", headers=h).json()
    assert [i["entry_id"] for i in res["items"]] == [e["b"]]
    # 쉼표가 든 값은 나누지 않는다
    res = client.get("/api/search", params={"tag": "a,b"}, headers=h).json()
    assert res["applied_filters"] == {"tag": ["a,b"]} and res["total"] == 0
    assert client.get("/api/search?sort=title&group=tag", headers=h).status_code == 200
    assert client.get("/api/search?sort=bad", headers=h).status_code == 422


def test_suggest_all(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    e, _ = make_entry_file(title="t", hulls=("9496",), name="a.pdf")
    _tag(db, e, "선수부", kind="zone")
    _tag(db, e, "Truss")
    _tag(db, e, "50%_tag")
    res = client.get("/api/suggest/all", params={"q": "94"}, headers=h).json()
    assert res == {"hull": ["9496"], "zone": [], "tag": []}   # 29 — 프로젝트는 없앴다
    assert client.get("/api/suggest/all", params={"q": "truss"}, headers=h).json()["tag"] == ["Truss"]
    assert client.get("/api/suggest/all", params={"q": "선수"}, headers=h).json()["zone"] == ["선수부"]
    assert client.get("/api/suggest/all", params={"q": "  "}, headers=h).json() == {"hull": [], "zone": [], "tag": []}
    # % · _ 는 글자 그대로
    assert client.get("/api/suggest/all", params={"q": "%"}, headers=h).json()["tag"] == ["50%_tag"]
    assert client.get("/api/suggest/all", params={"q": "x"}).status_code == 401


def test_group_pref_accepts_tag(client, make_user, auth_headers):
    make_user("A100001")
    h = auth_headers("A100001")
    assert client.put("/api/me/prefs", json={"search.group": "tag"}, headers=h).json()["search.group"] == "tag"
