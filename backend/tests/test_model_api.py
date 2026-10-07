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
    assert d["format_version"] == 2
    assert client.get(f"/api/files/{other.id}/model", headers=h).json() == {
        "state": None, "key": None, "format_version": None,
        "solve": {"state": None, "error_types": [], "stale": False}}   # 06 해석 검증 요약


def test_lbm_and_thumb(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    f = _converted(db, storage, make_entry_file)
    res = client.get(f"/api/files/{f.id}/model.lbm", headers=h)
    assert res.status_code == 200 and res.headers["content-encoding"] == "gzip"
    assert res.content[:4] == b"LBM1"  # httpx 가 gzip 을 풀어 준다(브라우저도 같다)
    s = db.get(models.ModelSummary, f.id)
    assert res.headers["etag"] == f'"{s.key}.v2"' and s.format_version == 2
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
    for path, tag in (("model.lbm", f'"{key}.v2"'), ("thumb.png", f'"{key}"')):
        res = client.get(f"/api/files/{f.id}/{path}", headers=h)
        assert res.headers["cache-control"] == "private, no-cache" and res.headers["etag"] == tag
        res = client.get(f"/api/files/{f.id}/{path}", headers=h | {"If-None-Match": tag})
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


def _as_v1(db, storage, f) -> bytes:
    """변환된 모델을 04c 이전(v1) 상태로 되돌린다 — format_version NULL + `{key}.lbm` 에 옛 파일."""
    s = db.get(models.ModelSummary, f.id)
    v1 = b"LBM1-old-v1"
    lbm_v1, _png = model_paths(storage, s.key, None)
    with open(lbm_v1, "wb") as fh:
        fh.write(gzip.compress(v1))
    os.remove(model_paths(storage, s.key)[0])
    s.format_version = None
    db.commit()
    return v1


def test_v1_served_until_reconverted_and_etag_differs(client, db, storage, make_user, auth_headers,
                                                      make_entry_file):
    """04c: 옛 형식(v1) 결과는 다시 변환될 때까지(대기·실패 중에도) 그대로 주고, 재변환 뒤에는 ETag 가 달라져
    v1 을 캐시한 브라우저가 304 로 옛 파일을 계속 쓰지 않는다."""
    from app.convert.job import enqueue_convert

    make_user("A100001")
    h = auth_headers("A100001")
    f = _converted(db, storage, make_entry_file)
    key = db.get(models.ModelSummary, f.id).key
    v1 = _as_v1(db, storage, f)
    assert client.get(f"/api/files/{f.id}/model", headers=h).json()["format_version"] == 1
    assert client.get(f"/api/files/{f.id}", headers=h).json()["format_version"] == 1
    res = client.get(f"/api/files/{f.id}/model.lbm", headers=h)
    etag_v1 = res.headers["etag"]
    assert etag_v1 == f'"{key}"' and res.content == v1

    enqueue_convert(db, f)            # 재변환 대기 중 — 여전히 v1
    db.commit()
    d = client.get(f"/api/files/{f.id}/model", headers=h).json()
    assert d["state"] == "queued" and d["format_version"] == 1 and d["has_lbm"] is True
    assert client.get(f"/api/files/{f.id}/model.lbm", headers=h | {"If-None-Match": etag_v1}).status_code == 304

    run_convert(db, storage, f)       # 재변환 — 같은 key, 다른 형식
    db.refresh(db.get(models.ModelSummary, f.id))
    res = client.get(f"/api/files/{f.id}/model.lbm", headers=h | {"If-None-Match": etag_v1})
    assert res.status_code == 200 and res.headers["etag"] == f'"{key}.v2"' != etag_v1
    assert res.content[:4] == b"LBM1" and res.content != v1
    assert os.path.exists(model_paths(storage, key, None)[0])   # 옛 v1 파일은 지우지 않는다
    assert client.get(f"/api/files/{f.id}", headers=h).json()["format_version"] == 2


def test_file_meta_format_version_null_without_model(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    _e, f = make_entry_file(name="r.pdf", kind="document")
    assert client.get(f"/api/files/{f.id}", headers=h).json()["format_version"] is None
