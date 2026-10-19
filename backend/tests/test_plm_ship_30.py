"""30 — 사내 PLM(VT_PLM_SHIP)에서 호선 선박 정보 조회: 선형 파서·번호 정규화·조회 상태·캐시,
호선에 적용(선종 칸·PLM 칸·감사·registry), 호선 화면 [선박 정보 검색]·호선 목록 일괄 채우기·확정 때 자동 조회(작업)."""
from datetime import datetime

import pytest

from app import cli, models, plm_ship
from app.ops import registry

ROW_3370 = {"SHIP_NO": "3370", "SHIP_TYPE_NAME": "174K-LNG", "MAIN_ENGINE": "G70ME-C10.5-GA-EGRBP ",
            "SHIP_CLASS1": "BV", "RESULT_DELIVERY_DATE": datetime(2025, 2, 28), "RESULT_DELIVERY_YN": "Y"}


@pytest.fixture
def plm():
    """가짜 PLM — rows 에 넣은 호선만 있다. calls 에 조회한 번호 묶음을 남긴다. raise_ 로 장애를 흉내 낸다."""
    state = {"rows": {"3370": ROW_3370}, "calls": [], "raise": None}

    def fetch(ship_nos):
        state["calls"].append(list(ship_nos))
        if state["raise"] is not None:
            raise state["raise"]
        return {n: state["rows"][n] for n in ship_nos if n in state["rows"]}

    plm_ship.set_fetcher(fetch)
    try:
        yield state
    finally:
        plm_ship.set_fetcher(None)


# ---- 선형 파서 · 번호 ----

@pytest.mark.parametrize("raw,capacity,kind,variant,label", [
    ("174K-LNG", "174K", "LNG", None, "174K LNG"),
    ("300K-VLCC", "300K", "VLCC", None, "300K VLCC"),
    ("22.5K-LPG", "22.5K", "LPG", None, "22.5K LPG"),
    ("180K-B/C", "180K", "B/C", None, "180K B/C"),
    ("4500-CNTR", "4500", "CNTR", None, "4500 CNTR"),
    ("6500-PCTC", "6500", "PCTC", None, "6500 PCTC"),
    ("90K-LPG(DF)", "90K", "LPG", "DF", "90K LPG"),
    ("16200-CNTR(MTNL DF)", "16200", "CNTR", "MTNL DF", "16200 CNTR"),
    ("150K-LNG(MOSS)", "150K", "LNG", "MOSS", "150K LNG"),
    ("15900-CNTR(DF/Type-B", "15900", "CNTR", "DF/Type-B", "15900 CNTR"),
    ("2500-CNTR (MAERSK NI", "2500", "CNTR", "MAERSK NI", "2500 CNTR"),
    ("7.5K-LNG BV", "7.5K", "LNG BV", None, "7.5K LNG BV"),
    ("174-LNG", "174", "LNG", None, "174 LNG"),
    ("13200K-CNTR", "13200K", "CNTR", None, "13200K CNTR"),
    ("174k-lng", "174K", "lng", None, "174K lng"),
    ("1.8K-SS #6 특수도장", "1.8K", "SS #6", None, "1.8K SS #6"),
])
def test_parse_ship_type(raw, capacity, kind, variant, label):
    assert plm_ship.parse_ship_type(raw) == {"capacity": capacity, "shipKind": kind, "variant": variant,
                                             "label": label}


@pytest.mark.parametrize("raw", ["105K", "FPSO", "SUPPLY VESSEL", "F-LNG", "KDX-III", "24-N-함정 군 요구사항", "'23-4",
                                 "4Dock 2K-FF", "1.5K PATROL(제민2호)", "중형선(4280_CNTR)", "0.3K-경비함"])
def test_parse_ship_type_keeps_unmatched_as_is(raw):
    assert plm_ship.parse_ship_type(raw) == {"capacity": None, "shipKind": None, "variant": None, "label": raw}


@pytest.mark.parametrize("raw", [None, "", "   "])
def test_parse_ship_type_empty(raw):
    assert plm_ship.parse_ship_type(raw) == {"capacity": None, "shipKind": None, "variant": None, "label": None}


@pytest.mark.parametrize("raw,want", [(" 3370 ", "3370"), ("h001", "H001"), ("33700", None), ("33-7", None),
                                      (None, None), ("", None)])
def test_normalize_ship_no(raw, want):
    assert plm_ship.normalize_ship_no(raw) == want


# ---- 조회 ----

def test_lookup_found_shape(plm):
    r = plm_ship.lookup(" 3370")
    assert r.status == "found" and plm["calls"] == [["3370"]]
    assert r.ship == {"shipNo": "3370", "shipType": "174K-LNG", "capacity": "174K", "shipKind": "LNG", "variant": None,
                      "label": "174K LNG", "mainEngine": "G70ME-C10.5-GA-EGRBP", "shipClass": "BV",
                      "deliveryDate": "2025-02-28", "delivered": True}


def test_lookup_empty_delivery_and_statuses(plm):
    plm["rows"]["3371"] = {**ROW_3370, "SHIP_NO": "3371", "RESULT_DELIVERY_YN": None, "RESULT_DELIVERY_DATE": None,
                           "SHIP_TYPE_NAME": "  ", "SHIP_CLASS1": ""}
    r = plm_ship.lookup("3371")
    assert r.status == "found" and r.ship["delivered"] is False and r.ship["deliveryDate"] is None
    assert r.ship["label"] is None and r.ship["shipClass"] is None
    assert plm_ship.lookup("9999").status == "not_found"
    calls = len(plm["calls"])
    assert plm_ship.lookup("33-7").status == "invalid" and len(plm["calls"]) == calls   # 조회하지 않는다


def test_lookup_failures_are_not_cached(plm):
    plm["raise"] = plm_ship.PlmUnavailable("not_configured")
    r = plm_ship.lookup("3370")
    assert (r.status, r.reason) == ("unavailable", "not_configured")
    plm["raise"] = RuntimeError("ORA-12170 timeout")
    assert plm_ship.lookup("3370").status == "error"
    assert plm_ship.lookup("3370").status == "error"
    assert len(plm["calls"]) == 3                    # 장애는 캐시하지 않는다
    plm["raise"] = None
    assert plm_ship.lookup("3370").status == "found"
    assert plm_ship.lookup("3370").status == "found"
    assert len(plm["calls"]) == 4                    # 찾은 값은 캐시


def test_default_fetcher_without_settings_is_unavailable(monkeypatch):
    for k in ("PLM_ORACLE_DSN", "PLM_ORACLE_USER", "PLM_ORACLE_PASSWORD"):
        monkeypatch.delenv(k, raising=False)
    plm_ship.set_fetcher(None)
    assert not plm_ship.is_configured()
    r = plm_ship.lookup("3370")
    assert (r.status, r.reason) == ("unavailable", "not_configured")


# ---- 호선 화면 [선박 정보 검색] ----

def test_hull_plm_button_fills_and_audits(client, db, storage, make_user, make_entry_file, auth_headers, plm):
    make_user("A100001")
    e, _ = make_entry_file(title="x", hulls=("3370",), name="a.pdf")
    db.get(models.Hull, "3370").ship_type = "LNGC"   # 사람이 적어 둔 값 — 단추를 누르면 바꾼다
    db.commit()
    h = auth_headers("A100001")
    r = client.post("/api/hulls/3370/plm", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ship_type"] == "174K LNG"
    assert body["plm"] == {"status": "found", "ship_type_raw": "174K-LNG", "capacity": "174K", "ship_kind": "LNG",
                           "variant": None, "main_engine": "G70ME-C10.5-GA-EGRBP", "ship_class": "BV",
                           "delivery_date": "2025-02-28", "delivered": True, "checked_at": body["plm"]["checked_at"]}
    d = client.get("/api/hulls/3370", headers=h).json()
    assert d["ship_type"] == "174K LNG" and d["plm"]["main_engine"] == "G70ME-C10.5-GA-EGRBP"
    log = db.query(models.AuditLog).filter_by(action="HULL_PLM").one()
    assert log.before["ship_type"] == "LNGC" and log.after["ship_type"] == "174K LNG"
    assert db.query(models.Job).filter_by(type="write_meta", target_id=e.id).count() >= 1   # entry.json 선종
    reg = registry.build_registry(db)
    assert [x for x in reg["hulls"] if x["hull_no"] == "3370"][0]["plm"]["ship_kind"] == "LNG"


def test_hull_plm_errors(client, db, make_user, auth_headers, plm):
    make_user("A100001")
    make_user("C300003", level=1)
    h = auth_headers("A100001")
    assert client.post("/api/hulls/9999/plm", headers=h).json()["detail"] == "ship_not_found"
    assert db.get(models.Hull, "9999").plm_status == "not_found"   # 없음도 기록(자동 조회가 되풀이하지 않게)
    assert client.post("/api/hulls/99999/plm", headers=h).status_code == 422
    plm["raise"] = plm_ship.PlmUnavailable("driver_missing")
    r = client.post("/api/hulls/3370/plm", headers=h)
    assert (r.status_code, r.json()["detail"]) == (503, "plm_driver_missing")
    plm["raise"] = RuntimeError("x")
    r = client.post("/api/hulls/3370/plm", headers=h)
    assert (r.status_code, r.json()["detail"]) == (502, "plm_fetch_error")
    assert client.post("/api/hulls/3370/plm", headers=auth_headers("C300003")).status_code == 403


# ---- 일괄 채우기 · 확정 때 자동 조회 ----

def test_bulk_fill_keeps_typed_ship_type(client, db, make_user, make_entry_file, auth_headers, plm):
    make_user("A100001")
    plm["rows"]["3371"] = {**ROW_3370, "SHIP_NO": "3371", "SHIP_TYPE_NAME": "300K-VLCC"}
    for no in ("3370", "3371", "3372"):
        make_entry_file(title=no, hulls=(no,), name=f"{no}.pdf")
    db.get(models.Hull, "3371").ship_type = "VLCC 직접 입력"
    db.commit()
    r = client.post("/api/hulls/plm-fill", headers=auth_headers("A100001")).json()
    assert r == {"checked": 3, "found": 2, "not_found": 1, "filled": 1}
    assert len(plm["calls"]) == 1                         # 한 번의 조회로 묶어서
    db.expire_all()
    assert db.get(models.Hull, "3370").ship_type == "174K LNG"
    assert db.get(models.Hull, "3371").ship_type == "VLCC 직접 입력"   # 사람이 적은 선종은 그대로
    assert db.get(models.Hull, "3371").ship_capacity == "300K"         # PLM 칸은 채운다
    assert db.get(models.Hull, "3372").plm_status == "not_found"
    # 다시 누르면 찾은 호선은 건너뛰고 못 찾은 것만 다시 본다
    r = client.post("/api/hulls/plm-fill", headers=auth_headers("A100001")).json()
    assert r["checked"] == 1 and len(plm["calls"]) == 1   # '없음'은 10분 캐시라 다시 묻지 않는다
    rows = {x["hull_no"]: x for x in client.get("/api/hulls", headers=auth_headers("A100001")).json()}
    assert rows["3370"]["plm_status"] == "found" and rows["3372"]["plm_status"] == "not_found"


def test_confirm_enqueues_plm_fill_when_configured(db, storage, make_user, setup_entry_with_files, monkeypatch, plm):
    from app.entries import service

    u = make_user("A100001")
    monkeypatch.setattr(plm_ship, "is_configured", lambda: True)
    _b, e = setup_entry_with_files(rels=("3370_선수부/model.bdf",))
    db.query(models.EntryHull).filter_by(entry_id=e.id).delete()
    db.add(models.EntryHull(entry_id=e.id, hull_no="3370", is_primary=True))
    db.commit()
    service.update_entry(db, storage, e, u, {"version": e.version, "zones": ["선수부"], "analysis_type": "강도 평가"})
    service.confirm(db, storage, db.get(models.Entry, e.id), u)
    q = db.query(models.Job).filter_by(type="plm_fill", state="queued")
    assert q.count() == 1
    plm_ship.enqueue_fill(db)            # 이미 대기 중이면 또 넣지 않는다
    db.commit()
    assert q.count() == 1
    # 워커가 돌면 비어 있는 선종만 채운다
    from app.hull_info import fill_from_plm
    assert fill_from_plm(db, storage, "system", only_unchecked=True)["filled"] == 1
    assert db.get(models.Hull, "3370").ship_type == "174K LNG"


def test_confirm_does_not_enqueue_when_not_configured(db, storage, make_user, make_entry_file):
    make_entry_file(title="x", hulls=("3370",), name="a.pdf")
    assert plm_ship.enqueue_fill(db) is None and db.query(models.Job).filter_by(type="plm_fill").count() == 0


# ---- 자료 수정 화면 [선박 정보 검색](읽기만) · 확정 자료에 호선을 더하면 자동 조회 ----

def test_plm_preview_reads_only(client, db, make_user, make_entry_file, auth_headers, plm):
    make_user("C300003", level=1)   # 미리 보기는 공용 정보를 바꾸지 않으니 LV1 도 된다
    make_entry_file(title="x", hulls=("3370",), name="a.pdf")
    h = auth_headers("C300003")
    r = client.get("/api/hulls/3370/plm", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ship_type"] == "174K LNG" and body["plm"]["main_engine"] == "G70ME-C10.5-GA-EGRBP"
    hull = db.get(models.Hull, "3370")
    db.refresh(hull)
    assert hull.ship_type is None and hull.plm_status is None   # 저장하지 않는다
    assert db.query(models.AuditLog).filter_by(action="HULL_PLM").count() == 0
    r = client.get("/api/hulls/9999/plm", headers=h)
    assert (r.status_code, r.json()["detail"]) == (404, "ship_not_found")
    assert db.get(models.Hull, "9999") is None                   # 없음도 기록하지 않는다
    assert client.get("/api/hulls/99999/plm", headers=h).status_code == 422
    plm["raise"] = plm_ship.PlmUnavailable("not_configured")
    r = client.get("/api/hulls/3380/plm", headers=h)   # 3370 은 찾음 캐시에 있다
    assert (r.status_code, r.json()["detail"]) == (503, "plm_not_configured")


def test_edit_confirmed_entry_hulls_enqueues_plm_fill(db, storage, make_user, make_entry_file, monkeypatch, plm):
    from app.entries import service

    u = make_user("A100001", level=3)
    monkeypatch.setattr(plm_ship, "is_configured", lambda: True)
    e, _ = make_entry_file(title="x", hulls=("3370",), name="a.pdf")
    db.get(models.Hull, "3370").plm_status = "found"
    db.commit()
    service.update_entry(db, storage, e, u, {"version": e.version, "title": "y"})
    assert db.query(models.Job).filter_by(type="plm_fill").count() == 0   # 호선을 안 바꾸면 그대로
    e = db.get(models.Entry, e.id)
    service.update_entry(db, storage, e, u, {"version": e.version, "hulls": ["3370", "3371"]})
    assert db.get(models.Hull, "3371") is not None                         # 새 호선 행
    assert db.query(models.Job).filter_by(type="plm_fill", state="queued").count() == 1


def test_bulk_fill_includes_confirmed_hulls_without_row(client, db, make_user, make_entry_file, auth_headers, plm):
    """예전에 확정 자료를 수정해 더한 호선(호선 행 없음)도 일괄 채우기가 찾아 채운다."""
    make_user("A100001")
    e, _ = make_entry_file(title="x", hulls=("3370",), name="a.pdf")
    db.add(models.EntryHull(entry_id=e.id, hull_no="3371", is_primary=False))   # 행 없이 더해진 호선
    d, _ = make_entry_file(title="y", status="draft", hulls=("3372",), name="b.pdf")   # 초안 호선은 대상 아님
    db.commit()
    assert db.get(models.Hull, "3371") is None
    plm["rows"]["3371"] = {**ROW_3370, "SHIP_NO": "3371"}
    r = client.post("/api/hulls/plm-fill", headers=auth_headers("A100001")).json()
    assert r == {"checked": 2, "found": 2, "not_found": 0, "filled": 2}
    assert db.get(models.Hull, "3371").ship_type == "174K LNG"
    assert db.get(models.Hull, "3372") is None


def test_cli_plm_fill(db, storage, make_entry_file, plm):
    import io

    make_entry_file(title="x", hulls=("3370",), name="a.pdf")
    out = io.StringIO()
    assert cli.plm_fill(db, storage, out=out) == 0
    assert "찾음 1" in out.getvalue()
    plm["raise"] = plm_ship.PlmUnavailable("not_configured")
    db.get(models.Hull, "3370").plm_status = None
    plm_ship.clear_cache()
    db.commit()
    out = io.StringIO()
    assert cli.plm_fill(db, storage, out=out) == 2 and "plm_not_configured" in out.getvalue()


# ---- CLI plm-check(접속 진단) ----

def test_plm_check_shows_tns_entry_and_lookup(tmp_path, monkeypatch, plm):
    (tmp_path / "tnsnames.ora").write_text(
        "OTHER =\n  (DESCRIPTION = (ADDRESS = (HOST = 1.1.1.1)(PORT = 1521)))\n"
        "HIPLM =\n  (DESCRIPTION =\n    (ADDRESS = (PROTOCOL = TCP)(HOST = 10.0.0.9)(PORT = 1522))\n  )\n"
        "LAST = (DESCRIPTION = (ADDRESS = (HOST = 2.2.2.2)))\n", encoding="utf-8")
    for k, v in {"PLM_ORACLE_DSN": "HIPLM", "PLM_ORACLE_USER": "caduser", "PLM_ORACLE_PASSWORD": "secret",
                 "TNS_ADMIN": str(tmp_path)}.items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("PLM_ORACLE_LIB_DIR", raising=False)
    path, entry = plm_ship._tns_entry("HIPLM", "")
    assert path.endswith("tnsnames.ora") and "10.0.0.9" in entry and "1.1.1.1" not in entry and "2.2.2.2" not in entry
    pytest.importorskip("oracledb")
    monkeypatch.setattr(plm_ship, "set_fetcher", lambda f: plm_ship._cache.clear())   # 진단이 가짜 PLM 을 그대로 쓰게
    out = "\n".join(plm_ship.diagnose("3370"))
    assert "secret" not in out
    assert "mode=thin" in out and "10.0.0.9" in out and "조회 성공: 3370 → 174K-LNG" in out


# ---- 자료 화면 속성 칸 — 호선 아래 PLM 정보 ----

def test_entry_detail_carries_hull_plm(client, db, storage, make_user, make_entry_file, auth_headers, plm):
    from app.entries.files import write_entry_files
    import json

    make_user("A100001")
    e, _ = make_entry_file(title="x", hulls=("3370", "3371"), name="a.pdf")
    h = auth_headers("A100001")
    client.post("/api/hulls/3370/plm", headers=h)
    d = client.get(f"/api/entries/{e.entry_id}", headers=h).json()
    by = {x["hull_no"]: x for x in d["hulls"]}
    assert by["3370"]["ship_type"] == "174K LNG" and by["3370"]["plm"]["main_engine"] == "G70ME-C10.5-GA-EGRBP"
    assert by["3371"]["plm"] is None                       # 아직 조회하지 않은 호선
    write_entry_files(db, storage, db.get(models.Entry, e.id))
    meta = json.loads((storage.vault / e.vault_rel / "entry.json").read_text(encoding="utf-8"))
    assert all("plm" not in x for x in meta["hulls"])      # 재구축 원천에는 싣지 않는다
