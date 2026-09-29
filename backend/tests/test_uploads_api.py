import os
from datetime import datetime, timedelta

from app import models
from app.storage.paths import to_long
from app.uploads import service


def test_upload_roundtrip(client, db, storage, make_user, auth_headers):
    make_user("A100001")
    h = auth_headers("A100001")
    r = client.post("/api/uploads", json={"name": "9999_시험"}, headers=h)
    assert r.status_code == 201, r.text
    key = r.json()["key"]
    r = client.put(f"/api/uploads/{key}/chunk", params={"path": "9999_시험/a.bdf", "offset": 0},
                   content=b"GRID", headers={**h, "Content-Type": "application/octet-stream"})
    assert r.status_code == 200 and r.json() == {"size": 4}
    r = client.put(f"/api/uploads/{key}/chunk", params={"path": "9999_시험/enc.pdf", "offset": 0},
                   content=b"HHIDRMC....", headers={**h, "Content-Type": "application/octet-stream"})
    assert r.status_code == 422 and r.json()["detail"] == "drm_encrypted"
    r = client.post(f"/api/uploads/{key}/finish", headers=h, json={
        "files": [{"rel_path": "9999_시험/a.bdf", "size": 4}],
        "rejected": [{"rel_path": "9999_시험/enc.pdf", "reason": "drm"}]})
    assert r.status_code == 200 and r.json()["state"] == "staged"
    assert os.path.exists(to_long(storage.staging / key / "9999_시험" / "a.bdf"))


def test_offset_mismatch_detail(client, make_user, auth_headers):
    make_user("A100001")
    h = auth_headers("A100001")
    key = client.post("/api/uploads", json={"name": "x"}, headers=h).json()["key"]
    r = client.put(f"/api/uploads/{key}/chunk", params={"path": "a.bdf", "offset": 5},
                   content=b"x", headers={**h, "Content-Type": "application/octet-stream"})
    assert r.status_code == 409 and r.json()["detail"] == {"code": "offset_mismatch", "size": 0}


def test_cancel(client, db, make_user, auth_headers):
    make_user("A100001")
    h = auth_headers("A100001")
    key = client.post("/api/uploads", json={"name": "x"}, headers=h).json()["key"]
    assert client.delete(f"/api/uploads/{key}", headers=h).status_code == 204
    assert db.query(models.Batch).filter_by(key=key).count() == 0


def test_requires_login(client):
    assert client.post("/api/uploads", json={"name": "x"}).status_code == 401


_OCTET = {"Content-Type": "application/octet-stream"}


def test_chunk_service_runs_off_event_loop(client, make_user, auth_headers, monkeypatch):
    """동기 서비스(DB + 공유 폴더 8MB 쓰기)를 이벤트 루프에서 돌리면 서버 전체가 멈춘다(I3)."""
    import asyncio

    make_user("A100001")
    h = auth_headers("A100001")
    key = client.post("/api/uploads", json={"name": "x"}, headers=h).json()["key"]
    seen = []

    def spy(*a, **k):
        try:
            asyncio.get_running_loop()
            seen.append("loop")
        except RuntimeError:
            seen.append("thread")
        return 1

    monkeypatch.setattr(service, "write_chunk", spy)
    r = client.put(f"/api/uploads/{key}/chunk", params={"path": "a.bdf", "offset": 0},
                   content=b"x", headers={**h, **_OCTET})
    assert r.status_code == 200 and seen == ["thread"]


def test_chunk_oversized_content_length_413_without_calling_service(client, make_user, auth_headers,
                                                                     monkeypatch):
    make_user("A100001")
    h = auth_headers("A100001")
    key = client.post("/api/uploads", json={"name": "x"}, headers=h).json()["key"]
    called = []
    monkeypatch.setattr(service, "write_chunk", lambda *a, **k: called.append(1) or 1)
    r = client.put(f"/api/uploads/{key}/chunk", params={"path": "a.bdf", "offset": 0},
                   content=b"x" * (service.MAX_CHUNK + 1), headers={**h, **_OCTET})
    assert r.status_code == 413 and r.json()["detail"] == "chunk_too_large"
    assert called == []


def test_chunk_oversized_streamed_body_413_without_calling_service(client, make_user, auth_headers,
                                                                    monkeypatch):
    """Content-Length 없이(chunked) 오는 본문도 한도를 넘는 순간 끊는다(I4)."""
    make_user("A100001")
    h = auth_headers("A100001")
    key = client.post("/api/uploads", json={"name": "x"}, headers=h).json()["key"]
    called = []
    monkeypatch.setattr(service, "write_chunk", lambda *a, **k: called.append(1) or 1)

    def body():
        for _ in range(9):
            yield b"x" * (1024 * 1024)

    r = client.put(f"/api/uploads/{key}/chunk", params={"path": "a.bdf", "offset": 0},
                   content=body(), headers={**h, **_OCTET})
    assert r.status_code == 413 and r.json()["detail"] == "chunk_too_large"
    assert called == []


def test_finish_ok_even_if_audit_fails(client, db, storage, make_user, auth_headers, monkeypatch):
    make_user("A100001")
    h = auth_headers("A100001")
    key = client.post("/api/uploads", json={"name": "x"}, headers=h).json()["key"]
    client.put(f"/api/uploads/{key}/chunk", params={"path": "a.bdf", "offset": 0},
               content=b"GRID", headers={**h, **_OCTET})

    def boom(*a, **k):
        raise RuntimeError("audit down")

    monkeypatch.setattr(service.audit, "record", boom)
    r = client.post(f"/api/uploads/{key}/finish", headers=h,
                    json={"files": [{"rel_path": "a.bdf", "size": 4}]})
    assert r.status_code == 200 and r.json()["state"] == "staged"
    assert os.path.exists(to_long(storage.staging / key / "a.bdf"))


def test_cleanup_stale_removes_old_uploads_only(db, storage, make_user):
    user = make_user("A100001")
    old = service.begin(db, storage, user, name="old", target_entry_id=None)
    new = service.begin(db, storage, user, name="new", target_entry_id=None)
    old.received_at = datetime.now() - timedelta(hours=25)
    db.commit()
    assert service.cleanup_stale(db, storage) == 1
    assert db.query(models.Batch).filter_by(key=old.key).count() == 0
    assert not os.path.exists(to_long(storage.web_inbox / old.key))
    assert os.path.exists(to_long(storage.web_inbox / new.key))
