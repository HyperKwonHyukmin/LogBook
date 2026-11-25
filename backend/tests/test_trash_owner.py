"""2026-11-25 — 휴지통은 버린 사람의 것: 목록은 자기가 버린 것만(LV3 은 scope=all), 영구 삭제는 LV3 또는 자기가 버린 자기 자료."""
from app import models
from app.entries import service

U1, U2, ADMIN = "A110001", "B220002", "C330003"


def _user(db, employee_id):
    return db.query(models.User).filter_by(employee_id=employee_id).one()


def _trashed(db, storage, setup_entry_with_files, uploader, by, key):
    _, e = setup_entry_with_files(uploader=uploader, key=key)
    service.confirm(db, storage, e, _user(db, uploader))
    service.trash(db, storage, e, _user(db, by))
    db.expire_all()
    return db.get(models.Entry, e.id)


def test_trash_list_is_mine_and_purge_rules(db, storage, client, auth_headers, make_user, setup_entry_with_files):
    make_user(U1, name="가나다")
    make_user(U2, name="라마바", level=1)
    make_user(ADMIN, name="관리자", is_admin=True)
    mine = _trashed(db, storage, setup_entry_with_files, U1, U1, "20261125-000000-t001")
    by_admin = _trashed(db, storage, setup_entry_with_files, U1, ADMIN, "20261125-000000-t002")
    h1, h2, ha = auth_headers(U1), auth_headers(U2), auth_headers(ADMIN)
    mine_id, mine_rel, admin_id = mine.entry_id, mine.trash_rel, by_admin.entry_id

    # 올린 사람이어도 남(관리자)이 버린 것은 내 휴지통에 없다
    rows = client.get("/api/trash", headers=h1).json()
    assert [r["entry_id"] for r in rows] == [mine_id]
    assert rows[0]["can_purge"] is True and rows[0]["trashed_by"] == U1 and rows[0]["trashed_by_name"] == "가나다"
    # 다른 사람(LV1)에게는 아무것도 없고, scope=all 도 일반 사용자에게는 자기 것만
    assert client.get("/api/trash", headers=h2).json() == []
    assert [r["entry_id"] for r in client.get("/api/trash", params={"scope": "all"}, headers=h1).json()] == [mine_id]
    # 관리자: 기본은 자기가 버린 것, scope=all 이면 모두
    assert [r["entry_id"] for r in client.get("/api/trash", headers=ha).json()] == [admin_id]
    assert {r["entry_id"] for r in client.get("/api/trash", params={"scope": "all"}, headers=ha).json()} == {mine_id, admin_id}

    # 영구 삭제: 남이 버린 것은 올린 사람도 못 한다, 자기가 버린 자기 자료는 된다
    assert client.delete(f"/api/trash/{admin_id}", headers=h1).status_code == 403
    assert client.delete(f"/api/trash/{mine_id}", headers=h2).status_code in (403, 404)   # LV1 남의 자료
    assert client.delete(f"/api/trash/{mine_id}", headers=h1).status_code == 204
    db.expire_all()
    assert db.query(models.Entry).filter_by(entry_id=mine_id).first() is None
    assert not (storage.trash / mine_rel).exists()
    assert db.query(models.AuditLog).filter_by(action="TRASH_PURGE", target_id=mine_id).one().employee_id == U1
    # 관리자는 누구 것이든
    assert client.delete(f"/api/trash/{admin_id}", headers=ha).status_code == 204
    # 휴지통에 없는 자료
    _, live = setup_entry_with_files(uploader=U1, key="20261125-000000-t003")
    service.confirm(db, storage, live, _user(db, U1))
    assert client.delete(f"/api/trash/{live.entry_id}", headers=h1).status_code == 409


def test_trash_owner_falls_back_to_uploader(db, storage, client, auth_headers, make_user, setup_entry_with_files):
    """감사 기록이 없으면(재구축 뒤) 올린 사람이 버린 사람이다."""
    make_user(U1)
    e = _trashed(db, storage, setup_entry_with_files, U1, U1, "20261125-000000-t004")
    db.query(models.AuditLog).delete()
    db.commit()
    rows = client.get("/api/trash", headers=auth_headers(U1)).json()
    assert [r["entry_id"] for r in rows] == [e.entry_id] and rows[0]["can_purge"] is True
