"""14 — 한 자료 안 BDF 판 묶음(A)과 변경 비교(B). 합성 모델만 쓴다(가상 호선 9999·9001·9002)."""
import gzip
import json
import os

import pytest

from app import models
from app.bdf.deck import DeckReader
from app.revisions import diff as D
from app.revisions import series as S
from app.revisions.naming import name_info, strip_marks

# ── 이름 규칙 ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("name,base,text", [
    ("deck_r1", "deck", "R1"), ("deck-R2", "deck", "R2"), ("deck_rev3", "deck", "R3"), ("deck Rev.A", "deck", "Rev.A"),
    ("deck_v2", "deck", "R2"), ("deck_ver2", "deck", "R2"), ("deck (2)", "deck", "(2)"),
    ("deck_20260930", "deck", "2026-09-30"), ("deck_2026-09-30", "deck", "2026-09-30"), ("deck_260930", "deck", "2026-09-30"),
    ("deck_final", "deck", "final"), ("deck_FINAL", "deck", "FINAL"), ("deck_최종", "deck", "최종"), ("deck최종", "deck", "최종"),
    ("deck_수정", "deck", "수정"), ("deck-R2-final", "deck", "R2 · final"), ("9999_hold_r1", "9999_hold", "R1"),
])
def test_strip_marks(name, base, text):
    b, m = strip_marks(name)
    assert b == base and m.text == text


@pytest.mark.parametrize("name", ["deck_2", "3370_M04", "deck_123456", "modelfinal", "model_LC1", "deck"])
def test_not_marks(name):
    b, m = strip_marks(name)
    assert b == name and m.empty


def _order(names):
    items = [S.Item(id=i, rel_path=n, name=n, created_at=None, sig=None, info=name_info(n)) for i, n in enumerate(names)]
    return [it.rel_path for it in sorted(items, key=S.Item.order_key)]


def test_order_rules():
    assert _order(["deck_final.bdf", "deck_r2.bdf", "deck.bdf", "deck_r1.bdf"]) == [
        "deck.bdf", "deck_r1.bdf", "deck_r2.bdf", "deck_final.bdf"]
    assert _order(["deck_r3_final.bdf", "deck_r3.bdf"]) == ["deck_r3.bdf", "deck_r3_final.bdf"]
    assert _order(["d_20260930.bdf", "d_20260105.bdf", "d_old.bdf"]) == ["d_old.bdf", "d_20260105.bdf", "d_20260930.bdf"]
    assert _order(["d Rev.B.bdf", "d Rev.A.bdf"]) == ["d Rev.A.bdf", "d Rev.B.bdf"]
    assert _order(["d (3).bdf", "d (2).bdf", "d.bdf"]) == ["d.bdf", "d (2).bdf", "d (3).bdf"]


def test_folder_marks_and_keys():
    assert name_info("R1/model.bdf").key == name_info("R2/model.bdf").key
    assert name_info("R2/model.bdf").marks.rev == 2
    assert name_info("hold1/model.bdf").key != name_info("hold2/model.bdf").key
    assert name_info("x/rev2/m_final.bdf").marks.rev == 2
    assert name_info("A/deck_r1.bdf").key != name_info("B/deck_r1.bdf").key


def _items(spec):
    """[(id, rel, sig)] → Item."""
    from datetime import datetime, timedelta

    t0 = datetime(2026, 9, 1)
    return [S.Item(id=i, rel_path=r, name=r.split("/")[-1], created_at=t0 + timedelta(minutes=i), sig=g,
                   info=name_info(r)) for i, r, g in spec]


def _groups(spec, overlaps=None):
    return sorted([[it.id for it in its] for key, its in S.auto_groups(_items(spec), overlaps) if key],
                  key=lambda g: g[0])


def test_auto_groups_by_name_and_geometry():
    spec = [(1, "deck.bdf", "g1"), (2, "deck_r1.bdf", "g2"), (3, "hold.bdf", "h"), (4, "hold_new_design.bdf", "h"),
            (5, "lonely.bdf", "z"), (6, "model_LC1.bdf", "m"), (7, "model_LC2.bdf", "m")]
    # deck 계열(이름) · hold + hold_new_design(형상 같음) · LC 변형은 형상이 같아도 판이 아니다
    assert _groups(spec) == [[1, 2], [3, 4]]


def test_singleton_joins_name_group_by_geometry():
    spec = [(1, "deck.bdf", "g"), (2, "deck_r1.bdf", "g2"), (3, "renamed.bdf", "g2")]
    assert _groups(spec) == [[1, 2, 3]]


def test_jaccard_merge():
    spec = [(1, "a.bdf", None), (2, "b.bdf", None), (3, "c.bdf", None)]
    assert _groups(spec) == []
    assert _groups(spec, {frozenset((1, 3)): 0.8, frozenset((1, 2)): 0.3}) == [[1, 3]]


def test_auto_labels():
    lab = lambda names: S.auto_labels(_items([(i, n, None) for i, n in enumerate(names)]))  # noqa: E731
    assert lab(["d_r1.bdf", "d_r3.bdf"]) == ["R1", "R3"]
    assert lab(["d Rev.A.bdf", "d Rev.B.bdf"]) == ["Rev.A", "Rev.B"]
    assert lab(["d.bdf", "d_r1.bdf"]) == ["R0", "R1"]
    assert lab(["d_20260101.bdf", "d_20260201.bdf"]) == ["R0", "R1"]


# ── BDF 합성 모델 ────────────────────────────────────────────────────

BASE = """SOL 101
CEND
TITLE = 9999 판 비교 시험
SUBCASE 1
  LOAD = 10
  SPC = 1
BEGIN BULK
GRID,1,,0.,0.,0.
GRID,2,,1000.,0.,0.
GRID,3,,1000.,1000.,0.
GRID,4,,0.,1000.,0.
GRID,5,,0.,0.,500.
CQUAD4,1,5,1,2,3,4
CBAR,2,7,1,5,0.,0.,1.
CBAR,3,7,2,5,0.,0.,1.
RBE2,10,5,123456,4
PSHELL,5,1,12.
PBEAML,7,1,,I
,300.,150.,150.,10.,12.,12.
MAT1,1,206000.,,0.3,7.85-9
FORCE,10,3,,1000.,0.,0.,-1.
GRAV,20,,9810.,0.,0.,-1.
SPC1,1,123456,1,2
CONM2,90,3,,2.5
PARAM,POST,-1
ENDDATA
"""


def facts(text):
    r = DeckReader(lambda rel: text.encode("utf-8"))
    cards = r.read("m.bdf")
    return D.read_facts(cards, r.control, r.sol)


def cmp(a, b):
    return D.compare(facts(a), facts(b))


def test_identical_and_format_only():
    s, d = cmp(BASE, BASE)
    assert s["identical"] is True
    s, _ = cmp(BASE, BASE.replace("PSHELL,5,1,12.", "PSHELL,5,1,1.2+1").replace("TITLE = 9999", "TITLE = 9001"))
    assert s["identical"] is True


def test_nodes_added_moved():
    s, d = cmp(BASE, BASE.replace("GRID,3,,1000.,1000.,0.", "GRID,3,,1000.,1000.,3.")
               .replace("GRID,4,,0.,1000.,0.", "GRID,4,,0.,1000.,0.000001")
               .replace("ENDDATA", "GRID,6,,9.,9.,9.\nENDDATA"))
    n = s["nodes"]
    assert (n["added"], n["removed"], n["moved"]) == (1, 0, 1)     # 0.000001 은 허용오차 안
    assert n["max_move"] == pytest.approx(3.0) and n["mean_move"] == pytest.approx(3.0)
    assert d["nodes"]["added"] == [6] and d["nodes"]["moved"] == [3] and d["nodes"]["top_moved"] == [[3, 3.0]]


def test_node_move_through_coordinate_system():
    a = BASE.replace("GRID,5,,0.,0.,500.", "GRID,5,,0.,0.,500.\nCORD2R,9,,0.,0.,0.,0.,0.,1.,\n,1.,0.,0.")
    b = (a.replace("CORD2R,9,,0.,0.,0.,0.,0.,1.,\n,1.,0.,0.", "CORD2R,9,,10.,0.,0.,10.,0.,1.,\n,11.,0.,0.")
         .replace("GRID,5,,0.,0.,500.", "GRID,5,9,0.,0.,500."))
    s, d = cmp(a, b)
    assert s["nodes"]["moved"] == 1 and s["nodes"]["max_move"] == pytest.approx(10.0)


def test_elements_add_remove_pid_conn_card_orient():
    b = (BASE.replace("CQUAD4,1,5,1,2,3,4", "CQUAD4,1,6,1,2,3,4\nPSHELL,6,1,12.")   # PID
         .replace("CBAR,3,7,2,5,0.,0.,1.", "CBAR,3,7,3,5,0.,0.,1.")                   # 연결
         .replace("CBAR,2,7,1,5,0.,0.,1.", "CBAR,2,7,1,5,1.,0.,0.")                   # 방향 벡터
         .replace("ENDDATA", "CTRIA3,30,5,1,2,3\nCTRIA3,31,5,1,3,4\nENDDATA"))         # 추가
    s, d = cmp(BASE, b)
    e = s["elements"]
    assert (e["added"], e["removed"], e["pid_changed"], e["conn_changed"], e["other_changed"]) == (2, 0, 1, 1, 1)
    assert e["added_by_card"] == {"CTRIA3": 2}
    assert d["elements"]["pid"] == [{"eid": 1, "a": "5", "b": "6"}]
    assert d["elements"]["conn"] == [3] and d["elements"]["other"] == [2]
    s2, d2 = cmp(BASE, BASE.replace("CQUAD4,1,5,1,2,3,4", "CTRIA3,1,5,1,2,3").replace("CBAR,3,7,2,5,0.,0.,1.\n", ""))
    assert s2["elements"]["card_changed"] == 1 and s2["elements"]["removed"] == 1
    assert s2["elements"]["removed_by_card"] == {"CBAR": 1}
    assert d2["elements"]["card"] == [{"eid": 1, "a": "CQUAD4", "b": "CTRIA3"}]


def test_rigid_dependent_change():
    s, d = cmp(BASE, BASE.replace("RBE2,10,5,123456,4", "RBE2,10,5,123456,4,3"))
    assert s["rigids"]["dep_changed"] == 1
    assert d["rigids"]["dep"][0] | {} == {"eid": 10, "card": "RBE2", "added": 1, "removed": 0, "added_ids": [3],
                                          "removed_ids": []}
    s, _ = cmp(BASE, BASE.replace("RBE2,10,5,", "RBE2,10,4,").replace(",123456,4", ",123456,5"))
    assert s["rigids"]["indep_changed"] == 1


def test_property_material_sentences():
    s, d = cmp(BASE, BASE.replace("PSHELL,5,1,12.", "PSHELL,5,1,14.").replace(",300.,150.", ",320.,150.")
               .replace("MAT1,1,206000.", "MAT1,1,210000."))
    p = s["properties"]
    assert (p["changed"], p["thickness"], p["section"]) == (2, 1, 1)
    texts = [c["text"] for c in d["properties"]["changed"]]
    assert "PSHELL 5: T 12 → 14" in texts
    assert "PBEAML 7 I: DIM 300×150×150×10×12×12 → 320×150×150×10×12×12" in texts
    assert d["materials"]["changed"][0]["text"] == "MAT1 1: E 206000 → 210000"
    assert d["materials"]["changed"][0]["changes"] == [{"field": "E", "a": "206000", "b": "210000"}]
    s, d = cmp(BASE, BASE.replace("MAT1,1,206000.,,0.3,7.85-9", "MAT1,1,206000.,,0.3,7.85-9\nMAT1,2,70000.,,0.33"))
    assert s["materials"]["added"] == 1 and d["materials"]["added"][0]["text"] == "MAT1 2 추가"


def test_loads_spc_force_grav_mass_control():
    b = (BASE.replace("SPC1,1,123456,1,2", "SPC1,1,123456,1,2,3")
         .replace("FORCE,10,3,,1000.", "FORCE,10,3,,1200.")
         .replace("GRAV,20,,9810.", "GRAV,20,,9806.")
         .replace("CONM2,90,3,,2.5", "CONM2,90,3,,3.0")
         .replace("LOAD = 10", "LOAD = 20").replace("SOL 101", "SOL 103"))
    s, d = cmp(BASE, b)
    lo = s["loads"]
    assert (lo["spc_added"], lo["spc_removed"], lo["sets_changed"]) == (1, 0, 2)
    assert d["loads"]["spc_added"] == [["1", 3, "123456"]] and d["loads"]["spc_nodes"] == [3]
    texts = [x["text"] for x in d["loads"]["sets"]]
    assert "SID 10: 힘 합 (0, 0, -1000) → (0, 0, -1200)" in texts
    assert "SID 20: GRAV (0, 0, -9810) → (0, 0, -9806)" in texts
    assert s["mass"]["changed"] == 1 and (s["mass"]["total_a"], s["mass"]["total_b"]) == (2.5, 3.0)
    c = s["control"]
    assert (c["sol_a"], c["sol_b"], c["changed"]) == ("101", "103", True)
    assert "SUBCASE 1 · LOAD = 20" in d["control"]["added"] and "SUBCASE 1 · LOAD = 10" in d["control"]["removed"]
    assert s["identical"] is False


def test_list_limit_truncated(monkeypatch):
    monkeypatch.setattr(D, "LIST_LIMIT", 3)
    extra = "".join(f"GRID,{100 + i},,{i}.,0.,0.\n" for i in range(5))
    s, d = cmp(BASE, BASE.replace("ENDDATA", extra + "ENDDATA"))
    assert s["nodes"]["added"] == 5 and d["nodes"]["added"] == [100, 101, 102]
    assert s["truncated"] == {"nodes.added": 5} and d["truncated"] == {"nodes.added": 5}


# ── DB · 작업 · API ─────────────────────────────────────────────────

def _write(db, storage, f, text):
    from app.entries.locate import file_path

    p = file_path(db, storage, f)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as fh:
        fh.write(text.encode("utf-8"))


@pytest.fixture
def convert(db, storage):
    from app.convert.job import run_convert

    def _go(f, text):
        _write(db, storage, f, text)
        run_convert(db, storage, f)
        return db.get(models.ModelSummary, f.id)

    return _go


@pytest.fixture
def revised(db, convert, make_entry_file):
    """가상 호선 9999 자료 하나에 판 셋(deck · deck_r1 · deck_r2) + 혼자인 모델 + 보고서."""
    e, f0 = make_entry_file(name="deck.bdf", kind="model", hulls=("9999",), title="9999 판 시험", sha="1" * 64)
    _e, f1 = make_entry_file(entry=e, name="deck_r1.bdf", kind="model", sha="2" * 64)
    _e, f2 = make_entry_file(entry=e, name="deck_r2.bdf", kind="model", sha="3" * 64)
    _e, f3 = make_entry_file(entry=e, name="other.bdf", kind="model", sha="4" * 64)
    make_entry_file(entry=e, name="r.pdf", kind="report", sha="5" * 64)
    convert(f0, BASE)
    convert(f1, BASE.replace("PSHELL,5,1,12.", "PSHELL,5,1,14."))
    convert(f2, BASE.replace("PSHELL,5,1,12.", "PSHELL,5,1,14.").replace("ENDDATA", "GRID,6,,9.,9.,9.\nENDDATA"))
    convert(f3, BASE.replace("GRID,1,,0.,0.,0.", "GRID,1,,0.,0.,-50."))
    return e, [f0, f1, f2, f3]


def _run_jobs(db, storage):
    from app.revisions.job import run_revision_diff

    n = 0
    for j in db.query(models.Job).filter_by(type="revision_diff", state="queued").all():
        run_revision_diff(db, storage, j.target_id)
        j.state = "done"
        db.commit()
        n += 1
    return n


def test_sync_auto_series_and_api(client, db, storage, revised, make_user, auth_headers):
    e, (f0, f1, f2, f3) = revised
    make_user("A100001")
    h = auth_headers("A100001")
    r = client.get(f"/api/entries/{e.entry_id}/revisions", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["series"]) == 1
    items = body["series"][0]["items"]
    assert [x["file_id"] for x in items] == [f0.id, f1.id, f2.id]
    assert [x["display"] for x in items] == ["R0", "R1", "R2"] and items[-1]["is_latest"]
    assert [x["file_id"] for x in body["others"]] == [f3.id]
    assert body["can_edit"] is True and body["manual"] is False
    diffs = body["series"][0]["diffs"]
    assert [(x["a"], x["b"], x["state"]) for x in diffs] == [(f0.id, f1.id, "queued"), (f1.id, f2.id, "queued")]
    assert _run_jobs(db, storage) == 2
    diffs = client.get(f"/api/entries/{e.entry_id}/revisions", headers=h).json()["series"][0]["diffs"]
    assert [x["state"] for x in diffs] == ["done", "done"]
    assert diffs[0]["summary"]["properties"]["thickness"] == 1 and diffs[1]["summary"]["nodes"]["added"] == 1
    # 상세(gzip JSON)
    r = client.get(f"/api/files/{f1.id}/diff/{f2.id}/detail", headers=h)
    assert r.status_code == 200 and r.json()["nodes"]["added"] == [6]
    # 검색 결과 행 요약
    from app.revisions.series import counts
    assert counts(db, [e.id]) == {e.id: {"series": 1, "files": 3, "latest": "R2"}}
    # entry_to_dict 짧은 모양
    d = client.get(f"/api/entries/{e.entry_id}", headers=h).json()
    assert [x["display"] for x in d["revisions"][0]["items"]] == ["R0", "R1", "R2"]


def test_diff_cache_reuse_and_invalidation(db, storage, convert, revised):
    from app.revisions import job as J

    e, (f0, f1, f2, _f3) = revised
    row = J.ensure(db, f0.id, f1.id)
    assert row.state == "queued"
    _run_jobs(db, storage)
    db.refresh(row)
    assert row.state == "done" and J.ensure(db, f0.id, f1.id).id == row.id
    assert db.query(models.Job).filter_by(type="revision_diff", state="queued").count() == 0   # 캐시 그대로
    # 내용이 바뀌면(다시 변환 → key 다름) 낡음 → 다시 대기열
    convert(f1, BASE.replace("PSHELL,5,1,12.", "PSHELL,5,1,16."))
    sa, sb = J._summaries(db, f0.id, f1.id)
    db.refresh(row)
    assert J.is_stale(row, sa, sb)
    again = J.ensure(db, f0.id, f1.id)
    assert again.id == row.id and again.state == "queued"
    _run_jobs(db, storage)
    db.refresh(again)
    assert again.state == "done" and again.summary["properties"]["changed"] == 1


def test_diff_copy_from_same_content_pair(db, storage, convert, make_entry_file):
    from app.revisions import job as J

    e, a = make_entry_file(name="p.bdf", kind="model", sha="1" * 64)
    _e, b = make_entry_file(entry=e, name="p_r1.bdf", kind="model", sha="2" * 64)
    # 원본 key 는 '경로 + 바이트' 의 sha 라 같은 이름·같은 내용이어야 같은 key 다
    e2, c = make_entry_file(name="p.bdf", kind="model", hulls=("9001",), sha="3" * 64)
    _e, d = make_entry_file(entry=e2, name="p_r1.bdf", kind="model", sha="4" * 64)
    other = BASE.replace("CONM2,90,3,,2.5", "CONM2,90,3,,9.")
    for f, t in ((a, BASE), (b, other), (c, BASE), (d, other)):
        convert(f, t)
    J.ensure(db, a.id, b.id)
    _run_jobs(db, storage)
    row = J.ensure(db, c.id, d.id)
    assert row.state == "done" and row.summary["mass"]["changed"] == 1     # 계산 없이 옮겨 씀
    assert J.read_detail(storage, row) is not None


def test_diff_failure_states(db, storage, convert, revised):
    from app.revisions import job as J

    e, (f0, f1, _f2, _f3) = revised
    row = J.ensure(db, f0.id, f1.id)
    # 원본이 DRM 암호문으로 바뀐 경우(변환 결과는 남아 있음) — error + 이유
    from app.entries.locate import file_path
    with open(file_path(db, storage, f1), "wb") as fh:
        fh.write(b"HHIDRMC....")
    J.run_revision_diff(db, storage, row.id)
    db.refresh(row)
    assert row.state == "error" and row.error == "drm"
    # 자동 확보는 실패를 되풀이하지 않고, 사용자 요청(retry)은 다시 넣는다
    assert J.ensure(db, f0.id, f1.id).state == "error"
    assert J.ensure(db, f0.id, f1.id, retry=True).state == "queued"
    # 최종 실패(워커)
    J.mark_failed(db, row.id, "boom")
    db.refresh(row)
    assert row.state == "error" and "boom" in row.error


def test_worker_dispatch_and_final_failure(db, storage, revised):
    from app import worker
    from app.revisions import job as J

    e, (f0, f1, _f2, _f3) = revised
    row = J.ensure(db, f0.id, f1.id)
    job = db.query(models.Job).filter_by(type="revision_diff", target_id=row.id).first()
    job.attempts = 3
    db.commit()
    worker._final_failure(db, job, "x")
    db.refresh(row)
    assert row.state == "error"


def test_after_convert_hook_enqueues_adjacent(db, storage, revised):
    from app.revisions.service import after_model_change

    e, (f0, f1, f2, _f3) = revised
    after_model_change(db, f2)
    pairs = {(r.file_a, r.file_b) for r in db.query(models.RevisionDiff)}
    assert pairs == {(f0.id, f1.id), (f1.id, f2.id)}


def test_include_fragment_excluded_and_self_heal(db, storage, convert, make_entry_file):
    e, main = make_entry_file(name="main.bdf", kind="model", sha="1" * 64)
    _e, mesh = make_entry_file(entry=e, name="main_r1.bdf", kind="model", sha="2" * 64)
    S.sync(db, e.id)
    assert {r.file_id for r in db.query(models.ModelRevision).filter(models.ModelRevision.series_key.isnot(None))} \
        == {main.id, mesh.id}
    # main_r1 이 사실 main 의 INCLUDE 조각이면 빠진다
    convert(mesh, "GRID,101,,0.,0.,0.\nGRID,102,,1.,0.,0.\nCROD,101,101,101,102\nPROD,101,1,1.\n")
    convert(main, BASE.replace("ENDDATA", "INCLUDE 'main_r1.bdf'\nENDDATA"))
    assert S.sync(db, e.id) is True
    assert {r.file_id for r in db.query(models.ModelRevision)} == {main.id}


def test_manual_layout_kept_and_new_file_appended(client, db, storage, convert, revised, make_entry_file,
                                                  make_user, auth_headers):
    e, (f0, f1, f2, f3) = revised
    make_user("A100001")
    h = auth_headers("A100001")
    body = client.get(f"/api/entries/{e.entry_id}/revisions", headers=h).json()
    # 판 정리: r1 을 빼고(계열 밖), other 를 넣고, 순서 바꾸고, 최신판은 deck, 이름 붙이기
    r = client.put(f"/api/entries/{e.entry_id}/revisions", headers=h, json={
        "token": body["token"],
        "series": [{"file_ids": [f2.id, f3.id, f0.id], "latest": f3.id, "labels": {str(f3.id): "중간판"}}]})
    assert r.status_code == 200, r.text
    s = r.json()["series"][0]
    assert [x["file_id"] for x in s["items"]] == [f2.id, f3.id, f0.id]
    assert [x["display"] for x in s["items"]] == ["R0", "중간판", "R2"] and s["items"][1]["is_latest"]
    assert [x["file_id"] for x in r.json()["others"]] == [f1.id] and r.json()["manual"] is True
    # 낡은 token → 409
    assert client.put(f"/api/entries/{e.entry_id}/revisions", headers=h,
                      json={"token": body["token"], "series": []}).status_code == 409
    # 감사 한 줄
    log = db.query(models.AuditLog).filter_by(action="ENTRY_REVISIONS").all()
    assert len(log) == 1 and log[0].after["series"][0]["latest"] == "other.bdf"
    # 다시 추정해도 정리는 그대로
    assert S.sync(db, e.id) is False
    # 새 파일(deck_r3) — 정리된 계열 끝에 붙고, 최신판은 사용자가 정한 other 그대로(끝이 아니었으므로)
    _e, f4 = make_entry_file(entry=e, name="deck_r3.bdf", kind="model", sha="6" * 64)
    convert(f4, BASE)
    S.sync(db, e.id)
    rows = {r.file_id: r for r in db.query(models.ModelRevision).filter_by(entry_id=e.id)}
    assert rows[f4.id].series_key == rows[f0.id].series_key and rows[f4.id].rev_order == 3
    assert rows[f3.id].is_latest and not rows[f4.id].is_latest
    # entry.json 에 정리 기록
    from app.entries.files import entry_dir, write_entry_files
    write_entry_files(db, storage, e)
    meta = json.loads((entry_dir(storage, e) / "entry.json").read_text(encoding="utf-8"))
    revs = {x["rel_path"]: x for x in meta["revisions"]}
    assert revs["other.bdf"]["label"] == "중간판" and revs["other.bdf"]["latest"] is True
    assert revs["deck_r1.bdf"]["series"] is None
    # 자동 추정으로 되돌리기
    r = client.post(f"/api/entries/{e.entry_id}/revisions/reset", headers=h)
    assert r.status_code == 200 and r.json()["manual"] is False
    assert [x["file_id"] for x in r.json()["series"][0]["items"]] == [f0.id, f1.id, f2.id, f4.id]


def test_latest_follows_new_file_when_it_was_last(db, convert, revised, make_entry_file):
    e, (f0, f1, f2, _f3) = revised
    S.sync(db, e.id)
    S.save_layout(db, e.id, [{"file_ids": [f0.id, f1.id, f2.id], "latest": f2.id}], "A100001")
    db.commit()
    _e, f4 = make_entry_file(entry=e, name="deck_r3.bdf", kind="model", sha="6" * 64)
    convert(f4, BASE)
    S.sync(db, e.id)
    rows = {r.file_id: r for r in db.query(models.ModelRevision).filter_by(entry_id=e.id)}
    assert rows[f4.id].is_latest and not rows[f2.id].is_latest


def test_save_validation(client, db, revised, make_user, auth_headers, make_entry_file):
    e, (f0, f1, _f2, _f3) = revised
    _x, foreign = make_entry_file(name="x.bdf", kind="model", hulls=("9002",), sha="9" * 64)
    make_user("A100001")
    h = auth_headers("A100001")
    url = f"/api/entries/{e.entry_id}/revisions"
    assert client.put(url, headers=h, json={"series": [{"file_ids": [f0.id, foreign.id]}]}).status_code == 422
    assert client.put(url, headers=h, json={"series": [{"file_ids": [f0.id, f1.id]},
                                                       {"file_ids": [f1.id, f0.id]}]}).status_code == 422
    # 파일 하나뿐인 계열은 계열 없음으로
    r = client.put(url, headers=h, json={"series": [{"file_ids": [f0.id]}]})
    assert r.status_code == 200 and r.json()["series"] == []


def test_access_rules(client, db, revised, make_user, auth_headers):
    """15 — 판 정리는 올린 사람·LV3, 보기·비교는 그 자료를 볼 수 있는 누구나(LV1 은 공유 자료만)."""
    e, (f0, f1, _f2, _f3) = revised
    make_user("A100001")                          # 올린 사람
    make_user("A100002")                          # 남(LV2)
    make_user("G100003", level=1)
    make_user("M100004", level=3)
    url = f"/api/entries/{e.entry_id}/revisions"
    other, guest, admin = auth_headers("A100002"), auth_headers("G100003"), auth_headers("M100004")
    # 일반 자료 — LV1 에게는 없는 것과 같다
    assert client.get(url, headers=guest).status_code == 404
    e.access = "shared"
    db.commit()
    body = client.get(url, headers=other).json()
    assert body["can_edit"] is False
    assert client.put(url, headers=other, json={"series": []}).status_code == 403
    assert client.put(url, headers=guest, json={"series": []}).json()["detail"] == "not_uploader"
    assert client.post(f"{url}/reset", headers=guest).status_code == 403
    assert client.put(url, headers=admin, json={"series": []}).status_code == 200
    # LV1 도 공유 자료의 비교는 볼·요청할 수 있다(보기 동작)
    assert client.post(f"/api/files/{f0.id}/diff/{f1.id}", headers=guest).status_code == 200
    # 블록 → 볼 수 없는 사람에게는 판 목록·비교 모두 404
    e.access = "blocked"
    db.commit()
    for h in (other, guest):
        assert client.get(url, headers=h).status_code == 404
        assert client.get(f"/api/files/{f0.id}/diff/{f1.id}", headers=h).status_code == 404
        assert client.post(f"/api/files/{f0.id}/diff/{f1.id}", headers=h).status_code == 404
        assert client.get(f"/api/files/{f0.id}/diff/{f1.id}/detail", headers=h).status_code == 404
    assert client.get(url, headers=admin).status_code == 200
    # 휴지통 자료는 정리 409
    e.access, e.status = "normal", "trashed"
    db.commit()
    assert client.put(url, headers=admin, json={"series": []}).status_code == 409


def test_diff_api_errors(client, db, make_entry_file, make_user, auth_headers):
    e, a = make_entry_file(name="a.bdf", kind="model", sha="1" * 64)
    _e, b = make_entry_file(entry=e, name="a_r1.bdf", kind="model", sha="2" * 64)
    _e, rep = make_entry_file(entry=e, name="r.pdf", kind="report", sha="3" * 64)
    make_user("A100001")
    h = auth_headers("A100001")
    assert client.post(f"/api/files/{a.id}/diff/{a.id}", headers=h).status_code == 422
    assert client.post(f"/api/files/{a.id}/diff/{rep.id}", headers=h).status_code == 422
    assert client.post(f"/api/files/{a.id}/diff/{b.id}", headers=h).json()["detail"] == "model_not_ready"
    r = client.get(f"/api/files/{a.id}/diff/{b.id}", headers=h).json()
    assert r["state"] == "waiting"
    assert client.get(f"/api/files/{a.id}/diff/{b.id}/detail", headers=h).status_code == 404


def test_rebuild_restores_manual_layout(db, storage, revised):
    from app.entries.files import write_entry_files
    from app.ops.rebuild import rebuild

    e, (f0, f1, f2, f3) = revised
    e.vault_rel = f"2026/{e.entry_id}"
    db.commit()
    S.sync(db, e.id)
    S.save_layout(db, e.id, [{"file_ids": [f2.id, f0.id], "latest": f0.id, "labels": {f2.id: "처음"}}], "A100001")
    db.commit()
    write_entry_files(db, storage, e)
    # DB 를 비우고 공유 폴더로 다시 채운다
    from app import database
    db.close()
    database.Base.metadata.drop_all(database.engine)
    database.Base.metadata.create_all(database.engine)
    res = rebuild(db, storage, force=True)
    assert res["entries"] >= 1
    rows = db.query(models.ModelRevision).filter_by(manual=True).all()
    by_name = {db.get(models.File, r.file_id).name: r for r in rows}
    assert by_name["deck_r2.bdf"].label == "처음" and by_name["deck.bdf"].is_latest
    assert by_name["deck_r2.bdf"].series_key == by_name["deck.bdf"].series_key
    assert by_name["deck_r1.bdf"].series_key is None


def test_purge_removes_revision_rows(db, storage, revised, make_user):
    from app.ops.purge import purge_entry
    from app.revisions import job as J

    e, (f0, f1, _f2, _f3) = revised
    S.sync(db, e.id)
    J.ensure(db, f0.id, f1.id)
    e.status, e.trash_rel = "trashed", "E_x"
    for f in db.query(models.File).filter_by(entry_id=e.id):
        f.location = "trash"
    db.commit()
    purge_entry(db, storage, e, actor="A100001")
    assert db.query(models.ModelRevision).count() == 0 and db.query(models.RevisionDiff).count() == 0
    assert db.query(models.Job).filter_by(type="revision_diff").count() == 0


def test_cli_revisions_refresh(db, revised, capsys):
    from app.cli import main

    e, _files = revised
    assert main(["revisions-refresh"]) == 0
    out = capsys.readouterr().out
    assert "자료 1건" in out and "비교 작업 2건" in out
    assert db.query(models.ModelRevision).filter_by(entry_id=e.id).count() == 4


def test_detail_file_is_gzip(db, storage, revised):
    from app.revisions import job as J

    e, (f0, f1, _f2, _f3) = revised
    row = J.ensure(db, f0.id, f1.id)
    _run_jobs(db, storage)
    db.refresh(row)
    p = J.detail_path(storage, row.key_a, row.key_b)
    assert p.suffix == ".rdiff"
    data = json.loads(gzip.decompress(p.read_bytes()))
    assert data["properties"]["changed"][0]["text"] == "PSHELL 5: T 12 → 14"
