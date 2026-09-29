import pytest

from app.ingest.hulls import best_hull, extract_hull_candidates


def _nos(cands):
    return [c.hull_no for c in cands]


def test_leading_number_with_separator_scores_high():
    cands = extract_hull_candidates(["3496-35210-A508372_20260108_edit.bdf"], known=set())
    assert cands[0].hull_no == "3496"
    assert cands[0].score >= 3
    assert any("맨 앞" in r for r in cands[0].reasons)


def test_repeated_across_names_accumulates():
    names = ["3496_Mooring", "3496_Mooring_FWD.bdf", "3496 검토보고서.pptx"]
    top = extract_hull_candidates(names, known=set())[0]
    assert top.hull_no == "3496" and top.score >= 3 + 3


def test_digits_inside_longer_numbers_are_ignored():
    assert extract_hull_candidates(["20260108.bdf", "A508372.f06"], known=set()) == []


def test_date_context_penalized_unless_known():
    cands = extract_hull_candidates(["2026-09 회의자료.pdf"], known=set())
    assert "2026" not in _nos(cands)
    known = extract_hull_candidates(["2026-09 회의자료.pdf"], known={"2026"})
    assert "2026" in _nos(known)


def test_known_hull_bonus():
    a = extract_hull_candidates(["검토 3370 모델.bdf"], known=set())[0]
    b = extract_hull_candidates(["검토 3370 모델.bdf"], known={"3370"})[0]
    assert b.score == a.score + 2


def test_best_hull_requires_score_and_margin():
    assert best_hull(extract_hull_candidates(["3496_a.bdf"], known=set())) == "3496"
    tie = extract_hull_candidates(["3496_a.bdf", "3370_b.bdf"], known=set())
    assert best_hull(tie) is None
    assert best_hull(extract_hull_candidates(["모델 3496.bdf"], known=set())) is None  # 점수 부족


# --- 회귀 테스트(2026-09-29 리뷰) — 실제 이름 패턴에서 3496 을 잃지 않아야 한다 ---

def test_underscore_separated_sequence_prefix_keeps_hull():
    assert best_hull(extract_hull_candidates(["3496_01_검토"], known=set())) == "3496"


def test_hyphen_suffix_keeps_hull():
    assert best_hull(extract_hull_candidates(["3496-09 x"], known=set())) == "3496"


def test_folder_with_sequence_numbered_files_keeps_hull():
    names = ["3496_Mooring", "3496_01_model.bdf", "3496_02_model.f06", "3496_03_report.pdf"]
    assert best_hull(extract_hull_candidates(names, known=set())) == "3496"


def test_hull_after_leading_date_is_still_found():
    cands = extract_hull_candidates(["2026.09.28 3496 회의"], known=set())
    assert best_hull(cands) == "3496"
    assert "2026" not in _nos(cands)


def test_hull_folder_survives_alongside_unrelated_date_file():
    cands = extract_hull_candidates(["2026_10_01.pdf", "3496"], known=set())
    assert best_hull(cands) == "3496"
    assert "2026" not in _nos(cands)


@pytest.mark.parametrize("name", ["H3496", "3496호선", "No.3496", "HULL 3496"])
def test_explicit_hull_markers_score_as_leading(name):
    assert best_hull(extract_hull_candidates([name], known=set())) == "3496"


def test_marker_prefix_does_not_match_inside_another_word():
    # "Ash3496" — 's' 바로 앞에 알파벳('h')이 있으니 그 's' 를 "S" 표시로 오인하면
    # 안 된다(리뷰 지적: MARKER_PREFIX 에 (?<![A-Za-z]) 없으면 마지막 글자 'h' 가
    # "H" 표시로도 잘못 매치된다).
    cands = extract_hull_candidates(["Ash3496 dwg"], known=set())
    assert best_hull(cands) is None  # 등장(1)만으로는 점수 부족(<3)
