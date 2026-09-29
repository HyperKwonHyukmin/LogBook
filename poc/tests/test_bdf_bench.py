import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bdf_bench
from bdf_bench import (
    bench,
    run,
    main,
    split_fields,
    split_fields_large,
    is_large_field_line,
    read_records,
    detect_punch,
)


def lf_name(name: str) -> str:
    return f"{name:<8}"


def lf_field(val: str) -> str:
    return f"{val:<16}"


def lf_cont(marker: str) -> str:
    """cols 73~80(연속행 매칭 식별자) 자리를 채운다 — 데이터로 읽히면 안 된다."""
    return f"{marker:<8}"


def sf(val: str) -> str:
    """소형(8칸) 필드 하나를 만든다."""
    return f"{val:<8}"


SMALL_BDF = """\
SOL 101
CEND
BEGIN BULK
GRID    1               0.      0.      0.
GRID    2               1000.   0.      0.
GRID    3               1000.   1000.   0.
GRID    4               0.      1000.   0.
CQUAD4  10      1       1       2       3       4
CBAR    20      2       1       2       0.      0.      1.
PSHELL  1       1       12.
PBARL   2       1               L
        100.    100.    10.     10.
MAT1    1       2.06+5          .3      7.85-9
ENDDATA
"""

# CTRIA3 가 존재하지 않는 PSHELL(pid=99)을 참조한다 — 파싱은 되지만 PID xref 는 실패해야 한다.
BAD_XREF_BDF = """\
SOL 101
CEND
BEGIN BULK
GRID    1               0.      0.      0.
GRID    2               1000.   0.      0.
GRID    3               1000.   1000.   0.
CTRIA3  10      99      1       2       3
ENDDATA
"""


# ---------------------------------------------------------------------------
# 1. split_fields / read_records — WorkBench nastran_bridge.py 이식 검증
# ---------------------------------------------------------------------------

def test_split_fields_handles_comment_and_fixed_width():
    assert split_fields("GRID    1               0.      0.      0.  $ 주석") == [
        "GRID", "1", "", "0.", "0.", "0.",
    ]


def test_split_fields_handles_comma_free_field():
    assert split_fields("GRID,1,,0.,0.,0.") == ["GRID", "1", "", "0.", "0.", "0."]


def test_read_records_merges_continuation_lines():
    rr = read_records(SMALL_BDF)
    names = [r[0] for r in rr["records"]]
    assert "PBARL" in names
    pbarl = next(r for r in rr["records"] if r[0] == "PBARL")
    # 연속행(두 번째 줄의 4개 치수)까지 하나의 레코드로 합쳐져 있어야 한다.
    assert "100." in pbarl
    assert rr["continuation_lines"] >= 1


# ---------------------------------------------------------------------------
# 2. 대형 필드(GRID*, CQUAD4*) — FemScanner CardReader.cs 이식 검증
# ---------------------------------------------------------------------------

def test_is_large_field_line_detects_first_line_and_continuation():
    assert is_large_field_line("GRID*   " + "1" * 8) is True
    assert is_large_field_line("*       " + "1" * 8) is True
    assert is_large_field_line("GRID    1       0.") is False


def test_split_fields_large_splits_name_8_then_16_char_fields():
    line = lf_name("GRID*") + lf_field("101") + lf_field("0") + lf_field("1000.") + lf_field("2000.")
    assert split_fields_large(line) == ["GRID*", "101", "0", "1000.", "2000."]


def test_split_fields_large_preserves_blank_field_and_ignores_col73_marker():
    """2026-09-28 재재검토(Critical): Patran/FEMAP 의 표준 GRID* 는 CP 를 비우고
    cols 73~80 에 연속행 매칭용 '*' 를 둔다. 이전 구현은 (a) 빈 CP 를 건너뛰어 X1 이
    한 칸 밀리고, (b) cols 73~80 의 '*' 를 5번째 데이터 필드로 잘못 읽었다."""
    line1 = (
        lf_name("GRID*")
        + lf_field("1")       # ID
        + lf_field("")        # CP — 비어 있다(전형적인 Patran/FEMAP 출력)
        + lf_field("1000.")   # X1
        + lf_field("2000.")   # X2
        + lf_cont("*")        # cols 73~80 — 데이터가 아니다, 무시해야 한다
    )
    assert split_fields_large(line1) == ["GRID*", "1", "", "1000.", "2000."]


def test_split_fields_large_continuation_stops_at_available_fields():
    line2 = lf_name("*") + lf_field("3000.") + lf_field("7")
    assert split_fields_large(line2) == ["*", "3000.", "7"]


def test_read_records_grid_star_blank_cp_keeps_xyz_and_cd_positions():
    """빈 CP 뒤의 X1/X2/X3 가 밀리지 않고, 연속행의 CD 도 올바른 위치(fields[6])로
    합쳐져야 한다."""
    line1 = (
        lf_name("GRID*") + lf_field("1") + lf_field("") + lf_field("1000.")
        + lf_field("2000.") + lf_cont("*")
    )
    line2 = lf_name("*") + lf_field("3000.") + lf_field("7")
    text = "\n".join(["BEGIN BULK", line1, line2, "ENDDATA"]) + "\n"
    rr = read_records(text)
    grid = next(r for r in rr["records"] if r[0].rstrip("*") == "GRID")
    assert grid[1] == "1"                              # ID
    assert grid[2] == ""                                # CP — 비어 있어야 한다(밀리면 안 됨)
    assert grid[3:6] == ["1000.", "2000.", "3000."]      # X1,X2,X3
    assert grid[6] == "7"                               # CD — 연속행에서 올바른 위치


def test_read_records_named_large_field_continuation_marker_is_stripped():
    """2026-09-28 최종 리뷰: `*G1` 처럼 이름 붙은 대형필드 연속행 마커가 연속행의
    첫 필드(fields[0])에 그대로 남아 있으면 "+"/"*" 와 정확히 같지 않아 원문
    nastran_bridge 조건(`fields[0] in {"", "+", "*"}`)을 통과하지 못하고 데이터로
    끼어든다 — X3 가 CD 자리로 밀린다. CD 를 비워 두면(0 이어야 정상) 버그가 있을 때
    X3 값이 그 자리를 차지해 CD 가 거짓으로 0 이 아니게 된다."""
    line1 = (
        lf_name("GRID*") + lf_field("1") + lf_field("") + lf_field("1000.")
        + lf_field("2000.") + lf_cont("*G1")
    )
    line2 = lf_name("*G1") + lf_field("3000.") + lf_field("")  # CD 비어 있음
    text = "\n".join(["BEGIN BULK", line1, line2, "ENDDATA"]) + "\n"
    rr = read_records(text)
    grid = next(r for r in rr["records"] if r[0].rstrip("*") == "GRID")
    assert grid[1] == "1"                              # ID
    assert grid[2] == ""                                # CP
    assert grid[3:6] == ["1000.", "2000.", "3000."]      # X1,X2,X3 — 마커가 안 끼어야 한다
    assert grid[6] == ""                                # CD — 비어 있어야 한다


def test_bdf_bench_named_large_field_marker_grid_cd_stays_zero(tmp_path):
    line1 = (
        lf_name("GRID*") + lf_field("1") + lf_field("") + lf_field("1000.")
        + lf_field("2000.") + lf_cont("*G1")
    )
    line2 = lf_name("*G1") + lf_field("3000.") + lf_field("")
    text = "\n".join(["SOL 101", "CEND", "BEGIN BULK", line1, line2, "ENDDATA"]) + "\n"
    p = tmp_path / "named_large.bdf"
    p.write_text(text, encoding="utf-8")
    row = bench(p)
    assert row["ok"] is True
    assert row["nodes"] == 1
    # 버그가 있으면 X3("3000.")가 CD 자리로 밀려 grid_cd_nonzero 가 거짓 양성이 된다.
    assert row["grid_cd_nonzero"] == 0


def test_read_records_named_small_field_continuation_marker_is_stripped():
    """소형 필드(8칸)도 `+A1` 같은 이름 붙은 마커가 연속행 첫 필드에 남는다 — 마커가
    안 벗겨지면 그 문자열이 데이터로 끼어들어 뒤 필드가 밀린다(여기선 중복으로도
    드러난다: 벗겨지지 않으면 '+A1' 이 두 번 나타난다)."""
    line1 = sf("PBARL") + sf("2") + sf("1") + sf("") + sf("L") + sf("+A1")
    line2 = sf("+A1") + sf("100.") + sf("100.") + sf("10.") + sf("10.")
    text = "\n".join(["BEGIN BULK", line1, line2, "ENDDATA"]) + "\n"
    rr = read_records(text)
    pbarl = next(r for r in rr["records"] if r[0] == "PBARL")
    assert pbarl == ["PBARL", "2", "1", "", "L", "+A1", "100.", "100.", "10.", "10."]
    assert pbarl.count("+A1") == 1  # 벗겨지지 않으면 연속행 쪽 마커까지 두 번 남는다


def test_split_fields_large_element_blank_field_keeps_node_positions():
    """요소 카드도 중간 필드가 비어도 노드(G1~G4) 위치가 밀리면 안 된다."""
    line1 = lf_name("CQUAD4*") + lf_field("20") + lf_field("") + lf_field("101") + lf_field("102")
    line2 = lf_name("*") + lf_field("103") + lf_field("104")
    text = "\n".join(["BEGIN BULK", line1, line2, "ENDDATA"]) + "\n"
    rr = read_records(text)
    cq = next(r for r in rr["records"] if r[0].rstrip("*") == "CQUAD4")
    assert cq[2] == ""  # PID 가 비어 있다 — 보존돼야 한다
    assert cq[3:7] == ["101", "102", "103", "104"]  # G1~G4 위치 불변


def test_bdf_bench_grid_star_blank_cp_not_counted_as_nonzero(tmp_path):
    line1 = (
        lf_name("GRID*") + lf_field("1") + lf_field("") + lf_field("1000.")
        + lf_field("2000.") + lf_cont("*")
    )
    line2 = lf_name("*") + lf_field("3000.") + lf_field("7")
    text = "\n".join(["SOL 101", "CEND", "BEGIN BULK", line1, line2, "ENDDATA"]) + "\n"
    p = tmp_path / "grid_star_blank_cp.bdf"
    p.write_text(text, encoding="utf-8")
    row = bench(p)
    assert row["ok"] is True
    assert row["nodes"] == 1
    # CP 가 비어 있었다 — 밀려서 '1000.'(X1)이 CP 로 읽히면 잘못 1로 잡힌다.
    assert row["grid_cp_nonzero"] == 0
    # CD=7 은 연속행에서 올바른 위치로 읽혀야 한다.
    assert row["grid_cd_nonzero"] == 1


def test_bdf_bench_parses_large_field_grid_and_element_correctly(tmp_path):
    grid_line1 = lf_name("GRID*") + lf_field("101") + lf_field("0") + lf_field("1000.") + lf_field("2000.")
    grid_line2 = lf_name("*") + lf_field("3000.") + lf_field("0")
    cquad_line1 = lf_name("CQUAD4*") + lf_field("20") + lf_field("1") + lf_field("101") + lf_field("102")
    cquad_line2 = lf_name("*") + lf_field("103") + lf_field("104")

    text = "\n".join([
        "SOL 101", "CEND", "BEGIN BULK",
        grid_line1, grid_line2,
        "GRID    102             0.      0.      0.",
        "GRID    103             0.      0.      0.",
        "GRID    104             0.      0.      0.",
        cquad_line1, cquad_line2,
        "PSHELL  1       1       12.",
        "ENDDATA",
    ]) + "\n"
    p = tmp_path / "large_field.bdf"
    p.write_text(text, encoding="utf-8")

    row = bench(p)
    assert row["ok"] is True
    assert row["nodes"] == 4  # 101(대형필드)·102·103·104
    assert row["counts"] == {"CQUAD4": 1}
    assert row["large_field_cards"] == 2  # GRID* 1장 + CQUAD4* 1장
    assert row["xref_ok"] is True  # PID=1(PSHELL 1) 존재
    assert row["missing_grid_refs"] == 0  # 101~104 모두 GRID 로 존재


# ---------------------------------------------------------------------------
# 3. 카드 특징 탐지 — all_cards/unknown_cards/coords/grid_cp·cd/include/tab/continuation
# ---------------------------------------------------------------------------

FEATURES_BDF = """\
SOL 101
CEND
INCLUDE 'sub/extra.bdf'
SUBCASE 1
  SPC = 1
  LOAD = 2
BEGIN BULK
CORD2R  5       0       0.      0.      0.      0.      0.      1.
GRID    1               0.      0.      0.
GRID    50      5       10.     20.     30.      3
CONM2\t300\t50\t0\t1000.
RBE3    100     50      123456  1.0     123     1
CHEXA   200     1       1       50      50      50      50      50
ENDDATA
"""


def test_all_cards_and_unknown_cards_reflect_bulk_only():
    parsed = bdf_bench.parse_bdf(FEATURES_BDF)
    # SUBCASE/SPC=/LOAD= 같은 케이스제어부 줄은 BEGIN BULK 이전이라 통계에 없어야 한다.
    assert "SUBCASE" not in parsed["all_cards"]
    assert "SPC" not in parsed["all_cards"] or parsed["all_cards"].get("SPC", 0) == 0
    assert parsed["all_cards"]["CHEXA"] == 1
    assert "CHEXA" in parsed["unknown_cards"]
    assert "GRID" not in parsed["unknown_cards"]
    assert "CORD2R" not in parsed["unknown_cards"]


def test_coords_counts_replace_hardcoded_zero():
    parsed = bdf_bench.parse_bdf(FEATURES_BDF)
    assert parsed["coords"] == {"CORD2R": 1}


def test_grid_cp_and_cd_nonzero_counts():
    parsed = bdf_bench.parse_bdf(FEATURES_BDF)
    assert parsed["grid_cards"] == 2
    assert parsed["grid_cp_nonzero"] == 1  # GRID 50 의 CP=5
    assert parsed["grid_cd_nonzero"] == 1  # GRID 50 의 CD=3


def test_include_paths_collected():
    """FEATURES_BDF 의 INCLUDE 는 BEGIN BULK **이전**(CEND 직후)에 있다 — all_cards 는
    벌크 구간만 보지만, include 스캔은 전체 텍스트를 봐야 이걸 놓치지 않는다."""
    parsed = bdf_bench.parse_bdf(FEATURES_BDF)
    assert parsed["include"] == ["sub/extra.bdf"]
    assert "INCLUDE" not in parsed["all_cards"]  # 벌크 밖이라 all_cards 에는 안 잡힌다


def test_include_still_found_when_inside_bulk_section():
    text = "\n".join([
        "BEGIN BULK",
        "INCLUDE 'inside/bulk.bdf'",
        "GRID    1               0.      0.      0.",
        "ENDDATA",
    ]) + "\n"
    parsed = bdf_bench.parse_bdf(text)
    assert parsed["include"] == ["inside/bulk.bdf"]


def test_tab_lines_counted(tmp_path):
    p = tmp_path / "features.bdf"
    p.write_text(FEATURES_BDF, encoding="utf-8")
    row = bench(p)
    assert row["ok"] is True
    assert row["tab_lines"] >= 1


# ---------------------------------------------------------------------------
# 4. xref 정확성 — CONROD/CELAS2 오탐지 배제, 실제 누락 PID 는 잡는다
# ---------------------------------------------------------------------------

def test_conrod_field2_is_grid_not_pid_and_not_flagged(tmp_path):
    text = """\
SOL 101
CEND
BEGIN BULK
GRID    1               0.      0.      0.
GRID    2               1000.   0.      0.
CONROD  10      1       2       5       100.
MAT1    5       2.06+5          .3      7.85-9
ENDDATA
"""
    p = tmp_path / "conrod.bdf"
    p.write_text(text, encoding="utf-8")
    row = bench(p)
    assert row["ok"] is True
    assert row["counts"] == {"CONROD": 1}
    assert row["xref_ok"] is True  # CONROD 는 PID 가 없다 — 오탐지 금지
    assert row["xref_errors"] == []


def test_celas2_field2_is_stiffness_not_pid_and_not_flagged(tmp_path):
    text = """\
SOL 101
CEND
BEGIN BULK
GRID    1               0.      0.      0.
GRID    2               1000.   0.      0.
CELAS2  10      1000.   1       1       2       1
ENDDATA
"""
    p = tmp_path / "celas2.bdf"
    p.write_text(text, encoding="utf-8")
    row = bench(p)
    assert row["ok"] is True
    assert row["counts"] == {"CELAS2": 1}
    assert row["xref_ok"] is True  # CELAS2 필드2 는 강성값이지 PID 가 아니다
    assert row["xref_errors"] == []


def test_real_missing_pid_is_flagged(tmp_path):
    p = tmp_path / "bad_xref.bdf"
    p.write_text(BAD_XREF_BDF, encoding="utf-8")
    row = bench(p)
    assert row["ok"] is True
    assert row["counts"] == {"CTRIA3": 1}
    assert row["xref_ok"] is False
    assert any("pid=99" in e for e in row["xref_errors"])


def test_missing_grid_ref_is_counted(tmp_path):
    text = """\
SOL 101
CEND
BEGIN BULK
GRID    1               0.      0.      0.
GRID    2               1000.   0.      0.
CBAR    20      2       1       999     0.      0.      1.
PBARL   2       1               L
        100.    100.    10.     10.
ENDDATA
"""
    p = tmp_path / "missing_grid.bdf"
    p.write_text(text, encoding="utf-8")
    row = bench(p)
    assert row["ok"] is True
    assert row["missing_grid_refs"] == 1  # 노드 999 는 정의돼 있지 않다


# ---------------------------------------------------------------------------
# 5. 펀치(punch) 판정 — 주석 속 'BEGIN BULK' 문구에 속지 않는다
# ---------------------------------------------------------------------------

def test_detect_punch_true_for_pure_bulk_file():
    text = "GRID    1               0.      0.      0.\nENDDATA\n"
    assert detect_punch(text) is True


def test_detect_punch_false_when_begin_bulk_present():
    assert detect_punch(SMALL_BDF) is False


def test_detect_punch_ignores_begin_bulk_mentioned_in_comment():
    text = (
        "$ 이 파일은 BEGIN BULK 없이 바로 GRID 부터 시작한다\n"
        "GRID    1               0.      0.      0.\n"
        "ENDDATA\n"
    )
    assert detect_punch(text) is True


# ---------------------------------------------------------------------------
# 6. 절대 중단하지 않는다 — bench()/run() 모두 예외를 행으로만 남긴다
# ---------------------------------------------------------------------------

def test_bdf_bench_records_read_failure_as_row(tmp_path):
    """읽을 수 없는 입력(디렉터리를 파일처럼 넘김)은 예외를 행으로만 남긴다."""
    d = tmp_path / "not_a_file"
    d.mkdir()
    row = bench(d)
    assert row["ok"] is False
    assert "error" in row


def test_run_records_walk_errors_as_rows_without_aborting(tmp_path, monkeypatch):
    (tmp_path / "a.bdf").write_text(SMALL_BDF, encoding="utf-8")

    def fake_walk(folder, onerror=None, **kwargs):
        if onerror:
            onerror(OSError(13, "Permission denied", str(tmp_path / "blocked")))
        yield (str(tmp_path), [], ["a.bdf"])

    monkeypatch.setattr(bdf_bench.os, "walk", fake_walk)
    rows = run(str(tmp_path))
    walk_rows = [r for r in rows if (r.get("error") or "").startswith("walk")]
    ok_rows = [r for r in rows if r.get("ok") is True]
    assert len(walk_rows) == 1
    assert "blocked" in walk_rows[0]["file"]
    assert len(ok_rows) == 1
    assert ok_rows[0]["file"] == "a.bdf"


def test_run_on_folder_collects_all_model_files(tmp_path):
    folder = tmp_path / "bdfs"
    folder.mkdir()
    (folder / "a.bdf").write_text(SMALL_BDF, encoding="utf-8")
    (folder / "b.dat").write_text(SMALL_BDF, encoding="utf-8")
    (folder / "ignore.blk").write_text(SMALL_BDF, encoding="utf-8")
    rows = run(str(folder))
    assert {r["file"] for r in rows} == {"a.bdf", "b.dat"}


# ---------------------------------------------------------------------------
# 회귀 — 기존 동작(인코딩 무관 파싱, 기본 카운트) 유지 확인
# ---------------------------------------------------------------------------

def test_bdf_bench_counts_elements_and_xref_ok(tmp_path):
    p = tmp_path / "small.bdf"
    p.write_text(SMALL_BDF, encoding="utf-8")
    row = bench(p)
    assert row["ok"] is True
    assert row["nodes"] == 4
    assert row["counts"] == {"CQUAD4": 1, "CBAR": 1}
    assert row["xref_ok"] is True
    assert row["xref_errors"] == []
    assert row["punch"] is False


def test_bdf_bench_cp949_korean_comment_still_parses_cards(tmp_path):
    """회사 콘솔/파일이 cp949 로 저장돼 있어도 카드 데이터는 항상 ASCII 라, 주석이
    깨지더라도(치환 문자) 카드 파싱 결과(노드·요소 수)는 그대로여야 한다."""
    text = SMALL_BDF.replace("ENDDATA", "$ 한글 주석 테스트\nENDDATA")
    p = tmp_path / "korean_cp949.bdf"
    p.write_bytes(text.encode("cp949"))
    row = bench(p)
    assert row["ok"] is True
    assert row["counts"] == {"CQUAD4": 1, "CBAR": 1}
    assert row["nodes"] == 4
    assert row["had_replacement_chars"] is True


def test_main_writes_utf8_json(tmp_path):
    folder = tmp_path / "한글폴더"
    folder.mkdir()
    (folder / "small.bdf").write_text(SMALL_BDF, encoding="utf-8")
    out = tmp_path / "out" / "exp5.json"
    assert main([str(folder), "-o", str(out)]) == 0
    assert "small.bdf" in out.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# 7. 실사 표본(선택) — jungbanBDF_A.bdf 가 로컬에 있을 때만 돈다(기밀 표본,
# 저장소에는 복사하지 않는다. reuse-inventory.md §9 근거: CQUAD4+CTRIA3=27,088).
# ---------------------------------------------------------------------------

JUNGBAN_PATH = Path(
    r"C:\Coding\WorkBench\HiTessWorkBenchBackEnd\InHouseProgram\ModuleOceanMoving"
    r"\JungbanBDF\jungbanBDF_A.bdf"
)


@pytest.mark.skipif(not JUNGBAN_PATH.exists(), reason="사내 표본 BDF 가 이 PC 에 없음")
def test_bench_on_real_jungban_bdf_matches_known_shell_count():
    row = bench(JUNGBAN_PATH)
    assert row["ok"] is True
    total = row["counts"].get("CQUAD4", 0) + row["counts"].get("CTRIA3", 0)
    assert total == 27088
    print(f"\njungbanBDF_A.bdf: parse_sec={row['parse_sec']} size_mb={row['size_mb']}")
