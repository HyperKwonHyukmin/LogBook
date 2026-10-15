"""11 — 검색 묶어 보기(group)·한 번의 저장 = 이력 한 줄·최근 비교(compare_history)."""
from app.access import SYSTEM
from datetime import datetime, timedelta

import pytest

from app import compares, database, models
from app.search import SearchQuery, get_search
from app.search.base import GROUP_NONE


def _q(db, q="", **kw):
    filters = kw.pop("filters", {})
    return get_search().search(db, SearchQuery(q=q, filters=filters, **({"user": SYSTEM} | kw)))


def _zone(db, e, value):
    t = db.query(models.Tag).filter_by(kind="zone", value=value).first()
    if t is None:
        t = models.Tag(kind="zone", value=value, listed=True)
        db.add(t)
        db.flush()
    db.add(models.EntryTag(entry_id=e.id, tag_id=t.id))
    db.commit()


# ---- 1. 묶어 보기 ----

def test_group_by_zone_counts_whole_result_and_none_last(db, storage, make_entry_file):
    a, _ = make_entry_file(title="가")
    b, _ = make_entry_file(title="나")
    c, _ = make_entry_file(title="다")
    d, _ = make_entry_file(title="라")   # 구역 없음
    _zone(db, a, "선미부")
    _zone(db, b, "선미부")
    _zone(db, c, "선미부")
    _zone(db, c, "기관실")              # 두 구역 — 두 묶음에 다 든다
    res = _q(db, group="zone", group_rows=2)
    assert res["group"] == "zone" and res["items"] == [] and res["total"] == 4
    assert [(g["value"], g["count"]) for g in res["groups"]] == [("선미부", 3), ("기관실", 1), (None, 1)]
    assert len(res["groups"][0]["items"]) == 2      # 처음 N 행만
    assert res["groups"][2]["items"][0]["entry_id"] == d.entry_id
    assert res["multi_valued"] == 1 and res["group_total"] == 3
    # 같은 행 모양 + 즐겨찾기 표시
    it = res["groups"][1]["items"][0]
    assert it["entry_id"] == c.entry_id and "kind_counts" in it and it["favorite"] is False and "_pk" not in it


def test_group_more_uses_same_order_and_none_token(db, storage, make_entry_file):
    es = [make_entry_file(title=f"자료{i}", period=f"2025-0{i}")[0] for i in range(1, 6)]
    for e in es[:4]:
        _zone(db, e, "선미부")
    more = _q(db, group="zone", group_value="선미부", limit=2, offset=2)
    assert more["total"] == 4 and more["group_value"] == "선미부"
    # 정렬 = 최신순(같은 확정일이면 나중 번호 먼저) → 4,3 | 2,1
    assert [i["entry_id"] for i in more["items"]] == [es[1].entry_id, es[0].entry_id]
    none = _q(db, group="zone", group_value=GROUP_NONE)
    assert [i["entry_id"] for i in none["items"]] == [es[4].entry_id]


def test_group_by_hull_and_uploader_labels_and_name_sort(db, storage, make_user, make_entry_file):
    make_user("A100001", name="김해석")
    make_user("B200002", name="박검토")
    make_entry_file(title="가", hulls=("9002",), uploaded_by="A100001")
    make_entry_file(title="나", hulls=("9001", "9002"), uploaded_by="B200002")
    db.get(models.Hull, "9002").ship_type = "벌크선"
    db.commit()
    res = _q(db, group="hull", group_sort="name")
    assert [(g["value"], g["count"], g["label"]) for g in res["groups"]] == [("9001", 1, None), ("9002", 2, "벌크선")]
    res = _q(db, group="uploaded_by")
    assert {g["value"]: g["label"] for g in res["groups"]} == {"A100001": "김해석", "B200002": "박검토"}


def test_group_api_validation_and_paging(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    for i in range(3):
        make_entry_file(title=f"자료{i}", hulls=(f"900{i}",))
    h = auth_headers("A100001")
    assert client.get("/api/search?group=bogus", headers=h).status_code == 422
    r = client.get("/api/search?group=hull&group_limit=2&group_offset=1", headers=h).json()
    assert r["group_total"] == 3 and len(r["groups"]) == 2 and r["group_offset"] == 1
    # 파일 보기에서는 묶지 않는다
    r = client.get("/api/search?group=hull&unit=file", headers=h).json()
    assert r["group"] is None and "groups" not in r and len(r["items"]) == 3


def test_group_pref_whitelist(client, make_user, auth_headers):
    make_user("A100001")
    h = auth_headers("A100001")
    assert client.put("/api/me/prefs", json={"search.group": "zone"}, headers=h).json()["search.group"] == "zone"
    assert client.put("/api/me/prefs", json={"search.group": "kind"}, headers=h).status_code == 422
    assert "search.group" not in client.put("/api/me/prefs", json={"search.group": None}, headers=h).json()


# ---- 2. 한 번의 저장 = 이력 한 줄 ----

def test_patch_all_fields_once_is_one_audit_row(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001", is_admin=True)
    e, _ = make_entry_file(title="옛 제목", hulls=("9001",))
    h = auth_headers("A100001")
    before = db.query(models.AuditLog).filter_by(target_id=e.entry_id).count()
    # 15 — 해석 시기(analysis_period)는 받지 않는다(보내도 무시 — 저장·감사에 남지 않는다)
    body = {"version": e.version, "title": "새 제목", "description": "설명", "analysis_period": "2025-11",
            "analysis_type": "FE 해석", "hulls": ["9001", "9002"], "zones": ["선미부"], "tags": ["계류"]}
    r = client.patch(f"/api/entries/{e.entry_id}", json=body, headers=h)
    assert r.status_code == 200
    got = r.json()
    assert got["version"] == e.version + 1 and [x["hull_no"] for x in got["hulls"]] == ["9001", "9002"]
    rows = db.query(models.AuditLog).filter_by(target_id=e.entry_id, action="ENTRY_UPDATE").all()
    assert len(rows) == 1 and db.query(models.AuditLog).filter_by(target_id=e.entry_id).count() == before + 1
    assert rows[0].after["hulls"] == ["9001", "9002"] and rows[0].after["tags"] == ["계류"]
    assert rows[0].before["title"] == "옛 제목" and rows[0].after["title"] == "새 제목"
    assert "analysis_period" not in rows[0].after and "analysis_period" not in got
    db.expire_all()
    assert db.query(models.Entry).filter_by(entry_id=e.entry_id).one().analysis_period is None
    # 옛 version 으로 다시 보내면 409
    r = client.patch(f"/api/entries/{e.entry_id}", json={**body, "title": "또"}, headers=h)
    assert r.status_code == 409 and r.json()["detail"] == "version_conflict"


# ---- 3. 최근 비교 ----

def _models(make_entry_file, n=3, state="done"):
    out = []
    e = None
    for i in range(n):
        e, f = make_entry_file(entry=e, name=f"m{i}.bdf", kind="model")
        out.append(f)
    return e, out


def _summary(db, f, state="done", key="k"):
    db.add(models.ModelSummary(file_id=f.id, state=state, key=key if state == "done" else None))
    db.commit()


def test_record_dedupes_set_keeps_last_order_and_counts(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    _, (a, b, c) = _models(make_entry_file)
    for f in (a, b, c):
        _summary(db, f, key=f"k{f.id}")
    h = auth_headers("A100001")
    r1 = client.post("/api/me/compares", json={"file_ids": [a.id, b.id]}, headers=h).json()
    r2 = client.post("/api/me/compares", json={"file_ids": [b.id, a.id]}, headers=h).json()
    assert r1["id"] == r2["id"] and r2["open_count"] == 2 and r2["file_ids"] == [b.id, a.id]
    client.post("/api/me/compares", json={"file_ids": [a.id, b.id, c.id]}, headers=h)
    items = client.get("/api/me/compares", headers=h).json()["items"]
    assert [i["file_ids"] for i in items] == [[a.id, b.id, c.id], [b.id, a.id]]
    f0 = items[0]["files"][0]
    assert f0["name"] == "m0.bdf" and f0["hull"] == "9999" and f0["available"] is True and f0["model_key"] == f"k{a.id}"
    assert f0["entry_id"].startswith("E")
    # 다른 사용자에게는 보이지 않는다
    make_user("B200002")
    assert client.get("/api/me/compares", headers=auth_headers("B200002")).json()["items"] == []


def test_record_rejects_fewer_than_two_models(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    _, (a, b, _c) = _models(make_entry_file)
    _, pdf = make_entry_file(name="r.pdf")
    h = auth_headers("A100001")
    assert client.post("/api/me/compares", json={"file_ids": [a.id]}, headers=h).status_code == 422
    assert client.post("/api/me/compares", json={"file_ids": [a.id, pdf.id, 999999]}, headers=h).status_code == 422
    assert client.post("/api/me/compares", json={"file_ids": "x"}, headers=h).status_code == 422
    assert client.post("/api/me/compares", json={"file_ids": [a.id, b.id]}).status_code == 401


def test_keep_latest_20(db, storage, make_user, make_entry_file):
    _, fs = _models(make_entry_file, n=8)
    import itertools
    pairs = list(itertools.combinations([f.id for f in fs], 2))[:23]
    t0 = datetime(2026, 10, 1)
    for i, p in enumerate(pairs):
        row = compares.record(db, "A100001", list(p))
        row.last_opened_at = t0 + timedelta(minutes=i)
        db.commit()
    compares.record(db, "A100001", list(pairs[-1]))
    assert db.query(models.CompareHistory).filter_by(employee_id="A100001").count() == compares.KEEP


def test_notes_and_purged_files_are_dropped(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    _, (a, b, c) = _models(make_entry_file)
    _summary(db, a)
    _summary(db, b, state="failed")
    h = auth_headers("A100001")
    rid = client.post("/api/me/compares", json={"file_ids": [a.id, b.id, c.id]}, headers=h).json()["id"]
    files = client.get("/api/me/compares", headers=h).json()["items"][0]["files"]
    assert [(f["available"], f["note"]) for f in files] == [(True, None), (False, "failed"), (False, "pending")]
    # c 가 영구 삭제됨 → 빼고 남긴다
    db.query(models.File).filter_by(id=c.id).delete()
    db.commit()
    item = client.get("/api/me/compares", headers=h).json()["items"][0]
    assert item["id"] == rid and item["file_ids"] == [a.id, b.id] and item["dropped"] == 1
    # b 도 사라지면 비교가 아니다 — 행을 지운다
    db.query(models.ModelSummary).filter_by(file_id=b.id).delete()
    db.query(models.File).filter_by(id=b.id).delete()
    db.commit()
    assert client.get("/api/me/compares", headers=h).json()["items"] == []
    assert db.query(models.CompareHistory).count() == 0


def test_delete_one_and_all(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    make_user("B200002")
    _, (a, b, c) = _models(make_entry_file)
    h = auth_headers("A100001")
    r1 = client.post("/api/me/compares", json={"file_ids": [a.id, b.id]}, headers=h).json()["id"]
    client.post("/api/me/compares", json={"file_ids": [a.id, c.id]}, headers=h)
    assert client.delete(f"/api/me/compares/{r1}", headers=auth_headers("B200002")).status_code == 404
    assert client.delete(f"/api/me/compares/{r1}", headers=h).json() == {"ok": True}
    assert len(client.get("/api/me/compares", headers=h).json()["items"]) == 1
    assert client.delete("/api/me/compares", headers=h).json() == {"deleted": 1}


@pytest.mark.fresh_schema   # 스키마를 바꾼다(conftest 'DB 초기화')
def test_init_schema_creates_compare_history():
    database.Base.metadata.drop_all(database.engine, tables=[models.CompareHistory.__table__])
    database.init_schema()
    from sqlalchemy import inspect
    assert "compare_history" in inspect(database.engine).get_table_names()
