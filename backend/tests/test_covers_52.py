"""52 — 검색 결과 대표 그림 대체: BDF 썸네일이 없으면 PDF 첫 쪽 → PPTX 썸네일 → 이미지."""
import io
import zipfile

import fitz
from PIL import Image

from app import covers, models


def _pdf_bytes():
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 72), "Report")
    data = doc.tobytes()
    doc.close()
    return data


def _png_bytes(size=(800, 600), color=(200, 30, 30)):
    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, format="PNG")
    return out.getvalue()


def _pptx_bytes(with_thumb=True):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        if with_thumb:
            jpg = io.BytesIO()
            Image.new("RGB", (256, 192), (10, 120, 200)).save(jpg, format="JPEG")
            z.writestr("docProps/thumbnail.jpeg", jpg.getvalue())
    return out.getvalue()


def _staged(db, storage, files):
    """초안 + 배치 + 임시 폴더 파일. files = [(rel, bytes)] → (entry, {name: File})."""
    b = models.Batch(key="20261105-000000-cccc", source="web", original_name="x", uploader="A100001")
    db.add(b)
    db.flush()
    e = models.Entry(title="t", status="draft", batch_id=b.id, uploaded_by="A100001")
    db.add(e)
    db.flush()
    e.entry_id = f"E{e.id:06d}"
    rows = {}
    for i, (rel, data) in enumerate(files):
        p = storage.staging / b.key / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        name = rel.rsplit("/", 1)[-1]
        f = models.File(batch_id=b.id, entry_id=e.id, rel_path=rel, name=name, ext="." + name.rsplit(".", 1)[-1].lower(),
                        kind="report", size=len(data), sha256=f"{i:064d}", location="staging")
        db.add(f)
        rows[name] = f
    db.commit()
    return e, rows


def test_pick_order_pdf_then_pptx_then_image(db, storage):
    e, rows = _staged(db, storage, [("p/a.png", _png_bytes()), ("p/deck.pptx", _pptx_bytes()), ("p/보고서.pdf", _pdf_bytes())])
    assert covers.cover_files(db, [e.id])[e.id]["file_id"] == rows["보고서.pdf"].id


def test_render_each_kind_and_cache(db, storage):
    e, rows = _staged(db, storage, [("p/r.pdf", _pdf_bytes()), ("p/d.pptx", _pptx_bytes()), ("p/i.png", _png_bytes())])
    for name in ("r.pdf", "d.pptx", "i.png"):
        data, key = covers.cover_png(db, storage, rows[name])
        img = Image.open(io.BytesIO(data))
        assert img.format == "PNG" and img.width <= covers.WIDTH and img.height <= covers.HEIGHT
        assert (storage.derived / "covers" / f"{rows[name].id}_{key}.png").is_file()


def test_pptx_without_thumbnail_has_no_cover(db, storage):
    _e, rows = _staged(db, storage, [("p/d.pptx", _pptx_bytes(with_thumb=False))])
    try:
        covers.cover_png(db, storage, rows["d.pptx"])
        raise AssertionError("expected NoCover")
    except covers.NoCover:
        pass


def test_api_cover_and_etag(client, db, storage, make_user, auth_headers):
    make_user("A100001")
    _e, rows = _staged(db, storage, [("p/r.pdf", _pdf_bytes())])
    h = auth_headers("A100001")
    r = client.get(f"/api/files/{rows['r.pdf'].id}/cover.png", headers=h)
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    r2 = client.get(f"/api/files/{rows['r.pdf'].id}/cover.png", headers={**h, "If-None-Match": r.headers["etag"]})
    assert r2.status_code == 304


def test_drm_file_is_skipped(db, storage):
    e, rows = _staged(db, storage, [("p/r.pdf", _pdf_bytes())])
    rows["r.pdf"].drm_encrypted = True
    db.commit()
    assert covers.cover_files(db, [e.id]) == {}
