"""55 — Windows 계정 자동 로그인(Windows 통합 인증, Negotiate). WorkBench services/windows_auth.py 를 이식했다.

왜: 사번만 로그인은 남의 사번으로 들어올 수 있다(2026-11-06 보안 점검). Negotiate 는 Windows 가 지금 로그인한 계정으로
일회용 증명 토큰을 만들어 보내므로 비밀번호가 망에 흐르지 않고, 사번 입력도 필요 없다(계정 이름 ``HHI\\<사번>``).
크롬은 같은 PC 시험에서 IP 주소로도 입력 창 없이 NTLM 을 보냈다(docs/plans/2026-11-06-logbook-55-windows-login.md).

- NTLM 은 한 TCP 연결에서 두 번 오간다(협상 → 도전 → 응답). 진행 중인 SSPI 상태를 연결(클라이언트 IP + 포트)마다
  30초 들고 있는다. ⚠ 프로세스 메모리라 API 는 uvicorn 프로세스 하나여야 한다(server_manager.API_CMD, --workers 금지).
- 받는 계정은 설정된 도메인(LOGBOOK_AD_DOMAIN, 기본 HHI)의 사번 모양 이름뿐이다.
- 틀린 시도는 사번·IP 별로 세어 도메인 컨트롤러에 묻기 전에 막는다(직원 회사 계정 잠금 방지).
- 토큰은 기록하지 않는다."""
from __future__ import annotations

import base64
import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Any, Callable

from .config import settings
from .identifiers import EMPLOYEE_ID_PATTERN

PENDING_TTL_SEC = 30
MAX_PENDING = 500
MAX_PENDING_PER_IP = 10   # 한 IP 가 협상 표를 채워 다른 사람의 자동 로그인을 막지 못하게

# sspicon 값(pywin32 가 없는 PC 에서도 모듈을 import 할 수 있게 숫자로 둔다)
SEC_I_CONTINUE_NEEDED = 0x00090312

# 틀린 시도 제한 — WorkBench 비밀번호·Windows 로그인과 같은 값
FAIL_WINDOW_SEC = 15 * 60
MAX_FAILURES_PER_EMPLOYEE = 4
MAX_FAILURES_PER_IP = 20


def _sspi_available() -> bool:
    try:
        import sspi  # noqa: F401  (pywin32)
        return True
    except Exception:
        return False


def enabled() -> bool:
    return settings.windows_login and _sspi_available()


def _default_server_auth():
    import sspi
    return sspi.ServerAuth("Negotiate")


def _account_name(server_auth) -> str:
    import sspicon
    return server_auth.ctxt.QueryContextAttributes(sspicon.SECPKG_ATTR_NAMES)


@dataclass(frozen=True)
class NegotiateStep:
    """한 번의 요청 결과. kind = challenge | continue | done | error."""
    kind: str
    out_token: str = ""      # base64, WWW-Authenticate: Negotiate <out_token>
    account: str = ""        # done 일 때 'HHI\\A476854'
    mechanism: str = ""      # NTLM | Kerberos
    error: str = ""


class NegotiateSessions:
    def __init__(self, server_auth_factory: Callable[[], Any] = _default_server_auth,
                 account_name: Callable[[Any], str] = _account_name,
                 now: Callable[[], float] = time.monotonic):
        self._factory = server_auth_factory
        self._account_name = account_name
        self._now = now
        self._lock = threading.Lock()
        self._pending: dict[tuple, tuple[Any, str, float]] = {}

    def _prune(self) -> None:
        cutoff = self._now() - PENDING_TTL_SEC
        for key in [k for k, (_, _, t) in self._pending.items() if t < cutoff]:
            del self._pending[key]

    def step(self, conn_key: tuple, authorization: str) -> NegotiateStep:
        scheme, _, b64 = (authorization or "").strip().partition(" ")
        if scheme.lower() not in ("negotiate", "ntlm") or not b64.strip():
            with self._lock:
                self._pending.pop(conn_key, None)
            return NegotiateStep("challenge")
        try:
            token = base64.b64decode(b64.strip(), validate=True)
        except Exception:
            return NegotiateStep("error", error="bad_token")

        with self._lock:
            self._prune()
            entry = self._pending.pop(conn_key, None)
            if entry is None:
                same_ip = sum(1 for k in self._pending if k[0] == conn_key[0])
                if len(self._pending) >= MAX_PENDING or same_ip >= MAX_PENDING_PER_IP:
                    return NegotiateStep("error", error="busy")
        if entry is None:
            # 첫 토큰의 모양으로 방식을 가른다(NTLM 은 'NTLMSSP' 서명이 그대로 들어 있다)
            server_auth, mechanism = self._factory(), ("NTLM" if b"NTLMSSP" in token else "Kerberos")
        else:
            server_auth, mechanism, _ = entry

        try:
            err, out = server_auth.authorize(token)
        except Exception as exc:  # 틀린 토큰·로컬 계정·만료 등 — SSPI 가 거절
            return NegotiateStep("error", mechanism=mechanism, error=str(exc)[:200])
        out_bytes = bytes(out[0].Buffer) if out and out[0].Buffer else b""
        out_token = base64.b64encode(out_bytes).decode() if out_bytes else ""

        if err == SEC_I_CONTINUE_NEEDED:
            with self._lock:
                self._pending[conn_key] = (server_auth, mechanism, self._now())
            return NegotiateStep("continue", out_token=out_token, mechanism=mechanism)
        if err != 0:
            return NegotiateStep("error", mechanism=mechanism, error=f"sspi_status_{err:#x}")
        try:
            account = self._account_name(server_auth)
        except Exception as exc:
            return NegotiateStep("error", mechanism=mechanism, error=f"account_name: {exc}"[:200])
        return NegotiateStep("done", out_token=out_token, account=account, mechanism=mechanism)


def ntlm_claimed_account(authorization: str) -> str | None:
    """NTLM 응답(3번째) 메시지에 평문으로 든 'DOMAIN\\user' — SSPI(도메인 컨트롤러)에 묻기 전에 읽는다.

    확인된 값이 아니다(보낸 사람이 적은 이름) — 횟수 제한 키로만 쓰고 로그인 판단에는 쓰지 않는다.
    NTLM 이 아니거나(Kerberos) 모양이 틀리면 None."""
    scheme, _, b64 = (authorization or "").strip().partition(" ")
    if scheme.lower() not in ("negotiate", "ntlm"):
        return None
    try:
        token = base64.b64decode(b64.strip(), validate=True)
    except Exception:
        return None
    start = token.find(b"NTLMSSP\x00")  # Negotiate 는 SPNEGO 로 감싸 보낸다
    if start < 0:
        return None
    msg = token[start:]
    if len(msg) < 64 or int.from_bytes(msg[8:12], "little") != 3:
        return None
    unicode = bool(int.from_bytes(msg[60:64], "little") & 0x1)

    def field(at: int) -> str:
        length = int.from_bytes(msg[at:at + 2], "little")
        offset = int.from_bytes(msg[at + 4:at + 8], "little")
        return msg[offset:offset + length].decode("utf-16-le" if unicode else "latin-1", errors="replace")

    domain, user = field(28), field(36)
    return f"{domain}\\{user}" if user else None


def employee_id_from_account(account: str, domain: str | None = None) -> str | None:
    """'HHI\\a476854' → 'A476854'. 다른 도메인·로컬 계정·사번 모양이 아니면 None."""
    expected = (domain or settings.ad_domain).upper()
    dom, sep, name = (account or "").partition("\\")
    if not sep or dom.strip().upper() != expected:
        return None
    employee_id = name.strip().upper()
    return employee_id if EMPLOYEE_ID_PATTERN.fullmatch(employee_id) else None


class LoginAttemptLimiter:
    """틀린 시도 횟수를 사번·IP 별로 센다(메모리, 서버를 다시 시작하면 초기화)."""

    def __init__(self, window_sec: int = FAIL_WINDOW_SEC, max_per_employee: int = MAX_FAILURES_PER_EMPLOYEE,
                 max_per_ip: int = MAX_FAILURES_PER_IP, now: Callable[[], float] = time.monotonic):
        self._window = window_sec
        self._max_employee = max_per_employee
        self._max_ip = max_per_ip
        self._now = now
        self._failures: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _recent(self, key: str, now: float) -> deque[float]:
        bucket = self._failures.setdefault(key, deque())
        while bucket and now - bucket[0] > self._window:
            bucket.popleft()
        return bucket

    def _count(self, key: str, now: float) -> int:
        count = len(self._recent(key, now))
        if count == 0:
            self._failures.pop(key, None)   # 이름을 바꿔 가며 보내도 빈 키가 쌓이지 않게
        return count

    def is_blocked(self, key: str, ip: str | None) -> bool:
        now = self._now()
        with self._lock:
            if self._count(f"emp:{key}", now) >= self._max_employee:
                return True
            return bool(ip) and self._count(f"ip:{ip}", now) >= self._max_ip

    def record_failure(self, key: str, ip: str | None) -> None:
        now = self._now()
        with self._lock:
            self._recent(f"emp:{key}", now).append(now)
            if ip:
                self._recent(f"ip:{ip}", now).append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(f"emp:{key}", None)

    def clear(self) -> None:
        with self._lock:
            self._failures.clear()


def unknown_key(ip: str | None) -> str:
    """누구인지 모르는 실패(Kerberos·모양이 틀린 토큰)를 세는 키 — IP 별."""
    return f"windows-ip:{ip or '-'}"


negotiate_sessions = NegotiateSessions()
login_attempt_limiter = LoginAttemptLimiter()
