"""로그인·로그아웃·내 정보(15 — 사용자는 WorkBench 가입자).

LogBook 에는 가입·승인 흐름이 없다. WorkBench users 표(읽기 전용, app/wb_users.py)에서 활성인 사번만 들어온다.
LogBook users 표는 사번 기준 캐시·등급 저장소 — 처음 들어오면 LV1 로 만들고, 들어올 때마다 이름·부서·직급·
WorkBench 관리자 여부를 WorkBench 값으로 맞춘다.

55 — 들어오는 길: Windows 계정 자동 로그인(/auth/windows 화면, /api/auth/windows 스크립트) · WorkBench 자동 로그인(/sso) ·
사번만 로그인(/api/auth/login, LOGBOOK_AUTH_MODE=windows 면 닫힘)."""
import logging
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy.orm import Session

from .. import audit, login_page, models, roles, sessions, wb_users, windows_auth
from ..config import settings
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_auth
from ..identifiers import EMPLOYEE_ID_PATTERN
from ..ops.registry import write_registry
from ..schemas import LoginRequest, user_snapshot, user_to_dict
from ..storage.paths import StoragePaths

log = logging.getLogger("logbook.auth")

router = APIRouter(prefix="/api/auth", tags=["auth"])
page_router = APIRouter(tags=["auth"])   # 55 — /auth/windows(브라우저 최상위 이동). SPA(mount_spa)보다 먼저 등록한다


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
    if settings.auth_mode == "windows":
        # 55 — 사번은 비밀이 아니다. 145 는 Windows 계정 확인(/auth/windows)이나 WorkBench(/sso)로만 들어온다
        raise HTTPException(status_code=403, detail="employee_id_login_disabled")
    user = admit(db, storage, _normalize(body.employee_id), client_ip(request))
    token = sessions.create(db, user.employee_id, hours=settings.session_hours)
    return {"token": token, "user": user_to_dict(user)}


@router.get("/options")
def options():
    """55 — 로그인 화면 분기: Windows 계정 자동 로그인을 쓸 수 있는지, 사번 입력 칸을 보일지."""
    return {"windows": windows_auth.enabled(), "employee_id_login": settings.auth_mode != "windows"}


class WindowsAuthFailed(Exception):
    """Windows 계정 확인 실패. reason = 사유 코드(화면 `?windows=` 와 API detail 에 그대로), headers = 401 도전 헤더."""

    def __init__(self, status: int, reason: str, headers: dict | None = None):
        super().__init__(reason)
        self.status, self.reason, self.headers = status, reason, headers


def _windows_admit(request: Request, db: Session, storage: StoragePaths) -> tuple[models.User, str]:
    """Negotiate 한 걸음 → 끝났으면 사번 로그인과 같은 절차(admit). 돌려주는 값 = (사용자, 상호 인증 토큰).

    ⚠ 실패 응답에는 WWW-Authenticate 를 다시 붙이지 않는다 — 붙이면 브라우저가 같은 실패를 되풀이한다."""
    if not windows_auth.enabled():
        raise WindowsAuthFailed(404, "windows_login_disabled")
    ip = client_ip(request)
    conn_key = (ip, request.client.port if request.client else None)
    authorization = request.headers.get("authorization", "")
    limiter = windows_auth.login_attempt_limiter
    # NTLM 응답은 도메인 컨트롤러로 가서 틀리면 그 직원 계정의 실패 횟수를 올린다(계정 잠금) — 묻기 전에 막는다
    claimed = (windows_auth.employee_id_from_account(windows_auth.ntlm_claimed_account(authorization) or "")
               or windows_auth.unknown_key(ip))
    if authorization and limiter.is_blocked(claimed, ip):
        log.warning("Windows 로그인 횟수 제한: %s", claimed)
        raise WindowsAuthFailed(429, "too_many_attempts")
    step = windows_auth.negotiate_sessions.step(conn_key, authorization)
    if step.kind in ("challenge", "continue"):
        header = f"Negotiate {step.out_token}" if step.out_token else "Negotiate"
        raise WindowsAuthFailed(401, "negotiate", {"WWW-Authenticate": header})
    if step.kind == "error":
        limiter.record_failure(claimed, ip)
        log.warning("Windows 로그인 실패(%s): %s", step.mechanism or "-", step.error)
        raise WindowsAuthFailed(401, "windows_auth_failed")
    employee_id = windows_auth.employee_id_from_account(step.account)
    if not employee_id:
        # 로컬 계정·다른 도메인·사번이 아닌 공용 계정. 계정 이름은 그 PC 사용자 자신의 것이라 기록해도 된다
        log.warning("Windows 로그인 거절(사번 계정 아님): %s", step.account[:64])
        raise WindowsAuthFailed(403, "windows_account_not_employee")
    limiter.reset(employee_id)
    try:
        user = admit(db, storage, employee_id, ip)
    except HTTPException as exc:
        raise WindowsAuthFailed(exc.status_code, exc.detail if isinstance(exc.detail, str) else "login_failed")
    return user, step.out_token


@router.post("/windows")
def login_windows(request: Request, db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage)):
    """55 — 스크립트·관리 작업용 Windows 계정 로그인. 본문 없이 보낸다: `curl.exe --negotiate -u : -X POST <주소>`.
    응답은 /login 과 같은 {token, user}."""
    try:
        user, out_token = _windows_admit(request, db, storage)
    except WindowsAuthFailed as exc:
        raise HTTPException(status_code=exc.status, detail=exc.reason, headers=exc.headers)
    token = sessions.create(db, user.employee_id, hours=settings.session_hours)
    headers = {"WWW-Authenticate": f"Negotiate {out_token}"} if out_token else {}
    return JSONResponse({"token": token, "user": user_to_dict(user)}, headers=login_page.HEADERS | headers)


@page_router.get("/auth/windows", include_in_schema=False)
def login_windows_page(request: Request, next: str | None = Query(default=None),
                       db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage)) -> HTMLResponse:
    """55 — 로그인 화면이 최상위 이동으로 보내는 경로. 크롬이 Windows 계정을 자동으로 보내면 토큰을 심고 next 로 간다.

    401 도전 응답의 본문도 로그인 화면으로 넘어가는 HTML 이다 — 브라우저가 계정을 보내지 못하면(도메인 밖 PC 등)
    그 본문이 보이며 `/login?windows=unavailable` 로 간다. 실패는 `/login?windows=<사유>`."""
    target = login_page.safe_next(next)
    try:
        user, out_token = _windows_admit(request, db, storage)
    except WindowsAuthFailed as exc:
        reason = "unavailable" if exc.reason == "negotiate" else exc.reason
        path = f"/login?windows={quote(reason)}" + (f"&next={quote(target)}" if target != "/" else "")
        return login_page.redirect_page(path, exc.status, exc.headers)
    token = sessions.create(db, user.employee_id, hours=settings.session_hours)
    headers = {"WWW-Authenticate": f"Negotiate {out_token}"} if out_token else None
    return login_page.success_page(token, user.employee_id, None, target, headers)


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
