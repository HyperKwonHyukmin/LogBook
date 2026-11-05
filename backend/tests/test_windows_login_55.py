"""55 — Windows 계정 자동 로그인(Negotiate)·사번만 로그인 닫기·health 경로 숨김.

SSPI 는 가짜(FakeServerAuth)로 바꾼다 — 실제 도메인 컨트롤러에 묻지 않는다."""
import base64
import dataclasses
import re

import pytest

from app import login_page, windows_auth
from app.routers import auth as auth_router

CONTINUE = windows_auth.SEC_I_CONTINUE_NEEDED


class _Buf:
    def __init__(self, data: bytes):
        self.Buffer = data


class FakeServerAuth:
    """steps = authorize 가 차례로 돌려줄 (상태, 출력 바이트). 예외를 넣으면 그때 던진다."""

    def __init__(self, steps, account):
        self.steps, self.account, self.seen = list(steps), account, []

    def authorize(self, token):
        self.seen.append(token)
        step = self.steps.pop(0)
        if isinstance(step, Exception):
            raise step
        err, out = step
        return err, [_Buf(out)]


class World:
    """가짜 SSPI 를 끼운 상태. scenario(steps, account) 로 다음 협상의 흐름을 정한다."""

    def __init__(self):
        self.created: list[FakeServerAuth] = []
        self.next_steps, self.next_account = [(0, b"")], "HHI\\a300001"

    def scenario(self, steps, account="HHI\\a300001"):
        self.next_steps, self.next_account = steps, account

    def factory(self):
        fake = FakeServerAuth(self.next_steps, self.next_account)
        self.created.append(fake)
        return fake


@pytest.fixture
def sspi_world(monkeypatch):
    w = World()
    monkeypatch.setattr(windows_auth, "_sspi_available", lambda: True)
    monkeypatch.setattr(windows_auth, "negotiate_sessions",
                        windows_auth.NegotiateSessions(w.factory, lambda fake: fake.account))
    windows_auth.login_attempt_limiter.clear()
    yield w
    windows_auth.login_attempt_limiter.clear()


@pytest.fixture
def windows_mode(monkeypatch):
    monkeypatch.setattr(auth_router, "settings", dataclasses.replace(auth_router.settings, auth_mode="windows"))


def _ntlm(msg_type: int, domain: str = "", user: str = "") -> str:
    """NTLM 메시지 모양(서명·종류·도메인·사용자 칸만 채운다)을 base64 로."""
    d, u = domain.encode("utf-16-le"), user.encode("utf-16-le")
    head = bytearray(64)
    head[0:8] = b"NTLMSSP\x00"
    head[8:12] = msg_type.to_bytes(4, "little")
    head[28:30] = len(d).to_bytes(2, "little")
    head[32:36] = (64).to_bytes(4, "little")
    head[36:38] = len(u).to_bytes(2, "little")
    head[40:44] = (64 + len(d)).to_bytes(4, "little")
    head[60:64] = (1).to_bytes(4, "little")   # unicode
    return base64.b64encode(bytes(head) + d + u).decode()


def _neg(token_b64: str) -> dict:
    return {"Authorization": f"Negotiate {token_b64}"}


KERBEROS = base64.b64encode(b"\x60\x82kerberos-ticket").decode()


# ---- 순수 함수 ----

def test_employee_id_from_account():
    assert windows_auth.employee_id_from_account("HHI\\a476854") == "A476854"
    assert windows_auth.employee_id_from_account("hhi\\A476854") == "A476854"
    assert windows_auth.employee_id_from_account("OTHER\\A476854") is None
    assert windows_auth.employee_id_from_account("HHIPW170658\\CF40Admin") is None
    assert windows_auth.employee_id_from_account("HHI\\admin01") is None
    assert windows_auth.employee_id_from_account("A476854") is None


def test_ntlm_claimed_account_reads_type3_only():
    assert windows_auth.ntlm_claimed_account("Negotiate " + _ntlm(3, "HHI", "a300001")) == "HHI\\a300001"
    assert windows_auth.ntlm_claimed_account("Negotiate " + _ntlm(1)) is None
    assert windows_auth.ntlm_claimed_account("Negotiate " + KERBEROS) is None
    assert windows_auth.ntlm_claimed_account("Bearer abc") is None


def test_safe_next_only_inside_app():
    assert login_page.safe_next("/search?q=1") == "/search?q=1"
    assert login_page.safe_next("/entries/E000001") == "/entries/E000001"
    for bad in (None, "", "search", "//evil.example", "/\\evil.example", "https://evil.example",
                "/a\nb", "/auth/windows", "/sso?code=x", "/login", "/api/auth/me", "/" + "a" * 600):
        assert login_page.safe_next(bad) == "/", bad


def test_limiter_counts_per_key_and_ip():
    now = [0.0]
    lim = windows_auth.LoginAttemptLimiter(window_sec=60, max_per_employee=2, max_per_ip=3, now=lambda: now[0])
    lim.record_failure("A1", "1.1.1.1")
    assert not lim.is_blocked("A1", "1.1.1.1")
    lim.record_failure("A1", "1.1.1.1")
    assert lim.is_blocked("A1", "9.9.9.9")
    lim.record_failure("A2", "1.1.1.1")
    assert lim.is_blocked("A3", "1.1.1.1")       # 같은 IP 에서 3번
    now[0] = 61
    assert not lim.is_blocked("A1", "1.1.1.1")   # 창이 지나면 풀린다


# ---- 화면 분기·모드 ----

def test_options_default_and_windows_mode(sspi_world, client, monkeypatch):
    assert client.get("/api/auth/options").json() == {"windows": True, "employee_id_login": True}
    monkeypatch.setattr(auth_router, "settings", dataclasses.replace(auth_router.settings, auth_mode="windows"))
    assert client.get("/api/auth/options").json() == {"windows": True, "employee_id_login": False}


def test_windows_mode_closes_employee_id_login(windows_mode, client, make_user):
    make_user("A300001")
    res = client.post("/api/auth/login", json={"employee_id": "A300001"})
    assert res.status_code == 403
    assert res.json()["detail"] == "employee_id_login_disabled"


def test_windows_login_disabled_is_404(client, monkeypatch):
    monkeypatch.setattr(windows_auth, "settings", dataclasses.replace(windows_auth.settings, windows_login=False))
    assert client.get("/api/auth/options").json()["windows"] is False
    res = client.post("/api/auth/windows")
    assert res.status_code == 404
    assert res.json()["detail"] == "windows_login_disabled"


# ---- API(스크립트용) ----

def test_api_without_header_challenges(sspi_world, client):
    res = client.post("/api/auth/windows")
    assert res.status_code == 401
    assert res.headers["www-authenticate"] == "Negotiate"
    assert sspi_world.created == []


def test_api_ntlm_two_legs_then_session(sspi_world, windows_mode, client, make_user):
    make_user("A300001", name="김윈도")
    sspi_world.scenario([(CONTINUE, b"challenge"), (0, b"")], account="HHI\\a300001")
    first = client.post("/api/auth/windows", headers=_neg(_ntlm(1)))
    assert first.status_code == 401
    assert first.headers["www-authenticate"] == "Negotiate " + base64.b64encode(b"challenge").decode()
    second = client.post("/api/auth/windows", headers=_neg(_ntlm(3, "HHI", "a300001")))
    assert second.status_code == 200, second.text
    body = second.json()
    assert body["user"]["employee_id"] == "A300001"
    assert len(sspi_world.created) == 1                  # 두 걸음이 같은 SSPI 객체를 이어 쓴다
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.status_code == 200 and me.json()["employee_id"] == "A300001"


def test_api_kerberos_one_leg_returns_mutual_token(sspi_world, client, make_user):
    make_user("A300001")
    sspi_world.scenario([(0, b"mutual")])
    res = client.post("/api/auth/windows", headers=_neg(KERBEROS))
    assert res.status_code == 200
    assert res.headers["www-authenticate"] == "Negotiate " + base64.b64encode(b"mutual").decode()


def test_api_other_domain_or_local_account_403(sspi_world, client, make_user):
    make_user("A300001")
    sspi_world.scenario([(0, b"")], account="HHIPW170658\\CF40Admin")
    res = client.post("/api/auth/windows", headers=_neg(KERBEROS))
    assert res.status_code == 403
    assert res.json()["detail"] == "windows_account_not_employee"


def test_api_typed_employee_id_must_match_windows_account(sspi_world, client, make_user, db):
    """화면에 입력한 사번이 이 PC 의 Windows 계정과 다르면 세션을 만들지 않는다."""
    from app import models

    make_user("A300001")
    make_user("A300002")
    sspi_world.scenario([(0, b"")], account="HHI\\a300001")
    res = client.post("/api/auth/windows?employee_id=A300002", headers=_neg(KERBEROS))
    assert res.status_code == 403
    assert res.json()["detail"] == "windows_account_mismatch"
    assert db.query(models.UserSession).filter_by(employee_id="A300002").count() == 0
    sspi_world.scenario([(0, b"")], account="HHI\\a300001")
    ok = client.post("/api/auth/windows?employee_id=a300001", headers=_neg(KERBEROS))
    assert ok.status_code == 200
    assert ok.json()["user"]["employee_id"] == "A300001"


def test_page_typed_employee_id_mismatch_goes_to_login(sspi_world, client, make_user):
    make_user("A300001")
    sspi_world.scenario([(0, b"")], account="HHI\\a300001")
    res = client.get("/auth/windows?employee_id=A300002&next=/search", headers=_neg(KERBEROS))
    assert res.status_code == 403
    assert "/login?windows=windows_account_mismatch\\u0026next=/search" in res.text


def test_api_not_in_workbench_follows_admit(sspi_world, client):
    sspi_world.scenario([(0, b"")], account="HHI\\Z999999")
    res = client.post("/api/auth/windows", headers=_neg(KERBEROS))
    assert res.status_code == 404
    assert res.json()["detail"] == "not_registered"


def test_api_sspi_rejects_without_rechallenge(sspi_world, client):
    sspi_world.scenario([RuntimeError("SEC_E_LOGON_DENIED")])
    res = client.post("/api/auth/windows", headers=_neg(KERBEROS))
    assert res.status_code == 401
    assert res.json()["detail"] == "windows_auth_failed"
    assert "www-authenticate" not in res.headers      # 다시 도전하면 브라우저가 같은 실패를 되풀이한다


def test_api_limits_claimed_account_before_asking_sspi(sspi_world, client):
    """사번별 4번 틀리면 5번째는 SSPI(도메인 컨트롤러)에 묻지 않고 429."""
    type3 = _neg(_ntlm(3, "HHI", "a300001"))
    for _ in range(windows_auth.MAX_FAILURES_PER_EMPLOYEE):
        sspi_world.scenario([RuntimeError("denied")])
        assert client.post("/api/auth/windows", headers=type3).status_code == 401
    asked = len(sspi_world.created)
    res = client.post("/api/auth/windows", headers=type3)
    assert res.status_code == 429
    assert res.json()["detail"] == "too_many_attempts"
    assert len(sspi_world.created) == asked


# ---- 화면(브라우저 최상위 이동) ----

def test_page_challenge_body_sends_to_login(sspi_world, client):
    res = client.get("/auth/windows?next=/search")
    assert res.status_code == 401
    assert res.headers["www-authenticate"] == "Negotiate"
    assert "/login?windows=unavailable\\u0026next=/search" in res.text
    assert res.headers["cache-control"] == "no-store"


def test_page_success_plants_token_and_goes_next(sspi_world, client, make_user, db):
    from app import models

    make_user("A300001")
    sspi_world.scenario([(0, b"")])
    res = client.get("/auth/windows?next=/entries/E000001", headers=_neg(KERBEROS))
    assert res.status_code == 200
    token = re.search(r'var token = "([0-9a-f-]{36})"', res.text).group(1)
    assert db.get(models.UserSession, token).employee_id == "A300001"
    assert 'location.replace("/entries/E000001")' in res.text


def test_page_rejects_outside_next(sspi_world, client, make_user):
    make_user("A300001")
    sspi_world.scenario([(0, b"")])
    res = client.get("/auth/windows?next=//evil.example", headers=_neg(KERBEROS))
    assert 'location.replace("/")' in res.text


def test_page_failure_goes_to_login_with_reason(sspi_world, client):
    sspi_world.scenario([(0, b"")], account="OTHER\\A300001")
    res = client.get("/auth/windows", headers=_neg(KERBEROS))
    assert res.status_code == 403
    assert "/login?windows=windows_account_not_employee" in res.text
    assert "www-authenticate" not in res.headers


def test_sso_success_page_still_uses_allowlist():
    from app.routers import integration

    res = integration._success_page("t" * 36, "A300001", {}, "/search")
    assert 'location.replace("/")' in res.body.decode()
    res = integration._success_page("t" * 36, "A300001", {}, "/inbox")
    assert 'location.replace("/inbox")' in res.body.decode()


# ---- health ----

def test_health_hides_storage_path(client):
    body = client.get("/api/system/health").json()
    assert "root" not in body["storage"]
