"""배치 목록·주인 지정(정리 대기 화면용)."""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import String, and_, cast, exists, or_
from sqlalchemy.orm import Session

from .. import access, audit, models
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_auth, require_writer
from ..entries.service import entry_to_dict
from ..ingest import duplicates
from ..ingest.progress import read_progress
from ..ops.state import worker_status
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/batches", tags=["batches"])
# 17 — 동일 BDF 로 모두 빠져 초안 없이 끝난 배치를 정리 대기에 남겨 두는 날 수
DUPLICATE_DONE_DAYS = 3


def queue_context(db: Session) -> dict:
    """배치 여럿이 같이 쓰는 큐 상황 — 워커 생존, 지금 도는 작업들(한 번만 읽는다)."""
    running = db.query(models.Job.type, models.Job.target_id).filter(models.Job.state == "running").all()
    return {"worker": worker_status(db), "running": running}


def _staged_info(db: Session, b: models.Batch, ctx: dict) -> dict:
    """분석 중(staged) 배치 — 서버가 지금 무엇을 하고 있는지(정리 대기 화면의 설명용)."""
    job = (db.query(models.Job).filter(models.Job.type == "process_batch", models.Job.target_id == b.id)
           .order_by(models.Job.id.desc()).first())
    ahead = 0
    if job is not None and job.state == "queued":
        ahead = (db.query(models.Job.id)
                 .filter(models.Job.type == "process_batch", models.Job.state == "queued", models.Job.id < job.id)
                 .count())
    # 워커가 이 배치 말고 다른 작업을 붙들고 있으면(긴 BDF 변환·해석 검증 등) 그 종류를 알린다
    busy = sorted({t for t, target in ctx["running"] if not (t == "process_batch" and target == b.id)})
    return {
        "progress": read_progress(db, b.key),
        "queue": {
            "job_state": job.state if job else None,
            "attempts": job.attempts if job else 0,
            "last_error": (job.last_error or None) if job and job.state == "queued" and job.attempts else None,
            "ahead": ahead,
            "busy_with": busy,
            "worker_alive": bool(ctx["worker"]["alive"]),
            "worker_at": ctx["worker"]["at"],
        },
    }


def batch_to_dict(db: Session, b: models.Batch, ctx: dict | None = None, viewer=None) -> dict:
    """배치 한 덩어리. viewer 를 주면 그가 볼 수 없는 초안(비공개로 둔 남의 초안)은 빼고(13),
    초안 안의 다른 Entry 참조(합치기 제안 등)도 그의 권한으로 거른다."""
    q = db.query(models.Entry).filter_by(batch_id=b.id, status="draft")
    if viewer is not None:
        q = q.filter(access.visible_entries_filter(viewer))
    drafts = q.order_by(models.Entry.id).all()
    d = {"key": b.key, "source": b.source, "original_name": b.original_name, "state": b.state,
         "uploader": b.uploader, "uploader_guess": b.uploader_guess, "owner_account": b.owner_account,
         "received_at": b.received_at.isoformat(),
         # 17 — 완전 동일 BDF 로 뺀 항목은 대상(파일 id)을 보는 사람 권한으로 설명해 싣는다(볼 수 없는 대상은 hidden)
         "excluded": duplicates.public_excluded(db, b.excluded, viewer), "error": b.error,
         "allow_duplicates": bool(b.allow_duplicates),
         "target_entry_id": b.target_entry_id, "entries": [entry_to_dict(db, e, viewer=viewer) for e in drafts]}
    if b.state == "staged" or drafts:
        ctx = ctx or queue_context(db)
    if b.state == "staged":
        d.update(_staged_info(db, b, ctx))
    if drafts:
        # 지금 3D 로 바꾸는 중인 BDF — 변환 기록은 queued 그대로라 작업 표에서 가린다
        converting = {target for t, target in ctx["running"] if t == "convert_model"}
        for e in d["entries"]:
            for f in e["files"]:
                if f.get("model") is not None:
                    f["model"]["running"] = f["id"] in converting
    if b.target_entry_id and b.state in ("staged", "processed"):
        target = db.get(models.Entry, b.target_entry_id)
        if target is not None and target.status == "draft" and (viewer is None or access.can_view_entry(viewer, target, db=db)):
            d["attachment_target"] = target.entry_id
            # Proposals are temporary attachment work, not another item to approve.
            d["entries"] = []
    return d


@router.get("")
def list_batches(scope: str = Query(default="mine", pattern="^(mine|unclaimed|all)$"),
                 db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    # 17 — 완전 동일 BDF 만 있어 초안 하나 없이 끝난(done) 배치도 며칠은 보인다 — 탐색기로 넣은 사람이 왜 사라졌는지
    # 알 수 있게(일부만 빠지고 나머지를 확정한 배치는 남기지 않는다)
    recent = datetime.now() - timedelta(days=DUPLICATE_DONE_DAYS)
    q = db.query(models.Batch).filter(or_(
        models.Batch.state.in_(("staged", "processed", "failed")),
        and_(models.Batch.state == "done", models.Batch.processed_at >= recent,
             cast(models.Batch.excluded, String).like(f"%{duplicates.REASON_MODEL}%"),
             ~exists().where(models.Entry.batch_id == models.Batch.id))))
    if scope == "mine":
        q = q.filter(models.Batch.uploader == user.employee_id)
    elif scope == "unclaimed":
        q = q.filter(models.Batch.uploader.is_(None))
    rows = q.order_by(models.Batch.received_at.desc(), models.Batch.id.desc()).limit(200).all()
    rows = [b for b in rows if b.state != "done" or _has_duplicate_exclusion(b)]
    ctx = queue_context(db) if rows else None
    out = [batch_to_dict(db, b, ctx, viewer=user) for b in rows]
    # 13 — 남의 배치인데 남은 초안이 모두 볼 수 없는 것이면 배치째 뺀다(이름도 드러내지 않는다)
    return [d for d, b in zip(out, rows) if d["entries"] or not _has_hidden_drafts(db, b, user)]


def _has_duplicate_exclusion(b: models.Batch) -> bool:
    return any(isinstance(x, dict) and x.get("reason") == duplicates.REASON_MODEL for x in (b.excluded or []))


def _has_hidden_drafts(db: Session, b: models.Batch, user: models.User) -> bool:
    if access.is_admin(user) or (b.uploader and b.uploader == user.employee_id):
        return False
    return db.query(models.Entry.id).filter_by(batch_id=b.id, status="draft").first() is not None


def _has_unseen_drafts(db: Session, b: models.Batch, user: models.User) -> bool:
    """이 배치에 user 가 볼 수 없는 초안이 하나라도 있는가(13 — 가져가기 차단용)."""
    if access.is_admin(user):
        return False
    return (db.query(models.Entry.id).filter(models.Entry.batch_id == b.id, models.Entry.status == "draft",
                                             ~access.visible_entries_filter(user)).first()) is not None


@router.get("/{key}")
def get_batch(key: str, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    """배치 하나 — Entry 상세의 [파일 추가]가 올린 뒤 합쳐질 때까지 상태를 본다(state·excluded·error)."""
    b = db.query(models.Batch).filter_by(key=key).first()
    if b is None:
        raise HTTPException(status_code=404, detail="batch_not_found")
    d = batch_to_dict(db, b, viewer=user)
    if not d["entries"] and _has_hidden_drafts(db, b, user):
        raise HTTPException(status_code=404, detail="batch_not_found")   # 13 — 볼 수 없는 초안뿐
    return d


@router.post("/{key}/claim")
def claim(key: str, request: Request, db: Session = Depends(get_db),
          storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_writer)):
    b = db.query(models.Batch).filter_by(key=key).first()
    if b is None or _has_unseen_drafts(db, b, user):
        # 13 — 볼 수 없는 초안이 든 배치를 가져가면 올린 사람이 되어 그 초안을 보게 된다(권한 상승).
        # 목록·단건에서 숨는 배치와 같게 '없음'으로 답한다.
        raise HTTPException(status_code=404, detail="batch_not_found")
    # 조건부 UPDATE(uploader IS NULL) 로 원자적으로 처리한다(I5) — 먼저 읽고 나서
    # 따로 쓰면, 두 요청이 동시에 "아직 주인 없음" 을 보고 둘 다 통과할 수 있다.
    # 영향 행이 1이 아니면(이미 누가 가져갔거나 그 사이 없어짐) 409.
    result = (
        db.query(models.Batch)
        .filter(models.Batch.id == b.id, models.Batch.uploader.is_(None))
        .update({"uploader": user.employee_id}, synchronize_session=False)
    )
    if result != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail="already_claimed")
    db.query(models.Entry).filter_by(batch_id=b.id, status="draft").update(
        {"uploaded_by": user.employee_id}, synchronize_session=False)
    audit.record(db, storage, actor=user.employee_id, action="BATCH_CLAIM", target_type="batch",
                 target_id=key, after={"uploader": user.employee_id}, ip=client_ip(request))
    db.refresh(b)
    return batch_to_dict(db, b, viewer=user)
