"""Logbook ORM 모델.

User·UserSession 은 WorkBench models.py 에서 가져와 축소했다(company·is_developer 제거,
is_active 대신 status=pending/active/disabled). 감사 로그는 WorkBench activity_log 와 달리
변경 전·후(before/after)를 남기고 자동 삭제하지 않는다(설계 §8).
"""
from datetime import datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects import mysql

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


ENTRY_STATUSES = ("draft", "confirmed", "trashed")
FILE_KINDS = ("model", "result", "report", "drawing", "other")


class Hull(Base):
    """호선 속성. 선종은 호선에 딸린 값이다(설계 §4)."""

    __tablename__ = "hulls"

    hull_no = Column(String(8), primary_key=True)
    ship_type = Column(String(50), nullable=True)
    memo = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now)


class Entry(Base):
    """해석 건. 묶음 제안(초안)도 status='draft' 로 같은 테이블에 둔다."""

    __tablename__ = "entries"
    __table_args__ = (
        CheckConstraint("status IN ('draft','confirmed','trashed')", name="ck_entries_status"),
    )

    id = Column(Integer, primary_key=True)
    entry_id = Column(String(10), unique=True, nullable=True)  # E000123 — 행 생성 직후 채움
    title = Column(String(200), nullable=False, default="")
    analysis_type = Column(String(50), nullable=True)
    description = Column(Text, nullable=True)
    analysis_period = Column(String(7), nullable=True)  # YYYY-MM
    status = Column(String(10), nullable=False, default="draft")
    batch_id = Column(Integer, ForeignKey("batches.id"), nullable=True, index=True)
    merge_into_id = Column(Integer, ForeignKey("entries.id"), nullable=True)
    suggested_entry_id = Column(Integer, ForeignKey("entries.id"), nullable=True)
    hull_evidence = Column(JSON, nullable=True)
    uploaded_by = Column(String(20), nullable=True, index=True)
    confirmed_by = Column(String(20), nullable=True)
    confirmed_at = Column(DateTime, nullable=True)
    vault_rel = Column(String(40), nullable=True)   # "2026/E000123"
    trash_rel = Column(String(80), nullable=True)   # "E000123_20260929-101500"
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, default=_now)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)


class EntryHull(Base):
    __tablename__ = "entry_hulls"

    entry_id = Column(Integer, ForeignKey("entries.id", ondelete="CASCADE"), primary_key=True)
    hull_no = Column(String(8), primary_key=True)  # hulls 외래키 없음(초안의 추정 호선 허용)
    is_primary = Column(Boolean, nullable=False, default=False)


class Tag(Base):
    """자유 입력 태그(구역 등). alias_of 로 동의어를 묶는다(03 에서 화면 제공)."""

    __tablename__ = "tags"
    __table_args__ = (UniqueConstraint("kind", "value", name="uq_tags_kind_value"),)

    id = Column(Integer, primary_key=True)
    kind = Column(String(10), nullable=False)  # zone | free
    value = Column(String(100), nullable=False)
    alias_of_id = Column(Integer, ForeignKey("tags.id"), nullable=True)


class EntryTag(Base):
    __tablename__ = "entry_tags"

    entry_id = Column(Integer, ForeignKey("entries.id", ondelete="CASCADE"), primary_key=True)
    tag_id = Column(Integer, ForeignKey("tags.id"), primary_key=True)


class Batch(Base):
    """한 번에 올라온 묶음(Inbox 폴더 1개 또는 낱개 파일 묶음)."""

    __tablename__ = "batches"

    id = Column(Integer, primary_key=True)
    key = Column(String(24), unique=True, nullable=False)  # 20260929-083015-a1b2
    source = Column(String(10), nullable=False)            # inbox | web
    original_name = Column(String(255), nullable=False)
    state = Column(String(12), nullable=False, default="staged")  # uploading|staged|processed|failed|done
    owner_account = Column(String(64), nullable=True)
    uploader_guess = Column(String(20), nullable=True)
    uploader = Column(String(20), nullable=True, index=True)
    target_entry_id = Column(
        Integer, ForeignKey("entries.id", use_alter=True, name="fk_batches_target_entry"), nullable=True
    )
    excluded = Column(JSON, nullable=True)
    error = Column(Text, nullable=True)
    received_at = Column(DateTime, nullable=False, default=_now)
    processed_at = Column(DateTime, nullable=True)


class File(Base):
    __tablename__ = "files"

    id = Column(Integer, primary_key=True)
    batch_id = Column(Integer, ForeignKey("batches.id"), nullable=False, index=True)
    entry_id = Column(Integer, ForeignKey("entries.id"), nullable=True, index=True)
    rel_path = Column(String(1024), nullable=False)  # posix. staging: 배치 루트 기준 / vault: files\ 기준
    name = Column(String(255), nullable=False)
    ext = Column(String(32), nullable=False, default="")
    kind = Column(String(10), nullable=False)
    size = Column(BigInteger, nullable=False, default=0)
    sha256 = Column(String(64), nullable=False, index=True)
    duplicate_of_id = Column(Integer, ForeignKey("files.id"), nullable=True)
    drm_encrypted = Column(Boolean, nullable=False, default=False)
    location = Column(String(8), nullable=False, default="staging")  # staging|vault|trash
    created_at = Column(DateTime, nullable=False, default=_now)


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (Index("ix_jobs_state_run_after", "state", "run_after", "id"),)

    id = Column(Integer, primary_key=True)
    type = Column(String(30), nullable=False)
    target_id = Column(Integer, nullable=False)
    state = Column(String(10), nullable=False, default="queued")  # queued|running|done|failed
    attempts = Column(Integer, nullable=False, default=0)
    last_error = Column(Text, nullable=True)
    run_after = Column(DateTime, nullable=False, default=_now)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)


# 본문 조각 하나가 64KB(TEXT) 를 넘을 수 있어 MySQL 에서는 MEDIUMTEXT(16MB) 를 쓴다.
LONG_TEXT = Text().with_variant(mysql.MEDIUMTEXT(), "mysql")

EXTRACT_STATES = ("queued", "done", "failed", "skipped")


class FileExtract(Base):
    """파일 본문 추출 상태와 규칙 기반 요약 카드(설계 §5.2).

    files 표에 열을 더하지 않고 표를 따로 둔다 — 이 저장소는 마이그레이션 도구 없이
    create_all 로만 표를 만들어서, 기존 표에 더한 열은 운영 DB 에 생기지 않는다."""

    __tablename__ = "file_extracts"

    file_id = Column(Integer, ForeignKey("files.id", ondelete="CASCADE"), primary_key=True)
    state = Column(String(10), nullable=False, default="queued")
    error = Column(String(500), nullable=True)   # skipped 사유(drm·too_large·trashed) 또는 실패 메시지
    summary = Column(JSON, nullable=True)        # 요약 카드 — extract.base.finish_summary() 참고
    chars = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)


class FileText(Base):
    """쪽·슬라이드·시트 단위 본문. ngram 전문 색인으로 한글 부분 일치를 찾는다(설계 §4)."""

    __tablename__ = "file_texts"
    __table_args__ = (
        Index("ft_file_texts_text", "text", mysql_prefix="FULLTEXT", mysql_with_parser="ngram"),
    )

    id = Column(Integer, primary_key=True)
    file_id = Column(Integer, ForeignKey("files.id", ondelete="CASCADE"), nullable=False, index=True)
    seq = Column(Integer, nullable=False)
    locator = Column(String(120), nullable=False)  # page:3 | slide:5 | notes:5 | sheet:<이름> | body
    text = Column(LONG_TEXT, nullable=False)


class DownloadToken(Base):
    """짧게 사는 내려받기 링크. <iframe>·<a> 는 Authorization 헤더를 붙일 수 없어서
    API 가 토큰을 주소에 담은 링크를 만들어 준다. 세션 토큰을 주소에 싣지 않기 위한 것이다."""

    __tablename__ = "download_tokens"

    token = Column(String(36), primary_key=True)
    file_id = Column(Integer, nullable=False)
    employee_id = Column(String(20), nullable=False)
    expires_at = Column(DateTime, nullable=False, index=True)


MODEL_STATES = ("queued", "done", "failed", "skipped", "include")


class ModelSummary(Base):
    """BDF 변환 결과 요약(설계 §4 model_summaries). 파생물(lbm·png)은 key(바이트 sha256)로 20_Derived 에 있다."""

    __tablename__ = "model_summaries"

    file_id = Column(Integer, ForeignKey("files.id", ondelete="CASCADE"), primary_key=True)
    state = Column(String(10), nullable=False, default="queued")
    error = Column(String(500), nullable=True)
    key = Column(String(64), nullable=True)
    counts = Column(JSON, nullable=True)
    bbox = Column(JSON, nullable=True)
    sol = Column(String(20), nullable=True)
    fingerprint = Column(LONG_TEXT, nullable=True)
    warnings = Column(JSON, nullable=True)
    includes = Column(JSON, nullable=True)   # 이 파일이 INCLUDE 한 형제 rel_path
    missing = Column(JSON, nullable=True)    # 찾지 못한 INCLUDE 이름
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)


class SystemState(Base):
    """운영 상태(워커 심장 박동·마지막 백업·마지막 일일 작업). 재구축 대상이 아니다(다시 쌓인다)."""

    __tablename__ = "system_state"

    key = Column(String(40), primary_key=True)
    value = Column(JSON, nullable=True)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)
