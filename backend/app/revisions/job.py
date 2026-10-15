"""revision_diff 작업(14 B) — 두 모델 파일을 읽어 비교하고 revision_diffs 에 남긴다.

원본 불변: 원본은 'rb' 로 읽기만 한다. 상세(ID 목록·문장)는 파생 폴더 `20_Derived/_diff/<k[:2]>/<k>.rdiff`
(gzip JSON, k = sha256(key_a:key_b:v<VERSION>)). 확장자를 .gz·.json 이 아닌 것으로 둔 것은 사내 DRM 이 감싸는 형식을 피하려고다.

캐시: 행의 key_a·key_b(비교한 원본 바이트 sha = model_summaries.key)·rule_version 이 지금 값과 같으면 그대로 쓴다.
다르면 낡은 결과(stale) — 다시 대기열에 넣는다. 다른 파일 쌍이라도 같은 key 두 개·같은 버전의 끝난 결과가 있으면 옮겨 쓴다.
"""
import gc
import gzip
import hashlib
import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Callable

from sqlalchemy import true
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import jobs, models
from ..bdf.deck import DeckReader, DeckTooLarge
from ..convert.job import MAX_MODEL_BYTES, EncryptedFile, _opener, _root, _write
from ..entries.locate import FileUnavailable
from ..storage.paths import StoragePaths, to_long
from .diff import VERSION, compare, read_facts

log = logging.getLogger(__name__)
JOB_TYPE = "revision_diff"
ACTIVE = ("queued", "running")


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def detail_key(key_a: str, key_b: str, version: int = VERSION) -> str:
    return hashlib.sha256(f"{key_a}:{key_b}:v{version}".encode()).hexdigest()


def detail_path(storage: StoragePaths, key_a: str, key_b: str, version: int = VERSION) -> Path:
    k = detail_key(key_a, key_b, version)
    return storage.derived / "_diff" / k[:2] / f"{k}.rdiff"


def _summaries(db: Session, a: int, b: int):
    return db.get(models.ModelSummary, a), db.get(models.ModelSummary, b)


def _ready(s: models.ModelSummary | None) -> bool:
    return bool(s is not None and s.state == "done" and s.key)


def is_stale(row: models.RevisionDiff, sa: models.ModelSummary | None, sb: models.ModelSummary | None) -> bool:
    """비교한 원본·규칙과 지금 값이 다른가 — 변환 결과(key)가 바뀌었거나 규칙 버전이 올랐다."""
    if row.rule_version != VERSION:
        return True
    return not (_ready(sa) and _ready(sb) and row.key_a == sa.key and row.key_b == sb.key)


# ── 대기열 ────────────────────────────────────────────────────────────────

def find(db: Session, a: int, b: int) -> models.RevisionDiff | None:
    return db.query(models.RevisionDiff).filter_by(file_a=a, file_b=b).first()


def ensure(db: Session, a: int, b: int, *, requested_by: str | None = None, retry: bool = False,
           commit: bool = True) -> models.RevisionDiff | None:
    """두 파일 비교를 마련한다 — 캐시가 맞으면 그 행, 아니면 대기열에 넣은 행. 두 모델 변환이 안 끝났으면 None.

    retry=True 이면 실패(error) 행도 다시 넣는다(사용자 요청). 자동 확보(판 목록)는 실패를 되풀이하지 않는다."""
    sa, sb = _summaries(db, a, b)
    if not (_ready(sa) and _ready(sb)):
        return None
    row = find(db, a, b)
    if row is not None and not is_stale(row, sa, sb):
        if row.state in ACTIVE or row.state == "done" or (row.state == "error" and not retry):
            return row
    if row is None:
        row = models.RevisionDiff(file_a=a, file_b=b)
        db.add(row)
    row.key_a, row.key_b, row.rule_version = sa.key, sb.key, VERSION
    row.summary, row.error, row.elapsed, row.finished_at = None, None, None, None
    row.requested_by, row.requested_at = requested_by, _now()
    # 같은 내용 쌍의 끝난 결과가 있으면 계산 없이 옮겨 쓴다(상세 파일은 key 로 같은 자리)
    same = (db.query(models.RevisionDiff)
            .filter(models.RevisionDiff.key_a == sa.key, models.RevisionDiff.key_b == sb.key,
                    models.RevisionDiff.rule_version == VERSION, models.RevisionDiff.state == "done",
                    (models.RevisionDiff.id != row.id) if row.id else true())
            .first())
    if same is not None:
        row.state, row.summary, row.elapsed, row.finished_at = "done", same.summary, 0.0, _now()
    else:
        row.state = "queued"
    try:
        db.flush()
    except IntegrityError:          # 다른 요청이 같은 쌍을 막 만들었다
        db.rollback()
        return find(db, a, b)
    if row.state == "queued":
        jobs.enqueue(db, JOB_TYPE, row.id)
    if commit:
        db.commit()
    return row


# ── 응답 모양 ──────────────────────────────────────────────────────────────

def describe(row: models.RevisionDiff | None, sa, sb) -> dict:
    """비교 상태 — state: None(요청 없음)|queued|running|done|error|waiting(변환 대기), stale(낡음)."""
    if row is None:
        # 두 모델 변환이 끝나지 않았으면 '변환 대기'(요청해도 409), 끝났으면 아직 요청 없음
        return {"id": None, "state": None if (_ready(sa) and _ready(sb)) else "waiting", "summary": None,
                "error": None, "stale": False}
    return {"id": row.id, "file_a": row.file_a, "file_b": row.file_b, "state": row.state,
            "summary": row.summary if row.state == "done" else None, "error": row.error,
            "stale": is_stale(row, sa, sb),
            "elapsed": row.elapsed, "finished_at": row.finished_at.isoformat() if row.finished_at else None}


# ── 실행 ──────────────────────────────────────────────────────────────────

def _error(db: Session, row: models.RevisionDiff, code: str, started: float) -> None:
    row.state, row.error = "error", code[:500]
    row.summary = None
    row.elapsed = round(time.monotonic() - started, 2)
    row.finished_at = _now()
    db.commit()


def mark_failed(db: Session, diff_id: int, error: str) -> None:
    """재시도 끝 최종 실패(워커가 부른다) — queued/running 으로 남지 않게."""
    row = db.get(models.RevisionDiff, diff_id)
    if row is None:
        return
    row.state, row.error, row.finished_at = "error", f"비교 작업 실패: {error}"[:500], _now()
    db.commit()


def _facts(db: Session, storage: StoragePaths, f: models.File):
    # 수십만 개의 작은 객체를 만드는 동안 순환 GC 를 끈다(합성 40만 카드 실측 읽기·간추리기 약 25% 빨라짐)
    enabled = gc.isenabled()
    gc.disable()
    try:
        reader = DeckReader(_opener(_root(db, storage, f)), max_bytes=MAX_MODEL_BYTES)
        cards = reader.read(f.rel_path)
        facts = read_facts(cards, reader.control, reader.sol)
        digest = reader.digest
        del cards, reader      # 카드 목록을 바로 놓는다 — 두 모델의 카드를 함께 들지 않는다
    finally:
        if enabled:
            gc.enable()
    return facts, digest


def run_revision_diff(db: Session, storage: StoragePaths, diff_id: int, *,
                      heartbeat: Callable[[], None] | None = None) -> None:
    row = db.get(models.RevisionDiff, diff_id)
    if row is None:
        return
    started = time.monotonic()
    beat = heartbeat or (lambda: None)
    fa, fb = db.get(models.File, row.file_a), db.get(models.File, row.file_b)
    if fa is None or fb is None or fa.location == "trash" or fb.location == "trash":
        return _error(db, row, "file_missing", started)
    sa, sb = _summaries(db, fa.id, fb.id)
    if not (_ready(sa) and _ready(sb)):
        return _error(db, row, "model_not_ready", started)
    row.state = "running"
    db.commit()
    try:
        a, key_a = _facts(db, storage, fa)
        beat()
        b, key_b = _facts(db, storage, fb)
        beat()
    except FileUnavailable as exc:
        return _error(db, row, f"file_missing: {exc}", started)
    except EncryptedFile:
        return _error(db, row, "drm", started)
    except DeckTooLarge:
        return _error(db, row, "too_large", started)
    except MemoryError:
        return _error(db, row, "memory_error", started)
    # 그 밖의 OSError(파일 없음·잠김)는 위로 — 작업 큐가 재시도한다
    try:
        summary, detail = compare(a, b)
    except MemoryError:
        a = b = None
        return _error(db, row, "memory_error", started)
    del a, b
    beat()
    data = gzip.compress(json.dumps(detail, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), 6)
    _write(detail_path(storage, key_a, key_b), data)   # 실패(OSError)는 위로 — 재시도
    row.key_a, row.key_b, row.rule_version = key_a, key_b, VERSION
    row.state, row.summary, row.error = "done", summary, None
    row.elapsed = round(time.monotonic() - started, 2)
    row.finished_at = _now()
    db.commit()
    log.info("판 비교: diff=%s file %s → %s (%.1fs)", row.id, fa.id, fb.id, row.elapsed)


def read_detail(storage: StoragePaths, row: models.RevisionDiff) -> bytes | None:
    """상세 gzip 바이트(없으면 None) — 그대로 내려보낸다(Content-Encoding: gzip)."""
    if row.state != "done" or not row.key_a or not row.key_b:
        return None
    try:
        with open(to_long(detail_path(storage, row.key_a, row.key_b, row.rule_version or VERSION)), "rb") as fh:
            return fh.read()
    except FileNotFoundError:
        return None
