import pytest

from app.bdf.deck import Card, DeckReader
from app.bdf.fields import is_real, parse_float, parse_int


def _reader(files: dict[str, bytes | str]) -> DeckReader:
    def opener(rel: str) -> bytes:
        if rel not in files:
            raise FileNotFoundError(rel)
        v = files[rel]
        return v.encode("utf-8") if isinstance(v, str) else v
    return DeckReader(opener)


def _f(card: Card, n: int) -> list[str]:
    return card.fields[:n]


def test_parse_numbers():
    assert parse_int(" 12 ") == 12 and parse_int("") is None and parse_int("+") is None
    assert parse_float("1.-3") == pytest.approx(1e-3)
    assert parse_float("-2.5+2") == pytest.approx(-250.0)
    assert parse_float("1.0D2") == pytest.approx(100.0)
    assert parse_float(".5") == 0.5 and parse_float("abc") is None
    assert is_real("1.") and is_real("2.5E3") and not is_real("123") and not is_real("")


def test_small_fixed_with_continuation_marker_dropped():
    deck = (
        "BEGIN BULK\n"
        "CBEAM   101     1       1       2       0.      0.      1.      BGG     +CB1\n"
        "+CB1                                                                    \n"
        "ENDDATA\n"
    )
    cards = _reader({"m.bdf": deck}).read("m.bdf")
    assert [c.name for c in cards] == ["CBEAM"]
    assert _f(cards[0], 8) == ["101", "1", "1", "2", "0.", "0.", "1.", "BGG"]
    assert len(cards[0].fields) == 16  # 줄마다 8칸 — 연속 표시 '+CB1' 은 데이터에 섞이지 않는다


def test_large_field_grid():
    deck = (
        "GRID*                  7               0   1234.56789012       -50.25000000*G7\n"
        "*G7                 10.0000000               0\n"
    )
    c = _reader({"m.bdf": deck}).read("m.bdf")[0]
    assert c.name == "GRID"
    assert c.fields[0] == "7" and c.fields[1] == "0"
    assert parse_float(c.fields[2]) == pytest.approx(1234.56789012)
    assert parse_float(c.fields[3]) == pytest.approx(-50.25)
    assert parse_float(c.fields[4]) == pytest.approx(10.0)


def test_free_field_and_long_free_line():
    deck = "GRID,1,,0.,0.,0.\nRBE2,9,1,123456,2,3,4,5,6,7,8,9,10\nPBARL,5,1,MSCBML0,L\n+,100.,100.,10.,10.\n"
    cards = _reader({"m.bdf": deck}).read("m.bdf")
    grid, rbe2, pbarl = cards
    assert grid.fields[:5] == ["1", "", "0.", "0.", "0."]
    assert [x for x in rbe2.fields if x][:3] == ["9", "1", "123456"] and rbe2.fields[-1] == "10"
    assert pbarl.fields[:4] == ["5", "1", "MSCBML0", "L"] and pbarl.fields[8:12] == ["100.", "100.", "10.", "10."]


def test_comments_tabs_korean_cp949():
    deck = "$ 한글 주석\nGRID\t1\t\t1.\t2.\t3.\t$ 끝 주석\n".encode("cp949")
    c = _reader({"m.bdf": deck}).read("m.bdf")[0]
    assert c.fields[:5] == ["1", "", "1.", "2.", "3."]


def test_exec_section_sol_and_begin_bulk():
    deck = "SOL 101\nCEND\nSUBCASE 1\n  SPC = 1\nBEGIN BULK\nGRID,1,,0.,0.,0.\nENDDATA\nGRID,2,,0.,0.,0.\n"
    r = _reader({"m.bdf": deck})
    cards = r.read("m.bdf")
    assert r.sol == "101" and [c.fields[0] for c in cards] == ["1"]


def test_include_relative_absolute_missing_and_loop():
    files = {
        "model/main.bdf": "BEGIN BULK\nINCLUDE 'sub/mesh.bdf'\nINCLUDE 'C:\\Users\\kim\\mat.bdf'\nINCLUDE 'none.bdf'\nENDDATA\n",
        "model/sub/mesh.bdf": "GRID,1,,0.,0.,0.\nINCLUDE '../main.bdf'\n",
        "model/mat.bdf": "MAT1,1,206000.,,0.3,7.85-9\n",
    }
    r = _reader(files)
    cards = r.read("model/main.bdf")
    assert [c.name for c in cards] == ["GRID", "MAT1"]
    assert r.includes == ["model/sub/mesh.bdf", "model/mat.bdf"]
    assert r.missing == ["none.bdf"]
    assert any(w.startswith("include_missing: none.bdf") for w in r.warnings)
    assert any(w.startswith("include_loop") for w in r.warnings)
    assert cards[1].source == "model/mat.bdf"


def test_include_cannot_escape_root():
    r = _reader({"a.bdf": "INCLUDE '../../etc/x.bdf'\n"})
    r.read("a.bdf")
    assert r.missing == ["../../etc/x.bdf"]


def test_include_split_over_lines():
    files = {"m.bdf": "INCLUDE 'very/long/\n path.bdf'\n", "very/long/path.bdf": "GRID,1,,0.,0.,0.\n"}
    r = _reader(files)
    assert [c.name for c in r.read("m.bdf")] == ["GRID"]


def test_digest_changes_with_include_content():
    a = _reader({"m.bdf": "INCLUDE 'i.bdf'\n", "i.bdf": "GRID,1,,0.,0.,0.\n"})
    a.read("m.bdf")
    b = _reader({"m.bdf": "INCLUDE 'i.bdf'\n", "i.bdf": "GRID,1,,1.,0.,0.\n"})
    b.read("m.bdf")
    assert a.digest != b.digest and len(a.digest) == 64


def test_missing_begin_bulk_starts_bulk_at_first_bulk_card():
    # 실제 사례: SOL·CEND·Case Control 뒤에 BEGIN BULK 없이 PARAM·GRID 가 이어진다(Nastran 은 FATAL, 뷰어는 읽는다)
    deck = ("$ head\nSOL 101\nCEND\n  DISPLACEMENT(PLOT) = ALL\nSUBCASE 1\n  SPC = 1\n  LOAD = 2\n"
            "PARAM,POST,-1\nGRID           9        202754.0  -410.0 26256.0\n"
            "CBEAM,1,1,9,10,0.,0.,1.\nGRID,10,,0.,0.,0.\nENDDATA\n")
    seen: list[str] = []
    r = _reader({"m.bdf": deck})
    r.raw_sink = seen.append
    cards = r.read("m.bdf")
    assert r.sol == "101"
    assert [c.name for c in cards] == ["GRID", "CBEAM", "GRID"]
    assert "missing_begin_bulk" in r.warnings
    assert seen[0].startswith("GRID")


def test_case_control_lines_do_not_start_bulk():
    deck = "SOL 101\nCEND\nSUBCASE 1\n  SPC = 1\n  LOAD = 2\nBEGIN BULK\nGRID,1,,0.,0.,0.\nENDDATA\n"
    r = _reader({"m.bdf": deck})
    assert [c.name for c in r.read("m.bdf")] == ["GRID"]
    assert "missing_begin_bulk" not in r.warnings
