"""Logbook ORM 모델.

User·UserSession 은 WorkBench models.py 에서 가져와 축소했다(company·is_developer 제거,
is_active 대신 status=pending/active/disabled). 감사 로그는 WorkBench activity_log 와 달리
변경 전·후(before/after)를 남기고 자동 삭제하지 않는다(설계 §8).
"""
from datetime import datetime

from sqlalchemy import JSON, Boolean, CheckConstraint, Column, DateTime, Integer, String

from .database import Base

USER_STATUSES = ("pending", "active", "disabled")


def _now() -> datetime:
    """DateTime 컬럼 기본값 — 마이크로초를 잘라 감사 로그(JSONL)·표시와 자리수를 맞춘다."""
    return datetime.now().replace(microsecond=0)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("status IN ('pending','active','disabled')", name="ck_users_status"),
    )

    id = Column(Integer, primary_key=True)
    employee_id = Column(String(20), unique=True, nullable=False, index=True)
    name = Column(String(50), nullable=False)
    department = Column(String(100), nullable=True)
    position = Column(String(50), nullable=True)
    status = Column(String(10), nullable=False, default="pending")
    is_admin = Column(Boolean, nullable=False, default=False)
    login_count = Column(Integer, nullable=False, default=0)
    last_login = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now)


class UserSession(Base):
    __tablename__ = "user_sessions"

    token = Column(String(36), primary_key=True)
    employee_id = Column(String(20), nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, default=_now)
    expires_at = Column(DateTime, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True)
    at = Column(DateTime, nullable=False, default=_now, index=True)
    employee_id = Column(String(20), nullable=True, index=True)
    action = Column(String(40), nullable=False, index=True)
    target_type = Column(String(20), nullable=False)
    target_id = Column(String(40), nullable=False)
    before = Column(JSON, nullable=True)
    after = Column(JSON, nullable=True)
    ip = Column(String(45), nullable=True)
