"""사용자 관리(15, LV3 전용) — WorkBench 활성 사용자 목록과 LogBook 등급 지정.

가입 승인·거절·비활성·활성은 없앴다(활성 여부는 WorkBench 가 정한다). 등급 규칙은 roles.py 한 곳."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import access, models, roles, wb_users
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_admin
from ..schemas import LevelRequest, user_to_dict
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])


def _row(wb: wb_users.WbUser | None, local: models.User | None, employee_id: str) -> dict:
    stored = (local.level or 1) if local is not None else 1
    wb_admin = bool(wb.is_admin) if wb is not None else bool(local and local.wb_admin)
    return {
        "employee_id": employee_id,
        "name": (wb.name if wb is not None else None) or (local.name if local is not None else None),
        "department": wb.department if wb is not None else (local.department if local is not None else None),
        "position": wb.position if wb is not None else (local.position if local is not None else None),
        "wb_active": bool(wb is not None and wb.is_active),
        "wb_admin": wb_admin,
        # 실효 등급 — WorkBench 관리자면 3(잠김), 아니면 저장값(LogBook 에 들어온 적 없으면 1)
        "level": 3 if wb_admin else stored,
        "stored_level": stored,
        "known": local is not None,
        "login_count": (local.login_count or 0) if local is not None else 0,
        "last_login": local.last_login.isoformat() if local is not None and local.last_login else None,
    }


@router.get("")
def list_users(q: str = "", db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    """WorkBench 활성 사용자 + LogBook 에 행이 있는데 WorkBench 활성이 아닌 사람(wb_active False — 맨 뒤).
    WorkBench 표를 읽을 수 없으면 503 wb_unavailable."""
    try:
        active = wb_users.list_active(db, q)
        locals_ = {u.employee_id: u for u in db.query(models.User)}
        rest = [e for e in locals_ if e not in {w.employee_id for w in active}]
        if q.strip():
            ql = q.strip().casefold()
            rest = [e for e in rest if e.casefold().startswith(ql) or (locals_[e].name or "").casefold().startswith(ql)]
        others = wb_users.fetch_many(db, rest)
    except wb_users.WbUnavailable:
        raise HTTPException(status_code=503, detail="wb_unavailable")
    rows = [_row(w, locals_.get(w.employee_id), w.employee_id) for w in active]
    rows += sorted((_row(others.get(e), locals_[e], e) for e in rest), key=lambda r: (r["name"] or "", r["employee_id"]))
    return rows


@router.put("/{employee_id}/level")
def set_level(employee_id: str, body: LevelRequest, request: Request,
              db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
              admin: models.User = Depends(require_admin)):
    """등급 바꾸기 — 감사 USER_LEVEL. 자기 자신 400, WorkBench 관리자 409 wb_admin_locked."""
    user = roles.set_level(db, storage, admin, employee_id, body.level, client_ip(request))
    return user_to_dict(user) | {"level": access.level_of(user)}
