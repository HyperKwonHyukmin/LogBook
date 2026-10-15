"""entry.json 재동기화(리뷰 8) — 공유 폴더의 재구축 원천이 DB 보다 낡았거나 빠진 Entry 를 다시 쓴다.

entry.json 쓰기는 요청 흐름에서 실패해도 확정·수정을 되돌리지 않고 write_meta 작업으로 넘긴다. 그 작업마저
끝내 실패하면(긴 SMB 장애) 파일이 빠지거나 낡은 채로 남고, 재구축이 그 Entry 를 건너뛴다(skipped_bad).
매일 작업이 이 함수로 한 번 훑어 메운다. 읽기는 entry.json 의 version 한 값뿐이라 가볍다.

- 확정: entry.json 이 없거나 깨졌거나 기록된 version 이 DB 보다 낮으면 다시 쓴다.
- 휴지통: 폴더 안 entry.json 이 없거나 깨졌을 때만 쓴다 — 휴지통 이동은 version 을 올리지만 entry.json 은
  확정 때의 내용(재구축이 그것으로 휴지통 Entry 를 되살린다)이라 낮은 것이 정상이다.
- Entry 폴더 자체가 없으면 쓰지 않는다(빈 폴더를 새로 만들면 파일 없는 가짜 자료가 된다) — `cli verify` 가 보고한다.
"""
import json
import logging
import os
from pathlib import Path, PurePosixPath
from typing import Callable

from sqlalchemy.orm import Session

from .. import models
from ..entries.files import write_entry_files
from ..storage.paths import StoragePaths, to_long

log = logging.getLogger(__name__)

RESYNC_LIMIT = 500          # 한 번에 다시 쓰는 최대 Entry 수(장애 뒤 몰려도 일일 작업이 오래 붙잡히지 않게)
BEAT_EVERY = 500            # 이만큼 훑을 때마다 박동(수만 건이면 몇 분 걸린다)
GIVE_UP_AFTER = 5           # 연달아 이만큼 쓰기에 실패하면 공유 폴더가 죽은 것으로 보고 멈춘다


def _stored_version(folder: Path) -> int | None:
    """entry.json 의 version. 없거나 깨졌으면 None."""
    try:
        with open(to_long(folder / "entry.json"), encoding="utf-8") as fh:
            data = json.load(fh)
        return int(data.get("version") or 0) if isinstance(data, dict) else None
    except (OSError, ValueError, TypeError):
        return None


def _folder(storage: StoragePaths, status: str, vault_rel: str, trash_rel: str | None) -> Path | None:
    if status == "confirmed":
        return storage.vault / Path(*PurePosixPath(vault_rel).parts)
    return storage.trash / trash_rel if trash_rel else None


def resync_entry_meta(db: Session, storage: StoragePaths, *, limit: int = RESYNC_LIMIT,
                      beat: Callable[[], None] | None = None) -> dict:
    result = {"scanned": 0, "rewritten": 0, "failed": 0, "no_folder": 0}
    rows = (db.query(models.Entry.id, models.Entry.status, models.Entry.vault_rel, models.Entry.trash_rel,
                     models.Entry.version)
            .filter(models.Entry.status.in_(("confirmed", "trashed")), models.Entry.vault_rel.isnot(None))
            .order_by(models.Entry.id).all())
    streak = 0
    for eid, status, vault_rel, trash_rel, version in rows:
        if result["rewritten"] >= limit or streak >= GIVE_UP_AFTER:
            break
        result["scanned"] += 1
        if beat is not None and result["scanned"] % BEAT_EVERY == 0:
            beat()
        folder = _folder(storage, status, vault_rel, trash_rel)
        if folder is None or not os.path.isdir(to_long(folder)):
            result["no_folder"] += 1
            continue
        stored = _stored_version(folder)
        stale = stored is None or (status == "confirmed" and stored < (version or 0))
        if not stale:
            continue
        entry = db.get(models.Entry, eid)
        try:
            # 확정이면 기본 자리(Vault), 휴지통이면 그 폴더에 쓴다
            write_entry_files(db, storage, entry, base=None if status == "confirmed" else folder)
            result["rewritten"] += 1
            streak = 0
        except OSError as exc:
            result["failed"] += 1
            streak += 1
            log.warning("entry.json 재동기화 실패: %s (%s)", entry.entry_id if entry else eid, exc)
    if streak >= GIVE_UP_AFTER:
        log.warning("entry.json 재동기화 — 연달아 %d번 실패해 멈춤(공유 폴더 확인)", streak)
    db.rollback()   # 읽기만 했다 — 세션이 잡은 스냅숏을 놓는다
    return result

