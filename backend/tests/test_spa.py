from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


def _client(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>로그북</html>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("비밀", encoding="utf-8")
    return TestClient(create_app(frontend_dist=dist))


def test_root_serves_index(tmp_path):
    res = _client(tmp_path).get("/")
    assert res.status_code == 200
    assert "로그북" in res.text
    assert res.headers["content-type"].startswith("text/html")
    assert int(res.headers["content-length"]) == len("<html>로그북</html>".encode("utf-8"))


def test_client_side_route_falls_back_to_index(tmp_path):
    assert "로그북" in _client(tmp_path).get("/e/E000123").text


def test_asset_served_with_js_type(tmp_path):
    res = _client(tmp_path).get("/assets/app.js")
    assert res.text == "console.log(1)"
    assert "javascript" in res.headers["content-type"]


def test_unknown_api_path_is_json_404(tmp_path):
    res = _client(tmp_path).get("/api/nope")
    assert res.status_code == 404
    assert res.headers["content-type"].startswith("application/json")


def test_path_traversal_does_not_escape_dist(tmp_path):
    res = _client(tmp_path).get("/..%2Fsecret.txt")
    assert "비밀" not in res.text


def test_no_dist_means_no_spa_routes(tmp_path):
    client = TestClient(create_app(frontend_dist=tmp_path / "없음"))
    assert client.get("/").status_code == 404


def test_api_prefix_check_is_case_insensitive(tmp_path):
    res = _client(tmp_path).get("/API/nope")
    assert res.status_code == 404
    assert res.headers["content-type"].startswith("application/json")


def test_missing_asset_under_assets_is_404_not_index(tmp_path):
    res = _client(tmp_path).get("/assets/missing.js")
    assert res.status_code == 404
    assert "로그북" not in res.text


def test_missing_extension_path_is_404_not_index(tmp_path):
    res = _client(tmp_path).get("/robots.png")
    assert res.status_code == 404
    assert "로그북" not in res.text


def test_head_root_returns_200(tmp_path):
    res = _client(tmp_path).head("/")
    assert res.status_code == 200


def test_malicious_paths_never_touch_filesystem_outside_dist(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>로그북</html>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")

    touched = []
    orig_resolve = Path.resolve
    orig_is_file = Path.is_file

    def spy_resolve(self, *a, **kw):
        touched.append(str(self))
        return orig_resolve(self, *a, **kw)

    def spy_is_file(self, *a, **kw):
        touched.append(str(self))
        return orig_is_file(self, *a, **kw)

    monkeypatch.setattr(Path, "resolve", spy_resolve)
    monkeypatch.setattr(Path, "is_file", spy_is_file)

    client = TestClient(create_app(frontend_dist=dist))

    # 스파이가 실제로 걸리는지 먼저 정상 요청으로 확인한다(항상 비어 있으면 테스트가 무의미).
    touched.clear()
    res = client.get("/assets/app.js")
    assert res.status_code == 200
    assert touched, "몽키패치가 걸리지 않았다 — 정상 요청에서도 아무 경로도 기록되지 않음"

    for url in (
        "/%5C%5Cevil%5Cshare%5Ca.txt",   # \\evil\share\a.txt (UNC)
        "/C%3A/Windows/win.ini",          # C:/Windows/win.ini (드라이브 문자)
        "/%2e%2e%2fsecret.txt",           # ../secret.txt
        "/..%5Csecret.txt",               # ..\secret.txt
    ):
        touched.clear()
        res = client.get(url)
        assert res.status_code == 200
        assert "로그북" in res.text
        assert touched == [], f"{url!r} 처리 중 파일시스템을 건드림: {touched}"
