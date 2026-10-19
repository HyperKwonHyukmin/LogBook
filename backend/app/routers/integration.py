"""18 — HiTESS WorkBench 연동(서버 간 API + 자동 로그인 /sso).

계획: docs/plans/2026-10-08-logbook-18-workbench-link.md §6·§7(인터페이스 계약).

- 서버 간 요청은 헤더 `X-HiTESS-Integration: <공유 비밀키>` 로 신원을 밝힌다(hmac.compare_digest 비교).
  비밀키 설정(LOGBOOK_WB_INTEGRATION_SECRET)이 비어 있으면 연동 전체가 꺼진다 — 통합 API 는 404 로 경로를 숨기고
  /sso 는 안내 화면을 보인다(fail-closed). 키가 설정됐는데 헤더가 없거나 틀리면 401 integration_unauthorized.
- 비밀키는 '서버 신원'만 증명한다. 파일 권한은 `as` 로 받은 사번의 LogBook 권한(files._file)으로 그대로 검사한다.
- 자동 로그인: WorkBench 가 준 일회 코드를 WorkBench 서버(/api/logbook/redeem)에 직접 물어 사번을 받고,
  사번 로그인과 같은 절차(auth.admit)를 밟아 세션을 만든다. 토큰은 작은 HTML 이 localStorage 에 넣는다.
  ⚠ 코드·토큰은 로그에 남기지 않는다."""
import hmac
import html
import json
import logging
import os
import re
import urllib.error
import urllib.request
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from .. import access, audit, models, roles, sessions, wb_targets, wb_users
from ..config import settings
from ..database import get_db
from ..dependencies import client_ip, get_storage
from ..identifiers import EMPLOYEE_ID_PATTERN
from ..storage.paths import StoragePaths
from ..uploads import service as upload_service
from . import auth as auth_router
from . import files as files_router

log = logging.getLogger("logbook.integration")

router = APIRouter(prefix="/api/integration", tags=["integration"])
sso_router = APIRouter(tags=["integration"])   # /sso — SPA(mount_spa)보다 먼저 등록한다

SECRET_HEADER = "X-HiTESS-Integration"
REDEEM_TIMEOUT = 5          # 초 — WorkBench 서버가 응답하지 않으면 안내 화면으로 끝낸다
CODE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,128}$")   # secrets.token_urlsafe(32) = 43자
WB_REF_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")        # sha256 hex
PICK_TARGETS = ("gmu", "truss")  # gmu = GMU 권상(작업 탭 1..4), truss = Truss Structural Assessment(단일 화면)
PICK_SLOTS = range(1, 5)


# ---- 비밀키 ----

def _secret_ok(given: str | None) -> bool:
    secret = settings.wb_integration_secret
    return bool(secret) and given is not None and hmac.compare_digest(given.encode("utf-8"), secret.encode("utf-8"))


def require_integration(x_hitess_integration: str | None = Header(default=None)) -> None:
    """통합 API 공통 — 연동이 꺼져 있으면 404(경로를 숨긴다), 비밀키가 없거나 틀리면 401."""
    if not settings.wb_integration_secret:
        raise HTTPException(status_code=404, detail="not_found")
    if not _secret_ok(x_hitess_integration):
        raise HTTPException(status_code=401, detail="integration_unauthorized")


# ---- WorkBench 로그아웃 연동 ----

class LogoutBody(BaseModel):
    wb_ref: str = Field(min_length=1, max_length=64)


@router.post("/logout", dependencies=[Depends(require_integration)])
def wb_logout(body: LogoutBody, db: Session = Depends(get_db)):
    """WorkBench 에서 로그아웃한 세션(wb_ref)으로 만든 LogBook 세션을 모두 지운다. 없으면 0(멱등)."""
    if not WB_REF_PATTERN.fullmatch(body.wb_ref):
        raise HTTPException(status_code=422, detail="invalid_wb_ref")
    return {"revoked": sessions.revoke_wb_ref(db, body.wb_ref.lower())}


# ---- 31: LogBook 등급 알려 주기(WorkBench 사용자 관리 화면) ----

@router.get("/levels", dependencies=[Depends(require_integration)])
def wb_levels(db: Session = Depends(get_db)):
    """LogBook 에 행이 있는 사용자의 저장 등급. WorkBench 는 자기 관리자(is_admin)면 3, 여기 없는 사람은 1 로 본다
    (access.level_of 와 같은 규칙 — 관리자 여부는 WorkBench 가 원본이라 여기서 다시 판단하지 않는다)."""
    rows = db.query(models.User.employee_id, models.User.level, models.User.last_login)
    return {"labels": {str(k): v for k, v in access.LEVEL_LABELS.items()},
            "levels": {e: {"level": lv if lv in access.LEVELS else 1,
                           "last_login": last.isoformat() if last else None} for e, lv, last in rows}}


# ---- 모델 파일 내보내기(WorkBench GMU 가져오기) ----

def _acting_user(db: Session, employee_id: str) -> models.User:
    """`as` 사번 — LogBook 에 있는 활성 사용자이고 WorkBench 에서도 아직 활성이어야 한다.
    아니면 404(파일이 없는 것과 같은 응답 — 누가 무엇을 볼 수 있는지 드러내지 않는다)."""
    eid = (employee_id or "").strip().upper()
    if not EMPLOYEE_ID_PATTERN.fullmatch(eid):
        raise HTTPException(status_code=404, detail="file_not_found")
    user = db.query(models.User).filter_by(employee_id=eid, status="active").first()
    if user is None:
        raise HTTPException(status_code=404, detail="file_not_found")
    try:
        wb = wb_users.cached(db, eid)
    except wb_users.WbUnavailable:
        raise HTTPException(status_code=503, detail="wb_unavailable")
    if wb is None or not wb.is_active:
        raise HTTPException(status_code=404, detail="file_not_found")
    if roles.apply_wb(user, wb):   # WorkBench 관리자 여부가 바뀌었으면 실효 등급을 맞춘 뒤 검사한다
        db.commit()
        db.refresh(user)
    return user


@router.get("/files/{file_id}/content", dependencies=[Depends(require_integration)])
def export_content(file_id: int, request: Request, as_: str = Query(default="", alias="as"),
                   target: str | None = Query(default=None),
                   db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage)):
    """BDF 원본 바이트 — `as` 사번이 볼 수 있는 모델만. 404 = 없음·권한 밖, 415 not_bdf, 409 has_includes.
    files.content 와 같은 규칙으로 흘려보낸다(read 바이트, DRM 파일은 Content-Length 를 뺀다).

    18-b — target(gmu|truss)을 주면 그 앱의 분류 규칙(wb_targets)도 검사한다. 모르는 target 은 422(입력 오류라
    권한 검사보다 먼저 — 드러나는 정보가 없다). 검사 순서: 404(권한) → 415 → 409 has_includes → 409 target_not_allowed.
    거절 본문은 최상위에 {"detail": "target_not_allowed", "message": 사유} — WorkBench 가 message 를 그대로 전한다."""
    if target is not None:
        wb_targets.check_target(target)
    user = _acting_user(db, as_)
    f = files_router._file(db, file_id, user)
    if f.kind != "model":
        raise HTTPException(status_code=415, detail="not_bdf")
    s = db.get(models.ModelSummary, f.id)
    # GMU 는 BDF 1개만 받는다 — INCLUDE 한 형제 파일(찾은 것·못 찾은 것)이 있으면 막는다(§6-5)
    if s is not None and (s.includes or s.missing):
        raise HTTPException(status_code=409, detail="has_includes")
    if target is not None:
        ok, why = wb_targets.Matcher(db, target).file(f)
        if not ok:
            # HTTPException(detail=dict) 는 {"detail": {...}} 로 감싸므로 JSONResponse 로 최상위에 둔다
            return JSONResponse(status_code=409, content={"detail": "target_not_allowed", "message": why})
    path = files_router._path(db, storage, f)
    e = db.get(models.Entry, f.entry_id) if f.entry_id else None
    name, drm, sha = f.name, bool(f.drm_encrypted), f.sha256
    entry_code = e.entry_id if e is not None and e.entry_id else ""
    try:
        fh = open(path, "rb")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="file_missing")
    except OSError:
        raise HTTPException(status_code=503, detail="storage_unreachable")
    try:
        audit.record(db, storage, actor=user.employee_id, action="WB_EXPORT", target_type="file",
                     target_id=str(f.id),
                     after={"name": name, "entry": entry_code or None, "sha256": sha, "target": target},
                     ip=client_ip(request))
    except Exception:
        fh.close()
        raise
    # 큰 파일을 흘려보내는 동안 DB 연결을 붙잡지 않는다(files.content 와 같은 이유)
    db.close()
    headers = {"Content-Disposition": files_router._disposition(name, False), "Cache-Control": "private, no-store",
               "X-Content-Type-Options": "nosniff", "X-LogBook-Entry": entry_code,
               "X-LogBook-File-Name": quote(name), "X-LogBook-Sha256": sha}
    if not drm:
        headers["Content-Length"] = str(os.fstat(fh.fileno()).st_size)

    def stream():
        with fh:
            while chunk := fh.read(files_router.STREAM_CHUNK):
                yield chunk

    return StreamingResponse(stream(), media_type="application/octet-stream", headers=headers)


# ---- WorkBench → LogBook 보내기(WB 관리자 'All Projects') ----
# 19 — WB 관리자가 고른 해석 입력·결과 파일을 그 관리자의 '정리 대기' 묶음으로 올린다.
# 크롬 업로드(uploads.service)와 같은 시작 → 조각 → 마치기 흐름이고, 올린 사람 = `as` 사번이다.
# 그래서 이후 정리(제목·호선·확정)는 그 관리자가 LogBook 정리 대기 화면에서 평소처럼 한다.

class WbUploadBegin(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    # 출처 — {analysis_id, owner, program, project, note}. 감사 기록(WB_UPLOAD)에만 남긴다.
    origin: dict | None = None


def _wb_sender(db: Session, storage: StoragePaths, employee_id: str, ip: str | None) -> models.User:
    """보내는 사람 — WorkBench 에서 활성 '관리자'여야 한다(WB 도 막지만 여기서 한 번 더).
    LogBook 에 처음 오는 관리자면 사번 로그인과 같은 절차(admit)로 행을 만든다."""
    eid = (employee_id or "").strip().upper()
    if not EMPLOYEE_ID_PATTERN.fullmatch(eid):
        raise HTTPException(status_code=422, detail="invalid_employee_id")
    try:
        wb = wb_users.cached(db, eid)
    except wb_users.WbUnavailable:
        raise HTTPException(status_code=503, detail="wb_unavailable")
    if wb is None or not wb.is_active or not wb.is_admin:
        raise HTTPException(status_code=403, detail="sender_not_admin")
    if db.query(models.User.id).filter_by(employee_id=eid).first() is None:
        return auth_router.admit(db, storage, eid, ip)
    user = db.query(models.User).filter_by(employee_id=eid).first()
    if user.status != "active":
        raise HTTPException(status_code=403, detail="sender_inactive")
    if roles.apply_wb(user, wb):
        db.commit()
        db.refresh(user)
    access.require_writer(user)
    return user


@router.post("/uploads", status_code=201, dependencies=[Depends(require_integration)])
def wb_upload_begin(body: WbUploadBegin, request: Request, as_: str = Query(default="", alias="as"),
                    db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage)):
    user = _wb_sender(db, storage, as_, client_ip(request))
    b = upload_service.begin(db, storage, user, name=body.name, target_entry_id=None)
    try:
        audit.record(db, storage, actor=user.employee_id, action="WB_UPLOAD", target_type="batch",
                     target_id=b.key, after={"name": b.original_name, "origin": body.origin or {}},
                     ip=client_ip(request))
    except Exception:
        db.rollback()
        log.exception("WorkBench 보내기 %s 감사 기록 실패(업로드는 계속)", b.key)
    return {"key": b.key, "state": b.state}


@router.put("/uploads/{key}/chunk", dependencies=[Depends(require_integration)])
async def wb_upload_chunk(key: str, request: Request, path: str = Query(...), offset: int = Query(ge=0),
                          as_: str = Query(default="", alias="as"),
                          db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage)):
    too_large = HTTPException(status_code=413, detail="chunk_too_large")
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > upload_service.MAX_CHUNK:
        raise too_large
    buf = bytearray()
    async for part in request.stream():
        buf += part
        if len(buf) > upload_service.MAX_CHUNK:
            raise too_large
    user = await run_in_threadpool(_wb_sender, db, storage, as_, client_ip(request))
    size = await run_in_threadpool(upload_service.write_chunk, db, storage, user, key, path, offset, bytes(buf))
    return {"size": size}


class WbDeclaredFile(BaseModel):
    rel_path: str
    size: int = Field(ge=0)


class WbRejectedFile(BaseModel):
    rel_path: str
    reason: str = "drm"


class WbUploadFinish(BaseModel):
    files: list[WbDeclaredFile]
    rejected: list[WbRejectedFile] = []


@router.post("/uploads/{key}/finish", dependencies=[Depends(require_integration)])
def wb_upload_finish(key: str, body: WbUploadFinish, request: Request, as_: str = Query(default="", alias="as"),
                     db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage)):
    """{key(모두 막히면 None), state: staged|blocked, blocked: [이미 LogBook 에 있는 같은 BDF], deferred}.
    완전 동일 BDF 는 크롬 업로드와 똑같이 받지 않는다(force 없음 — 필요하면 LogBook 화면에서 직접 올린다)."""
    user = _wb_sender(db, storage, as_, client_ip(request))
    return upload_service.finish(db, storage, user, key, files=[f.model_dump() for f in body.files],
                                 rejected=[r.model_dump() for r in body.rejected], force=False)


@router.delete("/uploads/{key}", status_code=204, dependencies=[Depends(require_integration)])
def wb_upload_cancel(key: str, request: Request, as_: str = Query(default="", alias="as"),
                     db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage)):
    user = _wb_sender(db, storage, as_, client_ip(request))
    upload_service.cancel(db, storage, user, key)
    return Response(status_code=204)


# ---- 자동 로그인(/sso) ----

class RedeemError(Exception):
    """일회 코드 교환 실패. reason = code_invalid | wb_unreachable | redeem_failed."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def redeem_code(code: str) -> dict:
    """WorkBench 서버에 일회 코드를 물어 {employee_id, wb_ref, wb_expires_at} 를 받는다(코드는 그쪽에서 즉시 소멸).
    테스트는 이 함수를 바꿔 끼운다."""
    req = urllib.request.Request(
        f"{settings.wb_api_url}/api/logbook/redeem", method="POST",
        data=json.dumps({"code": code}).encode("utf-8"),
        headers={"Content-Type": "application/json", SECRET_HEADER: settings.wb_integration_secret})
    try:
        with urllib.request.urlopen(req, timeout=REDEEM_TIMEOUT) as res:   # noqa: S310 (설정된 내부 주소)
            data = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RedeemError("code_invalid" if exc.code in (400, 404, 410) else "redeem_failed") from None
    except (urllib.error.URLError, OSError, TimeoutError):
        raise RedeemError("wb_unreachable") from None
    except ValueError:
        raise RedeemError("redeem_failed") from None
    if not isinstance(data, dict) or not isinstance(data.get("employee_id"), str):
        raise RedeemError("redeem_failed")
    return data


def _wb_expiry(value) -> datetime | None:
    """WorkBench 세션 만료 시각 → 이 서버의 naive 지역 시각. 숫자면 epoch 초, 문자열이면 ISO 8601.
    읽을 수 없으면 None(그때는 LogBook 세션 시간만 쓴다)."""
    try:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return datetime.fromtimestamp(value)
        if isinstance(value, str) and value.strip():
            dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
            return dt.astimezone().replace(tzinfo=None) if dt.tzinfo else dt
    except (ValueError, OverflowError, OSError):
        return None
    return None


def _pick(target: str | None, slot: str | None) -> dict:
    """선택 모드(§6-1) — target 이 'gmu'|'truss' 이고 slot 이 1..4 정수일 때만. 아니면 {}(WorkBench 경유 표시만 남는다).

    truss 는 작업 탭이 없는 단일 화면이라 slot 을 1 로 맞춘다(WB 는 항상 1 을 보낸다).
    """
    if target not in PICK_TARGETS or slot is None or not re.fullmatch(r"[1-9]", slot.strip()):
        return {}
    n = int(slot.strip())
    if n not in PICK_SLOTS:
        return {}
    return {"target": target, "slot": 1 if target == "truss" else n}


def _js(value) -> str:
    """HTML <script> 안에 넣을 JS 값 — JSON 으로 쓰고 </script>·주석·HTML 해석에 걸리는 글자를 \\u 로 바꾼다."""
    return (json.dumps(value, ensure_ascii=True).replace("<", "\\u003c").replace(">", "\\u003e")
            .replace("&", "\\u0026").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))


SSO_HEADERS = {"Cache-Control": "no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer",
               "X-Content-Type-Options": "nosniff"}

# 실패 사유 → (HTTP 상태, 안내 문구)
SSO_FAILURES = {
    "integration_disabled": (404, "이 LogBook 서버는 WorkBench 연동이 꺼져 있습니다. 관리자에게 알려 주세요."),
    "code_invalid": (401, "자동 로그인 코드가 만료되었거나 이미 사용되었습니다. WorkBench 에서 다시 열어 주세요."),
    "wb_unreachable": (502, "WorkBench 서버에 연결할 수 없어 자동 로그인하지 못했습니다. 잠시 뒤 WorkBench 에서 다시 열어 주세요."),
    "redeem_failed": (502, "WorkBench 서버가 자동 로그인 요청을 처리하지 못했습니다. WorkBench 에서 다시 열어 주세요."),
    "wb_session_expired": (401, "WorkBench 로그인이 만료되었습니다. WorkBench 에 다시 로그인한 뒤 열어 주세요."),
    "not_registered": (403, "WorkBench 에 가입된 사번이 아닙니다. HiTESS WorkBench 에서 가입·승인받은 뒤 들어오세요."),
    "wb_inactive": (403, "WorkBench 에서 승인 대기 중이거나 비활성화된 계정입니다. WorkBench 관리자에게 문의하세요."),
    "invalid_employee_id": (403, "WorkBench 사번 형식을 읽을 수 없습니다. 관리자에게 알려 주세요."),
    "wb_unavailable": (503, "WorkBench 사용자 정보를 읽을 수 없어 로그인하지 못했습니다. 잠시 뒤 다시 시도해 주세요."),
}


def _failure_page(reason: str) -> HTMLResponse:
    status, text = SSO_FAILURES.get(reason, SSO_FAILURES["redeem_failed"])
    body = f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Hi-TESS LogBook</title>
<style>
body{{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f7f9;
font-family:"SUIT","Inter","Malgun Gothic",system-ui,sans-serif;color:#1b2430}}
main{{max-width:420px;margin:24px;padding:28px 28px 24px;background:#fff;border:1px solid #dde1e7;border-radius:10px}}
h1{{margin:0 0 8px;font-size:18px;font-weight:600}}p{{margin:0 0 20px;font-size:14px;line-height:22px;color:#46505c}}
a{{display:inline-block;padding:7px 14px;border-radius:6px;background:#002554;color:#fff;text-decoration:none;font-size:14px}}
</style></head><body><main>
<h1>자동 로그인하지 못했습니다</h1>
<p>{html.escape(text)}</p>
<a href="/login">사번으로 로그인</a>
</main></body></html>"""
    return HTMLResponse(body, status_code=status, headers=SSO_HEADERS)


# 19 — 자동 로그인 뒤 열 화면. 허용 목록만(열린 리다이렉트 방지), 그 밖은 첫 화면.
SSO_NEXT_PATHS = {"inbox": "/inbox"}


def _success_page(token: str, employee_id: str, pick: dict, next_path: str = "/") -> HTMLResponse:
    if next_path not in SSO_NEXT_PATHS.values():   # 허용 목록의 상수만 스크립트에 그대로 넣는다
        next_path = "/"
    # 다른 사람이 쓰던 창이면 그 사람이 보내지 못한 화면 설정(prefs)을 새 사용자에게 보내지 않게 지운다
    body = f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<title>Hi-TESS LogBook</title></head><body>
<script>
(function () {{
  var token = {_js(token)}, eid = {_js(employee_id)}, pick = {_js(pick)};
  try {{
    if (localStorage.getItem('logbook_saved_employee_id') !== eid) localStorage.removeItem('logbook.prefsUnsent.v1');
    localStorage.setItem('logbook_token', token);
    localStorage.setItem('logbook_saved_employee_id', eid);
  }} catch (e) {{}}
  // 18-b — 새 선택 모드마다 자동 검색 필터를 다시 한 번 켠다(같은 창을 다른 대상으로 다시 열 때)
  try {{ sessionStorage.setItem('logbook_wb', JSON.stringify(pick)); sessionStorage.removeItem('logbook_wb_filter_applied'); }} catch (e) {{}}
  location.replace('{next_path}');
}})();
</script>
<noscript>JavaScript 가 꺼져 있어 로그인할 수 없습니다. <a href="/login">사번으로 로그인</a></noscript>
</body></html>"""
    return HTMLResponse(body, status_code=200, headers=SSO_HEADERS)


@sso_router.get("/sso", include_in_schema=False)
def sso(request: Request, code: str = Query(default=""), target: str | None = Query(default=None),
        slot: str | None = Query(default=None), next: str | None = Query(default=None),
        db: Session = Depends(get_db),
        storage: StoragePaths = Depends(get_storage)):
    """WorkBench 자동 로그인 — 일회 코드 교환 → 사번 로그인과 같은 절차 → 세션(wb_ref, 만료 상한) → 토큰을 심는 HTML."""
    if not settings.wb_integration_secret:
        return _failure_page("integration_disabled")
    if not CODE_PATTERN.fullmatch(code or ""):
        return _failure_page("code_invalid")
    try:
        data = redeem_code(code)
    except RedeemError as exc:
        log.warning("WorkBench 자동 로그인 코드 교환 실패: %s", exc.reason)
        return _failure_page(exc.reason)
    wb_ref = data.get("wb_ref")
    wb_ref = wb_ref.lower() if isinstance(wb_ref, str) and WB_REF_PATTERN.fullmatch(wb_ref) else None
    expires = _wb_expiry(data.get("wb_expires_at"))
    if expires is not None and expires <= datetime.now():
        return _failure_page("wb_session_expired")
    try:
        user = auth_router.admit(db, storage, auth_router._normalize(data["employee_id"]), client_ip(request))
    except HTTPException as exc:
        return _failure_page(exc.detail if isinstance(exc.detail, str) else "redeem_failed")
    token = sessions.create(db, user.employee_id, hours=settings.session_hours, wb_ref=wb_ref, expires_at=expires)
    return _success_page(token, user.employee_id, _pick(target, slot), SSO_NEXT_PATHS.get(next or "", "/"))
