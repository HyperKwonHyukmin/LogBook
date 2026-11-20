"""19 — WorkBench 관리자 'All Projects' → LogBook 보내기(/api/integration/uploads*) + /sso next.

합성 데이터만(가상 호선 9999). WorkBench 서버는 부르지 않는다 — 가짜 WorkBench 사용자 표(wb)를 쓴다."""
import dataclasses
import os

import pytest

from app import models
from app.routers import integration
from app.storage.paths import to_long

SECRET = "test-integration-secret-19"
H = {"X-HiTESS-Integration": SECRET}
OCTET = {**H, "Content-Type": "application/octet-stream"}
ADMIN, MEMBER = "A190001", "M190001"


@pytest.fixture
def secret(monkeypatch):
    monkeypatch.setattr(integration, "settings", dataclasses.replace(integration.settings, wb_integration_secret=SECRET))


@pytest.fixture
def no_secret(monkeypatch):
    monkeypatch.setattr(integration, "settings", dataclasses.replace(integration.settings, wb_integration_secret=""))


def _begin(client, who=ADMIN, name="WB #1 · GroupModuleUnit", owner="B190001", via=None):
    origin = {"analysis_id": 1, "owner": owner, "program": "GroupModuleUnit"} if owner is not None else None
    body = {"name": name, "origin": origin, **({"via": via} if via else {})}
    return client.post(f"/api/integration/uploads?as={who}", headers=H, json=body)


def test_roundtrip_creates_staged_batch_for_sender(secret, client, db, storage, make_user):
    make_user(ADMIN, level=2, wb_admin=True)
    r = _begin(client)
    assert r.status_code == 201, r.text
    key = r.json()["key"]
    r = client.put(f"/api/integration/uploads/{key}/chunk", headers=OCTET,
                   params={"as": ADMIN, "path": "run/9999_model.bdf", "offset": 0}, content=b"SOL 101\nCEND\n")
    assert r.status_code == 200 and r.json() == {"size": 13}
    r = client.post(f"/api/integration/uploads/{key}/finish?as={ADMIN}", headers=H,
                    json={"files": [{"rel_path": "run/9999_model.bdf", "size": 13}]})
    assert r.status_code == 200 and r.json()["state"] == "staged", r.text
    batch = db.query(models.Batch).filter_by(key=key).one()
    assert batch.uploader == ADMIN and batch.original_name == "WB #1 · GroupModuleUnit"
    assert os.path.exists(to_long(storage.staging / key / "run" / "9999_model.bdf"))
    log = db.query(models.AuditLog).filter_by(action="WB_UPLOAD", target_id=key).one()
    assert log.employee_id == ADMIN and log.after["origin"]["program"] == "GroupModuleUnit"
    assert log.after["by"] == "admin"


def test_first_time_admin_is_admitted(secret, client, db, wb):
    wb(ADMIN, name="관리자", active=True, admin=True)
    assert db.query(models.User).filter_by(employee_id=ADMIN).count() == 0
    r = _begin(client)
    assert r.status_code == 201, r.text
    assert db.query(models.User).filter_by(employee_id=ADMIN).count() == 1


def test_non_admin_cannot_send_others_analysis(secret, client, make_user):
    """65 — 관리자가 아니면 남의 해석(origin.owner ≠ as)과 출처 없는 보내기는 막는다."""
    make_user(MEMBER, level=2, wb_admin=False)
    r = _begin(client, who=MEMBER)
    assert r.status_code == 403 and r.json()["detail"] == "sender_not_owner"
    r = _begin(client, who=MEMBER, owner=None)
    assert r.status_code == 403 and r.json()["detail"] == "sender_not_owner"


def test_owner_roundtrip_lv1(secret, client, db, storage, make_user):
    """65 — LV1 도 자기 해석은 보낸다. 묶음 주인은 본인, 감사 기록 after.by = owner."""
    make_user(MEMBER, level=1, wb_admin=False)
    r = _begin(client, who=MEMBER, owner=MEMBER.lower(), via="my_projects")
    assert r.status_code == 201, r.text
    key = r.json()["key"]
    r = client.put(f"/api/integration/uploads/{key}/chunk", headers=OCTET,
                   params={"as": MEMBER, "path": "run/9999_own.bdf", "offset": 0}, content=b"SOL 101\nCEND\n")
    assert r.status_code == 200, r.text
    r = client.post(f"/api/integration/uploads/{key}/finish?as={MEMBER}", headers=H,
                    json={"files": [{"rel_path": "run/9999_own.bdf", "size": 13}]})
    assert r.status_code == 200 and r.json()["state"] == "staged", r.text
    assert db.query(models.Batch).filter_by(key=key).one().uploader == MEMBER
    log = db.query(models.AuditLog).filter_by(action="WB_UPLOAD", target_id=key).one()
    assert log.after["by"] == "owner"


def test_other_user_cannot_touch_owner_batch(secret, client, make_user):
    """65 — 조각, 취소는 origin 이 없지만 남의 묶음은 기존 '묶음 주인만' 검사가 막는다."""
    make_user(MEMBER, level=1, wb_admin=False)
    make_user("M190002", level=1, wb_admin=False)
    key = _begin(client, who=MEMBER, owner=MEMBER).json()["key"]
    r = client.put(f"/api/integration/uploads/{key}/chunk", headers=OCTET,
                   params={"as": "M190002", "path": "x.bdf", "offset": 0}, content=b"x")
    assert r.status_code == 403
    r = client.delete(f"/api/integration/uploads/{key}?as=M190002", headers=H)
    assert r.status_code == 403


def test_first_time_member_is_admitted_as_lv1(secret, client, db, wb):
    wb(MEMBER, name="일반", active=True, admin=False)
    r = _begin(client, who=MEMBER, owner=MEMBER)
    assert r.status_code == 201, r.text
    assert db.query(models.User).filter_by(employee_id=MEMBER).one().level == 1


def test_inactive_wb_user_rejected(secret, client, make_user):
    make_user(MEMBER, level=1, wb_admin=False, wb_active=False)
    r = _begin(client, who=MEMBER, owner=MEMBER)
    assert r.status_code == 403 and r.json()["detail"] == "sender_unknown"


def test_admin_own_analysis_by_path(secret, client, db, make_user):
    """65 — 관리자가 자기 해석을 보내도 All Projects 면 admin, My Projects 면 owner 로 남긴다."""
    make_user(ADMIN, level=3, wb_admin=True)
    k1 = _begin(client, owner=ADMIN).json()["key"]
    k2 = _begin(client, owner=ADMIN, via="my_projects").json()["key"]
    by = {r.target_id: r.after["by"] for r in db.query(models.AuditLog).filter_by(action="WB_UPLOAD")}
    assert by[k1] == "admin" and by[k2] == "owner"


def test_unknown_sender_rejected(secret, client):
    r = _begin(client, who="Z199999")
    assert r.status_code == 403 and r.json()["detail"] == "sender_unknown"


def test_routes_hidden_without_secret(no_secret, client, make_user):
    make_user(ADMIN, wb_admin=True)
    assert _begin(client).status_code == 404


def test_wrong_secret_401(secret, client, make_user):
    make_user(ADMIN, wb_admin=True)
    r = client.post(f"/api/integration/uploads?as={ADMIN}", headers={"X-HiTESS-Integration": "x"}, json={"name": "a"})
    assert r.status_code == 401


def test_drm_chunk_rejected_and_declared(secret, client, make_user):
    make_user(ADMIN, wb_admin=True)
    key = _begin(client).json()["key"]
    r = client.put(f"/api/integration/uploads/{key}/chunk", headers=OCTET,
                   params={"as": ADMIN, "path": "enc.pdf", "offset": 0}, content=b"HHIDRMC....")
    assert r.status_code == 422 and r.json()["detail"] == "drm_encrypted"
    client.put(f"/api/integration/uploads/{key}/chunk", headers=OCTET,
               params={"as": ADMIN, "path": "a.csv", "offset": 0}, content=b"x,y\n")
    r = client.post(f"/api/integration/uploads/{key}/finish?as={ADMIN}", headers=H,
                    json={"files": [{"rel_path": "a.csv", "size": 4}],
                          "rejected": [{"rel_path": "enc.pdf", "reason": "drm"}]})
    assert r.status_code == 200 and r.json()["state"] == "staged"


def test_cancel_removes_batch(secret, client, db, make_user):
    make_user(ADMIN, wb_admin=True)
    key = _begin(client).json()["key"]
    assert client.delete(f"/api/integration/uploads/{key}?as={ADMIN}", headers=H).status_code == 204
    assert db.query(models.Batch).filter_by(key=key).count() == 0


def test_other_admin_cannot_write_into_batch(secret, client, make_user):
    make_user(ADMIN, wb_admin=True)
    make_user("A190002", wb_admin=True)
    key = _begin(client).json()["key"]
    r = client.put(f"/api/integration/uploads/{key}/chunk", headers=OCTET,
                   params={"as": 'A190002', "path": "a.bdf", "offset": 0}, content=b"x")
    assert r.status_code == 403


@pytest.mark.parametrize("nxt,expected", [("inbox", '"/inbox"'), ("https://evil", '"/"'), (None, '"/"')])
def test_sso_next_allowlist(secret, client, make_user, monkeypatch, nxt, expected):
    make_user(ADMIN, wb_admin=True)
    monkeypatch.setattr(integration, "redeem_code", lambda code: {"employee_id": ADMIN})
    params = {"code": "c" * 43}
    if nxt:
        params["next"] = nxt
    r = client.get("/sso", params=params)
    assert r.status_code == 200
    # 허용 목록 밖은 첫 화면
    assert f"location.replace({expected})" in r.text
