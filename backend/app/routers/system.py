"""상태 확인(로그인 불필요)과 감사 로그 조회(로그인 사용자 누구나 — 설계 §8 '활동 로그')."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models
from ..config import APP_VERSION
from ..database import get_db
from ..dependencies import get_storage, require_auth
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/system/health")
def health(storage: StoragePaths = Depends(get_storage)):
    return {
        "ok": True,
        "version": APP_VERSION,
        # 죽은 공유 폴더에 요청이 물리지 않도록 timeout+캐시가 있는 check_reachable() 사용.
        "storage": {"root": str(storage.root), "reachable": storage.check_reachable()},
    }


@router.get("/audit")
def list_audit(
    limit: int = Query(default=100, ge=1, le=500),
    action: str | None = None,
    employee_id: str | None = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_auth),
):
    q = db.query(models.AuditLog)
    if action:
        q = q.filter_by(action=action)
    if employee_id:
        q = q.filter_by(employee_id=employee_id.upper())
    rows = q.order_by(models.AuditLog.at.desc(), models.AuditLog.id.desc()).limit(limit)
    return [
        {
            "id": r.id,
            "at": r.at.isoformat(timespec="seconds"),
            "employee_id": r.employee_id,
            "action": r.action,
            "target": {"type": r.target_type, "id": r.target_id},
            "before": r.before,
            "after": r.after,
        }
        for r in rows
    ]
