"""검색 모듈(설계 §6.2). 호출자는 get_search() 만 쓴다 — 구현(MySQL/Meilisearch)은 이 뒤에 숨는다."""
from .base import FILTER_KEYS, SearchBackend, SearchQuery
from .mysql_backend import MySqlSearch

_backend: SearchBackend = MySqlSearch()


def get_search() -> SearchBackend:
    return _backend


__all__ = ["FILTER_KEYS", "SearchBackend", "SearchQuery", "get_search"]
