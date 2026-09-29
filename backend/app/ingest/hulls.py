"""호선(4자리) 후보를 이름에서 뽑아 점수·근거와 함께 돌려준다(설계 §5.3).

4자리 숫자는 흔하다(연도·치수·PID). 그래서 단정하지 않고 점수로 제안만 하며,
사람이 정리 대기 화면에서 근거를 보고 확정한다.

날짜(YYYY-MM[-DD] 형태, 199x·20xx 연도만 — 4자리가 전부 연도로 보이는 것은 아니다)는
등록된 호선이 아닌 한 감점한다. 파일명 앞에 촬영·작성 날짜를 붙이는 관행
(`2026.09.28 3496 회의.pptx`)이 흔해서, "이름 맨 앞" 판정은 그 날짜 접두어를 건너뛰고
그 뒤에 오는 진짜 호선 번호를 맨 앞으로 본다(`_effective_leading_start`).

"H3496"·"No.3496"·"HULL 3496"·"3496호선" 처럼 호선임을 명시하는 표기는 숫자의 위치와
무관하게 "이름 맨 앞"과 같은 세기(+3)의 보너스를 받는다.
"""
import re
from dataclasses import dataclass, field
from typing import Iterable

TOKEN = re.compile(r"(?<![0-9])([0-9]{4})(?![0-9])")

# 이 토큰 하나만 놓고 볼 때 날짜(YYYY-MM[-DD])처럼 보이는지 — 연도 자리(199x·20xx)가
# 아니면 애초에 날짜일 수 없으므로 호선 번호(3496 등)는 이 규칙에 걸리지 않는다.
DATE = re.compile(r"^(199\d|20\d\d)[-_.](0[1-9]|1[0-2])(?:[-_.](0[1-9]|[12]\d|3[01]))?(?![0-9])")

# 이름 맨 앞이 날짜 접두어면(구분자까지) 그 뒤를 "맨 앞"으로 친다.
LEADING_DATE_PREFIX = re.compile(
    r"^(199\d|20\d\d)[-_.](0[1-9]|1[0-2])(?:[-_.](0[1-9]|[12]\d|3[01]))?(?![0-9])[-_ .]*"
)
LEADING_SEPARATORS = ("", "-", "_", " ", ".")  # 토큰 바로 뒤에 이 중 하나(또는 끝)면 "맨 앞"

# 명시적 호선 표기 — 숫자 앞뒤에 붙는 표시. (?<![A-Za-z]) 로 다른 단어의 일부(예:
# "Ash3496" 의 "...sh" 끝 h)를 표시로 오인하지 않게 막는다.
MARKER_PREFIX = re.compile(r"(?<![A-Za-z])(?:H|HN|S|No\.?|HULL)\s*$", re.IGNORECASE)
MARKER_SUFFIX = re.compile(r"(?:호선|호)")

MAX_OCCURRENCE_BONUS = 5


@dataclass
class HullCandidate:
    hull_no: str
    score: int = 0
    reasons: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"hull_no": self.hull_no, "score": self.score, "reasons": self.reasons}


def _effective_leading_start(name: str) -> int:
    m = LEADING_DATE_PREFIX.match(name)
    return m.end() if m else 0


def _is_date_like(name: str, start: int) -> bool:
    return bool(DATE.match(name[start:]))


def _has_marker(name: str, start: int, end: int) -> bool:
    return bool(MARKER_PREFIX.search(name[:start])) or bool(MARKER_SUFFIX.match(name[end:]))


def extract_hull_candidates(names: Iterable[str], known: set[str]) -> list[HullCandidate]:
    leading_example: dict[str, str] = {}
    marker_example: dict[str, str] = {}
    date_flags: dict[str, list[bool]] = {}

    for name in dict.fromkeys(names):  # 순서 유지 중복 제거
        eff_start = _effective_leading_start(name)
        for t in TOKEN.finditer(name):
            no = t.group(1)
            is_date = _is_date_like(name, t.start())
            date_flags.setdefault(no, []).append(is_date)

            if not is_date and no not in leading_example:
                tail = name[t.end():t.end() + 1]
                if t.start() == eff_start and tail in LEADING_SEPARATORS:
                    leading_example[no] = name

            if no not in marker_example and _has_marker(name, t.start(), t.end()):
                marker_example[no] = name

    cands = []
    for no, dates in date_flags.items():
        c = HullCandidate(no)
        non_date_count = sum(1 for d in dates if not d)
        all_date = all(dates)  # 이 번호가 등장한 모든 자리가 날짜 문맥이었는가

        if no in leading_example:
            c.score += 3
            c.reasons.append(f"이름 맨 앞: {leading_example[no]}")
        elif no in marker_example:
            c.score += 3
            c.reasons.append(f"호선 표기: {marker_example[no]}")

        if non_date_count:
            c.score += min(non_date_count, MAX_OCCURRENCE_BONUS)
            c.reasons.append(f"이름 {non_date_count}개에 등장")

        if no in known:
            c.score += 2
            c.reasons.append("등록된 호선")
        elif all_date:
            c.score -= 3
            c.reasons.append("날짜처럼 보임")

        if c.score > 0:
            cands.append(c)
    return sorted(cands, key=lambda c: (-c.score, c.hull_no))


def best_hull(cands: list[HullCandidate]) -> str | None:
    if not cands or cands[0].score < 3:
        return None
    if len(cands) > 1 and cands[1].score >= cands[0].score:
        return None
    return cands[0].hull_no
