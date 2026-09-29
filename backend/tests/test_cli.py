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
