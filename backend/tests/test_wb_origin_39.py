"""39 — WorkBench 해석 출처(Hi-TESS Core 1단계). 합성 데이터만(가상 호선 9999)."""
import dataclasses
import json
from datetime import datetime

import pytest

from app import models, wb_origin
from app.entries import service
from app.routers import integration

SECRET = "test-integration-secret-39"
H = {"X-HiTESS-Integration": SECRET}
ADMIN = "A390001"
SHA = "b" * 64


@pytest.fixture
def secret(monkeypatch):
    monkeypatch.setattr(integration, "settings", dataclasses.replace(integration.settings, wb_integration_secret=SECRET))


@pytest.fixture
def show(monkeypatch):
    """LOGBOOK_WB_ORIGIN_SHOW 켜기 — 자료 화면(entry_to_dict)·검색이 같은 settings 객체를 본다."""
    from app import config
    on = dataclasses.replace(config.settings, wb_origin_show=True)
    monkeypatch.setattr(config, "settings", on)
    import app.search.mysql_backend as mb
    monkeypatch.setattr(mb, "settings", on)


ORIGIN = {"analysis_id": 123, "owner": "b390001", "program": "GroupModuleUnit", "project": "9999 크레인",
          "created_at": "2026-10-19T09:00:00", "note": "검토용", "path": r"C:\\userConnection\\x",
          "passport": {"artifacts": [{"role": "input", "name": "model.bdf", "sha256": SHA.upper(), "size": 4},
                                     {"role": "result", "name": "bad", "sha256": "xyz"}]}}


def test_clean_keeps_known_fields_only():
    c = wb_origin.clean(ORIGIN)
    assert c["analysis_id"] == 123 and c["owner"] == "B390001" and "path" not in c
    assert c["passport"] == {"artifacts": [{"role": "input", "name": "model.bdf", "sha256": SHA, "size": 4}]}
    assert wb_origin.clean({"owner": "x"}) is None and wb_origin.clean({"analysis_id": "0"}) is None
    assert [wb_origin.parse_term(q) for q in ("WB #123", "wb#123", " wb 123 ", "WB #12a", "E000123")] == \
        [123, 123, 123, None, None]


def test_upload_stamps_batch_origin(secret, client, db, make_user):
    make_user(ADMIN, level=2, wb_admin=True)
    r = client.post(f"/api/integration/uploads?as={ADMIN}", headers=H, json={"name": "WB #123 · GMU", "origin": ORIGIN})
    assert r.status_code == 201, r.text
    b = db.query(models.Batch).filter_by(key=r.json()["key"]).one()
    assert b.wb_analysis_id == 123 and b.origin["program"] == "GroupModuleUnit"
    # 감사 기록도 그대로 남는다(지금 동작 유지)
    assert db.query(models.AuditLog).filter_by(action="WB_UPLOAD").count() == 1


def test_upload_without_origin_still_works(secret, client, db, make_user):
    make_user(ADMIN, level=2, wb_admin=True)
    r = client.post(f"/api/integration/uploads?as={ADMIN}", headers=H, json={"name": "그냥"})
    assert r.status_code == 201
    assert db.query(models.Batch).filter_by(key=r.json()["key"]).one().origin is None


def _confirmed_with_origin(db, storage, make_user, setup_entry_with_files, origin=ORIGIN):
    u = make_user("A100001")
    b, e = setup_entry_with_files()
    wb_origin.stamp(b, origin)
    f = db.query(models.File).filter_by(entry_id=e.id, name="a.bdf").one()
    f.sha256 = SHA
    db.commit()
    service.confirm(db, storage, e, u)
    db.expire_all()
    return u, db.get(models.Entry, e.id), f.id


def test_entry_shows_origin_only_when_key_on(db, storage, make_user, setup_entry_with_files, monkeypatch):
    u, e, fid = _confirmed_with_origin(db, storage, make_user, setup_entry_with_files)
    assert "wb_origins" not in service.entry_to_dict(db, e, viewer=u)   # 기본 꺼짐 — 지금 응답과 같다
    from app import config
    monkeypatch.setattr(config, "settings", dataclasses.replace(config.settings, wb_origin_show=True))
    o = service.entry_to_dict(db, e, viewer=u)["wb_origins"]
    assert len(o) == 1 and o[0]["label"] == "WB #123" and o[0]["owner"] == "B390001"
    assert o[0]["matched"] == [{"file_id": fid, "role": "input", "name": "model.bdf"}]


def test_entry_json_keeps_origins_and_rebuild_restores(db, storage, make_user, setup_entry_with_files):
    _u, e, _fid = _confirmed_with_origin(db, storage, make_user, setup_entry_with_files)
    base = storage.vault / str(datetime.now().year) / e.entry_id
    meta = json.loads((base / "entry.json").read_text(encoding="utf-8"))
    assert meta["origins"][0]["analysis_id"] == 123
    assert sorted(meta["origins"][0]["files"]) == ["3496_검토/model/a.bdf", "3496_검토/r.pdf"]
    # 재구축: 같은 entry.json 으로 새 Entry·파일을 만들면 출처 묶음이 되살아난다
    from app import wb_origin as w
    b = models.Batch(key="rb-test", source="rebuild", original_name="재구축", state="done")
    db.add(b)
    db.flush()
    e2 = models.Entry(title="x", status="confirmed", batch_id=b.id)
    db.add(e2)
    db.flush()
    files = [models.File(batch_id=b.id, entry_id=e2.id, rel_path=r, name=r.split("/")[-1], ext="", kind="model",
                         size=1, sha256="a" * 64, location="vault") for r in meta["origins"][0]["files"]]
    db.add_all(files)
    db.flush()
    assert w.restore(db, e2, files, meta["origins"]) == 1
    assert {db.get(models.Batch, f.batch_id).wb_analysis_id for f in files} == {123}


def test_search_wb_term(show, client, db, storage, make_user, auth_headers, setup_entry_with_files):
    _u, e, _fid = _confirmed_with_origin(db, storage, make_user, setup_entry_with_files)
    h = auth_headers("A100001")
    for q in ("WB #123", "wb123"):
        res = client.get("/api/search", params={"q": q}, headers=h).json()
        assert [r["entry_id"] for r in res["items"]] == [e.entry_id], q
    assert client.get("/api/search", params={"q": "WB #999"}, headers=h).json()["items"] == []
