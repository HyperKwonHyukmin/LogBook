"""09 — 결과 행의 대표 모델·보고서 한 줄, 결과 전체 요약 띠."""
from app.access import SYSTEM
from datetime import datetime

from app import models
from app.search import SearchQuery, get_search
from app.search.insight import family_counts, solve_status


def _q(db, q="", **kw):
    return get_search().search(db, SearchQuery(q=q, filters=kw.pop("filters", {}), **({"user": SYSTEM} | kw)))


def _model(db, f, *, grid, counts=None, key="k", bbox=None, sol="101", state="done"):
    db.add(models.ModelSummary(file_id=f.id, state=state, key=key, sol=sol,
                               counts={"GRID": grid, **(counts or {})},
                               bbox=bbox or {"min": [0, 0, 0], "max": [24000, 18200.4, 9600]}))
    db.commit()


def _solve(db, f, state, model_key="k", **kw):
    db.add(models.SolveCheck(file_id=f.id, state=state, model_key=model_key, **kw))
    db.commit()


def test_family_counts_and_status():
    assert family_counts({"GRID": 9, "CBAR": 3, "CBEAM": 1, "CQUAD4": 5, "CTRIA3": 1, "RBE2": 2, "RBE3": 1,
                          "CONM2": 4, "CELAS1": 2}) == {"beam": 4, "shell": 6, "rigid": 3, "mass": 4, "other": 2}
    assert family_counts(None) == {"beam": 0, "shell": 0, "rigid": 0, "mass": 0, "other": 0}
    assert solve_status("pass", False) == "pass"
    assert solve_status("pass", True) == "stale"
    assert solve_status("running", True) == "pending"
    assert solve_status(None, False) == "none"


def test_row_model_and_report_line(db, make_entry_file):
    e, small = make_entry_file(title="선미", name="small.bdf", kind="model")
    _e, big = make_entry_file(entry=e, name="main.bdf", kind="model")
    _e, pptx = make_entry_file(entry=e, name="b.pptx", kind="report")
    _e, pdf = make_entry_file(entry=e, name="a.pdf", kind="report")
    _model(db, small, grid=10, counts={"CBAR": 5}, key="k1")
    _model(db, big, grid=900, counts={"CBAR": 700, "CQUAD4": 300, "RBE2": 20}, key="k2")
    _solve(db, big, "pass", model_key="k2", groups=1)
    db.add_all([models.FileExtract(file_id=pdf.id, state="done", summary={"unit": "page", "count": 24, "title": "선미부 국부 강도 검토", "author": "홍"}),
                models.FileExtract(file_id=pptx.id, state="done", summary={"unit": "slide", "count": 12, "title": "발표"})])
    db.commit()
    item = _q(db)["items"][0]
    assert item["thumb"] == {"file_id": big.id, "model_key": "k2"}
    m = item["model"]
    assert m["file_id"] == big.id and m["elements"] == 1020 and m["nodes"] == 900
    assert m["families"] == {"beam": 700, "shell": 300, "rigid": 20, "mass": 0, "other": 0}
    assert m["size"] == [24000.0, 18200.4, 9600.0] and m["sol"] == "101" and m["groups"] == 1
    assert m["solve"]["status"] == "pass" and m["solve"]["stale"] is False
    assert item["report"] == {"file_id": pdf.id, "name": "a.pdf", "title": "선미부 국부 강도 검토", "unit": "page",
                              "count": 24, "author": "홍"}
    plain, _ = make_entry_file(title="모델 없음", name="x.dwg", kind="drawing")
    row = next(i for i in _q(db)["items"] if i["entry_id"] == plain.entry_id)
    assert row["model"] is None and row["report"] is None and row["thumb"] is None


def test_report_without_summary_still_named(db, make_entry_file):
    e, f = make_entry_file(title="가", name="only.docx", kind="report")
    assert _q(db)["items"][0]["report"] == {"file_id": f.id, "name": "only.docx", "title": None, "unit": None,
                                            "count": None, "author": None}


def test_summary_covers_whole_result_set(db, make_entry_file):
    ents = []
    for i, (atype, hull, period) in enumerate([("FE 해석", "9002", "2025-03"), ("FE 해석", "9002", "2026-01"),
                                               ("강도 평가", "9001", "2026-05"), ("강도 평가", "9002", None)]):
        e, f = make_entry_file(title=f"자료{i}", analysis_type=atype, hulls=(hull,), period=period,
                               name=f"m{i}.bdf", kind="model")
        ents.append((e, f))
    _model(db, ents[0][1], grid=10, counts={"CBAR": 500}, key="a")
    _model(db, ents[1][1], grid=10, counts={"CQUAD4": 20000}, key="b")
    _model(db, ents[2][1], grid=10, counts={"CBAR": 60000}, key="c")
    _solve(db, ents[0][1], "pass", model_key="a")
    _solve(db, ents[1][1], "fail", model_key="b", error_types=["mechanism"])
    _solve(db, ents[2][1], "pass", model_key="old")   # 모델이 바뀌어 다시 검증 필요
    res = _q(db, limit=1)                              # 요약은 쪽(1건)이 아니라 전체(4건)
    s = res["summary"]
    assert s["total"] == 4 and len(res["items"]) == 1
    assert s["analysis_type"] == [{"value": "FE 해석", "count": 2}, {"value": "강도 평가", "count": 2}]
    assert s["hull"][0] == {"value": "9002", "count": 3}
    assert "years" not in s and "year_unknown" not in s     # 15 — 해석 시기 분포는 없앴다
    assert s["solve"] == {"pass": 1, "fail": 1, "error": 0, "stale": 1, "pending": 0, "none": 0, "no_model": 1}
    assert s["model_size"]["min"] == 500 and s["model_size"]["max"] == 60000 and s["model_size"]["models"] == 3
    assert [b["count"] for b in s["model_size"]["buckets"]] == [1, 0, 1, 1]
    # 필터를 걸면 요약도 그 결과만
    s2 = _q(db, filters={"hull": "9001"})["summary"]
    assert s2["total"] == 1 and s2["solve"]["stale"] == 1


def test_summary_empty(db):
    s = _q(db, "없는낱말")["summary"]
    assert s["total"] == 0 and s["model_size"]["min"] is None and "years" not in s


def test_ignores_include_and_trashed_models(db, make_entry_file):
    e, inc = make_entry_file(title="가", name="inc.bdf", kind="model")
    _e, gone = make_entry_file(entry=e, name="gone.bdf", kind="model", location="trash")
    _model(db, inc, grid=999, key="i", state="include")
    _model(db, gone, grid=999, key="g")
    item = _q(db)["items"][0]
    assert item["model"] is None
    assert _q(db)["summary"]["solve"]["no_model"] == 1


def test_summary_has_no_period(db, make_entry_file):
    # 15 — 요약 띠에 해석 시기(연도) 분포가 없다(열에 값이 있어도)
    make_entry_file(title="가", period="2025-03", confirmed_at=datetime(2026, 9, 1))
    s = _q(db)["summary"]
    assert s["total"] == 1 and "years" not in s and "year_unknown" not in s
