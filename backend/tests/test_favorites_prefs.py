"""10 — 즐겨찾기(사용자별, 서버 저장)·사용자 화면 설정."""
import os
from datetime import datetime, timedelta

import pytest

from app import database, models
from app.ops.purge import purge_entry
from app.storage.paths import to_long


def _fav(db, employee_id, entry, at=None):
    db.add(models.Favorite(employee_id=employee_id, entry_id=entry.id, created_at=at or datetime(2026, 10, 1)))
    db.commit()


# ---- API ----

def test_put_delete_favorite_is_idempotent(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    e, _ = make_entry_file(title="계류 검토")
    h = auth_headers("A100001")
    for _ in range(2):
        r = client.put(f"/api/favorites/{e.entry_id}", headers=h)
        assert r.status_code == 200 and r.json() == {"entry_id": e.entry_id, "favorite": True}
    assert db.query(models.Favorite).count() == 1
    assert client.get(f"/api/entries/{e.entry_id}", headers=h).json()["favorite"] is True
    # 소문자 번호도 같은 Entry
    assert client.delete(f"/api/favorites/{e.entry_id.lower()}", headers=h).json()["favorite"] is False
    assert client.delete(f"/api/favorites/{e.entry_id}", headers=h).status_code == 200
    assert db.query(models.Favorite).count() == 0
    assert client.get(f"/api/entries/{e.entry_id}", headers=h).json()["favorite"] is False


def test_favorite_errors(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    t, _ = make_entry_file(status="trashed")
    h = auth_headers("A100001")
    assert client.put("/api/favorites/E999999", headers=h).status_code == 404
    assert client.put(f"/api/favorites/{t.entry_id}", headers=h).json()["detail"] == "entry_trashed"
    assert client.put(f"/api/favorites/{t.entry_id}").status_code == 401


def test_favorites_are_per_user(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    make_user("B200002")
    e, _ = make_entry_file()
    client.put(f"/api/favorites/{e.entry_id}", headers=auth_headers("A100001"))
    hb = auth_headers("B200002")
    assert client.get("/api/favorites", headers=hb).json() == {"total": 0, "items": []}
    assert client.get(f"/api/entries/{e.entry_id}", headers=hb).json()["favorite"] is False
    assert client.get("/api/search", headers=hb).json()["items"][0]["favorite"] is False


def test_list_favorites_newest_first_hides_trashed(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    a, _ = make_entry_file(title="가")
    b, _ = make_entry_file(title="나")
    d, _ = make_entry_file(title="초안", status="draft")
    t, _ = make_entry_file(title="휴지통", status="trashed")
    now = datetime(2026, 10, 7, 9, 0, 0)
    _fav(db, "A100001", a, now - timedelta(days=2))
    _fav(db, "A100001", b, now)
    _fav(db, "A100001", d, now - timedelta(days=1))
    _fav(db, "A100001", t, now)
    res = client.get("/api/favorites", headers=auth_headers("A100001")).json()
    assert [i["entry_id"] for i in res["items"]] == [b.entry_id, d.entry_id, a.entry_id]
    assert res["total"] == 3
    # 검색 결과 행과 같은 모양(제목·종류별 파일 수 등) + favorite
    it = res["items"][0]
    assert it["title"] == "나" and it["favorite"] is True and "kind_counts" in it and "_pk" not in it


def test_search_fav_filter_and_flags(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    a, _ = make_entry_file(title="계류 검토 가")
    b, _ = make_entry_file(title="계류 검토 나")
    d, _ = make_entry_file(title="계류 초안", status="draft")
    _fav(db, "A100001", a)
    _fav(db, "A100001", d)
    h = auth_headers("A100001")
    res = client.get("/api/search", headers=h).json()
    flags = {i["entry_id"]: i["favorite"] for i in res["items"]}
    assert flags == {a.entry_id: True, b.entry_id: False} and res["favorites_only"] is False
    # 즐겨찾기만 — 미확정도 보인다(drafts 를 켜지 않아도)
    res = client.get("/api/search?fav=1", headers=h).json()
    assert sorted(i["entry_id"] for i in res["items"]) == sorted([a.entry_id, d.entry_id])
    assert res["favorites_only"] is True and all(i["favorite"] for i in res["items"])
    # 검색어·필터와 함께
    assert [i["entry_id"] for i in client.get("/api/search?fav=1&q=초안", headers=h).json()["items"]] == [d.entry_id]
    # 파일 보기에도 파일이 든 Entry 의 즐겨찾기 여부
    files = client.get("/api/search?unit=file", headers=h).json()["items"]
    assert {f["entry_id"]: f["favorite"] for f in files} == {a.entry_id: True, b.entry_id: False}
    # 즐겨찾기한 순 정렬은 fav 없이 쓰면 기본 정렬로 돌아간다
    assert client.get("/api/search?sort=favorited", headers=h).json()["sort"] == "recent"
    assert client.get("/api/search?fav=1", headers=h).json()["sort"] == "recent"
    assert client.get("/api/search?fav=1&sort=favorited", headers=h).json()["sort"] == "favorited"


def test_hull_timeline_carries_favorite(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    a, _ = make_entry_file(title="가", hulls=("9001",))
    b, _ = make_entry_file(title="나", hulls=("9001",))
    _fav(db, "A100001", a)
    tl = client.get("/api/hulls/9001", headers=auth_headers("A100001")).json()["timeline"]
    flags = {e["entry_id"]: e["favorite"] for m in tl for e in m["entries"]}
    assert flags == {a.entry_id: True, b.entry_id: False}


# ---- 휴지통·영구 삭제·합치기 ----

def test_trash_hides_and_restore_brings_back(client, db, storage, make_user, auth_headers, setup_entry_with_files):
    make_user("A100001")
    _, e = setup_entry_with_files()
    h = auth_headers("A100001")
    assert client.post(f"/api/entries/{e.entry_id}/confirm", headers=h).status_code == 200
    client.put(f"/api/favorites/{e.entry_id}", headers=h)
    assert client.get("/api/favorites", headers=h).json()["total"] == 1
    client.delete(f"/api/entries/{e.entry_id}", headers=h)
    assert client.get("/api/favorites", headers=h).json()["total"] == 0
    assert client.get("/api/search?fav=1", headers=h).json()["total"] == 0
    assert db.query(models.Favorite).count() == 1   # 행은 남는다
    client.post(f"/api/entries/{e.entry_id}/restore", headers=h)
    assert [i["entry_id"] for i in client.get("/api/favorites", headers=h).json()["items"]] == [e.entry_id]


def test_purge_deletes_favorites(db, storage, make_entry_file):
    e, _ = make_entry_file(status="trashed", name="r.pdf")
    e.trash_rel = "E_fav"
    db.commit()
    os.makedirs(to_long(storage.trash / "E_fav"), exist_ok=True)
    _fav(db, "A100001", e)
    _fav(db, "B200002", e)
    keep, _ = make_entry_file()
    _fav(db, "A100001", keep)
    purge_entry(db, storage, e, "A100001")
    db.commit()
    assert [f.entry_id for f in db.query(models.Favorite)] == [keep.id]


def test_merge_deletes_favorites_of_removed_draft(client, db, make_user, auth_headers, setup_entry_with_files):
    make_user("A100001")
    _, e = setup_entry_with_files()
    h = auth_headers("A100001")
    f1, f2 = db.query(models.File).order_by(models.File.rel_path).all()
    new = client.post(f"/api/entries/{e.entry_id}/split", headers=h, json={"file_ids": [f2.id]}).json()
    client.put(f"/api/favorites/{new['entry_id']}", headers=h)
    assert client.post(f"/api/entries/{e.entry_id}/merge", headers=h,
                       json={"from_entry_id": new["entry_id"]}).status_code == 200
    assert db.query(models.Favorite).count() == 0


@pytest.mark.fresh_schema   # 스키마를 바꾼다(conftest 'DB 초기화')
def test_init_schema_creates_new_tables(db):
    """운영 DB(145)는 재시작 때 init_schema 의 create_all 로 새 표를 만든다."""
    from sqlalchemy import inspect

    models.Favorite.__table__.drop(database.engine)
    models.UserPref.__table__.drop(database.engine)
    database.init_schema()
    names = set(inspect(database.engine).get_table_names())
    assert {"favorites", "user_prefs"} <= names


# ---- 사용자 설정 ----

def test_prefs_roundtrip(client, db, make_user, auth_headers):
    make_user("A100001")
    make_user("B200002")
    h = auth_headers("A100001")
    assert client.get("/api/me/prefs", headers=h).json() == {}
    r = client.put("/api/me/prefs", headers=h, json={"search.previewWidth": 612.4})
    assert r.status_code == 200 and r.json() == {"search.previewWidth": 612}
    assert client.put("/api/me/prefs", headers=h, json={"search.previewWidth": 700}).json() == {"search.previewWidth": 700}
    assert client.get("/api/me/prefs", headers=h).json() == {"search.previewWidth": 700}
    assert client.get("/api/me/prefs", headers=auth_headers("B200002")).json() == {}   # 사용자별
    assert client.put("/api/me/prefs", headers=h, json={"search.previewWidth": None}).json() == {}
    assert db.query(models.UserPref).count() == 0


def test_prefs_validation(client, make_user, auth_headers):
    make_user("A100001")
    h = auth_headers("A100001")
    cases = [({"theme": "dark"}, "unknown_pref"), ({"search.previewWidth": 100}, "invalid_pref"),
             ({"search.previewWidth": "600"}, "invalid_pref"), ({"search.previewWidth": True}, "invalid_pref"),
             ({}, "empty_prefs"), ({"search.previewWidth": "x" * 2000}, "pref_too_large")]
    for body, detail in cases:
        r = client.put("/api/me/prefs", headers=h, json=body)
        assert r.status_code == 422 and r.json()["detail"] == detail, body
    assert client.put("/api/me/prefs", headers=h, json=[1, 2]).status_code == 422
    assert client.get("/api/me/prefs").status_code == 401
