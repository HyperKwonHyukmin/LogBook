"""72 — 새 자료 표시: 기준 시각(처음 7일 전), 내가 올린 것 제외, 열어 보면 그것만, 모두 확인, 관심 대상(묶음 포함)·선종, 끄기, 검색 new·is_new."""
from datetime import datetime, timedelta

from app import models

ME, OTHER = "U720001", "U720002"


def _target(db, entry, value, parent=None):
    t = db.query(models.Tag).filter_by(kind="target", value=value).first()
    if t is None:
        t = models.Tag(kind="target", value=value, listed=True)
        db.add(t)
        db.flush()
    if parent is not None:
        t.parent_id = parent.id
    if entry is not None:
        db.add(models.EntryTag(entry_id=entry.id, tag_id=t.id))
    db.commit()
    return t


def _setup(db, make_user, make_entry_file):
    make_user(ME, level=2)
    make_user(OTHER, level=2)
    now = datetime.now().replace(microsecond=0)
    es = {}
    for key, days, who, hull in (("fresh", 1, OTHER, "3496"), ("fresh2", 2, OTHER, "3497"), ("old", 10, OTHER, "3496"),
                                 ("mine", 1, ME, "3496")):
        e, _ = make_entry_file(title=f"{key} 자료", hulls=(hull,), name=f"{key}.pdf", uploaded_by=who,
                               confirmed_at=now - timedelta(days=days))
        es[key] = e
    draft, _ = make_entry_file(title="초안", status="draft", uploaded_by=OTHER, name="d.pdf")
    es["draft"] = draft
    db.get(models.Hull, "3496").ship_type = "LNGC"
    db.get(models.Hull, "3497").ship_type = "VLCC"
    db.commit()
    return es


def test_count_seen_and_seen_all(db, client, auth_headers, make_user, make_entry_file):
    es = _setup(db, make_user, make_entry_file)
    h = auth_headers(ME)
    s = client.get("/api/me/news", headers=h).json()
    assert s["enabled"] is True and s["count"] == 2   # 7일 안 남의 확정 자료만(오래된 것, 내 것, 초안 제외)
    items = {i["entry_id"]: i for i in client.get("/api/search", headers=h).json()["items"]}
    assert items[es["fresh"].entry_id]["is_new"] and not items[es["old"].entry_id]["is_new"]
    assert not items[es["mine"].entry_id]["is_new"]
    got = [i["entry_id"] for i in client.get("/api/search", params={"new": "true"}, headers=h).json()["items"]]
    assert sorted(got) == sorted([es["fresh"].entry_id, es["fresh2"].entry_id])
    assert client.get(f"/api/entries/{es['fresh'].entry_id}", headers=h).json()["is_new"] is True
    # 열어 보면 그 자료만 빠진다(다른 사람에게는 그대로)
    assert client.post("/api/me/news/seen", json={"entry_id": es["fresh"].entry_id}, headers=h).json() == {"count": 1}
    assert client.get(f"/api/entries/{es['fresh'].entry_id}", headers=h).json()["is_new"] is False
    assert client.post("/api/me/news/seen", json={"entry_id": es["fresh"].entry_id}, headers=h).status_code == 200   # 두 번째도 괜찮다
    assert client.post("/api/me/news/seen", json={"entry_id": "E999999"}, headers=h).status_code == 404
    # 모두 확인 — 0, 그 뒤 새로 확정된 자료는 다시 새 자료
    s = client.post("/api/me/news/seen-all", headers=h).json()
    assert s["count"] == 0 and db.query(models.EntryView).filter_by(employee_id=ME).count() == 0
    later, _ = make_entry_file(title="나중 자료", hulls=("3496",), name="l.pdf", uploaded_by=OTHER,
                               confirmed_at=datetime.now() + timedelta(seconds=5))
    assert client.get("/api/me/news", headers=h).json()["count"] == 1
    assert [i["entry_id"] for i in client.get("/api/search", params={"new": "true"}, headers=h).json()["items"]] == [later.entry_id]


def test_interest_filters_and_off(db, client, auth_headers, make_user, make_entry_file):
    es = _setup(db, make_user, make_entry_file)
    group = _target(db, None, "배관")
    _target(db, es["fresh"], "Manifold", parent=group)
    _target(db, es["fresh2"], "Unit")
    h = auth_headers(ME)
    put = lambda body: client.put("/api/me/prefs", json=body, headers=h)   # noqa: E731
    assert put({"news.targets": ["배관"]}).status_code == 200     # 묶음 → 하위 Manifold 자료
    assert client.get("/api/me/news", headers=h).json()["count"] == 1
    assert put({"news.targets": None, "news.shipTypes": ["VLCC"]}).status_code == 200
    s = client.get("/api/me/news", headers=h).json()
    assert s["count"] == 1 and s["ship_types"] == ["VLCC"] and s["targets"] == []
    assert put({"news.enabled": False}).status_code == 200
    assert client.get("/api/me/news", headers=h).json() | {"since": None} == {
        "enabled": False, "count": 0, "since": None, "targets": [], "ship_types": ["VLCC"]}
    assert not any(i["is_new"] for i in client.get("/api/search", headers=h).json()["items"])
    assert client.get("/api/search", params={"new": "true"}, headers=h).json()["items"] == []
    assert put({"news.enabled": "yes"}).status_code == 422
    assert put({"news.targets": ["a"] * 31}).status_code == 422
    assert put({"news.seenAt": "어제"}).status_code == 422
