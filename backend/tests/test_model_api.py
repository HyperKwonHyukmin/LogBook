import gzip
import os

from app import models
from app.convert.job import model_paths, run_convert
from app.entries.locate import file_path

MESH = "GRID,1,,0.,0.,0.\nGRID,2,,1000.,0.,0.\nGRID,3,,1000.,1000.,0.\nCQUAD4,1,5,1,2,3,3\nPSHELL,5,1,8.\n"


def _converted(db, storage, make_entry_file):
    _e, f = make_entry_file(name="m.bdf", kind="model")
    p = file_path(db, storage, f)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as fh:
        fh.write(MESH)
    run_convert(db, storage, f)
    return f


def test_model_summary(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    f = _converted(db, storage, make_entry_file)
    d = client.get(f"/api/files/{f.id}/model", headers=h).json()
    assert d["state"] == "done" and d["has_lbm"] is True and d["counts"]["CQUAD4"] == 1
    assert "PSHELL t8" in d["fingerprint"]
    _e, other = make_entry_file(name="x.bdf", kind="model")
    assert client.get(f"/api/files/{other.id}/model", headers=h).json() == {"state": None, "key": None}


def test_lbm_and_thumb(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    f = _converted(db, storage, make_entry_file)
    res = client.get(f"/api/files/{f.id}/model.lbm", headers=h)
    assert res.status_code == 200 and res.headers["content-encoding"] == "gzip"
    assert res.content[:4] == b"LBM1"  # httpx 가 gzip 을 풀어 준다(브라우저도 같다)
    s = db.get(models.ModelSummary, f.id)
    assert res.headers["etag"] == f'"{s.key}"'
    png = client.get(f"/api/files/{f.id}/thumb.png", headers=h)
    assert png.headers["content-type"] == "image/png" and png.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert client.get(f"/api/files/{f.id}/model.lbm").status_code == 401


def test_not_ready_and_missing(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    _e, f = make_entry_file(name="q.bdf", kind="model")
    db.add(models.ModelSummary(file_id=f.id, state="queued"))
    db.commit()
    assert client.get(f"/api/files/{f.id}/model.lbm", headers=h).json()["detail"] == "model_not_ready"
    g = _converted(db, storage, make_entry_file)
    lbm, _png = model_paths(storage, db.get(models.ModelSummary, g.id).key)
    os.remove(lbm)
    assert client.get(f"/api/files/{g.id}/model.lbm", headers=h).json()["detail"] == "model_missing"
    assert client.get(f"/api/files/{g.id}/model", headers=h).json()["has_lbm"] is False


def test_etag_304_and_no_cache(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    f = _converted(db, storage, make_entry_file)
    key = db.get(models.ModelSummary, f.id).key
    for path in ("model.lbm", "thumb.png"):
        res = client.get(f"/api/files/{f.id}/{path}", headers=h)
        assert res.headers["cache-control"] == "private, no-cache" and res.headers["etag"] == f'"{key}"'
        res = client.get(f"/api/files/{f.id}/{path}", headers=h | {"If-None-Match": f'"{key}"'})
        assert res.status_code == 304 and res.content == b""
        res = client.get(f"/api/files/{f.id}/{path}", headers=h | {"If-None-Match": '"other"'})
        assert res.status_code == 200


def test_previous_result_served_while_requeued_or_failed(client, db, storage, make_user, auth_headers,
                                                         make_entry_file):
    from app.convert.job import enqueue_convert, mark_failed

    make_user("A100001")
    h = auth_headers("A100001")
    f = _converted(db, storage, make_entry_file)
    enqueue_convert(db, f)
    db.commit()
    assert client.get(f"/api/files/{f.id}/model", headers=h).json()["has_lbm"] is True
    assert client.get(f"/api/files/{f.id}/model.lbm", headers=h).status_code == 200
    mark_failed(db, f.id, "boom")
    d = client.get(f"/api/files/{f.id}/model", headers=h).json()
    assert d["state"] == "failed" and d["has_lbm"] is True
    assert client.get(f"/api/files/{f.id}/thumb.png", headers=h).status_code == 200
    # 이전 파생물이 지워졌으면 queued/failed 는 준비 안 됨
    lbm, _png = model_paths(storage, db.get(models.ModelSummary, f.id).key)
    os.remove(lbm)
    assert client.get(f"/api/files/{f.id}/model.lbm", headers=h).json()["detail"] == "model_not_ready"


def test_first_conversion_failure_404(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    _e, f = make_entry_file(name="bad.bdf", kind="model")
    db.add(models.ModelSummary(file_id=f.id, state="failed", error="x"))
    db.commit()
    assert client.get(f"/api/files/{f.id}/model.lbm", headers=h).status_code == 404
    assert client.get(f"/api/files/{f.id}/model", headers=h).json()["has_lbm"] is False


def test_model_summary_reports_key(client, db, storage, make_user, auth_headers, make_entry_file):
    from app.convert.job import enqueue_convert

    make_user("A100001")
    h = auth_headers("A100001")
    f = _converted(db, storage, make_entry_file)
    key = db.get(models.ModelSummary, f.id).key
    assert client.get(f"/api/files/{f.id}/model", headers=h).json()["key"] == key
    enqueue_convert(db, f)
    db.commit()
    d = client.get(f"/api/files/{f.id}/model", headers=h).json()
    assert (d["state"], d["key"]) == ("queued", key)


def test_file_meta_drm_flag(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    _e, f = make_entry_file(name="m.bdf", kind="model")
    f.drm_encrypted = True
    db.commit()
    assert client.get(f"/api/files/{f.id}", headers=h).json()["drm_encrypted"] is True
