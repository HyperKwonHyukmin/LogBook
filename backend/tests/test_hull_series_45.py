"""45 — 시리즈 호선: PLM SHIP_PRE·SHIP_SEQ 를 호선에 저장(사람이 고친 값 유지), 묶음 키(series_keys)·같은 시리즈(series_members),
호선 화면 API 의 series, 수정 API 의 시리즈 대표, plm-fill --series, registry·재구축."""
import io
from datetime import datetime

import pytest

from app import cli, models, plm_ship
from app.ops import registry
from app.ops.rebuild import _restore_hulls

ROW = {"SHIP_TYPE_NAME": "174K-LNG", "MAIN_ENGINE": "G70ME", "SHIP_CLASS1": "BV",
       "RESULT_DELIVERY_DATE": datetime(2025, 2, 28), "RESULT_DELIVERY_YN": "Y"}


def _row(no, pre, seq):
    return {**ROW, "SHIP_NO": no, "SHIP_PRE": pre, "SHIP_SEQ": seq}


@pytest.fixture
def plm():
    # 145 실측(2026-10-21): 3370 · 3371 은 SHIP_PRE='3370', 순번 1 · 2. 3500 은 시리즈 정보 없음
    state = {"rows": {"3370": _row("3370", "3370", "1"), "3371": _row("3371", "3370", "2"),
                      "3500": _row("3500", None, None)}, "calls": []}

    def fetch(ship_nos):
        state["calls"].append(list(ship_nos))
        return {n: state["rows"][n] for n in ship_nos if n in state["rows"]}

    def fetch_series(leads):   # 45 6단계 — WHERE SHIP_PRE IN (…)
        state["series_calls"].append(list(leads))
        return {n: r for n, r in state["rows"].items() if r.get("SHIP_PRE") in leads}

    state["series_calls"] = []
    plm_ship.set_fetcher(fetch, fetch_series)
    try:
        yield state
    finally:
        plm_ship.set_fetcher(None)


def test_lookup_reads_series(plm):
    s = plm_ship.lookup("3371").ship
    assert (s["seriesLead"], s["seriesSeq"]) == ("3370", "2")
    assert plm_ship.lookup("3500").ship["seriesLead"] is None


def test_fill_saves_series_and_keys(client, db, make_user, make_entry_file, auth_headers, plm):
    make_user("A100001")
    for no in ("3370", "3371", "3500"):
        make_entry_file(title=no, hulls=(no,), name=f"{no}.pdf")
    r = client.post("/api/hulls/plm-fill", headers=auth_headers("A100001")).json()
    assert r["found"] == 3
    db.expire_all()
    assert (db.get(models.Hull, "3371").series_lead, db.get(models.Hull, "3371").series_seq) == ("3370", "2")
    assert plm_ship.series_keys(db, ["3370", "3371", "3500", "9999"]) == {
        "3370": "3370", "3371": "3370", "3500": "3500", "9999": "9999"}
    assert plm_ship.series_members(db, ["3370", "3500"]) == {"3370": ["3370", "3371"], "3500": ["3500"]}


def test_hull_detail_shows_series(client, db, make_user, make_entry_file, auth_headers, plm):
    make_user("A100001")
    make_entry_file(title="a", hulls=("3370",), name="a.pdf")
    make_entry_file(title="b", hulls=("3371",), name="b.pdf")
    make_entry_file(title="c", hulls=("3371",), name="c.pdf")
    h = auth_headers("A100001")
    client.post("/api/hulls/plm-fill", headers=h)
    d = client.get("/api/hulls/3371", headers=h).json()
    assert d["series"] == {"lead": "3370", "seq": "2", "manual": False,
                           "members": [{"hull_no": "3370", "seq": "1", "entries": 1},
                                       {"hull_no": "3371", "seq": "2", "entries": 2}]}
    make_entry_file(title="d", hulls=("3500",), name="d.pdf")
    client.post("/api/hulls/plm-fill", headers=h)
    # PLM 에 선행호선이 없는 호선 = 자기 번호(시리즈를 봤고 혼자) — 화면은 '한 척'
    assert client.get("/api/hulls/3500", headers=h).json()["series"] == {
        "lead": "3500", "seq": None, "manual": False, "members": [{"hull_no": "3500", "seq": None, "entries": 1}]}


def test_manual_series_kept_by_fill_and_reset_by_button(client, db, storage, make_user, make_entry_file,
                                                        auth_headers, plm):
    make_user("A100001")
    make_user("C300003", level=1)
    for no in ("3370", "3371", "3500"):
        make_entry_file(title=no, hulls=(no,), name=f"{no}.pdf")
    h = auth_headers("A100001")
    # PLM 에 시리즈가 없는 3500 을 사람이 3370 시리즈로
    assert client.patch("/api/hulls/3500", json={"series_lead": "3370"},
                        headers=auth_headers("C300003")).status_code == 403
    assert client.patch("/api/hulls/3500", json={"series_lead": "33-7"}, headers=h).status_code == 422
    r = client.patch("/api/hulls/3500", json={"series_lead": "3370"}, headers=h).json()
    assert r["series"]["lead"] == "3370" and r["series"]["manual"] is True
    log = db.query(models.AuditLog).filter_by(action="HULL_UPDATE", target_id="3500").one()
    assert (log.before["series_lead"], log.after["series_lead"]) == (None, "3370")
    # 일괄 채우기는 사람이 고친 값을 덮지 않는다
    client.post("/api/hulls/plm-fill", headers=h)
    db.expire_all()
    assert db.get(models.Hull, "3500").series_lead == "3370"
    assert plm_ship.series_members(db, ["3370"])["3370"] == ["3370", "3371", "3500"]
    # 빈 값 = 시리즈 아님(사람이 정함)
    client.patch("/api/hulls/3371", json={"series_lead": ""}, headers=h)
    db.expire_all()
    assert db.get(models.Hull, "3371").series_lead is None and db.get(models.Hull, "3371").series_manual
    # 호선 화면 [선박 정보 검색] 은 PLM 값으로 되돌린다
    plm_ship.clear_cache()
    assert client.post("/api/hulls/3371/plm", headers=h).status_code == 200
    db.expire_all()
    hull = db.get(models.Hull, "3371")
    assert (hull.series_lead, hull.series_seq, hull.series_manual) == ("3370", "2", None)


def test_cli_plm_fill_series_refills_found_hulls(db, storage, make_entry_file, plm):
    make_entry_file(title="x", hulls=("3371",), name="a.pdf")
    hull = db.get(models.Hull, "3371")
    hull.plm_status, hull.ship_type = "found", "174K LNG"   # 시리즈를 읽기 전에 찾은 호선
    db.commit()
    out = io.StringIO()
    assert cli.plm_fill(db, storage, out=out) == 0 and "조회 0건" in out.getvalue()
    out = io.StringIO()
    assert cli.plm_fill(db, storage, series=True, out=out) == 0 and "찾음 1" in out.getvalue()
    db.expire_all()
    assert db.get(models.Hull, "3371").series_lead == "3370"


def test_registry_round_trip(db, make_entry_file, plm):
    make_entry_file(title="x", hulls=("3371",), name="a.pdf")
    hull = db.get(models.Hull, "3371")
    hull.series_lead, hull.series_seq, hull.series_manual = "3370", "2", True
    db.commit()
    reg = registry.build_registry(db)
    item = [x for x in reg["hulls"] if x["hull_no"] == "3371"][0]
    assert item["series"] == {"lead": "3370", "seq": "2", "manual": True}
    hull.series_lead = hull.series_seq = hull.series_manual = None
    db.commit()
    _restore_hulls(db, reg)
    hull = db.get(models.Hull, "3371")
    assert (hull.series_lead, hull.series_seq, hull.series_manual) == ("3370", "2", True)


def test_coverage_and_graph_carry_series(db, make_user, make_entry_file, plm):
    """2단계 — 갖춤 현황 · 관계 지도 응답에 hull_series(다른 것만) · series_members(둘 이상만)."""
    from app.coverage import build_coverage
    from app.graph import build_graph

    user = make_user("A100001")
    for no in ("3370", "3371", "3500"):
        make_entry_file(title=no, hulls=(no,), name=f"{no}.pdf")
    db.get(models.Hull, "3370").series_lead = "3370"
    db.get(models.Hull, "3371").series_lead = "3370"
    db.commit()
    for body in (build_coverage(db, user), build_graph(db, user)):
        assert body["hull_series"] == {"3371": "3370"}
        assert body["series_members"] == {"3370": ["3370", "3371"]}


# ---- 3단계 — 검색 ----

def _search(db, q="", **kw):
    from app.access import SYSTEM
    from app.search import SearchQuery, get_search

    filters = kw.pop("filters", {})
    return get_search().search(db, SearchQuery(q=q, filters=filters, **({"user": SYSTEM} | kw)))


@pytest.fixture
def series_corpus(db, make_entry_file):
    out = {}
    for no, title in (("3370", "a"), ("3371", "b"), ("3500", "c")):
        out[no], _ = make_entry_file(title=title, hulls=(no,), name=f"{no}.pdf")
    for no, lead, seq in (("3370", "3370", "1"), ("3371", "3370", "2")):
        h = db.get(models.Hull, no)
        h.series_lead, h.series_seq, h.ship_type = lead, seq, "174K LNG"
    db.commit()
    return {k: v.entry_id for k, v in out.items()}


def test_search_term_finds_series_siblings(db, series_corpus):
    e = series_corpus
    res = _search(db, "3371")
    assert [i["entry_id"] for i in res["items"]] == [e["3371"], e["3370"]]   # 정확 일치가 먼저
    assert res["items"][1]["matched"] == ["hull_series"] and res["items"][1]["hulls"] == ["3370"]   # 실제 호선 그대로
    assert [i["entry_id"] for i in _search(db, "3500")["items"]] == [e["3500"]]


def test_search_filter_and_facets_by_series(db, series_corpus):
    e = series_corpus
    res = _search(db, filters={"hull": ["3371"]})
    assert {i["entry_id"] for i in res["items"]} == {e["3370"], e["3371"]}
    assert res["applied_filters"]["hull"] == ["3370"]
    facets = {f["value"]: f for f in res["facets"]["hull"]}
    assert facets["3370"] == {"value": "3370", "count": 2, "label": "3370·3371 시리즈 · 174K LNG"}
    assert "3371" not in facets and facets["3500"]["count"] == 1
    assert _search(db, "3371", filters={"hull": ["3370"]})["hull_suggestion"] is None


def test_search_group_by_series(db, series_corpus):
    e = series_corpus
    res = _search(db, group="hull")
    groups = {g["value"]: g for g in res["groups"]}
    assert groups["3370"]["count"] == 2 and groups["3370"]["label"] == "3370·3371 시리즈 · 174K LNG"
    assert res["multi_valued"] == 0
    more = _search(db, group="hull", group_value="3371")   # '더 보기'도 시리즈 단위
    assert {i["entry_id"] for i in more["items"]} == {e["3370"], e["3371"]}


def test_browse_keeps_real_hulls(db, series_corpus):
    from app.access import SYSTEM
    from app.search import get_search

    hulls = {f["value"]: f["count"] for f in get_search().browse(db, user=SYSTEM)["facets"]["hull"]}
    assert hulls == {"3370": 1, "3371": 1, "3500": 1}



# ---- 6단계 — PLM 의 같은 시리즈 호선 전체 ----

def test_fill_adds_series_siblings_without_entries(client, db, make_user, make_entry_file, auth_headers, plm):
    """3370 자료만 있어도 PLM 의 같은 시리즈 3371 · 3372 를 호선 행으로 — 호선 화면 시리즈 줄 · 검색(3372 → 3370 자료)."""
    make_user("A100001")
    plm["rows"]["3372"] = _row("3372", "3370", "3")
    e, _ = make_entry_file(title="a", hulls=("3370",), name="a.pdf")
    h = auth_headers("A100001")
    r = client.post("/api/hulls/plm-fill", headers=h).json()
    assert r["series_added"] == 2 and plm["series_calls"] == [["3370"]]
    sib = db.get(models.Hull, "3372")
    assert (sib.series_lead, sib.series_seq, sib.plm_status, sib.ship_type) == ("3370", "3", "found", "174K LNG")
    assert db.query(models.AuditLog).filter_by(action="HULL_PLM", target_id="3372").count() == 1
    d = client.get("/api/hulls/3370", headers=h).json()
    assert [(m["hull_no"], m["entries"]) for m in d["series"]["members"]] == [("3370", 1), ("3371", 0), ("3372", 0)]
    assert [x["hull_no"] for x in client.get("/api/hulls", headers=h).json()] == ["3370"]   # 목록은 자료 있는 호선만
    assert [i["entry_id"] for i in _search(db, "3372")["items"]] == [e.entry_id]
    # 다시 채워도 늘지 않는다
    assert client.post("/api/hulls/plm-fill", headers=h).json()["series_added"] == 0


def test_series_flag_adds_siblings_for_known_leads(db, storage, make_entry_file, plm):
    """이미 시리즈를 채운 145 — plm-fill --series 가 조회할 호선이 없어도 같은 시리즈 호선을 더한다."""
    make_entry_file(title="x", hulls=("3371",), name="a.pdf")
    hull = db.get(models.Hull, "3371")
    hull.plm_status, hull.ship_type, hull.series_lead = "found", "174K LNG", "3370"
    db.commit()
    out = io.StringIO()
    assert cli.plm_fill(db, storage, series=True, out=out) == 0
    assert "같은 시리즈 호선 더함 1" in out.getvalue()
    assert db.get(models.Hull, "3370").series_seq == "1"


def test_sibling_lookup_failure_does_not_block_fill(client, db, make_user, make_entry_file, auth_headers, plm):
    make_user("A100001")
    make_entry_file(title="a", hulls=("3370",), name="a.pdf")

    def broken(leads):
        raise RuntimeError("x")

    plm_ship.set_fetcher(lambda nos: {n: plm["rows"][n] for n in nos if n in plm["rows"]}, broken)
    r = client.post("/api/hulls/plm-fill", headers=auth_headers("A100001")).json()
    assert r["found"] == 1 and r["series_added"] == 0
    assert db.get(models.Hull, "3371") is None



# ---- 자동 — 단추 · CLI 없이 ----

def test_auto_job_fills_series_of_already_found_hulls(db, storage, make_entry_file, monkeypatch, plm):
    """시리즈 기능 전에 찾은 호선(found · 시리즈 없음)도 자동 작업(only_unchecked)과 작업 넣기가 다룬다."""
    from app import hull_info

    monkeypatch.setattr(plm_ship, "is_configured", lambda: True)
    make_entry_file(title="x", hulls=("3371",), name="a.pdf")
    hull = db.get(models.Hull, "3371")
    hull.plm_status, hull.ship_type = "found", "174K LNG"
    db.query(models.Job).delete()
    db.commit()
    assert plm_ship.enqueue_fill(db) is not None          # 워커 시작 · 확정 때 넣는 작업
    r = hull_info.fill_from_plm(db, storage, "system", only_unchecked=True)
    assert r["checked"] == 1 and r["series_added"] == 1   # 3371 시리즈 + 같은 시리즈 3370
    db.expire_all()
    assert db.get(models.Hull, "3371").series_lead == "3370" and db.get(models.Hull, "3370").series_seq == "1"
    db.query(models.Job).delete()
    db.commit()
    assert plm_ship.enqueue_fill(db) is None              # 더 할 일이 없다(되풀이하지 않는다)


def test_auto_job_skips_manual_and_marks_alone(db, storage, make_entry_file, monkeypatch, plm):
    from app import hull_info

    monkeypatch.setattr(plm_ship, "is_configured", lambda: True)
    make_entry_file(title="x", hulls=("3500",), name="a.pdf")
    make_entry_file(title="y", hulls=("3371",), name="b.pdf")
    h3500, h3371 = db.get(models.Hull, "3500"), db.get(models.Hull, "3371")
    h3500.plm_status = h3371.plm_status = "found"
    h3371.series_manual = True                             # 사람이 '시리즈 아님'으로 정함
    db.query(models.Job).delete()
    db.commit()
    r = hull_info.fill_from_plm(db, storage, "system", only_unchecked=True)
    assert r["checked"] == 1
    db.expire_all()
    assert db.get(models.Hull, "3500").series_lead == "3500"   # PLM 에 시리즈 없음 → 자기 번호
    assert db.get(models.Hull, "3371").series_lead is None
    assert plm_ship.enqueue_fill(db) is None
