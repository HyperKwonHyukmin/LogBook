"""가입 신청·로그인·로그아웃·내 정보. WorkBench routers/auth.py 에서 이식·축소했다."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import audit, models, sessions
from ..config import settings
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_auth
from ..identifiers import EMPLOYEE_ID_PATTERN
from ..schemas import LoginRequest, RegisterRequest, user_snapshot, user_to_dict
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _normalize(employee_id: str) -> str:
    return employee_id.strip().upper()


@router.post("/register", status_code=201)
def register(
    body: RegisterRequest,
    request: Request,
    db: Session = Depends(get_db),
    storage: StoragePaths = Depends(get_storage),
):
    employee_id = _normalize(body.employee_id)
    if not EMPLOYEE_ID_PATTERN.fullmatch(employee_id):
        raise HTTPException(status_code=422, detail="invalid_employee_id")
    if db.query(models.User).filter_by(employee_id=employee_id).first():
        raise HTTPException(status_code=409, detail="already_registered")
    user = models.User(
        employee_id=employee_id, name=body.name,
        department=body.department or None,
        position=body.position or None,
        status="pending", is_admin=False,
    )
    db.add(user)
    try:
        audit.record(db, storage, actor=employee_id, action="USER_REGISTER", target_type="user",
                     target_id=employee_id, after=user_snapshot(user), ip=client_ip(request))
    except IntegrityError:
        # 사전 조회와 커밋 사이 경쟁 — 동시에 같은 사번이 들어온 경우 unique 제약이 잡는다.
        db.rollback()
        raise HTTPException(status_code=409, detail="already_registered")
    return {"employee_id": employee_id, "status": "pending"}


@router.post("/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    employee_id = _normalize(body.employee_id)
    if not EMPLOYEE_ID_PATTERN.fullmatch(employee_id):
        raise HTTPException(status_code=422, detail="invalid_employee_id")
    user = db.query(models.User).filter_by(employee_id=employee_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="not_registered")
    if user.status == "pending":
        raise HTTPException(status_code=403, detail="pending_approval")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="account_disabled")
    user.login_count = (user.login_count or 0) + 1
    user.last_login = datetime.now().replace(microsecond=0)
    # 이 사용자의 만료된 세션을 로그인 시점에 정리한다(세션 테이블이 무한히 쌓이지 않게).
    db.query(models.UserSession).filter(
        models.UserSession.employee_id == user.employee_id,
        models.UserSession.expires_at < datetime.now(),
    ).delete(synchronize_session=False)
    db.commit()
    db.refresh(user)
    token = sessions.create(db, user.employee_id, hours=settings.session_hours)
    return {"token": token, "user": user_to_dict(user)}


@router.post("/logout")
def logout(request: Request, db: Session = Depends(get_db),
           user: models.User = Depends(require_auth)):
    # require_auth 가 scheme 을 대소문자 구분 없이 받으므로, 여기서도 같은 방식으로 잘라낸다
    # (그렇지 않으면 "bearer x" 로 로그인한 세션을 로그아웃에서 못 찾는다).
    _scheme, _, token = request.headers.get("Authorization", "").partition(" ")
    sessions.revoke(db, token.strip())
    return {"ok": True}


@router.get("/me")
def me(user: models.User = Depends(require_auth)):
    return user_to_dict(user)
