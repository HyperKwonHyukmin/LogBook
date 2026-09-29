# backend/tests/test_sessions.py
from datetime import datetime, timedelta

from app import models, sessions


def _user(db, employee_id="A123456", status="active"):
    db.add(models.User(employee_id=employee_id, name="사용자", status=status))
    db.commit()


def test_create_and_resolve(db):
    _user(db)
    token = sessions.create(db, "A123456", hours=8)
    assert len(token) == 36
    assert sessions.resolve(db, token) == "A123456"


def test_unknown_token_is_none(db):
    assert sessions.resolve(db, "00000000-0000-0000-0000-000000000000") is None


def test_expired_token_is_deleted(db):
    _user(db)
    token = sessions.create(db, "A123456", hours=8)
    s = db.get(models.UserSession, token)
    s.expires_at = datetime.now() - timedelta(minutes=1)
    db.commit()
    assert sessions.resolve(db, token) is None
    assert db.get(models.UserSession, token) is None


def test_session_of_disabled_user_is_rejected(db):
    _user(db)
    token = sessions.create(db, "A123456", hours=8)
    db.query(models.User).filter_by(employee_id="A123456").update({"status": "disabled"})
    db.commit()
    assert sessions.resolve(db, token) is None


def test_revoke_all(db):
    _user(db)
    sessions.create(db, "A123456", hours=8)
    sessions.create(db, "A123456", hours=8)
    assert sessions.revoke_all(db, "A123456") == 2
