"""26 — 갖춤 현황 API. 행(호선·프로젝트·공용)·구역 대표 값·모델/문서·자료 사이 연결·해석 검증 요약·권한.

합성 데이터만(가상 호선 9001·9002)."""
from datetime import datetime

import pytest

from app import models
from app.bdf.signature import VERSION as SIG_VERSION


def _tag(db, e, kind, value, alias_of=None):
    t = db.query(models.Tag).filter_by(kind=kind, value=value).first()
    if t is None:
        t = models.Tag(kind=kind, value=value, alias_of_id=alias_of.id if alias_of else None)
        db.add(t)
        db.flush()
    db.add(models.EntryTag(entry_id=e.id, tag_id=t.id))
    return t


def _summary(db, f, *, sig=True, state="done"):
    db.add(models.ModelSummary(file_id=f.id, state=state, key=f"{f.id:04d}" + "k" * 60,
                               sig_version=SIG_VERSION if sig else None, sig_geometry="g" * 64 if sig else None))


@pytest.fixture
def world(db, make_user, make_entry_file):
    make_user("M100001", name="일반", level=2)
    make_user("G100001", name="게스트", level=1)
    kw = dict(uploaded_by="M100001", analysis_type="Truss", confirmed_at=datetime(2026, 9, 1))
    # full: 모델 + 문서, 검증 통과
    full, ff = make_entry_file(title="정반 갖춤", hulls=("9001",), name="full.bdf", kind="model", **kw)
    make_entry_file(entry=full, name="full.pdf", kind="report")
    # 모델만, 검증 실패
    fail, fm = make_entry_file(title="정반 실패", hulls=("9002",), name="fail.bdf", kind="model", **kw)
    # 문서만 — 다른 자료(full)의 모델과 연결
    doc, fd = make_entry_file(title="문서만", hulls=("9002",), name="doc.pdf", kind="report", **kw)
    # 공용 + 프로젝트, 구역 없음(보완 필요), 서명 없는 모델
    common, fc = make_entry_file(title="공용 모델", hulls=(), name="c.bdf", kind="model", **kw)
    common.no_hull = True
    # 블록 자료 — 일반 사용자에게 숨는다
    hidden, fh = make_entry_file(title="숨은 자료", hulls=("9001",), name="h.bdf", kind="model",
                                 **(kw | {"uploaded_by": "U100001"}))   # 남이 올린 블록 자료
    hidden.access = "blocked"
    full.access = doc.access = "shared"
    for f in (ff, fm, fh):
        _summary(db, f)
    _summary(db, fc, sig=False)
    db.add(models.SolveCheck(file_id=ff.id, state="pass"))
    db.add(models.SolveCheck(file_id=fm.id, state="fail"))
    db.add(models.ReportModelLink(report_file_id=fd.id, model_file_id=ff.id))
    deck = _tag(db, full, "zone", "정반")
    _tag(db, fail, "zone", "정반 구역", alias_of=deck)
    _tag(db, doc, "zone", "블록")
    _tag(db, hidden, "zone", "블록")
    _tag(db, common, "project", "표준 정반")   # 29 — 예전 프로젝트 값은 행이 되지 않는다
    h = db.get(models.Hull, "9001")
    h.ship_type = "LNGC"
    db.commit()
    return {k: e.entry_id for k, e in dict(full=full, fail=fail, doc=doc, common=common, hidden=hidden).items()}


def _get(client, auth_headers, emp):
    r = client.get("/api/coverage", headers=auth_headers(emp))
    assert r.status_code == 200, r.text
    return r.json()


def test_rows_zones_and_facts(world, client, auth_headers):
    g = _get(client, auth_headers, "M100001")
    by = {e["id"]: e for e in g["entries"]}
    assert world["hidden"] not in by
    full, fail, doc, common = (by[world[k]] for k in ("full", "fail", "doc", "common"))
    assert full["rows"] == ["h:9001"] and full["zones"] == ["정반"]
    assert fail["zones"] == ["정반"]                                  # 동의어 → 대표 값
    assert common["rows"] == ["c:공용"]
    assert full["models"] == 1 and full["reports"] == 1 and full["solve"] == "pass"
    assert fail["solve"] == "fail" and fail["reports"] == 0
    assert doc["models"] == 0 and doc["solve"] is None
    assert doc["model_linked"] is True and full["doc_linked"] is True   # 자료 사이 보고서 ↔ 모델 연결
    assert common["needs_fix"] is True and common["unsigned"] is True
    assert full["needs_fix"] is False and full["uploader_name"] == "일반"
    assert g["hulls"] == {"9001": "LNGC", "9002": None}
    assert g["zones"][0] == "정반"                                   # 자료 많은 구역 먼저


def test_guest_sees_shared_only(world, client, auth_headers):
    g = _get(client, auth_headers, "G100001")
    assert {e["id"] for e in g["entries"]} == {world["full"], world["doc"]}


def test_link_to_hidden_model_not_counted(world, client, auth_headers, db):
    # 숨은 자료의 모델과 연결된 문서는 '모델 연결'로 세지 않는다
    doc = db.query(models.Entry).filter_by(entry_id=world["doc"]).one()
    hidden_file = db.query(models.File).filter_by(name="h.bdf").one()
    report = db.query(models.File).filter_by(entry_id=doc.id).one()
    db.query(models.ReportModelLink).delete()
    db.add(models.ReportModelLink(report_file_id=report.id, model_file_id=hidden_file.id))
    db.commit()
    by = {e["id"]: e for e in _get(client, auth_headers, "M100001")["entries"]}
    assert by[world["doc"]]["model_linked"] is False


def test_requires_login(client):
    assert client.get("/api/coverage").status_code == 401
