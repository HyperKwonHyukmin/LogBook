"""DB 기반 세션 토큰. WorkBench sessions.py 를 이식했다.

매 요청마다 계정이 여전히 active 인지 확인한다 — 관리자가 비활성화하면 이미 발급된
세션도 즉시 무효가 된다.
"""
import uuid
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from . import models


def create(db: Session, employee_id: str, *, hours: int, wb_ref: str | None = None,
           expires_at: datetime | None = None) -> str:
    """세션 하나를 만든다. 18 — WorkBench 자동 로그인은 wb_ref(WorkBench 세션 연결 고리)를 남기고,
    만료를 WorkBench 세션 만료(expires_at)보다 늦지 않게 자른다(지금+hours 와 expires_at 중 이른 쪽)."""
    token = str(uuid.uuid4())
    now = datetime.now()
    expires = now + timedelta(hours=hours)
    if expires_at is not None and expires_at < expires:
        expires = expires_at
    db.add(models.UserSession(token=token, employee_id=employee_id, created_at=now, expires_at=expires,
                              wb_ref=wb_ref))
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


def revoke_wb_ref(db: Session, wb_ref: str) -> int:
    """18 — WorkBench 에서 로그아웃한 세션(wb_ref)으로 만든 LogBook 세션을 모두 지운다. 지운 수."""
    deleted = db.query(models.UserSession).filter_by(wb_ref=wb_ref).delete(synchronize_session=False)
    db.commit()
    return deleted


def revoke_all(db: Session, employee_id: str) -> int:
    deleted = db.query(models.UserSession).filter_by(employee_id=employee_id).delete(
        synchronize_session=False
    )
    db.commit()
    return deleted
