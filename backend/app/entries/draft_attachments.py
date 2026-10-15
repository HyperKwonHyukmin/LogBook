"""Attach an uploaded batch to one draft without confirming it or changing its title."""
from pathlib import PurePosixPath

from fastapi import HTTPException

from .. import access, audit, models
from .files import move_all, plan_rel, rel_move_pairs, remove_empty_dirs

PENDING_STATES = ("uploading", "staged", "processed", "failed")


def pending_batches(db, entry_id, *, lock=False):
    query = db.query(models.Batch).filter(models.Batch.target_entry_id == entry_id,
                                         models.Batch.state.in_(PENDING_STATES)).order_by(models.Batch.id)
    return (query.with_for_update() if lock else query).all()


def ensure_no_pending(db, entry):
    if pending_batches(db, entry.id, lock=True):
        raise HTTPException(409, "draft_attachments_pending")


def attach_processed_batch(db, storage, batch, user):
    from . import service
    from ..convert.job import requeue_entry_models
    from ..revisions.series import refresh

    # Same lock as confirm and upload begin: approval cannot race attachment publication.
    target = db.get(models.Entry, batch.target_entry_id, with_for_update=True, populate_existing=True)
    if target is None or target.status != "draft":
        raise HTTPException(409, "attachment_target_not_draft")
    access.ensure_visible(db, user, target)
    access.ensure_can_edit(user, target)
    batch = db.get(models.Batch, batch.id, with_for_update=True, populate_existing=True)
    if batch.state == "done":
        return 0
    if batch.state != "processed" or batch.target_entry_id != target.id:
        raise HTTPException(409, "attachment_not_processed")
    original = db.get(models.Batch, target.batch_id)
    if original is None or original.id == batch.id:
        raise HTTPException(409, "attachment_original_batch_missing")
    children = (db.query(models.Entry).filter_by(batch_id=batch.id, status="draft")
                .order_by(models.Entry.id).with_for_update().all())
    if any(e.merge_into_id != target.id for e in children):
        raise HTTPException(409, "attachment_target_changed")
    child_ids = [e.id for e in children]
    files = db.query(models.File).filter(models.File.entry_id.in_(child_ids or [0])).all()
    if any(f.location != "staging" or f.batch_id != batch.id for f in files):
        raise HTTPException(409, "attachment_file_not_staged")
    source_root = storage.staging / batch.key
    target_root = storage.staging / original.key
    planned = set()
    # 원래 배치에서 다른 파일이 쓰는 이름 — 중단된 앞선 시도가 옮겨 둔 사본만 이어받는다(리뷰 7)
    taken = {r.casefold() for (r,) in db.query(models.File.rel_path)
             .filter(models.File.batch_id == original.id, models.File.location == "staging")}
    plans = [(f, plan_rel(source_root, target_root, f, planned, taken)) for f in files]
    undo = move_all(rel_move_pairs(source_root, target_root, plans))
    try:
        for file, rel in plans:
            file.entry_id, file.batch_id, file.rel_path = target.id, original.id, rel
            file.name = PurePosixPath(rel).name
        # Flush references before deleting temporary proposal entries.
        db.flush()
        for child in children:
            service._clear_dangling_references(db, child.id)
            db.query(models.ModelRevision).filter_by(entry_id=child.id).delete(synchronize_session=False)
            db.delete(child)
        batch.state, batch.error = "done", None
        target.version += 1
        db.flush()
        audit.record(db, storage, actor=user.employee_id, action="DRAFT_FILES_ADDED",
                     target_type="entry", target_id=target.entry_id,
                     after={"batch": batch.key, "files": [rel for _, rel in plans]})
    except Exception:
        db.rollback()
        undo()
        raise
    remove_empty_dirs(source_root)
    # INCLUDE files may now be available. Extraction jobs refer to stable File IDs.
    requeue_entry_models(db, target.id)
    db.commit()
    refresh(db, target.id)
    return len(children)


def release_batch(db, user, entry_id, key, storage=None):
    """Keep failed attachment files in their own batch; never discard their originals."""
    target = db.query(models.Entry).filter_by(entry_id=entry_id.upper()).with_for_update().first()
    access.ensure_visible(db, user, target)
    access.ensure_can_edit(user, target)
    if target.status != "draft":
        raise HTTPException(409, "attachment_target_not_draft")
    batch = db.query(models.Batch).filter_by(key=key).with_for_update().first()
    if batch is None or batch.target_entry_id != target.id:
        raise HTTPException(404, "attachment_not_found")
    if batch.state not in ("failed", "processed"):
        raise HTTPException(409, "attachment_still_processing")
    batch.target_entry_id = None
    children = db.query(models.Entry).filter_by(batch_id=batch.id, status="draft").all()
    for child in children:
        child.merge_into_id = None
        child.access = access.access_of(target)
        child.version += 1
    if children:
        batch.state = "processed"
    if storage is not None:
        audit.record(db, storage, actor=user.employee_id, action="DRAFT_ATTACHMENT_RELEASED",
                     target_type="entry", target_id=target.entry_id, after={"batch": batch.key})
    else:
        db.commit()
