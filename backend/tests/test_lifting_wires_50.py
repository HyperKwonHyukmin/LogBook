"""50 — 권상 Wire 모델 요약(app.bdf.wires)."""
import pytest

from app.bdf.deck import DeckReader
from app.bdf.model import build_model
from app.bdf.wires import wire_summary


def _model(text: str):
    r = DeckReader(lambda rel: text.encode("utf-8"))
    return build_model(r.read("m.bdf"), sol=r.sol, warnings=r.warnings)


# build_lifting_bdf 모양 — 10×4 m 판 위 보 4개, 훅 2개(그룹마다 lug 2), 강체 운동 막이 SPC1 12
LIFTING = (
    "SOL 101\nCEND\nTITLE = HiTessWorkBench Lifting Analysis\nBEGIN BULK\n"
    "GRID,1,,0.,0.,0.\nGRID,2,,10000.,0.,0.\nGRID,3,,10000.,4000.,0.\nGRID,4,,0.,4000.,0.\n"
    "CBEAM,1,1,1,2,0.,0.,1.\nCBEAM,2,1,2,3,0.,0.,1.\nCBEAM,3,1,3,4,0.,0.,1.\nCBEAM,4,1,4,1,0.,0.,1.\n"
    "PBEAML,1,1,MSCBML0,L\n,100.,100.,10.,10.\nMAT1,1,206000.,,0.3,7.85-9\n"
    "$ HiTessWorkBench Lifting Analysis (SF=1.2)\n"
    "GRID,101,,0.,2000.,6000.\nGRID,102,,10000.,2000.,6000.\n"
    "CROD,201,132,1,101\nCROD,202,132,4,101\nCROD,203,132,2,102\nCROD,204,132,3,102\n"
    "PROD,132,8,1257.,251327.\nMAT1,8,206000.,,0.3\n"
    "SPC1,990001,123456,101,102\nSPC1,990001,12,1\n"
    "ENDDATA\n"
)


def test_groups_wires_and_angles():
    s = wire_summary(_model(LIFTING))
    assert s["groupCount"] == 2 and s["wireCount"] == 4
    g1, g2 = s["groups"]
    assert g1["apexNodeId"] == 101 and g1["apexMm"] == [0.0, 2000.0, 6000.0]
    assert [w["lugNodeId"] for w in g1["wires"]] == [1, 4]
    assert [w["lugNodeId"] for w in g2["wires"]] == [2, 3]
    w = g1["wires"][0]
    assert w["lengthMm"] == pytest.approx((2000 ** 2 + 6000 ** 2) ** 0.5, abs=0.1)
    assert w["slingAngleDeg"] == pytest.approx(71.57, abs=0.01)   # atan(6000/2000)
    assert g1["lugSpanMm"] == 4000.0
    assert s["minSlingAngleDeg"] == pytest.approx(71.57, abs=0.01)


def test_bbox_excludes_apex_and_plan_excludes_wires():
    s = wire_summary(_model(LIFTING))
    assert s["bboxMm"] == {"min": [0.0, 0.0, 0.0], "max": [10000.0, 4000.0, 0.0]}
    assert len(s["planSegments"]) == 4 and not s["planSegmentsTruncated"]
    assert [0, 0, 10000, 0] in s["planSegments"]


def test_anti_rotation_spc_node_is_not_apex():
    # SPC1 12 만 걸린 노드 1 은 병진 3성분이 아니고 보에도 쓰여 apex 가 아니다
    s = wire_summary(_model(LIFTING))
    assert {g["apexNodeId"] for g in s["groups"]} == {101, 102}


def test_plain_model_returns_none():
    plain = LIFTING.split("$ HiTessWorkBench")[0] + "SPC1,1,123456,1\nENDDATA\n"
    assert wire_summary(_model(plain)) is None


def test_fixed_node_used_by_beam_is_not_apex():
    # 지지점이 보 끝이면(일반 구속) CROD 가 닿아도 apex 로 보지 않는다
    text = LIFTING.replace("SPC1,990001,123456,101,102", "SPC1,990001,123456,1")
    assert wire_summary(_model(text)) is None


def test_convert_deck_stores_wires(tmp_path):
    from app.convert.job import convert_deck
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "m_lifting.bdf").write_text(LIFTING, encoding="utf-8")
    out = convert_deck(str(tmp_path / "src"), "m_lifting.bdf", str(tmp_path / "store"), 10 ** 7)
    assert out["status"] == "done" and out["lifting"] is True
    assert out["wires"]["wireCount"] == 4


def test_convert_deck_plain_has_no_wires(tmp_path):
    from app.convert.job import convert_deck
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "m.bdf").write_text(LIFTING.replace("HiTessWorkBench Lifting Analysis", "x"), encoding="utf-8")
    out = convert_deck(str(tmp_path / "src"), "m.bdf", str(tmp_path / "store"), 10 ** 7)
    assert out["status"] == "done" and out["lifting"] is False and out["wires"] is None


def test_segments3d_keeps_height_and_vertical_edges():
    # 판(CQUAD4) 하나를 세워 세로 변(평면 길이 0)이 생기게 한다 — 평면 선분에는 없고 3D 선분에는 있어야 한다
    text = LIFTING.replace("$ HiTessWorkBench", "GRID,11,,0.,0.,3000.\nGRID,12,,10000.,0.,3000.\n"
                           "CQUAD4,50,2,1,2,12,11\nPSHELL,2,1,10.\n$ HiTessWorkBench")
    s = wire_summary(_model(text))
    assert s["schemaVersion"] == 2
    seg = s["segments3d"]
    assert [0, 0, 0, 0, 0, 3000] in seg or [0, 0, 3000, 0, 0, 0] in seg      # 세로 변
    assert not any(p[:2] == p[3:5] for p in s["planSegments"] if len(p) == 6)
    # 보 1-2 와 판의 아래 변 1-2 는 같은 변 — 한 번만
    assert sum(1 for p in seg if sorted([tuple(p[:3]), tuple(p[3:])]) == [(0, 0, 0), (10000, 0, 0)]) == 1
    # Wire(CROD → apex)는 구조 선분에 넣지 않는다
    assert not any(6000 in (p[2], p[5]) for p in seg)
    assert not s["segments3dTruncated"]
