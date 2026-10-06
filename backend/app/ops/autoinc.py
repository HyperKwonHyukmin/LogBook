"""Entry 번호(자동 증가) 보정(리뷰 I6) — 재구축·덤프 복원 뒤 새 Entry 번호가 예전 번호와 겹치지 않게 한다.

DB 에 없는 번호도 공유 폴더에는 남아 있을 수 있다(영구 삭제 전 휴지통, 초안 폐기 폴더, 감사 로그에 남은 번호,
덤프 이후 확정된 Entry). 그 번호들 중 가장 큰 값 다음으로 entries 의 AUTO_INCREMENT 를 올린다.
같은 번호가 다시 쓰이면 감사 로그·폴더 이름의 EntryID 가 서로 다른 두 건을 가리키게 된다."""
import logging
import os
import re

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from .. import models
from ..storage.paths import StoragePaths, to_long

log = logging.getLogger(__name__)

ENTRY_ID_PATTERN = re.compile(r"^E([0-9]{6,9})$")
YEAR_PATTERN = re.compile(r"^[0-9]{4}$")
TRASH_ID_PATTERN = re.compile(r"^(?:draft_)?E([0-9]{6,9})_")
AUDIT_ID_PATTERN = re.compile(r'"E([0-9]{6,9})"')
LOCK_WAIT_SECONDS = 30


def _dirs(path) -> list[str]:
    try:
        with os.scandir(to_long(path)) as it:
            return sorted(e.name for e in it if e.is_dir())
    except OSError:
        return []


def scan_entry_numbers(storage: StoragePaths) -> tuple[int, set[str]]:
    """공유 폴더에서 본 가장 큰 Entry 번호와 Vault 의 EntryID 목록을 돌려준다."""
    top = 0
    vault_ids: set[str] = set()
    for year in _dirs(storage.vault):
        if not YEAR_PATTERN.fullmatch(year):
            continue
        for name in _dirs(storage.vault / year):
            m = ENTRY_ID_PATTERN.fullmatch(name)
            if m:
                vault_ids.add(name)
                top = max(top, int(m.group(1)))
    for name in _dirs(storage.trash):
        m = TRASH_ID_PATTERN.match(name)
        if m:
            top = max(top, int(m.group(1)))
    try:
        audit_files = sorted(n for n in os.listdir(to_long(storage.audit_dir)) if n.endswith(".jsonl"))
    except OSError:
        audit_files = []
    for name in audit_files:
        try:
            with open(to_long(storage.audit_dir / name), encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    for m in AUDIT_ID_PATTERN.finditer(line):
                        top = max(top, int(m.group(1)))
        except OSError:
            log.warning("감사 로그를 읽지 못함(번호 보정에서 제외): %s", name)
    return top, vault_ids


def fix_autoinc(db: Session, storage: StoragePaths) -> dict:
    """entries 의 AUTO_INCREMENT 를 (공유 폴더·DB 에서 본 최대 번호 + 1) 로 올린다.

    Vault 에는 있는데 DB 에 없는 Entry 는 missing_in_db 로 돌려준다(덤프 이후 확정된 것 — 사람이 판단)."""
    seen_max, vault_ids = scan_entry_numbers(storage)
    db_max = db.query(func.max(models.Entry.id)).scalar() or 0
    next_id = max(seen_max, db_max) + 1
    in_db = {e for (e,) in db.query(models.Entry.entry_id).filter(models.Entry.entry_id.in_(vault_ids))} \
        if vault_ids else set()
    db.commit()
    if db.get_bind().dialect.name == "mysql":
        # 현재 최대 id 보다 작은 값은 MySQL 이 무시한다(줄어들지 않는다). DDL 이라 바로 확정된다.
        # ALTER 는 표의 메타데이터 잠금을 기다린다 — 다른 연결(API 등)이 entries 를 읽는 트랜잭션을 열어 두면
        # 기본값(1년) 동안 멈추므로 기다림을 LOCK_WAIT_SECONDS 로 줄인다. 넘으면 OperationalError 로 끝난다.
        db.execute(text(f"SET SESSION lock_wait_timeout = {LOCK_WAIT_SECONDS}"))
        try:
            db.execute(text(f"ALTER TABLE entries AUTO_INCREMENT = {int(next_id)}"))
        finally:
            db.execute(text("SET SESSION lock_wait_timeout = DEFAULT"))
        db.commit()
    return {"next_id": next_id, "seen_max": seen_max, "db_max": db_max,
            "missing_in_db": sorted(vault_ids - in_db)}
