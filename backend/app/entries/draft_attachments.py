"""Attach an uploaded batch to one draft without confirming it or changing its title."""
from pathlib import PurePosixPath

from fastapi import HTTPException

from .. import access, audit, models
from .files import move_all, plan_rel, rel_move_pairs, remove_empty_dirs

PENDING_STATES = ("uploading", "staged", "processed", "failed")

# 2026-11-20 — LV3 '그래도 올리기'(막힌 BDF 를 다시 보냄)는 처음 올린 묶음의 초안에 붙인다(사용자 신고: 폴더 하나가 초안 2건).
# 시작 요청의 join_batch 가 묶음 preset 에 이 열쇠로 남고, 정리(process_batch) 때 join_target 이 붙일 초안을 고른다
JOIN_KEY = "join_batch"


def _common_depth(a, b):
    """두 경로의 폴더 부분이 앞에서부터 몇 단계 같은가."""
    pa, pb = PurePosixPath(a).parts[:-1], PurePosixPath(b).parts[:-1]
    n = 0
    for x, y in zip(pa, pb):
        if x.casefold() != y.casefold():
            break
        n += 1
    return n


def join_target(db, batch, rel_paths):
    """join_batch 묶음이 붙을 초안 — 처음 묶음(같은 올린 사람, 정리 끝남)의 확정 전 초안 중 폴더가 가장 많이 겹치는 것.
    초안이 하나면 그것, 여럿이면 겹침이 가장 깊은 하나(같으면 고르지 않음). 못 고르면 None — 예전처럼 따로 초안이 된다."""
    key = (batch.preset or {}).get(JOIN_KEY) if isinstance(batch.preset, dict) else None
    if not key:
        return None
    first = db.query(models.Batch).filter_by(key=key).first()
    if first is None or first.id == batch.id or first.uploader != batch.uploader or first.state != "processed":
        return None
    drafts = (db.query(models.Entry).filter_by(batch_id=first.id, status="draft", merge_into_id=None)
              .order_by(models.Entry.id).all())
    if len(drafts) == 1:
        return drafts[0]
    scored = []
    for d in drafts:
        mine = [r for (r,) in db.query(models.File.rel_path).filter_by(entry_id=d.id)]
        scored.append((max((_common_depth(a, b) for a in mine for b in rel_paths), default=0), d))
    scored.sort(key=lambda s: s[0], reverse=True)
    if not scored or scored[0][0] == 0 or (len(scored) > 1 and scored[1][0] == scored[0][0]):
        return None
    return scored[0][1]


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
        if batch.allow_duplicates:
            # LV3 가 '그래도 올리기'로 받은 동일 BDF 가 이제 처음 묶음에 있다 — 확정 재검사가 다시 막지 않게 표시를 옮긴다
            original.allow_duplicates = True
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
