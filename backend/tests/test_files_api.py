import io
import os
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse

from app import models
from app.entries.locate import file_path


def _write(db, storage, f, data: bytes):
    p = file_path(db, storage, f)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as fh:
        fh.write(data)


def _xlsx() -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    wb.active.title = "응력"
    wb.active.append(["부재", 1.5])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_link_and_download(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    _e, f = make_entry_file(name="보고서 최종.pdf")
    _write(db, storage, f, b"%PDF-1.7 hello")
    res = client.post(f"/api/files/{f.id}/link", headers=auth_headers("A100001"))
    assert res.status_code == 200
    url = res.json()["url"]
    got = client.get(url)  # Authorization 없이
    assert got.status_code == 200 and got.content == b"%PDF-1.7 hello"
    assert got.headers["content-length"] == "14"
    assert got.headers["content-type"] == "application/octet-stream"
    assert "attachment" in got.headers["content-disposition"]
    assert "filename*=UTF-8''%EB%B3%B4%EA%B3%A0%EC%84%9C%20%EC%B5%9C%EC%A2%85.pdf" in got.headers["content-disposition"]


def test_inline_pdf_only(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    _e, pdf = make_entry_file(name="r.pdf")
    _write(db, storage, pdf, b"%PDF")
    url = client.post(f"/api/files/{pdf.id}/link?inline=true", headers=h).json()["url"]
    got = client.get(url)
    assert got.headers["content-type"] == "application/pdf" and got.headers["content-disposition"].startswith("inline")
    _e2, html = make_entry_file(name="x.html", kind="other")
    _write(db, storage, html, b"<script>")
    url = client.post(f"/api/files/{html.id}/link?inline=true", headers=h).json()["url"]
    got = client.get(url)
    assert got.headers["content-disposition"].startswith("attachment")


def test_link_rejections(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    _e, f = make_entry_file(name="r.pdf")
    _e2, g = make_entry_file(name="s.pdf")
    _write(db, storage, f, b"x")
    token = parse_qs(urlparse(client.post(f"/api/files/{f.id}/link", headers=h).json()["url"]).query)["t"][0]
    assert client.get(f"/api/files/{g.id}/content?t={token}").status_code == 403
    assert client.get(f"/api/files/{f.id}/content?t=nope").status_code == 403
    db.get(models.DownloadToken, token).expires_at = datetime.now() - timedelta(seconds=1)
    db.commit()
    assert client.get(f"/api/files/{f.id}/content?t={token}").status_code == 403
    assert client.post(f"/api/files/{f.id}/link").status_code == 401
    assert client.post("/api/files/999999/link", headers=h).status_code == 404
    _e3, t = make_entry_file(status="trashed", name="t.pdf")
    assert client.post(f"/api/files/{t.id}/link", headers=h).status_code == 404


def test_expired_tokens_cleaned(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    _e, f = make_entry_file(name="r.pdf")
    db.add(models.DownloadToken(token="old", file_id=f.id, employee_id="A100001",
                                expires_at=datetime.now() - timedelta(minutes=1)))
    db.commit()
    client.post(f"/api/files/{f.id}/link", headers=auth_headers("A100001"))
    db.expire_all()
    assert db.get(models.DownloadToken, "old") is None


def test_missing_file_404(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    _e, f = make_entry_file(name="r.pdf")
    url = client.post(f"/api/files/{f.id}/link", headers=auth_headers("A100001")).json()["url"]
    assert client.get(url).status_code == 404


def test_drm_file_streams_without_length(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    _e, f = make_entry_file(name="r.pdf")
    f.drm_encrypted = True
    db.commit()
    _write(db, storage, f, b"HHIDRMC....")
    got = client.get(client.post(f"/api/files/{f.id}/link", headers=auth_headers("A100001")).json()["url"])
    assert got.status_code == 200 and got.content == b"HHIDRMC...."
    assert "content-length" not in got.headers


def test_text_endpoint(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    _e, f = make_entry_file(name="r.pptx")
    assert client.get(f"/api/files/{f.id}/text", headers=h).json()["state"] is None
    db.add(models.FileExtract(file_id=f.id, state="done", summary={"unit": "slide", "count": 1}))
    db.add(models.FileText(file_id=f.id, seq=0, locator="slide:1", text="가" * 30000))
    db.commit()
    d = client.get(f"/api/files/{f.id}/text", headers=h).json()
    assert d["state"] == "done" and d["summary"]["unit"] == "slide"
    assert d["chunks"][0]["locator"] == "slide:1" and len(d["chunks"][0]["text"]) == 20000


def test_sheet_endpoint(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    _e, f = make_entry_file(name="s.xlsx")
    _write(db, storage, f, _xlsx())
    d = client.get(f"/api/files/{f.id}/sheet", headers=h).json()
    assert d["sheets"] == ["응력"] and d["rows"] == [["부재", "1.5"]]
    _e2, p = make_entry_file(name="r.pdf")
    assert client.get(f"/api/files/{p.id}/sheet", headers=h).json()["detail"] == "not_sheet"
    _e3, bad = make_entry_file(name="b.xlsx")
    _write(db, storage, bad, b"garbage")
    assert client.get(f"/api/files/{bad.id}/sheet", headers=h).json()["detail"] == "unreadable"
    _e4, gone = make_entry_file(name="g.xlsx")
    assert client.get(f"/api/files/{gone.id}/sheet", headers=h).status_code == 404


def test_content_releases_db_before_streaming(client, db, storage, make_user, auth_headers, make_entry_file,
                                              monkeypatch):
    """원본을 흘려보내는 동안 DB 연결을 붙잡지 않는다 — 응답 객체를 만들 때 세션이 이미 닫혀 있어야 한다."""
    from app.database import SessionLocal, get_db
    from app.routers import files as files_router

    make_user("A100001")
    _e, f = make_entry_file(name="r.pdf")
    _write(db, storage, f, b"%PDF-1.7 hello")
    url = client.post(f"/api/files/{f.id}/link", headers=auth_headers("A100001")).json()["url"]

    sessions = []

    def tracked_db():
        s = SessionLocal()
        sessions.append(s)
        try:
            yield s
        finally:
            s.close()

    seen = {}
    real = files_router.StreamingResponse

    class Probe(real):
        def __init__(self, *a, **kw):
            seen["in_tx"] = sessions[-1].in_transaction()
            super().__init__(*a, **kw)

    monkeypatch.setattr(files_router, "StreamingResponse", Probe)
    client.app.dependency_overrides[get_db] = tracked_db
    got = client.get(url)
    assert got.status_code == 200 and got.content == b"%PDF-1.7 hello"
    assert seen["in_tx"] is False


def test_bad_rel_path_is_404(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    _e, f = make_entry_file(name="../../s.xlsx")
    assert client.get(f"/api/files/{f.id}/sheet", headers=auth_headers("A100001")).status_code == 404
