"""배치 목록·주인 지정(정리 대기 화면용)."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from .. import audit, models
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_auth
from ..entries.service import entry_to_dict
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/batches", tags=["batches"])


def batch_to_dict(db: Session, b: models.Batch) -> dict:
    drafts = db.query(models.Entry).filter_by(batch_id=b.id, status="draft").order_by(models.Entry.id).all()
    return {"key": b.key, "source": b.source, "original_name": b.original_name, "state": b.state,
            "uploader": b.uploader, "uploader_guess": b.uploader_guess, "owner_account": b.owner_account,
            "received_at": b.received_at.isoformat(), "excluded": b.excluded or [], "error": b.error,
            "target_entry_id": b.target_entry_id, "entries": [entry_to_dict(db, e) for e in drafts]}


@router.get("")
def list_batches(scope: str = Query(default="mine", pattern="^(mine|unclaimed|all)$"),
                 db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    q = db.query(models.Batch).filter(models.Batch.state.in_(("staged", "processed", "failed")))
    if scope == "mine":
        q = q.filter(models.Batch.uploader == user.employee_id)
    elif scope == "unclaimed":
        q = q.filter(models.Batch.uploader.is_(None))
    return [batch_to_dict(db, b) for b in q.order_by(models.Batch.received_at.desc(), models.Batch.id.desc()).limit(200)]


@router.post("/{key}/claim")
def claim(key: str, request: Request, db: Session = Depends(get_db),
          storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    b = db.query(models.Batch).filter_by(key=key).first()
    if b is None:
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
    return batch_to_dict(db, b)
