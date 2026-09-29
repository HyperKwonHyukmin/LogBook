"""검색 인터페이스(설계 §6.2 — 나중에 Meilisearch 로 바꿀 때 구현만 교체한다)."""
from dataclasses import dataclass, field
from typing import Protocol

from sqlalchemy.orm import Session

FILTER_KEYS = ("hull", "ship_type", "analysis_type", "zone", "year", "uploaded_by", "kind")


@dataclass
class SearchQuery:
    q: str = ""
    unit: str = "entry"               # entry | file
    filters: dict = field(default_factory=dict)
    include_drafts: bool = False
    limit: int = 50
    offset: int = 0


class SearchBackend(Protocol):
    def search(self, db: Session, query: SearchQuery) -> dict: ...
