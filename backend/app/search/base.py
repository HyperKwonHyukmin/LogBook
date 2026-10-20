"""검색 인터페이스(설계 §6.2 — 나중에 Meilisearch 로 바꿀 때 구현만 교체한다)."""
from dataclasses import dataclass, field
from typing import Protocol

from sqlalchemy.orm import Session

# 15 — '해석 연도'(year) 필터는 해석 시기와 함께 없앴다
# 29 — 프로젝트(21) 필터는 없앴다
# 38 — 대상 구조물(target). 42 — 해석 종류(analysis_type) 필터는 없앴다
FILTER_KEYS = ("hull", "ship_type", "zone", "target", "uploaded_by", "kind", "tag")
# 관련도 | 최신순(올린 날짜, 15) | 즐겨찾기한 순(10) | 호선순·제목순(19)
SORTS = ("relevance", "recent", "favorited", "hull", "title")
# 옛 주소의 정렬 이름 → 지금 이름(15 — '해석 시기' 정렬은 최신순으로 받는다)
SORT_ALIASES = {"period": "recent"}
# 11 — '보기 기준'(묶어 보기). 값이 없는 Entry 의 묶음은 GROUP_NONE 으로 가리킨다(화면: 없음/미상)
GROUP_KEYS = ("hull", "zone", "target", "uploaded_by", "tag")   # 19 — 태그별, 38 — 대상별, 42 — 해석 종류별은 없앴다
GROUP_SORTS = ("count", "name")
GROUP_NONE = "__none__"
# 20 — 호선별 묶기에서 '호선 없음(공용)' 을 고른 자료의 묶음(화면: 공용). 값이 빈 '호선 없음' 묶음과 따로 둔다
GROUP_SHARED = "__shared__"
# 19 — 한 칸에 여러 값(같은 칸 안은 OR, 칸끼리는 AND). 한 칸에 받는 값 수 상한
MAX_FILTER_VALUES = 50


def filter_values(value) -> list[str]:
    """필터 칸 하나의 값 목록 — 옛 호출(문자열 하나)과 새 호출(목록)을 함께 받는다(19). 빈 값·중복은 뺀다."""
    if value is None:
        return []
    items = [value] if isinstance(value, str) else list(value)
    out = []
    for v in items:
        v = str(v).strip() if v is not None else ""
        if v and v not in out:
            out.append(v)
    return out[:MAX_FILTER_VALUES]


@dataclass
class SearchQuery:
    q: str = ""
    unit: str = "entry"               # entry | file
    filters: dict = field(default_factory=dict)   # 칸 → 값 하나(str) 또는 값 목록(19, 같은 칸 안은 OR)
    include_drafts: bool = False
    limit: int = 50
    offset: int = 0
    sort: str | None = None           # None = 검색어가 있으면 relevance, 없으면 recent
    viewer: str | None = None         # 10 — 행마다 '내 즐겨찾기인가'(favorite) 를 붙일 사용자
    favorites_of: str | None = None   # 10 — 이 사용자의 즐겨찾기만(휴지통 제외, 미확정 포함)
    # 13 — 요청한 사용자(models.User). 볼 수 없는 Entry 를 SQL 단계에서 뺀다(목록·건수·묶음·요약 모두).
    # None 이면 아무것도 보이지 않는다(안전한 기본값) — API 는 반드시 넘긴다
    user: object | None = None
    # 11 — 묶어 보기(문서 보기에서만). group_value 가 있으면 그 묶음 하나의 행을 limit/offset 으로(더 보기)
    group: str | None = None
    group_value: str | None = None
    group_sort: str = "count"
    group_rows: int = 5               # 묶음마다 처음에 보이는 행 수
    group_limit: int = 30             # 한 번에 돌려주는 묶음 수
    group_offset: int = 0


class SearchBackend(Protocol):
    def search(self, db: Session, query: SearchQuery) -> dict: ...

    def browse(self, db: Session, include_drafts: bool = False, user=None) -> dict: ...
