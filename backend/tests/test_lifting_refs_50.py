"""50 — 다른 Unit 의 권상 Wire 배치 찾기(서버 간 API). 합성 데이터만(가상 호선 9999)."""
import dataclasses
import os

import pytest

from app import models
from app.routers import integration
from app.storage.paths import to_long

from test_lifting_wires_50 import LIFTING

SECRET = "test-integration-secret-50"
H = {"X-HiTESS-Integration": SECRET}
LV2, OTHER = "M500001", "M500002"


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
    make_user(LV2, name="일반", level=2)
    make_user(OTHER, name="남", level=2)
    out = {}
    # 변환 때 요약이 이미 들어간 Wire 모델
    e, f = make_entry_file(title="9999 M04 권상", name="9999_m04_lifting.bdf", kind="model", uploaded_by=LV2)
    db.add(models.ModelSummary(file_id=f.id, state="done", key="a" * 64, includes=[], missing=[], lifting=True))
    _put(storage, e, f, LIFTING.encode())
    out["converted"] = (e, f)
    # 50 이전 변환(요약 없음) — 요청 때 읽어 채운다
    e, f = make_entry_file(title="9999 M05 권상", name="9999_m05_lifting.bdf", kind="model", uploaded_by=LV2)
    _put(storage, e, f, LIFTING.encode())
    out["lazy"] = (e, f)
    # 이름만 _lifting — apex 없음 → 목록에서 빠진다
    e, f = make_entry_file(title="가짜", name="9999_x_lifting.bdf", kind="model", uploaded_by=LV2)
    _put(storage, e, f, b"SOL 101\nCEND\nBEGIN BULK\nGRID,1\nCBAR,1,1,1,2\nGRID,2,,1.\nENDDATA\n")
    out["fake"] = (e, f)
    # 남의 일반(비공유) 자료 — LV2 도 볼 수는 있다(access normal). 숨김 자료로 권한 확인
    e, f = make_entry_file(title="숨김", name="9999_h_lifting.bdf", kind="model", uploaded_by=OTHER)
    e.access = "blocked"
    _put(storage, e, f, LIFTING.encode())
    out["hidden"] = (e, f)
    # 일반 모델(Wire 아님)
    e, f = make_entry_file(title="일반 모델", name="9999_plain.bdf", kind="model", uploaded_by=LV2)
    out["plain"] = (e, f)
    db.commit()
    return out


def test_list_lazy_fill_and_filters(secret, client, db, world):
    r = client.get(f"/api/integration/lifting-refs?as={LV2}", headers=H)
    assert r.status_code == 200, r.text
    body = r.json()
    names = sorted(i["name"] for i in body["items"])
    assert names == ["9999_m04_lifting.bdf", "9999_m05_lifting.bdf"]   # 가짜·숨김·일반 모델은 빠진다
    item = body["items"][0]
    assert item["summaryState"] == "done" and item["summary"]["groupCount"] == 2
    assert "planSegments" not in item["summary"] and item["hullNos"] == ["9999"]
    # 요청 때 읽은 요약은 저장된다 — 가짜는 none 으로
    db.expire_all()
    assert db.get(models.ModelSummary, world["lazy"][1].id).wires["wireCount"] == 4
    assert db.get(models.ModelSummary, world["fake"][1].id).wires["none"] is True


def test_list_query_and_hull(secret, client, world):
    r = client.get(f"/api/integration/lifting-refs?as={LV2}&q=m05", headers=H)
    assert [i["name"] for i in r.json()["items"]] == ["9999_m05_lifting.bdf"]
    r = client.get(f"/api/integration/lifting-refs?as={LV2}&hull=1234", headers=H)
    assert r.json() == {"total": 0, "items": []}


def test_detail_has_plan_segments(secret, client, world):
    fid = world["converted"][1].id
    r = client.get(f"/api/integration/lifting-refs/{fid}?as={LV2}", headers=H)
    assert r.status_code == 200
    s = r.json()["summary"]
    assert len(s["planSegments"]) == 4 and s["groups"][0]["wires"][0]["slingAngleDeg"] > 70


def test_detail_rejects(secret, client, world):
    assert client.get(f"/api/integration/lifting-refs/{world['plain'][1].id}?as={LV2}", headers=H).status_code == 415
    assert client.get(f"/api/integration/lifting-refs/{world['fake'][1].id}?as={LV2}", headers=H).status_code == 415
    assert client.get(f"/api/integration/lifting-refs/{world['hidden'][1].id}?as={LV2}", headers=H).status_code == 404


def test_requires_secret_and_user(secret, client, world):
    assert client.get(f"/api/integration/lifting-refs?as={LV2}").status_code == 401
    assert client.get("/api/integration/lifting-refs?as=Z999999", headers=H).status_code == 404


def test_disabled_without_secret(no_secret, client, world):
    assert client.get(f"/api/integration/lifting-refs?as={LV2}", headers=H).status_code == 404


def test_old_summary_is_rebuilt_and_list_hides_segments(secret, client, db, world):
    # 3D 선분 이전(schemaVersion 1) 요약이 남아 있으면 상세 요청 때 다시 읽는다
    fid = world["converted"][1].id
    row = db.get(models.ModelSummary, fid)
    row.wires = {"schemaVersion": 1, "groupCount": 2, "wireCount": 4, "groups": [], "planSegments": [], "bboxMm": None}
    db.commit()
    r = client.get(f"/api/integration/lifting-refs/{fid}?as={LV2}", headers=H)
    s = r.json()["summary"]
    assert s["schemaVersion"] == 2 and len(s["segments3d"]) == 4
    db.expire_all()
    assert db.get(models.ModelSummary, fid).wires["schemaVersion"] == 2
    items = client.get(f"/api/integration/lifting-refs?as={LV2}", headers=H).json()["items"]
    assert all("segments3d" not in i["summary"] and "planSegments" not in i["summary"] for i in items)


def test_query_treats_like_wildcards_literally(secret, client, world):
    """검색어의 _·% 는 글자 그대로(2026-11-05 검토) — 'm0_' 가 m04·m05 를 잡지 않는다."""
    r = client.get(f"/api/integration/lifting-refs?as={LV2}&q=m0_", headers=H)
    assert r.json()["items"] == []
    r = client.get(f"/api/integration/lifting-refs?as={LV2}&q=9999_m04", headers=H)
    assert [i["name"] for i in r.json()["items"]] == ["9999_m04_lifting.bdf"]
