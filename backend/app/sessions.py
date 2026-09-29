"""DB 기반 세션 토큰. WorkBench sessions.py 를 이식했다.

매 요청마다 계정이 여전히 active 인지 확인한다 — 관리자가 비활성화하면 이미 발급된
세션도 즉시 무효가 된다.
"""
import uuid
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from . import models


def create(db: Session, employee_id: str, *, hours: int) -> str:
    token = str(uuid.uuid4())
    now = datetime.now()
    db.add(models.UserSession(token=token, employee_id=employee_id,
                              created_at=now, expires_at=now + timedelta(hours=hours)))
    db.commit()
    return token


def resolve(db: Session, token: str) -> str | None:
    s = db.get(models.UserSession, token)
    if s is None:
        return None
    user = db.query(models.User).filter_by(employee_id=s.employee_id).first()
    if datetime.now() > s.expires_at or user is None or user.status != "active":
        db.delete(s)
        db.commit()
        return None
    return s.employee_id


def revoke(db: Session, token: str) -> None:
    s = db.get(models.UserSession, token)
    if s is not None:
        db.delete(s)
        db.commit()


def revoke_all(db: Session, employee_id: str) -> int:
    deleted = db.query(models.UserSession).filter_by(employee_id=employee_id).delete(
        synchronize_session=False
    )
    db.commit()
    return deleted
