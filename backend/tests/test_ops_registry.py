import json
import os

from app import models
from app.ops.registry import REGISTRY_FILE, build_registry, read_registry, write_registry
from app.storage.paths import to_long


def _seed(db):
    db.add(models.User(employee_id="A100001", name="홍길동", department="구조", status="active", is_admin=True))
    db.add(models.Hull(hull_no="9999", ship_type="LNGC", memo="174K"))
    bow = models.Tag(kind="zone", value="선수부")
    db.add(bow)
    db.flush()
    db.add(models.Tag(kind="zone", value="FWD", alias_of_id=bow.id))
    db.add(models.Tag(kind="free", value="계류"))
    db.commit()


def test_build_registry(db):
    _seed(db)
    r = build_registry(db)
    assert r["version"] == 1
    assert r["users"][0]["employee_id"] == "A100001" and r["users"][0]["is_admin"] is True
    assert r["hulls"] == [{"hull_no": "9999", "ship_type": "LNGC", "memo": "174K"}]
    assert r["tags"] == [{"kind": "zone", "value": "FWD", "alias_of": "선수부"}]


def test_write_and_read(db, storage):
    _seed(db)
    write_registry(db, storage)
    path = storage.system / REGISTRY_FILE
    with open(to_long(path), encoding="utf-8") as fh:
        assert json.load(fh)["hulls"][0]["memo"] == "174K"
    assert read_registry(storage)["tags"][0]["value"] == "FWD"


def test_write_failure_does_not_raise(db, storage, monkeypatch):
    _seed(db)
    import app.ops.registry as reg

    def boom(*a, **k):
        raise OSError("share down")
    monkeypatch.setattr(reg.os, "replace", boom)
    write_registry(db, storage)  # 예외 없이 경고만


def test_alias_and_hull_update_write_registry(client, db, storage, make_user, auth_headers):
    make_user("A100001")
    h = auth_headers("A100001")
    a, b = models.Tag(kind="zone", value="A"), models.Tag(kind="zone", value="B")
    db.add_all([a, b])
    db.commit()
    client.post(f"/api/tags/{b.id}/alias", json={"target_id": a.id}, headers=h)
    assert read_registry(storage)["tags"] == [{"kind": "zone", "value": "B", "alias_of": "A"}]
    client.patch("/api/hulls/9999", json={"memo": "메모"}, headers=h)
    assert read_registry(storage)["hulls"][0]["memo"] == "메모"


def test_read_missing_returns_empty(storage):
    assert read_registry(storage) == {"version": 1, "users": [], "hulls": [], "tags": []}


def test_user_changes_write_registry(client, db, storage, make_user, auth_headers):
    """가입 신청·승인·관리자 지정·create_admin 뒤에도 registry.json 이 갱신된다."""
    from app.cli import create_admin

    make_user("A100001", is_admin=True)
    h = auth_headers("A100001")
    client.post("/api/auth/register", json={"employee_id": "A100002", "name": "김철수"})
    users = {u["employee_id"]: u for u in read_registry(storage)["users"]}
    assert users["A100002"]["status"] == "pending"
    client.post("/api/admin/users/A100002/approve", headers=h)
    client.put("/api/admin/users/A100002/admin", json={"is_admin": True}, headers=h)
    users = {u["employee_id"]: u for u in read_registry(storage)["users"]}
    assert users["A100002"]["status"] == "active" and users["A100002"]["is_admin"] is True
    create_admin(db, storage, "A100003", "이영희", None)
    assert "A100003" in {u["employee_id"] for u in read_registry(storage)["users"]}


def test_concurrent_writes_leave_valid_file_and_no_tmp(db, storage):
    """여러 스레드가 동시에 써도 파일이 깨지지 않고 임시 파일이 남지 않는다(리뷰 I5)."""
    import threading

    from app import database

    _seed(db)
    errors = []

    def writer():
        s = database.SessionLocal()
        try:
            for _ in range(5):
                if not write_registry(s, storage):
                    errors.append("fail")
        finally:
            s.close()

    threads = [threading.Thread(target=writer) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(60)
    assert errors == []
    assert read_registry(storage)["hulls"][0]["memo"] == "174K"
    assert not [n for n in os.listdir(to_long(storage.system)) if n.endswith(".tmp")]
