"""관리자 사용자 관리. WorkBench routers/users.py 에서 이식했다.

비활성화는 상태 변경과 세션 폐기를 한 트랜잭션으로 확정한다(부분 성공 방지).
관리자는 자기 자신을 비활성화하거나 관리자 권한을 내릴 수 없다(관리자 0명 사고 방지).
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import audit, models
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_admin
from ..ops.registry import write_registry
from ..schemas import AdminFlagRequest, user_snapshot, user_to_dict
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])


def _get(db: Session, employee_id: str) -> models.User:
    user = db.query(models.User).filter_by(employee_id=employee_id.upper()).first()
    if user is None:
        raise HTTPException(status_code=404, detail="user_not_found")
    return user


def _set_status(db, storage, request, admin, employee_id, status, action, *,
                required_current=None, wrong_status_detail=None):
    user = _get(db, employee_id)
    if user.employee_id == admin.employee_id and status != "active":
        raise HTTPException(status_code=400, detail="cannot_change_self")
    if required_current is not None and user.status != required_current:
        raise HTTPException(status_code=409, detail=wrong_status_detail)
    before = user_snapshot(user)
    user.status = status
    if status != "active":
        db.query(models.UserSession).filter_by(employee_id=user.employee_id).delete(
            synchronize_session=False
        )
    audit.record(db, storage, actor=admin.employee_id, action=action, target_type="user",
                 target_id=user.employee_id, before=before, after=user_snapshot(user),
                 ip=client_ip(request))
    db.refresh(user)
    write_registry(db, storage)  # 사용자 목록을 registry.json 에도 남긴다(05 — 재구축 원천)
    return user_to_dict(user)


@router.get("")
def list_users(status: str | None = None, db: Session = Depends(get_db),
               admin: models.User = Depends(require_admin)):
    q = db.query(models.User)
    if status:
        q = q.filter_by(status=status)
    return [user_to_dict(u) for u in q.order_by(models.User.created_at.desc(), models.User.id.desc())]


@router.post("/{employee_id}/approve")
def approve(employee_id: str, request: Request, db: Session = Depends(get_db),
            storage: StoragePaths = Depends(get_storage),
            admin: models.User = Depends(require_admin)):
    return _set_status(db, storage, request, admin, employee_id, "active", "USER_APPROVE",
                       required_current="pending", wrong_status_detail="not_pending")


@router.post("/{employee_id}/enable")
def enable(employee_id: str, request: Request, db: Session = Depends(get_db),
           storage: StoragePaths = Depends(get_storage),
           admin: models.User = Depends(require_admin)):
    return _set_status(db, storage, request, admin, employee_id, "active", "USER_ENABLE",
                       required_current="disabled", wrong_status_detail="not_disabled")


@router.post("/{employee_id}/disable")
def disable(employee_id: str, request: Request, db: Session = Depends(get_db),
            storage: StoragePaths = Depends(get_storage),
            admin: models.User = Depends(require_admin)):
    return _set_status(db, storage, request, admin, employee_id, "disabled", "USER_DISABLE",
                       required_current="active", wrong_status_detail="not_active")


@router.post("/{employee_id}/reject")
def reject(employee_id: str, request: Request, db: Session = Depends(get_db),
           storage: StoragePaths = Depends(get_storage),
           admin: models.User = Depends(require_admin)):
    user = _get(db, employee_id)
    if user.status != "pending":
        raise HTTPException(status_code=409, detail="not_pending")
    before = user_snapshot(user)
    target = user.employee_id
    db.delete(user)
    audit.record(db, storage, actor=admin.employee_id, action="USER_REJECT", target_type="user",
                 target_id=target, before=before, ip=client_ip(request))
    write_registry(db, storage)
    return {"ok": True}


@router.put("/{employee_id}/admin")
def set_admin(employee_id: str, body: AdminFlagRequest, request: Request,
              db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
              admin: models.User = Depends(require_admin)):
    user = _get(db, employee_id)
    if user.employee_id == admin.employee_id and not body.is_admin:
        raise HTTPException(status_code=400, detail="cannot_change_self")
    before = user_snapshot(user)
    user.is_admin = body.is_admin
    audit.record(db, storage, actor=admin.employee_id,
                 action="USER_ADMIN_GRANT" if body.is_admin else "USER_ADMIN_REVOKE",
                 target_type="user", target_id=user.employee_id, before=before,
                 after=user_snapshot(user), ip=client_ip(request))
    db.refresh(user)
    write_registry(db, storage)
    return user_to_dict(user)
