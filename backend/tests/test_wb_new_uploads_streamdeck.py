"""새로 올라온 자료 수 — /api/integration/new-uploads (WorkBench 관리자 콘솔 → 스트림덱 키, 2026-11-18).

관리자가 마지막으로 확인한 시각 뒤에 다른 사람이 올린 묶음만 센다. 합성 데이터만."""
import dataclasses
from datetime import datetime, timedelta

import pytest

from app import models
from app.routers import integration

SECRET = "test-integration-secret-newuploads"
H = {"X-HiTESS-Integration": SECRET}
ME = "A111111"


@pytest.fixture
def secret(monkeypatch):
    monkeypatch.setattr(integration, "settings", dataclasses.replace(integration.settings, wb_integration_secret=SECRET))


def _batch(db, key, *, uploader, state="staged", minutes_ago=0):
    b = models.Batch(key=key, source="web", original_name=f"{key}.zip", state=state, uploader=uploader,
                     received_at=datetime.now().replace(microsecond=0) - timedelta(minutes=minutes_ago))
    db.add(b)
    db.commit()
    return b


def test_counts_only_others_after_since(client, db, secret):
    since = (datetime.now() - timedelta(minutes=30)).replace(microsecond=0)
    _batch(db, "old-other", uploader="B222222", minutes_ago=60)      # 확인 전
    _batch(db, "new-mine", uploader=ME, minutes_ago=5)               # 내가 올림
    _batch(db, "new-other", uploader="B222222", minutes_ago=5, state="done")
    _batch(db, "new-inbox", uploader=None, minutes_ago=3)            # 올린 사람 모름 → 센다
    _batch(db, "new-uploading", uploader="B222222", minutes_ago=2, state="uploading")
    _batch(db, "new-failed", uploader="B222222", minutes_ago=2, state="failed")

    res = client.get("/api/integration/new-uploads", params={"since": since.isoformat(), "exclude": ME.lower()}, headers=H)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["count"] == 2
    assert set(body["names"]) == {"new-other.zip", "new-inbox.zip"}
    assert body["latest_at"]

    # exclude 가 없으면 내 것도 센다
    res = client.get("/api/integration/new-uploads", params={"since": since.isoformat()}, headers=H)
    assert res.json()["count"] == 3


def test_needs_secret_and_valid_since(client, secret):
    since = datetime.now().isoformat()
    assert client.get("/api/integration/new-uploads", params={"since": since}).status_code == 401
    assert client.get("/api/integration/new-uploads", params={"since": since},
                      headers={"X-HiTESS-Integration": "wrong"}).status_code == 401
    assert client.get("/api/integration/new-uploads", params={"since": "not-a-date"}, headers=H).status_code == 422


def test_timezone_aware_since_is_converted(client, db, secret):
    _batch(db, "recent", uploader="B222222", minutes_ago=1)
    aware = (datetime.now().astimezone() - timedelta(minutes=10)).isoformat()
    res = client.get("/api/integration/new-uploads", params={"since": aware}, headers=H)
    assert res.status_code == 200 and res.json()["count"] == 1


def test_uploading_since_is_earliest_others_upload(client, db, secret):
    since = datetime.now().replace(microsecond=0).isoformat()
    _batch(db, "up-old", uploader="B222222", minutes_ago=20, state="uploading")
    _batch(db, "up-new", uploader="B222222", minutes_ago=3, state="uploading")
    _batch(db, "up-mine", uploader=ME, minutes_ago=40, state="uploading")    # 내 것은 빼고 본다
    body = client.get("/api/integration/new-uploads", params={"since": since, "exclude": ME}, headers=H).json()
    assert body["count"] == 0
    assert body["uploading_since"]
    got = datetime.fromisoformat(body["uploading_since"])
    assert timedelta(minutes=19) < datetime.now() - got < timedelta(minutes=21)


def test_uploading_since_none_without_uploads(client, db, secret):
    body = client.get("/api/integration/new-uploads", params={"since": datetime.now().isoformat()}, headers=H).json()
    assert body["uploading_since"] is None
