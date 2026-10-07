"""04c 형식 v2 — 보 방향 벡터(X1–X3·G0)·변위 좌표계(CD) 회전·오프셋(OFFT)·속성 단면 보강."""
import math

import numpy as np
import pytest

from app.bdf.deck import DeckReader
from app.bdf.lbm import VERSION, read_lbm, write_lbm
from app.bdf.model import build_model

# 보 축은 언제나 GA(1) → GB(2) = +x, 길이 1000
BASE = "GRID,1,,0.,0.,0.\nGRID,2,,1000.,0.,0.\n"


def _model(text: str):
    r = DeckReader(lambda rel: text.encode("utf-8"))
    return build_model(r.read("m.bdf"), sol=r.sol, warnings=r.warnings)


def _beam(m, eid):
    return next(e for e in m.beams if e.eid == eid)


def _approx(v, expected):
    assert v is not None
    assert list(v) == pytest.approx(list(expected), abs=1e-9)


def test_x_vector_and_g0():
    m = _model(BASE + "GRID,3,,0.,0.,500.\n"
               "CBAR,10,1,1,2,0.,2.,0.\n"     # X 벡터 → 단위화
               "CBAR,11,1,1,2,3\n"            # 정수 X1 + 빈 X2·X3 = G0 → xyz(3) − xyz(1)
               "CBEAM,12,1,1,2,3,,\n"         # CBEAM 도 같은 규칙
               "CBAR,13,1,1,2,1.,0.,1.\n")    # 실수 X1 은 G0 가 아니다
    _approx(_beam(m, 10).v, (0, 1, 0))
    _approx(_beam(m, 11).v, (0, 0, 1))
    _approx(_beam(m, 12).v, (0, 0, 1))
    _approx(_beam(m, 13).v, (math.sqrt(0.5), 0, math.sqrt(0.5)))
    assert not any(w.startswith(("beam_orient_missing", "offset_unsupported")) for w in m.warnings)


def test_orientation_missing_and_baror_default():
    m = _model(BASE + "GRID,3,,0.,0.,500.\n"
               "CBAR,10,1,1,2\n"              # 칸도 BAROR 도 없음 → 없음 + 경고
               "CBAR,11,1,1,2,99\n"           # G0 절점 없음
               "CROD,12,2,1,2\n")             # 방향 벡터가 없는 요소 — 경고 대상 아님
    assert _beam(m, 10).v is None and _beam(m, 11).v is None and _beam(m, 12).v is None
    assert "beam_orient_missing: 2" in m.warnings
    m = _model(BASE + "BAROR,,,,,0.,0.,1.\nBEAMOR,,,,,0.,1.,0.\nCBAR,10,1,1,2\nCBEAM,11,1,1,2\nCBAR,12,1,1,2,0.,-1.,0.\n")
    _approx(_beam(m, 10).v, (0, 0, 1))
    _approx(_beam(m, 11).v, (0, 1, 0))
    _approx(_beam(m, 12).v, (0, -1, 0))      # 카드 칸이 BAROR 보다 우선


def test_cd_rectangular_rotation():
    # CORD2R 5: z = (0,0,1), xz 평면 위 점 C = (0,1,0) → 국부 x = 기본 +y, 국부 y = 기본 −x
    m = _model("CORD2R,5,,0.,0.,0.,0.,0.,1.\n,0.,1.,0.\n"
               "GRID,1,,0.,0.,0.,5\nGRID,2,,1000.,0.,0.\n"
               "CBAR,10,1,1,2,1.,0.,0.\n"
               "CBAR,11,1,1,2,1.,0.,0.,BGG\n")   # OFFT 첫 글자 B = 기본 좌표계 성분
    _approx(_beam(m, 10).v, (0, 1, 0))
    _approx(_beam(m, 11).v, (1, 0, 0))


def test_cd_from_grdset_and_unknown_cd():
    m = _model("CORD2R,5,,0.,0.,0.,0.,0.,1.\n,0.,1.,0.\nGRDSET,,,,,,5\n"
               "GRID,1,,0.,0.,0.\nGRID,2,,1000.,0.,0.\nGRID,3,,0.,0.,0.,0\nGRID,4,,0.,0.,0.,77\n"
               "CBAR,10,1,1,2,1.,0.,0.\n"       # GRDSET 의 CD 5
               "CBAR,11,1,3,2,1.,0.,0.\n"       # GRID 의 CD 0 이 GRDSET 보다 우선
               "CBAR,12,1,4,2,0.,1.,0.\n")      # 정의되지 않은 CD → 기본으로 보고 경고
    _approx(_beam(m, 10).v, (0, 1, 0))
    _approx(_beam(m, 11).v, (1, 0, 0))
    _approx(_beam(m, 12).v, (0, 1, 0))
    assert "cd_unresolved: 1" in m.warnings


def test_cd_cylindrical_and_spherical_local_basis():
    # 기본과 나란한 원통·구 좌표계. GA 위치의 국부 기저를 쓴다.
    m = _model("CORD2C,6,,0.,0.,0.,0.,0.,1.\n,1.,0.,0.\nCORD2S,7,,0.,0.,0.,0.,0.,1.\n,1.,0.,0.\n"
               "GRID,1,6,1000.,90.,0.,6\n"       # CP·CD 원통 (r=1000, θ=90°) = 기본 (0,1000,0)
               "GRID,2,,1000.,0.,0.\n"
               "GRID,3,,0.,0.,1000.,7\n"         # CD 구, 위치 기본 (0,0,1000) = 구 (r=1000, θ=0)
               "CBAR,10,1,1,2,1.,0.,0.\n"        # e_r → (0,1,0)
               "CBAR,11,1,1,2,0.,1.,0.\n"        # e_θ → (−1,0,0)
               "CBAR,12,1,1,2,0.,0.,1.\n"        # e_z → (0,0,1)
               "CBAR,13,1,3,2,1.,0.,0.\n"        # 구 e_r(극) → (0,0,1)
               "CBAR,14,1,3,2,0.,1.,0.\n")       # 구 e_θ(θ=0, φ=0) → (1,0,0)
    _approx(_beam(m, 10).v, (0, 1, 0))
    _approx(_beam(m, 11).v, (-1, 0, 0))
    _approx(_beam(m, 12).v, (0, 0, 1))
    _approx(_beam(m, 13).v, (0, 0, 1))
    _approx(_beam(m, 14).v, (1, 0, 0))


def test_offsets_ggg_rotated_by_end_cd():
    m = _model("CORD2R,5,,0.,0.,0.,0.,0.,1.\n,0.,1.,0.\n"
               "GRID,1,,0.,0.,0.\nGRID,2,,1000.,0.,0.,5\n"
               "CBAR,10,1,1,2,0.,0.,1.\n+,,,0.,0.,50.,10.,0.,50.\n"   # OFFT 빈칸 = GGG
               "CBAR,11,1,1,2,0.,0.,1.,GGG\n+,,,1.,2.,3.\n")         # WB 없음 → 0
    _approx(_beam(m, 10).off, (0, 0, 50, 0, 10, 50))    # WB 는 GB 의 CD 5(국부 x = 기본 +y)
    _approx(_beam(m, 11).off, (1, 2, 3, 0, 0, 0))
    assert _beam(m, 10).v is not None


def test_offsets_offset_system_and_unsupported():
    # v = +z, x = +x → z_elem = x × v = −y, y_elem = z × x = +z
    m = _model(BASE +
               "CBAR,10,1,1,2,0.,0.,1.,GOO\n+,,,0.,10.,20.,5.,0.,0.\n"
               "CBAR,11,1,1,2,0.,0.,1.,XYZ\n+,,,0.,0.,50.\n"         # 알 수 없는 OFFT
               "CBAR,12,1,1,2,,,,GOG\n+,,,0.,0.,50.\n"               # O 인데 v 없음
               "CBAR,13,1,1,2,0.,0.,1.,XYZ\n")                       # 오프셋 없음 → 경고 없음
    _approx(_beam(m, 10).off, (0, -20, 10, 5, 0, 0))
    assert _beam(m, 11).off is None and _beam(m, 12).off is None
    assert "offset_unsupported: 2" in m.warnings
    _approx(_beam(m, 11).v, (0, 0, 1))                  # 방향 벡터는 OFFT 와 상관없이 풀린다


def test_cbeam_bit_and_offsets_with_sa_sb():
    m = _model(BASE + "CBEAM,10,1,1,2,0.,1.,0.,25.\n+,,,0.,0.,7.,0.,0.,8.\n+,101,102\n")
    e = _beam(m, 10)
    _approx(e.v, (0, 1, 0))
    _approx(e.off, (0, 0, 7, 0, 0, 8))                  # 실수 8번째 칸 = BIT → OFFT 기본 GGG
    assert not any(w.startswith("offset_unsupported") for w in m.warnings)


def test_large_field_and_free_field_continuations():
    def large(name, *vals):
        return f"{name:<8}" + "".join(f"{v:>16}" for v in vals) + "\n"

    text = (BASE
            + large("CBAR*", "10", "1", "1", "2") + large("*", "0.", "0.", "1.", "GGG")
            + large("*", "", "", "0.", "0.") + large("*", "50.", "0.", "0.", "-50.")
            + "CBAR    11      1       1       2       0.      1.      0.\n"
            + "CBAR,12,1,1,2,0.,1.,0.,,+C\n+C,,,1.,1.,1.\n")
    m = _model(text)
    _approx(_beam(m, 10).v, (0, 0, 1))
    _approx(_beam(m, 10).off, (0, 0, 50, 0, 0, -50))
    _approx(_beam(m, 11).v, (0, 1, 0))                  # 고정 소형 필드
    assert _beam(m, 11).off is None
    _approx(_beam(m, 12).off, (1, 1, 1, 0, 0, 0))       # 자유 형식 + 이름 붙은 연속 줄


def test_property_section_enrichment():
    m = _model(BASE + "PTUBE,1,1,100.,10.\nPTUBE,2,1,60.\nPROD,3,1,314.159265\n"
               "PBAR,4,1,400.\nPBEAM,5,1,900.\nPBAR,6,1\nPBARL,7,1,,TUBE\n,50.,40.\n")
    p = m.properties
    assert p[1] == {"card": "PTUBE", "mid": 1, "type": "TUBE", "dims": [50.0, 40.0]}
    assert p[2]["dims"] == [30.0, 0.0]                  # T 없음 = 속이 찬 봉
    assert p[3]["type"] == "ROD" and p[3]["approx"] is True and p[3]["dims"][0] == pytest.approx(10.0)
    assert p[3]["A"] == pytest.approx(314.159265)
    assert p[4] == {"card": "PBAR", "mid": 1, "A": 400.0, "type": "BAR", "dims": [20.0, 20.0], "approx": True}
    assert p[5]["type"] == "BAR" and p[5]["dims"] == [30.0, 30.0]
    assert p[6] == {"card": "PBAR", "mid": 1, "A": None}   # 면적이 없으면 단면도 없다
    assert p[7] == {"card": "PBARL", "mid": 1, "type": "TUBE", "dims": [50.0, 40.0]}


def test_lbm_v2_blocks_row_aligned_and_finite():
    m = _model(BASE + "GRID,3,,0.,0.,500.\n"
               "CROD,9,2,1,2\nCBAR,10,1,1,2,3\n+,,,0.,0.,50.\n"
               "CBAR,11,1,1,2,0.,1.,0.\n+,,,1.e39,0.,0.\n")   # f4 를 넘는 오프셋 → 0(NaN/inf 금지)
    header, b = read_lbm(write_lbm(m))
    assert header["version"] == VERSION == 2
    assert b["beams"][:, 0].tolist() == [9, 10, 11]
    assert b["beam_orient"].shape == (3, 3) and b["beam_offsets"].shape == (3, 6)
    assert b["beam_orient"].dtype == np.dtype("<f4") and b["beam_offsets"].dtype == np.dtype("<f4")
    assert b["beam_orient"].tolist() == [[0, 0, 0], [0, 0, 1], [0, 1, 0]]
    assert b["beam_offsets"][1].tolist() == [0, 0, 50, 0, 0, 0]
    assert np.isfinite(b["beam_offsets"]).all() and b["beam_offsets"][2].tolist() == [0] * 6
    for meta in header["blocks"].values():
        assert meta["offset"] % 4 == 0


def test_lbm_v2_empty_beam_blocks():
    m = _model("GRID,1,,0.,0.,0.\nGRID,2,,1.,0.,0.\nGRID,3,,0.,1.,0.\nCTRIA3,1,5,1,2,3\nPSHELL,5,1,1.\n")
    _h, b = read_lbm(write_lbm(m))
    assert b["beam_orient"].shape == (0, 3) and b["beam_offsets"].shape == (0, 6)
