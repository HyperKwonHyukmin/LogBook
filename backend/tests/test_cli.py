import pytest

from app import cli, models


def test_create_admin_new_user(db, storage):
    cli.create_admin(db, storage, "a476854", "권혁민", "구조시스템연구실")
    db.expire_all()
    u = db.query(models.User).filter_by(employee_id="A476854").one()
    assert (u.status, u.is_admin) == ("active", True)
    assert db.query(models.AuditLog).filter_by(action="ADMIN_BOOTSTRAP").count() == 1


def test_create_admin_promotes_existing_pending_user(db, storage, make_user):
    make_user("A476854", status="pending")
    cli.create_admin(db, storage, "A476854", "권혁민", None)
    db.expire_all()
    u = db.query(models.User).filter_by(employee_id="A476854").one()
    assert (u.status, u.is_admin) == ("active", True)


def test_create_admin_rejects_bad_format(db, storage):
    with pytest.raises(ValueError):
        cli.create_admin(db, storage, "12345", "이름", None)


def test_main_exits_2_on_bad_employee_id(capsys):
    code = cli.main(["create-admin", "12345", "이름"])
    assert code == 2
    assert "12345" in capsys.readouterr().err


def test_enqueue_extract_all(db, make_entry_file):
    from app import models
    from app.cli import enqueue_extract_all

    _e, a = make_entry_file(name="a.pdf")
    _e2, b = make_entry_file(name="b.pdf")
    make_entry_file(name="m.bdf", kind="model")
    db.add(models.FileExtract(file_id=b.id, state="done"))
    db.commit()
    assert enqueue_extract_all(db) == 1
    assert enqueue_extract_all(db, force=True) == 2


def test_enqueue_extract_all_retargets_restored_and_failed(db, make_entry_file):
    from app import models
    from app.cli import enqueue_extract_all

    _e, restored = make_entry_file(name="restored.pdf")          # 복원됨(vault) — 예전엔 trashed 로 건너뜀
    _e2, drm = make_entry_file(name="drm.pdf")                   # DRM 건너뜀은 다시 하지 않는다
    _e3, failed = make_entry_file(name="failed.pdf")             # 실패는 다시
    _e4, trashed = make_entry_file(status="trashed", name="t.pdf")  # 아직 휴지통 — 대상 아님
    db.add_all([models.FileExtract(file_id=restored.id, state="skipped", error="trashed"),
                models.FileExtract(file_id=drm.id, state="skipped", error="drm"),
                models.FileExtract(file_id=failed.id, state="failed", error="x"),
                models.FileExtract(file_id=trashed.id, state="skipped", error="trashed")])
    db.commit()
    assert enqueue_extract_all(db) == 2
    targets = sorted(j.target_id for j in db.query(models.Job).filter_by(type="extract_file"))
    assert targets == sorted([restored.id, failed.id])
    db.query(models.Job).delete()
    db.commit()
    assert enqueue_extract_all(db, force=True) == 3  # 휴지통 밖 추출 가능 파일 전부
