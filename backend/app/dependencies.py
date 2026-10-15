"""FastAPI 의존성: 저장소 경로, 인증(Bearer 토큰), 관리자 권한, 클라이언트 IP."""
from pathlib import Path

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from . import access, models, roles, sessions, wb_users
from .config import settings
from .database import get_db
from .storage.paths import StoragePaths


def get_storage() -> StoragePaths:
    return StoragePaths(Path(settings.storage_root))


# 15 — WorkBench 표를 읽을 수 없는 동안에도 열어 두는 경로. 로그아웃은 누구나, 내 정보·운영 상태는
# 마지막으로 확인된 LV3 만(관리자가 운영 화면에서 'WorkBench 사용자 표: 연결 안 됨' 원인을 볼 수 있게)
WB_DOWN_ANYONE = ("/api/auth/logout",)
WB_DOWN_LEVEL3 = ("/api/auth/me", "/api/admin/ops/status")


def require_auth(
    request: Request,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> models.User:
    if not authorization:
        raise HTTPException(status_code=401, detail="auth_required")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="auth_required")
    employee_id = sessions.resolve(db, token.strip())
    if not employee_id:
        raise HTTPException(status_code=401, detail="session_invalid")
    user = db.query(models.User).filter_by(employee_id=employee_id).one()
    return _check_workbench(db, user, request.url.path)


def _check_workbench(db: Session, user: models.User, path: str = "") -> models.User:
    """15 — 매 요청 WorkBench 활성 여부를 본다(사번별 짧은 캐시, wb_users.cached).

    WorkBench 에서 비활성·삭제되면 그 사람의 세션을 모두 지우고 401 wb_inactive(다음 요청에서 끊긴다).
    표를 읽을 수 없으면 503 wb_unavailable — 조용히 통과시키지 않는다(토큰은 지우지 않는다).
    관리자 여부·이름이 바뀌었으면 LogBook 행에 맞춘다(실효 등급이 바로 따라온다)."""
    try:
        wb = wb_users.cached(db, user.employee_id)
    except wb_users.WbUnavailable:
        if path in WB_DOWN_ANYONE or (path in WB_DOWN_LEVEL3 and access.is_admin(user)):
            return user
        raise HTTPException(status_code=503, detail="wb_unavailable")
    if wb is None or not wb.is_active:
        sessions.revoke_all(db, user.employee_id)
        raise HTTPException(status_code=401, detail="wb_inactive")
    if roles.apply_wb(user, wb):
        db.commit()
        db.refresh(user)
    return user


def require_admin(user: models.User = Depends(require_auth)) -> models.User:
    """LV3(관리자, 15) — WorkBench 관리자는 자동 LV3."""
    if not access.is_admin(user):
        raise HTTPException(status_code=403, detail="admin_required")
    return user


def require_writer(user: models.User = Depends(require_auth)) -> models.User:
    """올리기 등 쓰기 — 로그인한 누구나(LV1 이상, 15). 13 의 guest 403 은 없어졌다(자리만 남김)."""
    access.require_writer(user)
    return user


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None
