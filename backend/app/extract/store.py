"""파생 텍스트 캐시 — 20_Derived\\_text\\<sha 앞 2자>\\<sha256>.json.

sha256 기준이라 같은 파일이 여러 번 올라와도 한 번만 추출하고, DB 재구축 때 다시 쓴다.
캐시 쓰기 실패는 추출 자체를 실패시키지 않는다(DB 가 먼저다)."""
import json
import logging
import os
from pathlib import Path

from ..storage.paths import StoragePaths, to_long
from .base import ExtractResult

log = logging.getLogger(__name__)
CACHE_VERSION = 1


def cache_path(storage: StoragePaths, sha256: str) -> Path:
    return storage.derived / "_text" / sha256[:2] / f"{sha256}.json"


def load_cached(storage: StoragePaths, sha256: str) -> ExtractResult | None:
    try:
        with open(to_long(cache_path(storage, sha256)), encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or data.get("version") != CACHE_VERSION:
        return None
    return ExtractResult(chunks=[(loc, text) for loc, text in data.get("chunks", [])],
                         summary=data.get("summary") or {}, truncated=bool(data.get("truncated")))


def save_cached(storage: StoragePaths, sha256: str, r: ExtractResult) -> None:
    p = cache_path(storage, sha256)
    tmp = p.with_name(p.name + ".tmp")
    try:
        os.makedirs(to_long(p.parent), exist_ok=True)
        with open(to_long(tmp), "w", encoding="utf-8") as fh:
            json.dump({"version": CACHE_VERSION, "sha256": sha256, "chunks": r.chunks,
                       "summary": r.summary, "truncated": r.truncated}, fh, ensure_ascii=False)
        os.replace(to_long(tmp), to_long(p))
    except OSError as exc:
        log.warning("파생 텍스트 캐시 쓰기 실패(추출 결과는 DB 에 유지): %s — %s", sha256, exc)
