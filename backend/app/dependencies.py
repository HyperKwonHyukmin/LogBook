"""FastAPI 의존성: 저장소 경로, 인증(Bearer 토큰), 관리자 권한, 클라이언트 IP."""
from pathlib import Path

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from . import models, sessions
from .config import settings
from .database import get_db
from .storage.paths import StoragePaths


def get_storage() -> StoragePaths:
    return StoragePaths(Path(settings.storage_root))


def require_auth(
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
    return db.query(models.User).filter_by(employee_id=employee_id).one()


def require_admin(user: models.User = Depends(require_auth)) -> models.User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="admin_required")
    return user


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None
