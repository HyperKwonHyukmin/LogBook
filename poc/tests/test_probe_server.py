import importlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient


def _client(tmp_path, monkeypatch):
    monkeypatch.setenv("LOGBOOK_POC_DIR", str(tmp_path))
    import probe_server

    importlib.reload(probe_server)
    return TestClient(probe_server.app)


def test_index_page_has_upload_form_and_client_ip(tmp_path, monkeypatch):
    res = _client(tmp_path, monkeypatch).get("/")
    assert res.status_code == 200
    assert 'type="file"' in res.text
    assert "testclient" in res.text  # 접속 IP 표시


def test_index_page_shows_save_dir(tmp_path, monkeypatch):
    res = _client(tmp_path, monkeypatch).get("/")
    assert str(tmp_path) in res.text


def test_upload_reports_received_and_saved_sniff(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    res = client.post("/upload", files={"file": ("a.pptx", b"HHIDRMC" + b"\x00" * 10)})
    body = res.json()
    assert body["received_sniff"] == "drm"
    assert body["saved_sniff"] == "drm"
    assert body["save_dir"] == str(tmp_path)
    assert (tmp_path / "a.pptx").exists()


def test_upload_logs_each_result_as_utf8_jsonl(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    client.post("/upload", files={"file": ("보고서.pdf", b"%PDF-1.7\n")})
    log = (tmp_path / "upload_log.jsonl").read_text(encoding="utf-8")
    assert "보고서.pdf" in log and '"received_sniff": "pdf"' in log
    assert f'"save_dir": "{tmp_path}"'.replace("\\", "\\\\") in log or str(tmp_path) in log


def test_upload_rejects_path_traversal_names(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    client.post("/upload", files={"file": ("..\\..\\evil.txt", b"x")})
    assert (tmp_path / "evil.txt").exists()
    assert not (tmp_path.parent.parent / "evil.txt").exists()


def test_upload_rejects_forward_slash_path_traversal_names(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    client.post("/upload", files={"file": ("../../evil2.txt", b"x")})
    assert (tmp_path / "evil2.txt").exists()
    assert not (tmp_path.parent.parent / "evil2.txt").exists()
