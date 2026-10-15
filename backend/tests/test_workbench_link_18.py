"""18 — HiTESS WorkBench 연동: 서버 간 API(/api/integration/*)와 자동 로그인(/sso).

계약: docs/plans/2026-10-08-logbook-18-workbench-link.md §7. 합성 데이터만(가상 호선 9999).
WorkBench 서버는 부르지 않는다 — 일회 코드 교환(integration.redeem_code)을 바꿔 끼운다."""
import dataclasses
import hashlib
import json
import os
import re
from datetime import datetime, timedelta
from urllib.parse import unquote

import pytest

from app import models
from app.routers import integration
from app.storage.paths import to_long

SECRET = "test-integration-secret-18"
H = {"X-HiTESS-Integration": SECRET}
LV1, LV2 = "G180001", "M180001"
WB_REF = hashlib.sha256(b"wb-token-1").hexdigest()


@pytest.fixture
def secret(monkeypatch):
    monkeypatch.setattr(integration, "settings", dataclasses.replace(integration.settings, wb_integration_secret=SECRET))


@pytest.fixture
def no_secret(monkeypatch):
    monkeypatch.setattr(integration, "settings", dataclasses.replace(integration.settings, wb_integration_secret=""))


def _put(storage, entry, f, data: bytes):
    vf = storage.vault / "2026" / entry.entry_id / "files"
    os.makedirs(to_long(vf), exist_ok=True)
    with open(to_long(vf / f.name), "wb") as fh:
        fh.write(data)


@pytest.fixture
def world(db, storage, make_user, make_entry_file):
    make_user(LV1, name="게스트", level=1)
    make_user(LV2, name="일반", level=2)
    out = {}
    for k, access in (("shared", "shared"), ("normal", "normal")):
        e, f = make_entry_file(title=f"권상 모델 {k}", name=f"gmu_{k}.bdf", kind="model", hulls=("9999",))
        e.access = access
        db.add(models.ModelSummary(file_id=f.id, state="done", key=f"{k[0]}" * 64, includes=[], missing=[]))
        _put(storage, e, f, b"SOL 101\nCEND\nBEGIN BULK\nGRID,1\nENDDATA\n")
        out[k] = (e.entry_id, f.id)
    e, f = make_entry_file(title="보고서", name="report.pdf", kind="report", hulls=("9999",))
    e.access = "shared"
    out["report"] = (e.entry_id, f.id)
    e, f = make_entry_file(title="INCLUDE 모델", name="main.bdf", kind="model", hulls=("9999",))
    e.access = "shared"
    db.add(models.ModelSummary(file_id=f.id, state="done", key="i" * 64, includes=["sub.bdf"], missing=[]))
    out["incl"] = (e.entry_id, f.id)
    e, f = make_entry_file(title="INCLUDE 못 찾은 모델", name="lost.bdf", kind="model", hulls=("9999",))
    e.access = "shared"
    db.add(models.ModelSummary(file_id=f.id, state="done", key="j" * 64, includes=[], missing=["gone.bdf"]))
    out["missing"] = (e.entry_id, f.id)
    db.commit()
    return out


def _session(db, employee_id, wb_ref=None):
    from app import sessions
    return sessions.create(db, employee_id, hours=8, wb_ref=wb_ref)


# ---- 비밀키 ----

def test_integration_routes_hidden_without_secret(no_secret, client, world):
    fid = world["shared"][1]
    assert client.post("/api/integration/logout", json={"wb_ref": WB_REF}, headers=H).status_code == 404
    assert client.get(f"/api/integration/files/{fid}/content?as={LV2}", headers=H).status_code == 404


def test_integration_wrong_or_missing_secret_401(secret, client, world):
    fid = world["shared"][1]
    for h in ({}, {"X-HiTESS-Integration": "wrong"}, {"X-HiTESS-Integration": ""}):
        r = client.post("/api/integration/logout", json={"wb_ref": WB_REF}, headers=h)
        assert r.status_code == 401 and r.json()["detail"] == "integration_unauthorized"
        assert client.get(f"/api/integration/files/{fid}/content?as={LV2}", headers=h).status_code == 401


def test_sso_without_secret_shows_failure_page(no_secret, client, monkeypatch):
    called = []
    monkeypatch.setattr(integration, "redeem_code", lambda code: called.append(code) or {})
    r = client.get("/sso?code=" + "a" * 43)
    assert r.status_code == 404
    assert "연동이 꺼져" in r.text and 'href="/login"' in r.text
    assert "logbook_token" not in r.text
    assert called == []


# ---- 로그아웃 연동 ----

def test_logout_revokes_only_matching_wb_ref(secret, client, db, world):
    a = _session(db, LV2, WB_REF)
    b = _session(db, LV2, WB_REF)
    other = _session(db, LV2, hashlib.sha256(b"other").hexdigest())
    plain = _session(db, LV2)
    r = client.post("/api/integration/logout", json={"wb_ref": WB_REF.upper()}, headers=H)
    assert r.status_code == 200 and r.json() == {"revoked": 2}
    db.expire_all()
    left = {s.token for s in db.query(models.UserSession).all()}
    assert a not in left and b not in left and {other, plain} <= left
    # 다시 불러도 0(멱등)
    assert client.post("/api/integration/logout", json={"wb_ref": WB_REF}, headers=H).json() == {"revoked": 0}
    assert client.post("/api/integration/logout", json={"wb_ref": "not-hex"}, headers=H).status_code == 422


# ---- 모델 내보내기 ----

def test_content_respects_as_user_permissions(secret, client, db, world):
    eid, fid = world["shared"]
    r = client.get(f"/api/integration/files/{fid}/content?as={LV1.lower()}", headers=H)
    assert r.status_code == 200, r.text
    assert r.content.startswith(b"SOL 101")
    assert r.headers["X-LogBook-Entry"] == eid
    assert unquote(r.headers["X-LogBook-File-Name"]) == "gmu_shared.bdf"
    f = db.get(models.File, fid)
    assert r.headers["X-LogBook-Sha256"] == f.sha256
    assert r.headers["Content-Length"] == str(len(r.content))
    log = db.query(models.AuditLog).filter_by(action="WB_EXPORT").all()
    assert len(log) == 1 and log[0].employee_id == LV1 and log[0].target_type == "file" and log[0].target_id == str(fid)

    # LV1 은 일반(normal) 자료를 볼 수 없다 → 없는 파일과 같은 404, LV2 는 본다
    nfid = world["normal"][1]
    r = client.get(f"/api/integration/files/{nfid}/content?as={LV1}", headers=H)
    assert r.status_code == 404 and r.json()["detail"] == "file_not_found"
    assert client.get(f"/api/integration/files/{nfid}/content?as={LV2}", headers=H).status_code == 200
    assert client.get(f"/api/integration/files/999999/content?as={LV2}", headers=H).status_code == 404


def test_content_unknown_or_inactive_as_is_404(secret, client, wb, world):
    fid = world["shared"][1]
    assert client.get(f"/api/integration/files/{fid}/content", headers=H).status_code == 404
    assert client.get(f"/api/integration/files/{fid}/content?as=Z999999", headers=H).status_code == 404
    wb(LV2, name="일반", active=False)   # WorkBench 에서 비활성화
    assert client.get(f"/api/integration/files/{fid}/content?as={LV2}", headers=H).status_code == 404


def test_content_drm_omits_content_length(secret, client, db, world):
    fid = world["shared"][1]
    f = db.get(models.File, fid)
    f.drm_encrypted = True
    db.commit()
    r = client.get(f"/api/integration/files/{fid}/content?as={LV2}", headers=H)
    assert r.status_code == 200 and r.content.startswith(b"SOL 101")
    assert "content-length" not in r.headers


def test_content_not_model_415(secret, client, world):
    r = client.get(f"/api/integration/files/{world['report'][1]}/content?as={LV2}", headers=H)
    assert r.status_code == 415 and r.json()["detail"] == "not_bdf"


def test_content_with_includes_409(secret, client, world):
    for k in ("incl", "missing"):
        r = client.get(f"/api/integration/files/{world[k][1]}/content?as={LV2}", headers=H)
        assert r.status_code == 409 and r.json()["detail"] == "has_includes"


def test_content_permission_checked_before_kind(secret, client, db, world):
    """권한 밖이면 종류(415)·INCLUDE(409)도 드러내지 않는다."""
    e = db.query(models.Entry).filter_by(entry_id=world["incl"][0]).one()
    e.access = "normal"
    db.commit()
    assert client.get(f"/api/integration/files/{world['incl'][1]}/content?as={LV1}", headers=H).status_code == 404


# ---- 자동 로그인 ----

def _token_from(html_text):
    m = re.search(r"var token = (\"[^\"]+\")", html_text)
    return json.loads(m.group(1)) if m else None


def _pick_from(html_text):
    m = re.search(r"pick = (\{[^;]*\});", html_text)
    return json.loads(m.group(1)) if m else None


def test_sso_success_creates_capped_session(secret, client, db, world, monkeypatch):
    wb_exp = (datetime.now() + timedelta(hours=2)).replace(microsecond=0)
    seen = []

    def fake(code):
        seen.append(code)
        return {"employee_id": LV2.lower(), "wb_ref": WB_REF, "wb_expires_at": wb_exp.isoformat()}

    monkeypatch.setattr(integration, "redeem_code", fake)
    code = "c" * 43
    r = client.get(f"/sso?code={code}&target=gmu&slot=2")
    assert r.status_code == 200, r.text
    assert seen == [code]
    assert r.headers["Cache-Control"] == "no-store"
    assert r.headers["Referrer-Policy"] == "no-referrer"
    token = _token_from(r.text)
    assert token and "localStorage.setItem('logbook_token', token)" in r.text
    assert "location.replace('/')" in r.text
    assert _pick_from(r.text) == {"target": "gmu", "slot": 2}
    s = db.get(models.UserSession, token)
    assert s.employee_id == LV2 and s.wb_ref == WB_REF
    assert abs((s.expires_at - wb_exp).total_seconds()) <= 1      # WorkBench 만료(2시간)로 잘렸다
    # 그 토큰으로 API 가 열린다
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).json()["employee_id"] == LV2
    u = db.query(models.User).filter_by(employee_id=LV2).one()
    db.refresh(u)
    assert u.login_count == 1
    # WorkBench 로그아웃 → 이 세션이 지워진다
    assert client.post("/api/integration/logout", json={"wb_ref": WB_REF}, headers=H).json() == {"revoked": 1}
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_sso_session_hours_when_wb_expiry_later(secret, client, db, world, monkeypatch):
    far = datetime.now() + timedelta(days=3)
    monkeypatch.setattr(integration, "redeem_code",
                        lambda code: {"employee_id": LV2, "wb_ref": WB_REF, "wb_expires_at": far.timestamp()})
    r = client.get("/sso?code=" + "d" * 43)
    s = db.get(models.UserSession, _token_from(r.text))
    hours = integration.settings.session_hours
    assert abs((s.expires_at - (datetime.now() + timedelta(hours=hours))).total_seconds()) < 60


def test_sso_first_login_creates_lv1_user_and_audit(secret, client, db, wb, monkeypatch):
    wb("N180001", name="새 사용자")
    monkeypatch.setattr(integration, "redeem_code", lambda code: {"employee_id": "N180001", "wb_ref": WB_REF})
    r = client.get("/sso?code=" + "e" * 43)
    assert r.status_code == 200
    u = db.query(models.User).filter_by(employee_id="N180001").one()
    assert u.level == 1
    assert db.query(models.AuditLog).filter_by(action="USER_JOIN", target_id="N180001").count() == 1


@pytest.mark.parametrize("reason, status", [("code_invalid", 401), ("wb_unreachable", 502)])
def test_sso_redeem_failure_pages(secret, client, db, monkeypatch, reason, status):
    def fake(code):
        raise integration.RedeemError(reason)

    monkeypatch.setattr(integration, "redeem_code", fake)
    r = client.get("/sso?code=" + "f" * 43)
    assert r.status_code == status
    assert 'href="/login"' in r.text and "logbook_token" not in r.text
    assert r.headers["Cache-Control"] == "no-store" and r.headers["Referrer-Policy"] == "no-referrer"
    assert db.query(models.UserSession).count() == 0


def test_sso_malformed_code_does_not_call_wb(secret, client, monkeypatch):
    called = []
    monkeypatch.setattr(integration, "redeem_code", lambda code: called.append(code) or {})
    for q in ("", "?code=", "?code=short", "?code=" + "x" * 30 + "%3Cscript%3E"):
        r = client.get("/sso" + q)
        assert r.status_code == 401 and "<script>" not in r.text.split("<body>", 1)[1]
    assert called == []


def test_sso_inactive_or_unregistered_user(secret, client, db, wb, monkeypatch):
    wb("P180001", name="꺼진 사용자", active=False)
    monkeypatch.setattr(integration, "redeem_code", lambda code: {"employee_id": "P180001", "wb_ref": WB_REF})
    r = client.get("/sso?code=" + "g" * 43)
    assert r.status_code == 403 and "비활성" in r.text
    monkeypatch.setattr(integration, "redeem_code", lambda code: {"employee_id": "Q180001", "wb_ref": WB_REF})
    r = client.get("/sso?code=" + "h" * 43)
    assert r.status_code == 403 and "가입된 사번이 아닙니다" in r.text
    assert db.query(models.UserSession).count() == 0


def test_sso_expired_wb_session(secret, client, db, world, monkeypatch):
    past = (datetime.now() - timedelta(minutes=1)).isoformat()
    monkeypatch.setattr(integration, "redeem_code",
                        lambda code: {"employee_id": LV2, "wb_ref": WB_REF, "wb_expires_at": past})
    r = client.get("/sso?code=" + "k" * 43)
    assert r.status_code == 401 and db.query(models.UserSession).count() == 0


@pytest.mark.parametrize("query, pick", [
    ("&target=gmu&slot=1", {"target": "gmu", "slot": 1}),
    ("&target=gmu&slot=4", {"target": "gmu", "slot": 4}),
    ("&target=gmu&slot=0", {}),
    ("&target=gmu&slot=5", {}),
    ("&target=gmu&slot=2.5", {}),
    ("&target=gmu&slot=-1", {}),
    ("&target=gmu&slot=abc", {}),
    ("&target=gmu", {}),
    ("&target=truss&slot=1", {"target": "truss", "slot": 1}),
    ("&target=truss&slot=2", {"target": "truss", "slot": 1}),  # 단일 화면 — 1 로 맞춘다
    ("&target=truss&slot=0", {}),
    ("&target=truss", {}),
    ("&target=bdfscanner&slot=1", {}),
    ("&target=%3C%2Fscript%3E&slot=2", {}),
    ("", {}),
])
def test_sso_slot_validation(secret, client, world, monkeypatch, query, pick):
    monkeypatch.setattr(integration, "redeem_code", lambda code: {"employee_id": LV2, "wb_ref": WB_REF})
    r = client.get("/sso?code=" + "m" * 43 + query)
    assert r.status_code == 200
    assert _pick_from(r.text) == pick
    assert "</script>" not in r.text.split("<script>", 1)[1].split("</script>", 1)[0]


def test_js_escape_is_html_safe():
    out = integration._js("</script><!--&")
    assert "<" not in out and ">" not in out and "&" not in out
    assert json.loads(out) == "</script><!--&"


def test_login_still_works_after_refactor(client, world):
    r = client.post("/api/auth/login", json={"employee_id": LV2})
    assert r.status_code == 200 and r.json()["user"]["employee_id"] == LV2


@pytest.mark.fresh_schema   # 스키마를 바꾼다(conftest 'DB 초기화')
def test_ensure_columns_adds_wb_ref(db):
    """기존 DB(열·색인 없음)에도 시작 때 더해진다."""
    from sqlalchemy import inspect, text

    from app import database

    with database.engine.begin() as conn:
        conn.execute(text("ALTER TABLE user_sessions DROP INDEX ix_user_sessions_wb_ref"))
        conn.execute(text("ALTER TABLE user_sessions DROP COLUMN wb_ref"))
    added = database.ensure_columns()
    assert "user_sessions.wb_ref" in added and "user_sessions.ix_user_sessions_wb_ref" in added
    insp = inspect(database.engine)
    assert "wb_ref" in {c["name"] for c in insp.get_columns("user_sessions")}
    assert "ix_user_sessions_wb_ref" in {i["name"] for i in insp.get_indexes("user_sessions")}
