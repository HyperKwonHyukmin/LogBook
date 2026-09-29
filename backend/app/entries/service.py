"""Entry 서비스 — 조회 변환·수정·호선/구역·확정·휴지통·복원·쪼개기·합치기."""
import logging
import os
import re
from datetime import datetime, timedelta
from pathlib import Path, PurePosixPath

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import audit, jobs, models
from ..storage.paths import StoragePaths, long_join, to_long

logger = logging.getLogger(__name__)

HULL_PATTERN = re.compile(r"^[0-9]{4}$")
EDITABLE_FIELDS = ("title", "analysis_type", "description", "analysis_period")
PERIOD_PATTERN = re.compile(r"^[0-9]{4}-(0[1-9]|1[0-2])$")


def hulls_of(db: Session, entry: models.Entry) -> list[models.EntryHull]:
    return (db.query(models.EntryHull).filter_by(entry_id=entry.id)
            .order_by(models.EntryHull.is_primary.desc(), models.EntryHull.hull_no).all())


def zones_of(db: Session, entry: models.Entry) -> list[str]:
    rows = (db.query(models.Tag.value).join(models.EntryTag, models.EntryTag.tag_id == models.Tag.id)
            .filter(models.EntryTag.entry_id == entry.id, models.Tag.kind == "zone")
            .order_by(models.Tag.value).all())
    return [v for (v,) in rows]


def file_to_dict(f: models.File, duplicate_entries: dict[int, str] | None = None) -> dict:
    return {"id": f.id, "rel_path": f.rel_path, "name": f.name, "kind": f.kind, "size": f.size,
            "sha256": f.sha256, "drm_encrypted": f.drm_encrypted, "duplicate_of_id": f.duplicate_of_id,
            "duplicate_of_entry": (duplicate_entries or {}).get(f.duplicate_of_id),
            "location": f.location}


def _entry_ref(db: Session, entry_pk: int | None) -> dict | None:
    if entry_pk is None:
        return None
    e = db.get(models.Entry, entry_pk)
    return {"entry_id": e.entry_id, "title": e.title} if e else None


def entry_to_dict(db: Session, entry: models.Entry) -> dict:
    hulls = hulls_of(db, entry)
    ship = {h.hull_no: h.ship_type for h in
            db.query(models.Hull).filter(models.Hull.hull_no.in_([x.hull_no for x in hulls]))} if hulls else {}
    files = db.query(models.File).filter_by(entry_id=entry.id).order_by(models.File.rel_path).all()
    dup_ids = [f.duplicate_of_id for f in files if f.duplicate_of_id]
    dup_entries = dict(
        db.query(models.File.id, models.Entry.entry_id).join(models.Entry, models.Entry.id == models.File.entry_id)
        .filter(models.File.id.in_(dup_ids)).all()) if dup_ids else {}
    return {
        "id": entry.id, "entry_id": entry.entry_id, "status": entry.status, "title": entry.title,
        "analysis_type": entry.analysis_type, "description": entry.description,
        "analysis_period": entry.analysis_period, "version": entry.version,
        "hulls": [{"hull_no": h.hull_no, "ship_type": ship.get(h.hull_no), "is_primary": bool(h.is_primary)}
                  for h in hulls],
        "zones": zones_of(db, entry),
        "hull_evidence": entry.hull_evidence or [],
        "uploaded_by": entry.uploaded_by, "confirmed_by": entry.confirmed_by,
        "confirmed_at": entry.confirmed_at.isoformat() if entry.confirmed_at else None,
        "batch_id": entry.batch_id, "merge_into_id": entry.merge_into_id,
        "suggested_entry_id": entry.suggested_entry_id, "vault_rel": entry.vault_rel,
        "files": [file_to_dict(f, dup_entries) for f in files],
        "suggested_entry": _entry_ref(db, entry.suggested_entry_id),
        "merge_into": _entry_ref(db, entry.merge_into_id),
    }


def snapshot(db: Session, entry: models.Entry) -> dict:
    d = entry_to_dict(db, entry)
    return {k: d[k] for k in ("title", "analysis_type", "description", "analysis_period", "zones")} | {
        "hulls": [h["hull_no"] for h in d["hulls"]]}


def can_edit_draft(user: models.User, entry: models.Entry) -> bool:
    return user.is_admin or (entry.uploaded_by is not None and entry.uploaded_by == user.employee_id)


def ensure_editable(user: models.User, entry: models.Entry) -> None:
    if entry.status == "trashed":
        raise HTTPException(status_code=409, detail="entry_trashed")
    if entry.status == "draft" and not can_edit_draft(user, entry):
        raise HTTPException(status_code=403, detail="not_uploader")


def _lock(db: Session, entry: models.Entry) -> models.Entry:
    """동시 요청끼리 같은 Entry 를 건드리지 못하게 행 잠금을 걸고, 잠근 뒤의 최신 상태로
    다시 읽는다(I6) — 잠그기 전에 읽은 값 기준으로 상태를 검사하면, 그 사이 다른 요청이
    상태를 이미 바꿨을 수 있다(예: 두 요청이 동시에 확정을 시도).

    ⚠ populate_existing=True 가 반드시 있어야 한다. entry 가 이미 이 세션의 identity map
    에 있으면(이 함수 호출 전에 이미 한 번 읽은 경우, 실사용에서 항상 그렇다) db.get() 은
    with_for_update 로 실제 SELECT ... FOR UPDATE 를 보내 행을 잠그면서도, 그 쿼리 결과로
    파이썬 객체의 속성을 다시 채우지는 않는다 — 캐시된(오래된) status/version 을 계속
    들고 있게 되어 "잠근 뒤 다시 검사" 가 무의미해진다."""
    return db.get(models.Entry, entry.id, with_for_update=True, populate_existing=True)


def set_hulls(db: Session, entry: models.Entry, hull_nos: list[str]) -> None:
    clean = list(dict.fromkeys(h.strip() for h in hull_nos if h.strip()))
    if any(not HULL_PATTERN.fullmatch(h) for h in clean):
        raise HTTPException(status_code=422, detail="invalid_hull")
    db.query(models.EntryHull).filter_by(entry_id=entry.id).delete(synchronize_session=False)
    for i, h in enumerate(clean):
        db.add(models.EntryHull(entry_id=entry.id, hull_no=h, is_primary=(i == 0)))


def set_zones(db: Session, entry: models.Entry, values: list[str]) -> None:
    db.query(models.EntryTag).filter_by(entry_id=entry.id).delete(synchronize_session=False)
    for v in dict.fromkeys(x.strip() for x in values if x.strip()):
        tag = db.query(models.Tag).filter_by(kind="zone", value=v[:100]).first()
        if tag is None:
            tag = models.Tag(kind="zone", value=v[:100])
            db.add(tag)
            db.flush()
        db.add(models.EntryTag(entry_id=entry.id, tag_id=tag.id))


def _set_merge_into(db: Session, entry: models.Entry, value: str | None) -> None:
    """PATCH 로 초안의 merge_into_id 를 바꾼다(I9) — 확정 시점에 대상이 이미 휴지통이거나
    없어졌으면 confirm() 이 409 target_not_confirmed 로 막지만, 그때까지는 손 쓸 방법이
    없었다. 이제 사용자가 이 필드를 비워(null) 그 초안을 일반 확정으로 되돌릴 수 있다."""
    if entry.status != "draft":
        raise HTTPException(status_code=422, detail="merge_into_id_only_for_draft")
    if not value:
        entry.merge_into_id = None
        return
    target = db.query(models.Entry).filter_by(entry_id=str(value).upper()).first()
    if target is None:
        raise HTTPException(status_code=422, detail="merge_target_not_found")
    entry.merge_into_id = target.id


def update_entry(db: Session, storage: StoragePaths, entry: models.Entry, user: models.User,
                 patch: dict, ip: str | None = None) -> models.Entry:
    entry = _lock(db, entry)
    ensure_editable(user, entry)
    if patch.get("version") != entry.version:
        raise HTTPException(status_code=409, detail="version_conflict")
    period = patch.get("analysis_period")
    if period and not PERIOD_PATTERN.fullmatch(period):
        raise HTTPException(status_code=422, detail="invalid_period")
    if entry.status == "confirmed" and "title" in patch and not (patch["title"] or "").strip():
        raise HTTPException(status_code=422, detail="title_required")  # M6
    before = snapshot(db, entry) if entry.status == "confirmed" else None
    for field_name in EDITABLE_FIELDS:
        if field_name in patch:
            value = patch[field_name]
            setattr(entry, field_name, (value or "").strip() if field_name == "title" else (value or None))
    if "hulls" in patch:
        set_hulls(db, entry, patch["hulls"] or [])
    if "zones" in patch:
        set_zones(db, entry, patch["zones"] or [])
    if "merge_into_id" in patch:
        _set_merge_into(db, entry, patch["merge_into_id"])
    entry.version += 1
    db.flush()
    if entry.status == "confirmed":
        audit.record(db, storage, actor=user.employee_id, action="ENTRY_UPDATE", target_type="entry",
                     target_id=entry.entry_id, before=before, after=snapshot(db, entry), ip=ip)
        db.commit()
        _write_meta_or_queue(db, storage, entry)
    else:
        db.commit()
    return entry


ADMIN_TAKEOVER_DAYS = 30


def _now():
    return datetime.now().replace(microsecond=0)


def _write_meta_or_queue(db: Session, storage: StoragePaths, entry: models.Entry) -> None:
    """entry.json/_INFO.txt 를 쓴다. 실패해도(OSError) 이미 커밋된 DB 상태(확정·수정 등)를
    되돌리지 않는다 — 대신 재시도 작업을 큐에 넣고 계속한다(I3). 호출 시점에 Entry 의
    DB 트랜잭션은 이미 커밋돼 있어야 한다(이 함수 자체가 실패해도 그 커밋은 안전하다)."""
    from .files import write_entry_files

    try:
        write_entry_files(db, storage, entry)
    except OSError as exc:
        logger.warning("entry.json/_INFO.txt 쓰기 실패 — 재시도 작업을 큐에 등록: %s (%s)",
                       entry.entry_id, exc)
        jobs.enqueue(db, "write_meta", entry.id)
        db.commit()


def _check_confirmer(db: Session, user: models.User, entry: models.Entry) -> models.Batch | None:
    batch = db.get(models.Batch, entry.batch_id) if entry.batch_id else None
    if entry.uploaded_by and entry.uploaded_by == user.employee_id:
        return batch
    if user.is_admin and batch and batch.received_at <= datetime.now() - timedelta(days=ADMIN_TAKEOVER_DAYS):
        return batch
    raise HTTPException(status_code=403, detail="not_uploader")


def _finish_batch(db: Session, storage: StoragePaths, batch: models.Batch | None) -> None:
    from .files import remove_empty_dirs

    if batch is None:
        return
    left = db.query(models.Entry.id).filter_by(batch_id=batch.id, status="draft").count()
    if left == 0:
        batch.state = "done"
        remove_empty_dirs(storage.staging / batch.key)


def _ensure_hulls(db: Session, entry: models.Entry) -> None:
    for h in hulls_of(db, entry):
        if db.get(models.Hull, h.hull_no) is None:
            db.add(models.Hull(hull_no=h.hull_no))


def _clear_dangling_references(db: Session, entry_id: int) -> None:
    """`db.delete(entry)` 직전에 호출 — 지우려는 Entry(id=entry_id)를 가리키는 다른 행이
    남아 있으면 FK 위반으로 삭제 자체가 실패한다. 정상 흐름에서는 잘 안 생기는 조합이지만
    (merge_into_id 는 보통 확정 Entry 를, suggested_entry_id 도 확정 Entry 만 가리킨다),
    미래의 경로나 수동 데이터로도 FK 에러 없이 항상 지울 수 있도록 방어적으로 비운다."""
    db.query(models.Entry).filter_by(merge_into_id=entry_id).update(
        {"merge_into_id": None}, synchronize_session=False)
    db.query(models.Entry).filter_by(suggested_entry_id=entry_id).update(
        {"suggested_entry_id": None}, synchronize_session=False)
    db.query(models.Batch).filter_by(target_entry_id=entry_id).update(
        {"target_entry_id": None}, synchronize_session=False)


def confirm(db: Session, storage: StoragePaths, entry: models.Entry, user: models.User,
            ip: str | None = None) -> models.Entry:
    from .files import entry_dir, move_all, rel_move_pairs, unique_rel

    entry = _lock(db, entry)
    if entry.status != "draft":
        raise HTTPException(status_code=409, detail="not_draft")
    batch = _check_confirmer(db, user, entry)
    if batch is None:
        raise HTTPException(status_code=409, detail="no_batch")  # M7
    files = db.query(models.File).filter_by(entry_id=entry.id).all()
    staging_root = storage.staging / batch.key

    if entry.merge_into_id:
        target = db.get(models.Entry, entry.merge_into_id)
        if target is None or target.status != "confirmed":
            raise HTTPException(status_code=409, detail="target_not_confirmed")
        target = _lock(db, target)
        if target.status != "confirmed":
            raise HTTPException(status_code=409, detail="target_not_confirmed")
        files_root = entry_dir(storage, target) / "files"
        planned: set[str] = set()
        plans = [(f, unique_rel(files_root, f.rel_path, planned)) for f in files]
        undo = move_all(rel_move_pairs(staging_root, files_root, plans))
        try:
            for f, r in plans:
                f.entry_id, f.rel_path, f.location = target.id, r, "vault"
            _clear_dangling_references(db, entry.id)
            db.delete(entry)
            target.version += 1
            db.flush()
            audit.record(db, storage, actor=user.employee_id, action="ENTRY_FILES_ADDED", target_type="entry",
                         target_id=target.entry_id, after={"files": [r for _, r in plans]}, ip=ip)
        except Exception:
            db.rollback()
            undo()
            raise
        _finish_batch(db, storage, batch)
        db.commit()
        _write_meta_or_queue(db, storage, target)
        return target

    if not (entry.title or "").strip():
        raise HTTPException(status_code=422, detail="title_required")
    now = _now()
    entry.vault_rel = f"{now.year}/{entry.entry_id}"
    files_root = entry_dir(storage, entry) / "files"
    undo = move_all(rel_move_pairs(staging_root, files_root, [(f, f.rel_path) for f in files]))
    try:
        for f in files:
            f.location = "vault"
        entry.status, entry.confirmed_by, entry.confirmed_at = "confirmed", user.employee_id, now
        _ensure_hulls(db, entry)
        db.flush()
        audit.record(db, storage, actor=user.employee_id, action="ENTRY_CONFIRM", target_type="entry",
                     target_id=entry.entry_id, after=snapshot(db, entry) | {"files": len(files)}, ip=ip)
    except Exception:
        db.rollback()
        undo()
        raise
    _finish_batch(db, storage, batch)
    db.commit()
    _write_meta_or_queue(db, storage, entry)
    return entry


def _stamp() -> str:
    return f"{datetime.now():%Y%m%d-%H%M%S}"


def trash(db: Session, storage: StoragePaths, entry: models.Entry, user: models.User,
          ip: str | None = None) -> models.Entry:
    from .files import entry_dir, move_all, rel_move_pairs

    entry = _lock(db, entry)
    if entry.status == "trashed":
        raise HTTPException(status_code=409, detail="entry_trashed")
    files = db.query(models.File).filter_by(entry_id=entry.id).all()
    if entry.status == "confirmed":
        rel = f"{entry.entry_id}_{_stamp()}"
        undo = move_all([(entry_dir(storage, entry), storage.trash / rel)])
        action = "ENTRY_TRASH"
    else:
        if not can_edit_draft(user, entry):
            raise HTTPException(status_code=403, detail="not_uploader")
        batch = db.get(models.Batch, entry.batch_id)
        rel = f"draft_{entry.entry_id}_{_stamp()}"
        src_root = storage.staging / batch.key
        undo = move_all(rel_move_pairs(src_root, storage.trash / rel, [(f, f.rel_path) for f in files]))
        action = "DRAFT_DISCARD"
    try:
        before = snapshot(db, entry)
        for f in files:
            f.location = "trash"
        entry.status, entry.trash_rel = "trashed", rel
        entry.version += 1
        db.flush()
        audit.record(db, storage, actor=user.employee_id, action=action, target_type="entry",
                     target_id=entry.entry_id, before=before, after={"trash_rel": rel}, ip=ip)
    except Exception:
        db.rollback()
        undo()
        raise
    if action == "DRAFT_DISCARD":
        _finish_batch(db, storage, db.get(models.Batch, entry.batch_id))
    db.commit()
    return entry


def restore(db: Session, storage: StoragePaths, entry: models.Entry, user: models.User,
            ip: str | None = None) -> models.Entry:
    from .files import entry_dir, move_all

    entry = _lock(db, entry)
    if entry.status != "trashed" or not entry.vault_rel:
        raise HTTPException(status_code=409, detail="not_restorable")
    dest = entry_dir(storage, entry)
    if os.path.exists(to_long(dest)):
        raise HTTPException(status_code=409, detail="vault_conflict")
    undo = move_all([(storage.trash / entry.trash_rel, dest)])
    try:
        for f in db.query(models.File).filter_by(entry_id=entry.id):
            f.location = "vault"
        entry.status, entry.trash_rel = "confirmed", None
        entry.version += 1
        db.flush()
        audit.record(db, storage, actor=user.employee_id, action="ENTRY_RESTORE", target_type="entry",
                     target_id=entry.entry_id, ip=ip)
    except Exception:
        db.rollback()
        undo()
        raise
    db.commit()
    _write_meta_or_queue(db, storage, entry)
    return entry


def _require_draft_owner(user: models.User, *entries: models.Entry) -> None:
    for e in entries:
        if e.status != "draft":
            raise HTTPException(status_code=409, detail="not_draft")
        if not can_edit_draft(user, e):
            raise HTTPException(status_code=403, detail="not_uploader")


def split(db: Session, entry: models.Entry, user: models.User, file_ids: list[int]) -> models.Entry:
    entry = _lock(db, entry)
    _require_draft_owner(user, entry)
    files = db.query(models.File).filter(models.File.id.in_(file_ids or [0])).all()
    if not files or len(files) != len(set(file_ids)) or any(f.entry_id != entry.id for f in files):
        raise HTTPException(status_code=422, detail="file_not_in_entry")
    new = models.Entry(title=entry.title, status="draft", batch_id=entry.batch_id, uploaded_by=entry.uploaded_by,
                       hull_evidence=entry.hull_evidence, merge_into_id=entry.merge_into_id)
    db.add(new)
    db.flush()
    new.entry_id = f"E{new.id:06d}"
    for h in hulls_of(db, entry):
        db.add(models.EntryHull(entry_id=new.id, hull_no=h.hull_no, is_primary=h.is_primary))
    for f in files:
        f.entry_id = new.id
    entry.version += 1
    db.commit()
    return new


def merge(db: Session, entry: models.Entry, other: models.Entry, user: models.User) -> models.Entry:
    # id 오름차순으로 잠근다 — merge(A,B) 와 merge(B,A) 가 동시에 들어오면 반대 순서로
    # 잠가 서로를 기다리는 교착(deadlock)이 날 수 있다.
    if entry.id <= other.id:
        entry, other = _lock(db, entry), _lock(db, other)
    else:
        other, entry = _lock(db, other), _lock(db, entry)
    _require_draft_owner(user, entry, other)
    if entry.id == other.id or entry.batch_id != other.batch_id:
        raise HTTPException(status_code=422, detail="different_batch")
    db.query(models.File).filter_by(entry_id=other.id).update({"entry_id": entry.id}, synchronize_session=False)
    _clear_dangling_references(db, other.id)
    db.delete(other)
    entry.version += 1
    db.commit()
    return entry


def move_file(db: Session, f: models.File, target: models.Entry, user: models.User) -> None:
    source = db.get(models.Entry, f.entry_id)
    source = _lock(db, source)
    target = _lock(db, target)
    _require_draft_owner(user, source, target)
    if source.batch_id != target.batch_id:
        raise HTTPException(status_code=422, detail="different_batch")
    f.entry_id = target.id
    source.version += 1
    target.version += 1
    db.commit()
