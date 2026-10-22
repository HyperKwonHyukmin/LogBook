"""46 — 개선·업데이트 이력: /updates 페이지(껍데기)와 /api/admin/updates(LV3 만)."""
import json

from app.routers.updates import DATA

KINDS = {"기능", "개선", "정리", "운영", "검토"}


def test_old_page_redirects_to_app_screen(client):
    """옛 독립 페이지 주소는 앱 안 화면으로 — 주소 꼬리(?period=)도 함께."""
    r = client.get("/updates", follow_redirects=False)
    assert r.status_code == 307 and r.headers["location"] == "/admin/updates"
    r = client.get("/updates?period=2026-10", follow_redirects=False)
    assert r.headers["location"] == "/admin/updates?period=2026-10"


def test_api_admin_only(client, make_user, auth_headers):
    make_user("A460001", level=3)
    make_user("M460001", level=2)
    assert client.get("/api/admin/updates").status_code == 401
    assert client.get("/api/admin/updates", headers=auth_headers("M460001")).status_code == 403
    items = client.get("/api/admin/updates", headers=auth_headers("A460001")).json()["items"]
    assert isinstance(items, list) and all(i["kind"] in KINDS and i["title"] and i["date"] for i in items)


def test_data_newest_first():
    dates = [i["date"] for i in json.loads(DATA.read_text(encoding="utf-8"))["items"]]
    assert dates == sorted(dates, reverse=True)


def test_data_shape_for_page():
    """화면 문구에 em dash 를 쓰지 않는다(DESIGN.md 7-8). 바로가기는 앱 안 경로만."""
    items = json.loads(DATA.read_text(encoding="utf-8"))["items"]
    for i in items:
        shown = [i["title"], i["summary"], i.get("status") or ""] + i.get("points", [])
        assert not any("—" in t for t in shown), i["title"]
        if "path" in i:
            assert i["path"].startswith("/") and i["screen"]
