"""해석 검증 입력 BDF 만들기(06 §2) — 순수 함수."""
import pytest

from app.bdf.model import build_model
from app.solve.deck import (SID_START, IncludeMissing, build_deck, collect_bulk, fixed_nodes, pick_sid,
                            used_sids)


def _opener(files: dict[str, str]):
    def read(rel: str) -> bytes:
        if rel not in files:
            raise FileNotFoundError(rel)
        return files[rel].encode()
    return read


MAIN = """\
ASSIGN OUTPUT2='x.op2'
SOL 101
CEND
TITLE = 원본 제목
SUBCASE 1
  SPC = 1
  LOAD = 2
  DISP = ALL
BEGIN BULK
PARAM,POST,-1
$ 주석 줄
INCLUDE 'mesh.bdf'
SPC1,1,123456,1   $ 원본 구속
GRAV,2,,9810.,0.,0.,-1.
FORCE,990001,3,,1.,0.,0.,1.
LOAD,7,1.,1.,990002
ENDDATA
GRID,999,,0.,0.,0.
"""
MESH = "GRID,1,,0.,0.,0.\nGRID,2,,1000.,0.,0.\nGRID*   3               1000.0          1000.0\n*       0.0\n" \
       "CROD,1,5,1,2\nCROD,2,5,2,3\nPROD,5,1,100.\nMAT1,1,206000.,,0.3,7.85-9\n"


def test_collect_bulk_expands_include_and_drops_control():
    reader, lines = collect_bulk(_opener({"m.bdf": MAIN, "mesh.bdf": MESH}), "m.bdf")
    text = "\n".join(lines)
    # 실행·케이스 제어·BEGIN BULK·ENDDATA·INCLUDE 줄·주석 줄은 빠진다
    for gone in ("SOL 101", "CEND", "SUBCASE", "BEGIN BULK", "ENDDATA", "INCLUDE", "주석", "ASSIGN"):
        assert gone not in text
    # INCLUDE 자리에 포함 파일 원문이 그 순서대로 들어간다(대형 필드 줄도 원문 그대로)
    assert lines[0] == "PARAM,POST,-1"
    assert lines[1:7] == MESH.splitlines()[:6]
    # 원본 경계조건·하중 카드는 지우지도 고치지도 않는다(줄 끝 주석만 뗀다)
    assert "SPC1,1,123456,1" in lines and "GRAV,2,,9810.,0.,0.,-1." in lines
    # ENDDATA 뒤는 읽지 않는다
    assert "GRID,999" not in text
    assert reader.includes == ["mesh.bdf"] and len(reader.digest) == 64


def test_collect_bulk_only_file_without_begin_bulk():
    reader, lines = collect_bulk(_opener({"m.bdf": MESH}), "m.bdf")
    assert lines == MESH.splitlines()


def test_missing_include_raises():
    with pytest.raises(IncludeMissing) as exc:
        collect_bulk(_opener({"m.bdf": MAIN}), "m.bdf")
    assert exc.value.names == ["mesh.bdf"]


def test_sid_avoids_original_sets():
    reader, _lines = collect_bulk(_opener({"m.bdf": MAIN, "mesh.bdf": MESH}), "m.bdf")
    used = used_sids(reader.cards)
    assert {1, 2, 7, 990001, 990002} <= used
    assert pick_sid(used) == 990003
    assert pick_sid(set()) == SID_START


def test_fixed_nodes_per_group_lowest_z():
    text = ("GRID,1,,0.,0.,0.\nGRID,2,,0.,0.,0.9\nGRID,3,,0.,0.,5.\n"        # 그룹 A: 1·2 고정(1mm 안)
            "GRID,11,,0.,0.,100.\nGRID,12,,0.,0.,102.\n"                    # 그룹 B: 11 고정
            "GRID,20,,0.,0.,-50.\n"                                           # 요소 없는 GRID 는 고정 안 함
            "CROD,1,5,1,2\nCROD,2,5,2,3\nCROD,3,5,11,12\n")
    reader, _ = collect_bulk(_opener({"m.bdf": text}), "m.bdf")
    nodes, groups = fixed_nodes(build_model(reader.cards))
    assert groups == 2 and nodes == [1, 2, 11]


def test_fixed_nodes_skip_rbe_dependents():
    # 가장 낮은 절점 1 이 RBE2 종속이면 고정하지 않는다(종속 자유도에 SPC → Nastran 오류)
    text = ("GRID,1,,0.,0.,0.\nGRID,2,,1.,0.,10.\nGRID,3,,2.,0.,20.\nGRID,4,,3.,0.,10.\n"
            "CROD,1,5,1,2\nCROD,2,5,2,3\nCROD,3,5,3,4\nRBE2,9,4,123456,1\n")
    reader, _ = collect_bulk(_opener({"m.bdf": text}), "m.bdf")
    nodes, groups = fixed_nodes(build_model(reader.cards))
    assert groups == 1 and nodes == [2, 4]


def test_build_deck_text():
    text = build_deck(["GRID,1,,0.,0.,0.", "CROD,1,5,1,2"], 990001, list(range(1, 9)))
    lines = text.splitlines()
    assert lines[:6] == ["SOL 101", "CEND", "ECHO = NONE", "SPC = 990001", "LOAD = 990001", "BEGIN BULK"]
    assert lines[6:8] == ["GRID,1,,0.,0.,0.", "CROD,1,5,1,2"]
    assert "GRAV,990001,,1.0,0.,0.,-1." in lines
    spc = [ln for ln in lines if ln.startswith("SPC1,")]
    assert spc == ["SPC1,990001,123456,1,2,3,4,5,6", "SPC1,990001,123456,7,8"]
    assert lines[-1] == "ENDDATA" and text.endswith("\n")
    # 출력 요청은 넣지 않는다
    assert "DISP" not in text and "STRESS" not in text


def test_build_deck_without_fixed_nodes_has_no_spc_request():
    text = build_deck(["GRID,1,,0.,0.,0."], 990001, [])
    assert "SPC = " not in text and "SPC1" not in text and "LOAD = 990001" in text
