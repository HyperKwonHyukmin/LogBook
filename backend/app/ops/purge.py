"""휴지통 영구 삭제(설계 §8) — 90일 지난 것은 매일 자동으로, 관리자는 수동으로.

순서: 95_Trash 폴더를 먼저 지운다 → DB 행을 지운다 → 감사 기록(이때 한 번에 커밋).
폴더 삭제가 실패하면 DB 는 건드리지 않는다(다음에 다시 시도할 수 있게)."""
import logging
import os
import shutil
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import audit, models
from ..entries.service import _clear_dangling_references
from ..storage.paths import StoragePaths, long_join

log = logging.getLogger(__name__)


def purge_entry(db: Session, storage: StoragePaths, entry: models.Entry, actor: str, ip: str | None = None,
                *, older_than: datetime | None = None) -> None:
    """휴지통 Entry 하나를 영구 삭제한다.

    복원(restore)과 겹칠 수 있어(리뷰 I2) 먼저 Entry 행을 잠그고 잠근 뒤의 최신 상태로 다시 확인한다 —
    잠그기 전에 본 값(호출자가 들고 있던 객체)으로 판단하면, 그 사이 복원돼 Vault 로 돌아간 Entry 를 지울 수 있다.
    older_than 을 주면(자동 비우기) 잠근 뒤의 updated_at 도 다시 본다."""
    seen_rel = entry.trash_rel
    locked = db.get(models.Entry, entry.id, with_for_update=True, populate_existing=True)
    if locked is None:
        raise HTTPException(status_code=404, detail="entry_not_found")
    entry = locked
    if entry.status != "trashed" or not entry.trash_rel or entry.trash_rel != seen_rel:
        db.rollback()
        raise HTTPException(status_code=409, detail="not_trashed")
    if older_than is not None and entry.updated_at > older_than:
        db.rollback()
        raise HTTPException(status_code=409, detail="not_expired")
    try:
        folder = long_join(storage.trash, entry.trash_rel)
        if os.path.exists(folder):
            shutil.rmtree(folder)
    except (OSError, ValueError) as exc:
        db.rollback()
        log.warning("휴지통 폴더 삭제 실패: %s — %s", entry.trash_rel, exc)
        raise HTTPException(status_code=503, detail="storage_error")
    file_ids = [i for (i,) in db.query(models.File.id).filter_by(entry_id=entry.id)]
    before = {"title": entry.title, "files": len(file_ids), "trash_rel": entry.trash_rel}
    if file_ids:
        # 다른 파일이 이 파일들을 중복 원본으로 가리키면 FK 위반이 난다 — 참조만 비운다
        db.query(models.File).filter(models.File.duplicate_of_id.in_(file_ids)).update(
            {"duplicate_of_id": None}, synchronize_session=False)
        for model in (models.FileText, models.FileExtract, models.ModelSummary):
            db.query(model).filter(model.file_id.in_(file_ids)).delete(synchronize_session=False)
        db.query(models.DownloadToken).filter(models.DownloadToken.file_id.in_(file_ids)).delete(
            synchronize_session=False)
        # 이 파일들의 작업은 대상이 없어지므로 상태와 상관없이 지운다(실패 목록에 '#id' 로 남지 않게)
        db.query(models.Job).filter(models.Job.type.in_(("extract_file", "convert_model")),
                                    models.Job.target_id.in_(file_ids)).delete(synchronize_session=False)
        db.query(models.File).filter(models.File.id.in_(file_ids)).delete(synchronize_session=False)
    db.query(models.Job).filter(models.Job.type == "write_meta",
                                models.Job.target_id == entry.id).delete(synchronize_session=False)
    db.query(models.EntryHull).filter_by(entry_id=entry.id).delete(synchronize_session=False)
    db.query(models.EntryTag).filter_by(entry_id=entry.id).delete(synchronize_session=False)
    _clear_dangling_references(db, entry.id)
    entry_id = entry.entry_id
    db.delete(entry)
    db.flush()
    audit.record(db, storage, actor=actor, action="TRASH_PURGE", target_type="entry", target_id=entry_id,
                 before=before, ip=ip)


def purge_expired(db: Session, storage: StoragePaths, days: int, now: datetime | None = None) -> int:
    """휴지통에 들어간 지(updated_at) days 일이 지난 Entry 를 모두 영구 삭제한다. 하나가 실패해도 계속한다."""
    limit = (now or datetime.now()) - timedelta(days=days)
    ids = [i for (i,) in db.query(models.Entry.id)
           .filter(models.Entry.status == "trashed", models.Entry.updated_at <= limit).order_by(models.Entry.id)]
    n = 0
    for pk in ids:
        e = db.get(models.Entry, pk)
        if e is None:
            continue
        label = e.entry_id
        try:
            purge_entry(db, storage, e, "system", older_than=limit)
            n += 1
        except HTTPException as exc:
            db.rollback()
            if exc.status_code == 409 or exc.status_code == 404:
                log.info("휴지통 자동 비우기 건너뜀(그 사이 복원·변경됨): %s — %s", label, exc.detail)
            else:
                log.warning("휴지통 자동 비우기 실패: %s — %s", label, exc.detail)
        except Exception:
            db.rollback()
            log.exception("휴지통 자동 비우기 실패: %s", label)
    return n
