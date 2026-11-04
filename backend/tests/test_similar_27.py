"""27 — 선례 찾기. 특징(model_summaries 에서)·점수(형상 같으면 맨 위)·같은 설계 묶기·권한·올린 BDF.

합성 데이터만(가상 호선 9001~9004)."""
from datetime import datetime

import pytest

from app import models, similar
from app.bdf.signature import VERSION as SIG_VERSION

FRAME = {"CBEAM": 900, "RBE2": 40, "CONM2": 10, "GRID": 800}
PLATE = {"CQUAD4": 9000, "CBEAM": 2000, "GRID": 9500}
BOX_FRAME = {"min": [0, 0, 0], "max": [22000, 8000, 1500]}
BOX_PLATE = {"min": [0, 0, 0], "max": [14000, 10000, 2500]}
FP_FRAME = "CBEAM 900 · 크기 22000x8000x1500 · PBEAML L 100x100x10 · PBEAML H 300x300x10x15 · MAT1 E206000 · SOL 101"
FP_PLATE = "CQUAD4 9000 · CBEAM 2000 · PSHELL t10 · PSHELL t12 · PBEAML L 150x90x12 · SOL 101"


def test_sections_and_features():
    assert similar.sections_of(FP_FRAME) == ["H 300x300x10x15", "L 100x100x10"]
    f = similar.features(FRAME, BOX_FRAME, FP_FRAME, "101", "g")
    assert f["dims"] == [22.0, 8.0, 1.5]                      # mm → m
    assert f["elems"] == 900 and abs(sum(f["mix"]) - 1) < 1e-9 and f["mix"][0] > .9
    assert similar.features({"GRID": 4}, BOX_FRAME, "", None, None) is None   # 요소가 없으면 비교하지 않는다


def test_score_shape_first_and_parts():
    a = similar.features(FRAME, BOX_FRAME, FP_FRAME, "101", "g1") | {"zone": "정반"}
    same_geom = similar.features(FRAME, {"min": [0, 0, 0], "max": [22000, 8000, 1500]}, FP_PLATE, "101", "g1") \
        | {"zones": ["블록"]}
    plate = similar.features(PLATE, BOX_PLATE, FP_PLATE, "101", "g2") | {"zones": ["블록"]}
    s1, s2 = similar.score(a, same_geom), similar.score(a, plate)
    assert s1["shape"] and s1["total"] >= .9 > s2["total"]
    assert set(s2["raw"]) == {"size", "scale", "mix", "sec", "tag"} and s2["raw"]["tag"] == 0
    assert similar.score(a, a | {"zones": ["정반"], "sig": None})["raw"]["tag"] == 1


def _model(db, make_entry_file, *, hull, title, counts, bbox, fp, sig, zone=None, access="normal",
           solve=None, by="M100001"):
    e, f = make_entry_file(title=title, hulls=(hull,), name=f"{title}.bdf", kind="model", uploaded_by=by,
                           confirmed_at=datetime(2026, 9, 1))
    e.access = access
    db.add(models.ModelSummary(file_id=f.id, state="done", key=f"{f.id:04d}" + "k" * 60, counts=counts, bbox=bbox,
                               fingerprint=fp, sol="101", sig_version=SIG_VERSION, sig_geometry=sig))
    if solve:
        db.add(models.SolveCheck(file_id=f.id, state=solve))
    if zone:
        t = db.query(models.Tag).filter_by(kind="zone", value=zone).first() or models.Tag(kind="zone", value=zone)
        db.add(t)
        db.flush()
        db.add(models.EntryTag(entry_id=e.id, tag_id=t.id))
    db.commit()
    return e, f


@pytest.fixture
def world(db, make_user, make_entry_file):
    make_user("M100001", name="일반", level=2)
    g = "a" * 64
    base = _model(db, make_entry_file, hull="9001", title="기준", counts=FRAME, bbox=BOX_FRAME, fp=FP_FRAME, sig=g,
                  zone="정반")
    s1 = _model(db, make_entry_file, hull="9002", title="같은 설계 1", counts=FRAME, bbox=BOX_FRAME, fp=FP_FRAME,
                sig=g, zone="정반", solve="fail")
    s2 = _model(db, make_entry_file, hull="9003", title="같은 설계 2", counts=FRAME, bbox=BOX_FRAME, fp=FP_FRAME,
                sig=g, zone="정반", solve="pass")
    plate = _model(db, make_entry_file, hull="9004", title="판", counts=PLATE, bbox=BOX_PLATE, fp=FP_PLATE,
                   sig="b" * 64, zone="블록")
    hidden = _model(db, make_entry_file, hull="9004", title="숨은 같은 설계", counts=FRAME, bbox=BOX_FRAME,
                    fp=FP_FRAME, sig=g, access="blocked", by="U100001")   # 남이 올린 블록 자료
    return {k: v for k, v in dict(base=base, s1=s1, s2=s2, plate=plate, hidden=hidden).items()}


def test_similar_to_file_groups_same_design(world, client, auth_headers):
    fid = world["base"][1].id
    r = client.get(f"/api/similar?file_id={fid}", headers=auth_headers("M100001"))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["base"]["zone"] == "정반" and "atype" not in d["base"] and d["base"]["has_signature"]   # 42
    first = d["results"][0]
    assert first["score"]["shape"] and first["member_total"] == 2          # 같은 설계 둘이 한 줄, 숨은 자료는 빠짐
    assert first["lead"]["title"] == "같은 설계 2"                          # 대표 = 검증 통과
    assert {m["title"] for m in first["members"]} == {"같은 설계 1", "같은 설계 2"}
    assert d["results"][1]["lead"]["title"] == "판" and not d["results"][1]["score"]["shape"]
    assert all(fid != m["file_id"] for row in d["results"] for m in row["members"])   # 기준 자신은 빠진다


def test_zone_override_and_hidden_base(world, client, auth_headers):
    h = auth_headers("M100001")
    r = client.get(f"/api/similar?file_id={world['base'][1].id}&zone=블록&analysis_type=권상", headers=h).json()   # 42 — 옛 analysis_type 은 무시
    plate = next(x for x in r["results"] if x["lead"]["title"] == "판")
    assert plate["score"]["raw"]["tag"] == 1
    assert client.get(f"/api/similar?file_id={world['hidden'][1].id}", headers=h).status_code == 404


BDF = b"""SOL 101
CEND
BEGIN BULK
GRID,1,,0.,0.,0.
GRID,2,,22000.,0.,0.
GRID,3,,22000.,8000.,1500.
CBEAM,1,1,1,2,0.,0.,1.
CBEAM,2,1,2,3,0.,0.,1.
PBEAML,1,1,,L
,100.,100.,10.
MAT1,1,206000.,,0.3
ENDDATA
"""


def test_upload_bdf(world, client, auth_headers):
    h = auth_headers("M100001")
    r = client.post("/api/similar/bdf?name=new.bdf&zone=정반", headers=h, content=BDF)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["base"]["name"] == "new.bdf" and d["base"]["elems"] == 2 and d["base"]["dims"][0] == 22.0
    assert d["base"]["file_id"] is None and d["results"]
    bad = client.post("/api/similar/bdf?name=x.bdf", headers=h, content=b"HHIDRMC....")
    assert bad.status_code == 422 and bad.json()["detail"] == "bdf_drm"
    empty = client.post("/api/similar/bdf?name=x.bdf", headers=h, content=b"BEGIN BULK\nGRID,1,,0.,0.,0.\nENDDATA\n")
    assert empty.status_code == 422 and empty.json()["detail"] == "bdf_no_elements"


def test_requires_login(client):
    assert client.get("/api/similar?file_id=1").status_code == 401


def test_draft_file_as_base_for_inbox(world, client, auth_headers, db, make_entry_file):
    """49 — 정리 대기 카드가 올린 사람의 초안 BDF 를 기준으로 비슷한 확정 모델을 찾는다(초안 자신·다른 초안은 대상 아님)."""
    e, f = make_entry_file(status="draft", title="WB 초안", hulls=("9005",), name="draft.bdf", kind="model",
                           uploaded_by="M100001")
    db.add(models.ModelSummary(file_id=f.id, state="done", key="d" * 64, counts=FRAME, bbox=BOX_FRAME,
                               fingerprint=FP_FRAME, sol="101", sig_version=SIG_VERSION, sig_geometry="a" * 64))
    db.commit()
    r = client.get(f"/api/similar?file_id={f.id}", headers=auth_headers("M100001"))
    assert r.status_code == 200, r.text
    first = r.json()["results"][0]
    assert first["best"] >= 0.9 and first["lead"]["title"] in {"같은 설계 2", "기준"}
    assert all(m["entry_id"] != e.entry_id for row in r.json()["results"] for m in row["members"])


def test_tolerance_keeps_close_size_and_same_design(world, client, auth_headers, db, make_entry_file):
    """49 — tol=true: 크기 L·W·H 각 ±15%, 요소 수 ±30% 안이거나 형상 서명이 같은 것만. 줄마다 diff(상대 차이)."""
    near = _model(db, make_entry_file, hull="9006", title="조금 큰 틀", counts={"CBEAM": 1000, "RBE2": 40, "GRID": 900},
                  bbox={"min": [0, 0, 0], "max": [24000, 8400, 1600]}, fp=FP_FRAME, sig="c" * 64)
    far = _model(db, make_entry_file, hull="9007", title="두 배 큰 틀", counts={"CBEAM": 900, "RBE2": 40, "GRID": 800},
                 bbox={"min": [0, 0, 0], "max": [44000, 8000, 1500]}, fp=FP_FRAME, sig="d" * 64)
    h = auth_headers("M100001")
    fid = world["base"][1].id
    loose = {r["lead"]["title"] for r in client.get(f"/api/similar?file_id={fid}", headers=h).json()["results"]}
    assert {"조금 큰 틀", "두 배 큰 틀", "판"} <= loose   # 선례 찾기 화면은 범위를 걸지 않는다
    rows = client.get(f"/api/similar?file_id={fid}&tol=true", headers=h).json()["results"]
    titles = {r["lead"]["title"] for r in rows}
    assert "조금 큰 틀" in titles and "두 배 큰 틀" not in titles and "판" not in titles
    assert any(r["score"]["shape"] for r in rows)   # 같은 설계(형상 서명)는 범위와 상관없이
    row = next(r for r in rows if r["lead"]["title"] == "조금 큰 틀")
    assert row["diff"]["dims"][0] == pytest.approx(24 / 22 - 1, abs=1e-3) and row["diff"]["elems"] == pytest.approx(1000 / 900 - 1, abs=1e-3)
    assert near and far
