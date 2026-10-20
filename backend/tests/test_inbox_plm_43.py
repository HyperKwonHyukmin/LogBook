"""43 — 정리 대기(초안) 단계 PLM 자동 조회 · 빈 칸이 있어도 확정."""
from app import models, plm_ship
from app.entries import service
from app.ingest.process import process_batch


def _write(path, data=b"x"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def _plm_jobs(db):
    return db.query(models.Job).filter_by(type="plm_fill", state="queued").count()


def test_upload_registers_suggested_hull_and_enqueues_plm(db, storage, make_user, monkeypatch):
    """업로드 처리에서 제안한 호선은 확정을 기다리지 않고 호선 행 + PLM 조회 작업이 생긴다."""
    make_user("A100001")
    monkeypatch.setattr(plm_ship, "is_configured", lambda: True)
    b = models.Batch(key="20261020-000000-plm4", source="web", original_name="3370_선수부", uploader="A100001")
    db.add(b)
    db.commit()
    _write(storage.staging / b.key / "3370_선수부" / "model.bdf")
    process_batch(db, storage, b)
    draft = db.query(models.Entry).filter_by(batch_id=b.id).one()
    assert [h.hull_no for h in service.hulls_of(db, draft)] == ["3370"]
    hull = db.get(models.Hull, "3370")
    assert hull is not None and hull.plm_status is None
    assert _plm_jobs(db) == 1


def test_draft_hull_edit_enqueues_plm(db, storage, make_user, setup_entry_with_files, monkeypatch):
    """정리 대기에서 호선을 고르면 바로 호선 행 + PLM 조회 작업(확정 자료와 같은 규칙)."""
    u = make_user("A100001")
    monkeypatch.setattr(plm_ship, "is_configured", lambda: True)
    _b, e = setup_entry_with_files()
    service.update_entry(db, storage, e, u, {"version": e.version, "hulls": ["3371"]})
    assert db.get(models.Entry, e.id).status == "draft"
    assert db.get(models.Hull, "3371") is not None
    assert _plm_jobs(db) == 1
    # 초안에만 있는 호선은 호선 목록(확정 자료로만 센다)에 끼지 않는다
    from app.hull_info import list_hulls
    assert "3371" not in {r["hull_no"] for r in list_hulls(db, "", u)}


def test_register_hulls_without_plm_makes_rows_only(db):
    assert plm_ship.register_hulls(db, ["3372", "", None]) is None   # PLM 설정 없음 — 작업 없음
    assert db.get(models.Hull, "3372") is not None
    assert db.query(models.Job).filter_by(type="plm_fill").count() == 0
