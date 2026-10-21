"""Hi-TESS LogBook ORM 모델.

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
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy import text as sa_text
from sqlalchemy.dialects import mysql

from .database import Base

USER_STATUSES = ("pending", "active", "disabled")
# 13 — 사용자 등급(낮은 순). 15 부터 쓰지 않는다(level 로 대체) — 재구축·이전이 옛 값을 읽을 때만
USER_ROLES = ("guest", "member", "viewer_all", "admin", "master")
# 15 — LogBook 등급 LV1(게스트)·LV2(일반)·LV3(관리자). 판단은 access.py 한 곳
USER_LEVELS = (1, 2, 3)
# 15 — 자료 공개 단계: 공유(LV1 이상) · 일반(LV2 이상, 기본) · 블록(LV3 만). 옛 13 값(public/private)은 이전 대상
ENTRY_ACCESS = ("shared", "normal", "blocked")
LEGACY_ENTRY_ACCESS = ("public", "private")
PRIVATE_MIN_ROLES = ("viewer_all", "admin")


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
    is_admin = Column(Boolean, nullable=False, default=False)   # 호환용 — 실효 LV3 이면 True(아래 _sync_level)
    # 13 — 등급(guest|member|viewer_all|admin|master). 15 부터 쓰지 않는다(이전 원천으로만 남긴다)
    role = Column(String(12), nullable=False, server_default=sa_text("'member'"))
    # 15 — LogBook 등급(1·2·3, 저장값). 실효 등급은 access.level_of = WorkBench 관리자면 3, 아니면 이 값.
    # 기존 DB 에는 database.ensure_columns 가 NULL 로 더하고 migrate_levels 가 role·is_admin·status 로 채운다
    level = Column(Integer, nullable=True, default=1)
    # 15 — WorkBench users.is_admin 의 캐시(로그인·매 요청 확인 때 맞춘다). 참이면 실효 LV3
    wb_admin = Column(Boolean, nullable=False, default=False, server_default=sa_text("0"))
    login_count = Column(Integer, nullable=False, default=0)
    last_login = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now)


class UserSession(Base):
    __tablename__ = "user_sessions"

    token = Column(String(36), primary_key=True)
    employee_id = Column(String(20), nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, default=_now)
    expires_at = Column(DateTime, nullable=False)
    # 18 — WorkBench 자동 로그인(/sso)으로 만든 세션의 연결 고리 = sha256(WorkBench 토큰) hex.
    # WorkBench 에서 로그아웃하면 이 값으로 LogBook 세션을 함께 지운다(/api/integration/logout). 사번 로그인은 NULL
    wb_ref = Column(String(64), nullable=True, index=True)


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
    # 30 — 사내 PLM(VT_PLM_SHIP)에서 읽은 선박 정보. 선종(ship_type)은 사람이 고칠 수 있는 값이라 따로 두고,
    # 여기는 PLM 원문과 그 분해 값이다(관계 지도 등에서 선종·용량·선급·주기관으로 묶을 재료).
    plm_status = Column(String(12), nullable=True)        # found | not_found | None(아직 조회 안 함)
    plm_checked_at = Column(DateTime, nullable=True)
    plm_ship_type = Column(String(60), nullable=True)     # SHIP_TYPE_NAME 원문 '174K-LNG'
    ship_capacity = Column(String(20), nullable=True)     # '174K' · '4500'(단위 없음)
    ship_kind = Column(String(40), nullable=True)         # 'LNG' · 'B/C'
    ship_variant = Column(String(60), nullable=True)      # 괄호 부가정보 'DF' · 'MOSS'
    main_engine = Column(String(100), nullable=True)
    ship_class = Column(String(20), nullable=True)        # SHIP_CLASS1
    delivery_date = Column(String(10), nullable=True)     # 'YYYY-MM-DD'
    delivered = Column(Boolean, nullable=True)
    # 45 — 시리즈(같은 설계로 여러 척). PLM SHIP_PRE = 시리즈 첫 호선(첫 호선은 자기 번호). 묶음 키는 series_lead or hull_no.
    # series_manual = 사람이 고친 값 — PLM 일괄 채우기가 덮지 않는다([선박 정보 검색] 단추는 PLM 값으로 되돌린다).
    series_lead = Column(String(8), nullable=True, index=True)
    series_seq = Column(String(10), nullable=True)
    series_manual = Column(Boolean, nullable=True)


class Entry(Base):
    """해석 건. 묶음 제안(초안)도 status='draft' 로 같은 테이블에 둔다."""

    __tablename__ = "entries"
    __table_args__ = (
        CheckConstraint("status IN ('draft','confirmed','trashed')", name="ck_entries_status"),
    )

    id = Column(Integer, primary_key=True)
    entry_id = Column(String(10), unique=True, nullable=True)  # E000123 — 행 생성 직후 채움
    title = Column(String(200), nullable=False, default="")
    analysis_type = Column(String(50), nullable=True)   # 42 — 해석 종류는 없앴다(열만 남고 읽지 않는다)
    description = Column(Text, nullable=True)
    analysis_period = Column(String(7), nullable=True)  # YYYY-MM — 15 부터 쓰지 않는다(값 보존용으로 열만 남김)
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
    # 15 — 공개 단계 shared|normal|blocked(access.py). 13 의 public/private 는 database.migrate_access 가 옮긴다.
    # 기존 DB 의 열 기본값('public')은 그대로 두고 앱이 늘 값을 넣는다(옛 값도 '일반'으로 다룬다)
    access = Column(String(10), nullable=False, default="normal", server_default=sa_text("'normal'"))
    # 13 — 15 부터 쓰지 않는다(이전 원천으로만 남긴다)
    private_min_role = Column(String(12), nullable=False, default="viewer_all",
                              server_default=sa_text("'viewer_all'"))
    # 20 — '호선 없음(공용)' 을 명시로 고른 자료. 참이면 BDF 자료도 호선 없이 확정할 수 있다(호선 칸 = '공용')
    no_hull = Column(Boolean, nullable=False, default=False, server_default=sa_text("0"))
    # 20 — 제목 초안의 원천(올라온 폴더 이름 또는 확장자 뗀 파일 이름). 20 이전 자료는 NULL — 파일 경로로 추정한다
    title_source = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)


class EntryGrant(Base):
    """Entry 개별 열람 허락(13, 15 규칙) — 올린 사람 또는 LV3 가 WorkBench 활성 사용자에게 준다(블록 자료는 LV3 만).
    공개 단계와 무관하게 그 사람은 이 Entry 를 본다(LV1 이 일반 자료, LV2 가 블록 자료를 보게 하는 수단).

    registry.json(grants)에 남겨 재구축 뒤에도 되살린다. entry.json(공유 폴더 Entry 폴더)에는 넣지 않는다."""

    __tablename__ = "entry_grants"
    __table_args__ = (UniqueConstraint("entry_id", "employee_id", name="uq_entry_grants_entry_user"),)

    id = Column(Integer, primary_key=True)
    entry_id = Column(Integer, ForeignKey("entries.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_id = Column(String(20), nullable=False, index=True)
    granted_by = Column(String(20), nullable=True)
    granted_at = Column(DateTime, nullable=False, default=_now)


class EntryHull(Base):
    __tablename__ = "entry_hulls"

    entry_id = Column(Integer, ForeignKey("entries.id", ondelete="CASCADE"), primary_key=True)
    hull_no = Column(String(8), primary_key=True)  # hulls 외래키 없음(초안의 추정 호선 허용)
    is_primary = Column(Boolean, nullable=False, default=False)


class Person(Base):
    """46 — 담당자 명부. 과제를 실제로 한 사람(올린 사람과 다를 수 있다). WorkBench 에서 골라 넣은 사람(source='wb',
    사번 있음)과 손으로 만든 사람(source='manual', 사번 없을 수 있음 — 퇴사자 등)을 같은 표에 둔다.
    여러 자료가 한 행을 가리키므로 퇴사 처리(employed)를 한 번 하면 그 사람의 모든 자료에 보인다.
    재구축 원천은 각 entry.json 의 assignees(사람 정보 사본) — 고치면 그 사람의 확정 자료 entry.json 을 다시 쓴다."""

    __tablename__ = "people"
    __table_args__ = (CheckConstraint("source IN ('wb','manual')", name="ck_people_source"),)

    id = Column(Integer, primary_key=True)
    employee_id = Column(String(20), unique=True, nullable=True)   # NULL 은 여러 개 둘 수 있다(MySQL UNIQUE)
    name = Column(String(50), nullable=False)
    department = Column(String(100), nullable=True)
    position = Column(String(50), nullable=True)
    employed = Column(Boolean, nullable=False, default=True, server_default=sa_text("1"))   # 재직(참)·퇴사(거짓)
    source = Column(String(10), nullable=False, default="manual")
    created_by = Column(String(20), nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)


class EntryAssignee(Base):
    """46 — 자료의 담당자(여러 명, sort_order 0 이 주 담당자)."""

    __tablename__ = "entry_assignees"

    entry_id = Column(Integer, ForeignKey("entries.id", ondelete="CASCADE"), primary_key=True)
    person_id = Column(Integer, ForeignKey("people.id"), primary_key=True, index=True)
    sort_order = Column(Integer, nullable=False, default=0)


class Tag(Base):
    """자유 입력 태그(구역 등). alias_of 로 동의어를 묶는다(03 에서 화면 제공)."""

    __tablename__ = "tags"
    __table_args__ = (UniqueConstraint("kind", "value", name="uq_tags_kind_value"),)

    id = Column(Integer, primary_key=True)
    # zone | free | target(38) | atype(42 — 해석 종류는 없앴다. 남은 행은 읽지 않는다) (29 — 21 의 project 는 없앴다. 남은 행이 있어도 읽지 않는다)
    kind = Column(String(10), nullable=False)
    value = Column(String(100), nullable=False)
    alias_of_id = Column(Integer, ForeignKey("tags.id"), nullable=True)
    # 08 통제 어휘 — listed=1 인 대표 태그가 목록 용어다. 기존 DB 에는 database.ensure_columns 가 더한다
    listed = Column(Boolean, nullable=False, default=False, server_default=sa_text("0"))
    sort_order = Column(Integer, nullable=True)
    active = Column(Boolean, nullable=False, default=True, server_default=sa_text("1"))


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
    # 39 — WorkBench 해석 출처(wb_origin.py). WB 가 보낸 묶음에만 — {analysis_id, owner, program, project, created_at,
    # note, passport{artifacts}}. 파일은 원래 batch_id 를 간직하므로 합치기·옮기기 뒤에도 출처가 파일을 따라간다
    origin = Column(JSON, nullable=True)
    wb_analysis_id = Column(Integer, nullable=True, index=True)   # 'WB #123' 검색용
    error = Column(Text, nullable=True)
    # 17 — LV3 가 '그래도 올리기' 로 올린 배치: 워커 처리·확정 재검사가 완전 동일 BDF 를 막지 않는다
    allow_duplicates = Column(Boolean, nullable=False, default=False, server_default="0")
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
    # 37 — 확정 자료에서 파일 하나만 뺀 것(파일 삭제). entry_id 를 비우고 원래 자료 pk 를 남긴다 — entry_id 로
    # 파일을 고르는 모든 경로(검색·판·문서·관계 지도)에서 저절로 빠진다. 실제 파일은 95_Trash/<trash_rel>/<rel_path>
    # FK 는 걸지 않는다 — 원래 자료가 영구 삭제(ops/purge)돼도 이 행을 막지 않게
    removed_from_id = Column(Integer, nullable=True, index=True)
    trash_rel = Column(String(80), nullable=True)   # "E000051_files_20261019-101500"


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
    # key 의 lbm 형식 버전(bdf.lbm.VERSION). NULL = 04c 이전 변환(v1). 기존 DB 에는 database.ensure_columns 가 더한다
    format_version = Column(Integer, nullable=True)
    # 내용 서명(12) — 범주별 정규화 sha256(bdf.signature). 파일명·주석·줄 형식·카드 순서와 무관하다.
    # 같은 모델 = geometry·property·material·load 모두 같음, 같은 형상 = geometry 만 같음(entries/same_model.py).
    # NULL = 12 이전 변환 → `enqueue-convert --missing-signature` 로 채운다. 기존 DB 에는 ensure_columns 가 더한다.
    sig_version = Column(Integer, nullable=True)
    sig_geometry = Column(String(64), nullable=True, index=True)
    sig_property = Column(String(64), nullable=True)
    sig_material = Column(String(64), nullable=True)
    sig_load = Column(String(64), nullable=True)
    sig_other = Column(String(64), nullable=True)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)


class SystemState(Base):
    """운영 상태(워커 심장 박동·마지막 백업·마지막 일일 작업). 재구축 대상이 아니다(다시 쌓인다)."""

    __tablename__ = "system_state"

    key = Column(String(40), primary_key=True)
    value = Column(JSON, nullable=True)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)


SOLVE_STATES = ("queued", "running", "pass", "fail", "error")


class SolveCheck(Base):
    """해석 검증 결과(06 §4) — 파일당 1행, 다시 검증하면 덮어쓴다.

    다시 돌리면 나오는 파생값이라 registry.json·재구축(05)에는 넣지 않는다. f06 은 파생 폴더
    `20_Derived/_solve/<model_key[:2]>/<model_key>.f06` 에 있다(solve.job.f06_path)."""

    __tablename__ = "solve_checks"

    file_id = Column(Integer, ForeignKey("files.id", ondelete="CASCADE"), primary_key=True)
    state = Column(String(20), nullable=False, default="queued")
    error_types = Column(JSON, nullable=True)      # 유형 키 목록(solve.f06 — mechanism·license 등)
    fatals = Column(JSON, nullable=True)           # [{code, message, type}] 최대 5건
    warning_count = Column(Integer, nullable=True)
    message = Column(String(500), nullable=True)
    spc_nodes = Column(Integer, nullable=True)     # 고정한 노드 수
    groups = Column(Integer, nullable=True)        # 연결 그룹 수
    fixed_node_ids = Column(JSON, nullable=True)   # 고정한 노드 번호(최대 solve.job.MAX_FIXED_IDS 개)
    elapsed = Column(Float, nullable=True)         # 소요 초(읽기·실행·판정 전체)
    model_key = Column(String(64), nullable=True)  # 검증한 원본 바이트의 key — ModelSummary.key 와 다르면 '다시 검증 필요'
    has_f06 = Column(Boolean, nullable=False, default=False)
    requested_by = Column(String(20), nullable=True)
    requested_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)


class Favorite(Base):
    """즐겨찾기(10) — 사용자별로 서버에 둬서 다른 PC·브라우저에서도 같은 목록이 보인다.

    Entry 가 휴지통에 가면 행은 남기고 목록에서만 숨긴다(복원하면 그대로 돌아온다). 영구 삭제·합치기로
    Entry 행이 지워질 때는 entries.service._clear_dangling_references 가 함께 지운다(FK CASCADE 도 건다).
    개인 편의 정보라 registry.json·재구축(05) 대상이 아니다."""

    __tablename__ = "favorites"
    __table_args__ = (UniqueConstraint("employee_id", "entry_id", name="uq_favorites_user_entry"),)

    id = Column(Integer, primary_key=True)
    employee_id = Column(String(20), nullable=False, index=True)
    entry_id = Column(Integer, ForeignKey("entries.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, default=_now)


class UserPref(Base):
    """사용자 화면 설정(10) — 열쇠 하나에 JSON 값 하나. 받는 열쇠는 prefs.PREF_KEYS 에 적은 것뿐이다.

    브라우저 localStorage 는 빠른 사본이고, 여기 값이 있으면 다른 PC 에서도 같은 설정으로 시작한다.
    재구축(05) 대상이 아니다(없으면 기본값으로 동작한다)."""

    __tablename__ = "user_prefs"

    employee_id = Column(String(20), primary_key=True)
    key = Column(String(40), primary_key=True)
    value = Column(JSON, nullable=True)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)


class CompareHistory(Base):
    """최근 비교(11) — 사용자가 /compare 로 연 모델 묶음(2~4개). 사용자별로 서버에 둬서 다른 PC 에서도 보인다.

    같은 모델 묶음(순서 무관, ids_key = 정렬한 파일 id)은 한 행 — 다시 열면 순서는 마지막에 연 순서로,
    open_count·last_opened_at 만 고친다. 사용자당 최근 compares.KEEP 개만 남긴다. 파일이 영구 삭제되면
    읽을 때 그 id 를 빼고, 남은 모델이 둘보다 적으면 행을 지운다(파일 FK 를 걸지 않는다 — JSON 목록).
    개인 편의 정보라 registry.json·재구축(05) 대상이 아니다."""

    __tablename__ = "compare_history"
    __table_args__ = (UniqueConstraint("employee_id", "ids_key", name="uq_compare_history_user_ids"),)

    id = Column(Integer, primary_key=True)
    employee_id = Column(String(20), nullable=False, index=True)
    file_ids = Column(JSON, nullable=False)          # 마지막에 연 순서의 파일 id 목록
    ids_key = Column(String(100), nullable=False)    # 정렬한 id 를 쉼표로 — 같은 묶음 찾기
    open_count = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, default=_now)
    last_opened_at = Column(DateTime, nullable=False, default=_now)


class ModelRevision(Base):
    """판 묶음(14) — 한 Entry 안 모델 파일이 어느 계열(series)의 몇 번째 판인가.

    대상 파일(모델, INCLUDE 조각 제외)마다 한 행. series_key 가 NULL 이면 계열이 없다(혼자인 파일).
    manual = 사용자가 '판 정리'로 정한 행 — 자동 추정(revisions.series.sync)은 manual 이 아닌 행만 다시 정한다.
    label 은 사용자가 준 판 이름만 담는다(자동 이름 R0·R1… 은 읽을 때 계산). 사용자 정리는 entry.json 에도 남긴다(재구축)."""

    __tablename__ = "model_revisions"

    file_id = Column(Integer, ForeignKey("files.id", ondelete="CASCADE"), primary_key=True)
    entry_id = Column(Integer, ForeignKey("entries.id", ondelete="CASCADE"), nullable=False, index=True)
    series_key = Column(String(64), nullable=True)
    rev_order = Column(Integer, nullable=False, default=0)
    is_latest = Column(Boolean, nullable=False, default=False)
    label = Column(String(20), nullable=True)
    manual = Column(Boolean, nullable=False, default=False)
    updated_by = Column(String(20), nullable=True)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)


DIFF_STATES = ("queued", "running", "done", "error")


class RevisionDiff(Base):
    """두 모델 비교 결과(14 B) — 앞 판 file_a → 뒤 판 file_b, ID 단위.

    key_a·key_b = 비교한 원본 바이트 sha(model_summaries.key), rule_version = revisions.diff.VERSION.
    셋이 지금 값과 같으면 캐시로 쓰고, 다르면 낡은 결과(다시 비교). 상세(ID 목록·문장)는 파생 폴더
    `20_Derived/_diff/<k[:2]>/<k>.rdiff`(gzip JSON). 다시 계산하면 나오는 파생값이라 재구축(05) 대상이 아니다."""

    __tablename__ = "revision_diffs"
    __table_args__ = (UniqueConstraint("file_a", "file_b", name="uq_revision_diffs_pair"),)

    id = Column(Integer, primary_key=True)
    file_a = Column(Integer, ForeignKey("files.id", ondelete="CASCADE"), nullable=False, index=True)
    file_b = Column(Integer, ForeignKey("files.id", ondelete="CASCADE"), nullable=False, index=True)
    key_a = Column(String(64), nullable=True)
    key_b = Column(String(64), nullable=True)
    rule_version = Column(Integer, nullable=True)
    state = Column(String(10), nullable=False, default="queued")
    summary = Column(JSON, nullable=True)
    error = Column(String(500), nullable=True)
    elapsed = Column(Float, nullable=True)
    requested_by = Column(String(20), nullable=True)
    requested_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)


class WbTargetRule(Base):
    """18-b — WorkBench 앱(target)별 보내기 제한. Entry 의 구역·대상(40)·태그 중 하나라도 맞으면 보낼 수 있다(OR).

    행이 없거나 세 목록이 모두 비면 제한하지 않는다. 알려진 target 목록·판정은 wb_targets.py 한 곳.
    registry.json(wb_target_rules)에도 남겨 재구축 때 되살린다."""

    __tablename__ = "wb_target_rules"

    target = Column(String(20), primary_key=True)   # gmu | truss (wb_targets.TARGETS)
    zones = Column(JSON, nullable=True)             # 구역 목록 용어 값
    targets = Column(JSON, nullable=True)           # 40 — 대상 목록 용어 값(기존 DB 는 database.ensure_columns)
    tags = Column(JSON, nullable=True)              # 자유 태그(입력한 그대로 — 판정 때 동의어를 푼다)
    updated_by = Column(String(20), nullable=True)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)


# 21 — 문서 분류 값(이 순서가 화면의 고르기 순서다 — 프런트는 GET /api/reports 의 document_type_options 로 받는다).
# 23 — 발표자료·회의자료·계산서를 더했다. 화면 상단 빠른 구분(보고서/발표자료/기타)은 report_catalog.DOCUMENT_TYPE_GROUPS
REPORT_DOCUMENT_TYPES = ("해석 보고서", "연구 보고서", "시험 보고서", "기술 검토", "발표자료", "회의자료", "계산서",
                         "지침", "기타")


class ReportMeta(Base):
    """21 — 보고서 파일 하나의 분류(문서 분류). 행이 없으면 '미분류'(version 0).
    23 — 행이 없는 .ppt/.pptx 는 '발표자료'로 **추정해 보여 준다**(저장하지 않는다 — report_catalog.effective_document_type).
    행이 있고 document_type 이 NULL 이면 사용자가 '미분류'로 저장한 것이라 추정하지 않는다.

    파일 id 기준이라 파일이 자료 사이를 옮겨 가도(합치기 확정 등) 그대로 따라간다. 휴지통에 가도 남고(복원하면 그대로),
    영구 삭제(ops/purge)·FK CASCADE 로 함께 지운다. 재구축 원천은 보고서가 든 자료의 entry.json `reports`."""

    __tablename__ = "report_meta"

    file_id = Column(Integer, ForeignKey("files.id", ondelete="CASCADE"), primary_key=True)
    document_type = Column(String(50), nullable=True)
    version = Column(Integer, nullable=False, default=1)   # 동시 저장 확인(PUT 의 version 과 같아야 한다)
    updated_by = Column(String(20), nullable=True)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)


class ReportModelLink(Base):
    """21 — '보고서에 사용한 모델'(사용자가 명시로 연결). 같은 자료의 모델은 연결하지 않아도 관련 모델로 보인다.

    보고서·모델 모두 파일 id 기준. 어느 쪽이든 영구 삭제되면 행도 지운다(ops/purge·FK CASCADE). 휴지통에 간 모델은
    행을 남기고 화면에서만 숨긴다(복원하면 다시 보인다). 재구축 원천은 보고서 자료의 entry.json `reports[].models`
    (모델이 든 자료 번호 + 상대경로 + sha256)."""

    __tablename__ = "report_model_links"
    __table_args__ = (UniqueConstraint("report_file_id", "model_file_id", name="uq_report_model_links_pair"),)

    id = Column(Integer, primary_key=True)
    report_file_id = Column(Integer, ForeignKey("files.id", ondelete="CASCADE"), nullable=False, index=True)
    model_file_id = Column(Integer, ForeignKey("files.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by = Column(String(20), nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now)


# ---- 15: is_admin(호환 열) = 실효 LV3 ----
# is_admin 은 예전 코드·테스트가 쓰던 호환 열이다. 저장 직전에 level·wb_admin 으로 맞춘다(읽는 코드는 없다).
from sqlalchemy import event  # noqa: E402


def _sync_level(_mapper, _conn, user: "User") -> None:
    if user.level not in USER_LEVELS:
        user.level = 1
    user.is_admin = bool(user.wb_admin) or user.level == 3


event.listen(User, "before_insert", _sync_level)
event.listen(User, "before_update", _sync_level)
