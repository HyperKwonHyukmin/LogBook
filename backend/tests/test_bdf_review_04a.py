"""04a 코드 리뷰 지적 사항 — 파서(deck)·필드·모델·lbm·썸네일 회귀 시험."""
import math

import numpy as np
import pytest

from app.bdf.deck import Card, DeckReader, DeckTooLarge
from app.bdf.fields import parse_float
from app.bdf.lbm import read_lbm, write_lbm
from app.bdf.model import Element, ModelError, Rigid, build_model
from app.bdf.thumbnail import render_thumbnail


def _reader(files: dict[str, str | bytes], **kw) -> DeckReader:
    def opener(rel: str) -> bytes:
        if rel not in files:
            raise FileNotFoundError(rel)
        v = files[rel]
        return v.encode("utf-8") if isinstance(v, str) else v
    return DeckReader(opener, **kw)


def _model(text: str):
    r = _reader({"m.bdf": text})
    return build_model(r.read("m.bdf"), sol=r.sol, warnings=r.warnings)


# ── 1. 자유 형식 9번째 칸 = 연속 표시 ──────────────────────────────

def test_free_nine_tokens_last_is_continuation():
    m = _model("CORD2R,1,0,0.,0.,0.,0.,0.,1.,\n,1.,0.,0.\nGRID,7,1,5.,0.,0.\n")
    assert m.nodes[7] == pytest.approx((5.0, 0.0, 0.0))
    c = _reader({"m.bdf": "CORD2R,1,0,0.,0.,0.,0.,0.,1.,\n,1.,0.,0.\n"}).read("m.bdf")[0]
    assert c.fields[8:11] == ["1.", "0.", "0."]


def test_free_nine_tokens_star_marker_dropped():
    c = _reader({"m.bdf": "CORD2R,1,0,0.,0.,0.,0.,0.,1.,*A\n*A,1.,0.,0.\n"}).read("m.bdf")[0]
    assert c.fields[8:11] == ["1.", "0.", "0."]


# ── 2. NaN/inf ──────────────────────────────────────────────

@pytest.mark.parametrize("token", ["nan", "NaN", "inf", "-inf", "infinity", "1.E999", "1.+999"])
def test_parse_float_non_finite(token):
    assert parse_float(token) is None


def test_non_finite_grid_still_builds_and_writes():
    m = _model("GRID,1,,nan,0.,0.\nGRID,2,,1.E999,inf,0.\nCROD,1,1,1,2\nPROD,1,1,nan\n")
    assert all(math.isfinite(v) for xyz in m.nodes.values() for v in xyz)
    header, _blocks = read_lbm(write_lbm(m))
    assert header["counts"]["CROD"] == 1


def test_write_lbm_rejects_nan_in_header():
    m = _model("GRID,1,,0.,0.,0.\nGRID,2,,1.,0.,0.\nCROD,1,1,1,2\n")
    m.properties[1] = {"card": "PROD", "A": float("nan")}
    with pytest.raises(ValueError):
        write_lbm(m)


# ── 4. 메모리 ───────────────────────────────────────────────

def test_byte_budget_include_raises():
    files = {"m.bdf": "INCLUDE 'big.bdf'\nGRID,1,,0.,0.,0.\n", "big.bdf": "GRID,2,,0.,0.,0.\n" * 10}
    r = _reader(files, max_bytes=100)
    with pytest.raises(DeckTooLarge):
        r.read("m.bdf")


def test_byte_budget_within_limit():
    files = {"m.bdf": "INCLUDE 'i.bdf'\n", "i.bdf": "GRID,2,,0.,0.,0.\n"}
    assert len(_reader(files, max_bytes=1000).read("m.bdf")) == 1


def test_slots_dataclasses():
    for cls in (Card, Element, Rigid):
        assert hasattr(cls, "__slots__")
    with pytest.raises(AttributeError):
        Card("GRID", [], "m.bdf").extra = 1


def test_line_endings_crlf_and_cr():
    deck = b"GRID,1,,0.,0.,0.\r\nGRID,2,,1.,0.,0.\rGRID,3,,2.,0.,0.\n"
    assert [c.fields[0] for c in _reader({"m.bdf": deck}).read("m.bdf")] == ["1", "2", "3"]


# ── 5. MAT*·P* 덮어쓰기 ────────────────────────────────────────

def test_mats1_does_not_overwrite_mat1():
    m = _model("MAT1,1,206000.,,0.3\nMATS1,1,,PLASTIC,0.,1,1,235.\nMATT1,1,5\n")
    assert m.materials[1]["card"] == "MAT1" and m.materials[1]["E"] == 206000.0
    assert "MATS1" not in m.unsupported and "MATT1" not in m.unsupported


def test_property_allow_list():
    m = _model("PSHELL,5,1,12.\nPLOTEL,1,1,2\nPFOO,5,1\nPLOAD4,1,1,1.\nPARAM,POST,-1\n")
    assert m.properties[5]["card"] == "PSHELL"
    assert m.unsupported == {"PFOO": 1}


# ── 사소한 항목 ───────────────────────────────────────────────

def test_include_has_bulk_main_has_exec_only():
    files = {
        "m.bdf": "SOL 101\nCEND\nSUBCASE 1\n  LOAD = 1\nINCLUDE 'bulk.bdf'\n",
        "bulk.bdf": "BEGIN BULK\nGRID,1,,0.,0.,0.\nENDDATA\n",
    }
    r = _reader(files)
    cards = r.read("m.bdf")
    assert [c.name for c in cards] == ["GRID"] and r.sol == "101"


def test_begin_bulk_never_a_card():
    files = {"m.bdf": "BEGIN BULK\nINCLUDE 'i.bdf'\nGRID,2,,0.,0.,0.\n", "i.bdf": "BEGIN BULK\nGRID,1,,0.,0.,0.\n"}
    assert [c.name for c in _reader(files).read("m.bdf")] == ["GRID", "GRID"]


def test_enddata_in_include_stops_deck():
    files = {"m.bdf": "INCLUDE 'i.bdf'\nGRID,2,,0.,0.,0.\n", "i.bdf": "GRID,1,,0.,0.,0.\nENDDATA\nGRID,3,,0.,0.,0.\n"}
    assert [c.fields[0] for c in _reader(files).read("m.bdf")] == ["1"]


def test_unclosed_include_quote_gives_up():
    deck = "INCLUDE 'never closed\n" + "".join(f"GRID,{i},,0.,0.,0.\n" for i in range(1, 11))
    r = _reader({"m.bdf": deck})
    cards = r.read("m.bdf")
    assert any(w.startswith("include_unreadable") for w in r.warnings)
    assert len(cards) >= 5  # 5줄까지만 이어 붙이고 나머지는 카드로 읽는다


def test_long_include_name_truncated():
    name = "x" * 500 + ".bdf"
    r = _reader({"m.bdf": f"INCLUDE {name}\n"})
    r.read("m.bdf")
    assert len(r.missing[0]) <= 200 and all(len(w) <= 230 for w in r.warnings)


def test_blank_pid_defaults_to_eid():
    m = _model("GRID,1,,0.,0.,0.\nGRID,2,,1.,0.,0.\nGRID,3,,1.,1.,0.\nCBAR,7,,1,2,0.,0.,1.\nCTRIA3,8,,1,2,3\n")
    assert m.beams[0].pid == 7 and m.tris[0].pid == 8


def test_missing_gb_warning():
    m = _model("GRID,1,,0.,0.,0.\nCBAR,7,1,1\nCBUSH,8,1,1\n")
    assert "missing_gb: 1" in m.warnings and "grounded_cbush: 1" in m.warnings


def test_grdset_default_cp():
    m = _model("GRDSET,,10\nCORD2R,10,0,100.,0.,0.,100.,0.,1.\n,101.,0.,0.\nGRID,1,,1.,0.,0.\nGRID,2,0,1.,0.,0.\n")
    assert m.nodes[1] == pytest.approx((101.0, 0.0, 0.0))
    assert m.nodes[2] == pytest.approx((1.0, 0.0, 0.0))


def test_pcomp_sym_and_repeat_thickness():
    m = _model("PCOMP,1,,,,,,,SYM\n,1,2.,0.,,1,,45.\n,1,,90.\n")
    assert m.properties[1]["t"] == pytest.approx(12.0)  # (2+2+2)×2


def test_duplicate_ids_warn_last_wins():
    m = _model("GRID,1,,0.,0.,0.\nGRID,1,,5.,0.,0.\nGRID,2,,1.,0.,0.\nCROD,9,1,1,2\nCBAR,9,1,1,2,0.,0.,1.\n")
    assert m.nodes[1] == (5.0, 0.0, 0.0)
    assert [e.card for e in m.beams] == ["CBAR"]
    assert "duplicate_id: 2" in m.warnings


def test_free_continuation_with_leading_space():
    cards = _reader({"m.bdf": "RBE2,9,1,123456,2,3,4,5,6,+\n +,7,8\n"}).read("m.bdf")
    assert [c.name for c in cards] == ["RBE2"] and cards[0].fields[8:10] == ["7", "8"]


def test_id_out_of_range():
    with pytest.raises(ModelError) as ei:
        _model("GRID,1,,0.,0.,0.\nGRID,3000000000,,1.,0.,0.\nCROD,1,1,1,3000000000\n")
    assert ei.value.code == "id_out_of_range"
    with pytest.raises(ModelError):
        _model("GRID,1,,0.,0.,0.\nGRID,2,,1.,0.,0.\nCROD,1,2147483648,1,2\n")


def test_spc_components_validated():
    m = _model("GRID,1,,0.,0.,0.\nGRID,2,,1.,0.,0.\nSPC,1,1,123,0.,2,1.5\nSPC1,1,789,1,2\n")
    assert m.spcs == {1: "123"}


def test_bbox_uses_element_nodes():
    m = _model("GRID,1,,0.,0.,0.\nGRID,2,,10.,0.,0.\nGRID,99,,1.E6,0.,0.\nCROD,1,1,1,2\n")
    assert m.bbox() == {"min": [0.0, 0.0, 0.0], "max": [10.0, 0.0, 0.0]}
    assert _model("GRID,1,,0.,0.,0.\nGRID,2,,3.,0.,0.\n").bbox()["max"] == [3.0, 0.0, 0.0]


def test_thumbnail_random_thinning_and_framing(monkeypatch):
    import app.bdf.thumbnail as th

    text = "".join(f"GRID,{i},,{i}.,0.,{(i % 2)}.\n" for i in range(1, 202)) + "GRID,999,,1.E6,1.E6,1.E6\n"
    text += "".join(f"CTRIA3,{i},1,{i},{i + 1},{i + 2}\n" for i in range(1, 200))
    m = _model(text)
    picked = th._thin(list(range(1000)), 100)
    assert len(picked) == 100 and picked == sorted(picked) and picked != list(range(0, 1000, 10))
    assert picked == th._thin(list(range(1000)), 100)  # 고정 시드 — 같은 결과
    monkeypatch.setattr(th, "MAX_SHELLS", 50)
    png = render_thumbnail(m)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    # 요소에 안 쓰인 먼 절점(999)이 틀을 좌우하지 않는다
    bounds = th._frame_points(m)
    assert np.abs(bounds).max() < 1000


def test_free_line_with_nine_numeric_fields_keeps_last_value():
    """WorkBench 식 긴 RBE2 줄이 마침 9칸이어도 마지막 종속 절점을 잃지 않는다."""
    r = DeckReader(lambda rel: b"RBE2,9,1,123456,2,3,4,5,6,7\n")
    card = r.read("m.bdf")[0]
    assert [x for x in card.fields if x][-1] == "7"
