"""검색 인터페이스(설계 §6.2 — 나중에 Meilisearch 로 바꿀 때 구현만 교체한다)."""
from dataclasses import dataclass, field
from typing import Protocol

from sqlalchemy.orm import Session

FILTER_KEYS = ("hull", "ship_type", "analysis_type", "zone", "year", "uploaded_by", "kind", "tag")
SORTS = ("relevance", "period", "recent")   # 관련도 | 해석 시기 | 최근 등록(08)
YEAR_UNKNOWN = "unknown"                    # 해석 시기가 없는 Entry 의 '해석 연도' 값(화면: 시기 미상)


@dataclass
class SearchQuery:
    q: str = ""
    unit: str = "entry"               # entry | file
    filters: dict = field(default_factory=dict)
    include_drafts: bool = False
    limit: int = 50
    offset: int = 0
    sort: str | None = None           # None = 검색어가 있으면 relevance, 없으면 period


class SearchBackend(Protocol):
    def search(self, db: Session, query: SearchQuery) -> dict: ...
