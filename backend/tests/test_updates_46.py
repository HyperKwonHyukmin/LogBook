"""46 — 개선·업데이트 이력: /updates 페이지(껍데기)와 /api/admin/updates(LV3 만)."""
import json

from app.routers.updates import DATA

KINDS = {"기능", "개선", "정리", "운영", "검토"}


def test_page_is_html_without_content(client):
    r = client.get("/updates")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    assert "/api/admin/updates" in r.text and "logbook_token" in r.text
    # 내용(항목 제목)은 페이지에 없다 — API 뒤에만
    first = json.loads(DATA.read_text(encoding="utf-8"))["items"][0]["title"]
    assert first not in r.text


def test_api_admin_only(client, make_user, auth_headers):
    make_user("A460001", level=3)
    make_user("M460001", level=2)
    assert client.get("/api/admin/updates").status_code == 401
    assert client.get("/api/admin/updates", headers=auth_headers("M460001")).status_code == 403
    items = client.get("/api/admin/updates", headers=auth_headers("A460001")).json()["items"]
    assert items and all(i["kind"] in KINDS and i["title"] and i["date"] for i in items)


def test_data_newest_first():
    dates = [i["date"] for i in json.loads(DATA.read_text(encoding="utf-8"))["items"]]
    assert dates == sorted(dates, reverse=True)


def test_page_borrows_app_css(tmp_path):
    from app.routers.updates import app_css_link

    (tmp_path / "index.html").write_text('<head><link rel="stylesheet" crossorigin href="/assets/index-ab12.css"></head>',
                                         encoding="utf-8")
    assert app_css_link(tmp_path) == '<link rel="stylesheet" crossorigin href="/assets/index-ab12.css">'
    assert app_css_link(tmp_path / "없음") == "" and app_css_link(None) == ""


def test_data_shape_for_page():
    """화면 문구에 em dash 를 쓰지 않는다(DESIGN.md 7-8). 바로가기는 앱 안 경로만."""
    items = json.loads(DATA.read_text(encoding="utf-8"))["items"]
    for i in items:
        shown = [i["title"], i["summary"], i.get("status") or ""] + i.get("points", [])
        assert not any("—" in t for t in shown), i["title"]
        if "path" in i:
            assert i["path"].startswith("/") and i["screen"]
