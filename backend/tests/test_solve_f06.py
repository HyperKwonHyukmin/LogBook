"""f06 판정·오류 유형 분류(06 §3). 실측 f06(MSC Nastran 2013.1, 이 PC)은 tests/fixtures/solve_f06/ 에 줄였다."""
from pathlib import Path

import pytest

from app.solve.f06 import error_result, judge

FIX = Path(__file__).parent / "fixtures" / "solve_f06"


def _f06(name: str) -> str:
    return (FIX / f"{name}.f06").read_text(encoding="latin-1")


def test_pass_counts_warnings():
    v = judge(_f06("pass"))
    assert v["state"] == "pass" and v["fatals"] == [] and v["error_types"] == []
    assert v["warning_count"] == 1          # 9058 (하중이 0) — 실측
    assert v["message"] is None


@pytest.mark.parametrize("name, code, kind", [
    ("mech", 9050, "mechanism"),
    ("rbedup", 5289, "rbe_dependent_dup"),
    ("undefgrid", 2007, "undefined_ref"),
    ("undefmat", 2042, "undefined_ref"),
    ("undefpid", 6440, "undefined_ref"),
    ("format", 9994, "card_format"),
    ("unknowncard", 307, "card_format"),
    ("nege", 9994, "property_value"),
    ("badgeom", 4296, "bad_geometry"),
    ("zerolen", 9994, "bad_geometry"),
    ("pbeaml_api", 6498, "property_value"),    # 6498 이 원인(6623)을 본문에 싣고 6624·9002 만 따라온다
])
def test_real_fatals(name, code, kind):
    v = judge(_f06(name))
    assert v["state"] == "fail"
    assert v["fatals"][0]["code"] == code and v["fatals"][0]["type"] == kind
    assert v["error_types"][0] == kind
    # 연쇄 메시지(208·102·9002)는 원인 FATAL 이 있으면 빠진다
    assert not {f["code"] for f in v["fatals"]} & {208, 102, 9002}
    assert all(len(f["message"]) <= 300 for f in v["fatals"])


def test_fatal_message_text():
    v = judge(_f06("rbedup"))
    # 같은 메시지 6건(성분 1~6) — 최대 5건만 남긴다
    assert len(v["fatals"]) == 5 and v["error_types"] == ["rbe_dependent_dup"]
    assert v["fatals"][0]["message"].startswith("DEPENDENT DEGREE-OF-FREEDOM GRID ID =1")
    v = judge(_f06("nege"))
    # 9994 의 첫 줄('MAT1 with MID=1 near line 14')만으로는 뜻이 없어 다음 줄을 잇는다
    assert "MAT1 with MID=1" in v["fatals"][0]["message"] and "E:-206000." in v["fatals"][0]["message"]
    assert v["message"].startswith("FATAL 9994")
    v = judge(_f06("pbeaml_api"))
    # 6498 은 'API MESSAGE FOLLOWS.' 대신 실린 원인 문구를 보인다
    assert [f["code"] for f in v["fatals"]] == [6498]
    assert v["fatals"][0]["message"].startswith('ERROR DETECTED WHILE PROCESSING A "PBEAML"')
    assert "CAN NOT BE LESS THAN WIDTH" in v["fatals"][0]["message"]


SYN_2101 = """\
 *** USER FATAL MESSAGE 2101A (GP4)
     GRID POINT       12 COMPONENT 1 ILLEGALLY DEFINED IN SETS   UM  M
 *** USER FATAL MESSAGE 2101 (GP4)
     DEPENDENT DEGREE OF FREEDOM 12 COMPONENT 1 IS LISTED MORE THAN ONCE
1                                        * * * END OF JOB * * *
"""

SYN_LICENSE = """\
 *** SYSTEM FATAL MESSAGE 3060 (OPTCNT)
     SUBROUTINE OPTCNT - OPTION NAST NOT IN APPROVED LIST.
     SYSTEM DATE (MM/DD/YY) 10/06/26
1                                        * * * END OF JOB * * *
"""

SYN_OTHER = """\
 *** SYSTEM FATAL MESSAGE 1234 (XYZ)
     SOMETHING STRANGE HAPPENED
1                                        * * * END OF JOB * * *
"""


def test_synthetic_2101_and_cascade_only():
    v = judge(SYN_2101)
    assert v["state"] == "fail" and v["error_types"] == ["rbe_dependent_dup"]
    v = judge(" *** USER FATAL MESSAGE 9002 (SUBDMAP IFPS)\n     ERROR(S) ENCOUNTERED IN THE MAIN BULK DATA\n"
              "1                                        * * * END OF JOB * * *\n")
    # 연쇄 코드만 있으면 그것이라도 남긴다
    assert v["state"] == "fail" and v["fatals"][0]["code"] == 9002


def test_other_fatal():
    v = judge(SYN_OTHER)
    assert v["state"] == "fail" and v["error_types"] == ["other"] and v["fatals"][0]["code"] == 1234


def test_license_is_error_not_fail():
    v = judge(SYN_LICENSE)
    assert v["state"] == "error" and v["error_types"] == ["license"]
    v = judge(None, log_text="MSC Authorization Information - Checkout Failed (1018, 0)\nlicense not available")
    assert v["state"] == "error" and v["error_types"] == ["license"]


def test_header_copyright_is_not_license():
    # 모든 f06 머리의 'Unauthorized use … licensors' 문구로 라이선스 실패라 하지 않는다
    v = judge("  Unauthorized use, reproduction ... its licensors. All rights reserved.\n" + _f06("pass"))
    assert v["state"] == "pass"


def test_missing_empty_and_unfinished_f06():
    assert judge(None)["error_types"] == ["no_f06"]
    assert judge("")["error_types"] == ["no_f06"]
    v = judge(" *** USER WARNING MESSAGE 9058 (SUBDMAP SESTATIC)\n     LOADS ARE ZERO\n")  # 끝나지 않음
    assert v["state"] == "error" and v["error_types"] == ["no_f06"]


def test_timeout_wins():
    v = judge(_f06("pass"), timed_out=True)
    assert v["state"] == "error" and v["error_types"] == ["timeout"]


def test_error_result_shape():
    r = error_result("nastran_missing", "Nastran 실행 파일 없음")
    assert r == {"state": "error", "error_types": ["nastran_missing"], "fatals": [], "warning_count": None,
                 "message": "Nastran 실행 파일 없음"}
