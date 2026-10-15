"""SPA 캐시 규칙 — 재배포 뒤 열린 탭이 사라진 묶음을 부르지 않게.

app.spa 만 쓴다(create_app·DB 없이 FastAPI 하나에 붙인다) — `pytest --noconftest tests/test_spa_cache.py` 로
테스트 DB 없이도 돈다(일반 실행에서는 conftest 의 공통 fixture 가 함께 걸린다).
"""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.spa import IMMUTABLE, NO_CACHE, mount_spa


def _client(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>로그북</html>", encoding="utf-8")
    (dist / "assets" / "index-abc123.js").write_text("console.log(1)", encoding="utf-8")
    (dist / "favicon.png").write_bytes(b"\x89PNG")
    app = FastAPI()
    mount_spa(app, dist)
    return TestClient(app)


def test_index_and_spa_fallback_are_no_cache(tmp_path):
    client = _client(tmp_path)
    for url in ("/", "/index.html", "/e/E000123", "/compare?ids=1,2"):
        res = client.get(url)
        assert res.status_code == 200
        assert "로그북" in res.text
        assert res.headers["cache-control"] == NO_CACHE, url


def test_hashed_assets_are_long_cached(tmp_path):
    res = _client(tmp_path).get("/assets/index-abc123.js")
    assert res.status_code == 200
    assert res.headers["cache-control"] == IMMUTABLE


def test_missing_asset_stays_404_without_long_cache(tmp_path):
    res = _client(tmp_path).get("/assets/ComparePage-old999.js")
    assert res.status_code == 404
    assert "immutable" not in res.headers.get("cache-control", "")


def test_other_root_files_keep_browser_default(tmp_path):
    res = _client(tmp_path).get("/favicon.png")
    assert res.status_code == 200
    assert "cache-control" not in res.headers
