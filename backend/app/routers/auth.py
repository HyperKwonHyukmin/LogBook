"""로그인·로그아웃·내 정보(15 — 사용자는 WorkBench 가입자).

LogBook 에는 가입·승인 흐름이 없다. WorkBench users 표(읽기 전용, app/wb_users.py)에서 활성인 사번만 들어온다.
LogBook users 표는 사번 기준 캐시·등급 저장소 — 처음 들어오면 LV1 로 만들고, 들어올 때마다 이름·부서·직급·
WorkBench 관리자 여부를 WorkBench 값으로 맞춘다."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import audit, models, roles, sessions, wb_users
from ..config import settings
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_auth
from ..identifiers import EMPLOYEE_ID_PATTERN
from ..ops.registry import write_registry
from ..schemas import LoginRequest, user_snapshot, user_to_dict
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _normalize(employee_id: str) -> str:
    return employee_id.strip().upper()


@router.post("/register")
def register():
    """15 — LogBook 자체 가입은 없앴다. WorkBench 에서 가입·승인받은 사번으로 바로 들어온다."""
    raise HTTPException(status_code=410, detail="register_moved")


def admit(db: Session, storage: StoragePaths, employee_id: str, ip: str | None) -> models.User:
    """로그인 공통 절차 — 사번 로그인(/login)과 18 WorkBench 자동 로그인(/sso)이 같이 쓴다.

    WorkBench 표 확인(캐시 없이) → 활성 확인 → LogBook 행 맞추기(처음이면 LV1) → 로그인 횟수·시각 →
    만료 세션 정리 → 처음이면 USER_JOIN 감사 기록과 registry.json. 막히면 HTTPException(detail 은 사유 코드)."""
    if not EMPLOYEE_ID_PATTERN.fullmatch(employee_id):
        raise HTTPException(status_code=422, detail="invalid_employee_id")
    try:
        wb = wb_users.fetch(db, employee_id)   # 로그인은 캐시를 쓰지 않는다
    except wb_users.WbUnavailable:
        raise HTTPException(status_code=503, detail="wb_unavailable")
    wb_users.remember(wb, employee_id)
    if wb is None:
        raise HTTPException(status_code=404, detail="not_registered")
    if not wb.is_active:
        raise HTTPException(status_code=403, detail="wb_inactive")
    user, created = roles.ensure_local_user(db, wb)
    user.login_count = (user.login_count or 0) + 1
    user.last_login = datetime.now().replace(microsecond=0)
    # 이 사용자의 만료된 세션을 로그인 시점에 정리한다(세션 테이블이 무한히 쌓이지 않게).
    db.query(models.UserSession).filter(
        models.UserSession.employee_id == user.employee_id,
        models.UserSession.expires_at < datetime.now(),
    ).delete(synchronize_session=False)
    db.flush()
    if created:
        # 처음 들어온 WorkBench 가입자(LV1) — 감사 기록이 함께 커밋한다
        audit.record(db, storage, actor=user.employee_id, action="USER_JOIN", target_type="user",
                     target_id=user.employee_id, after=user_snapshot(user), ip=ip)
    else:
        db.commit()
    db.refresh(user)
    if created:
        write_registry(db, storage)  # 사용자 목록도 registry.json 에 남긴다(05 — 재구축 원천)
    return user


@router.post("/login")
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db),
          storage: StoragePaths = Depends(get_storage)):
    user = admit(db, storage, _normalize(body.employee_id), client_ip(request))
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
