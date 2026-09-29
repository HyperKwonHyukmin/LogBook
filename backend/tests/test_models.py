# backend/tests/test_models.py
import pytest
from sqlalchemy.exc import IntegrityError, OperationalError

from app import models


def test_user_defaults(db):
    u = models.User(employee_id="A123456", name="홍길동")
    db.add(u)
    db.commit()
    db.refresh(u)
    assert u.status == "pending"
    assert u.is_admin is False
    assert u.login_count == 0
    assert u.created_at is not None


def test_employee_id_is_unique(db):
    db.add(models.User(employee_id="A123456", name="가"))
    db.commit()
    db.add(models.User(employee_id="A123456", name="나"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_user_status_check_constraint_rejects_bogus_value(db):
    db.add(models.User(employee_id="A999999", name="테스트", status="bogus"))
    with pytest.raises((IntegrityError, OperationalError)):
        db.commit()


def test_audit_log_stores_korean_json(db):
    row = models.AuditLog(
        employee_id="A123456", action="USER_APPROVE", target_type="user", target_id="B654321",
        before={"status": "pending"}, after={"status": "active", "메모": "승인"},
    )
    db.add(row)
    db.commit()
    db.expire_all()
    got = db.query(models.AuditLog).one()
    assert got.after == {"status": "active", "메모": "승인"}
    assert got.at is not None
