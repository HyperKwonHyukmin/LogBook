"""MySQL 연결. WorkBench app/database.py 를 이식했다(예약문자 안전 URL, pool_pre_ping)."""
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import URL
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import Settings, settings


def build_database_url(s: Settings = settings) -> URL:
    return URL.create(
        drivername="mysql+pymysql",
        username=s.db_user,
        password=s.db_password,
        host=s.db_host,
        port=s.db_port,
        database=s.db_name,
        query={"charset": "utf8mb4"},
    )


engine = create_engine(build_database_url(), pool_recycle=3600, pool_pre_ping=True)


@event.listens_for(engine, "connect")
def _disable_fulltext_stopwords(dbapi_conn, _record) -> None:
    """InnoDB ngram 파서는 불용어(a·at·in·is·or·to…)를 품은 2글자 토큰을 색인·검색에서 버린다.
    그러면 영어 본문 'data'(da·at·ta 모두 불용어 포함)가 한 건도 안 잡힌다. 세션마다 불용어
    목록을 꺼서, create_all 이 만드는 FULLTEXT 색인과 검색 모두 불용어 없이 동작하게 한다."""
    cur = dbapi_conn.cursor()
    try:
        cur.execute("SET SESSION innodb_ft_enable_stopword = OFF")
    finally:
        cur.close()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# create_all 은 이미 있는 표에 열을 더하지 않는다(마이그레이션 도구 없음). 기존 표에 열을 더할 때는
# 여기에 (표, 열, DDL 형식) 을 적는다 — 시작할 때 init_schema() 가 없는 열만 ALTER TABLE 로 더한다.
# 반드시 NULL 허용(또는 기본값 있는) 열이어야 한다(기존 행이 있으므로).
ADDED_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("model_summaries", "format_version", "INT NULL"),   # 04c — lbm 형식 버전
    ("tags", "listed", "TINYINT(1) NOT NULL DEFAULT 0"),   # 08 — 통제 어휘 용어
    ("tags", "sort_order", "INT NULL"),
    ("tags", "active", "TINYINT(1) NOT NULL DEFAULT 1"),
    ("model_summaries", "sig_version", "INT NULL"),          # 12 — BDF 내용 서명
    ("model_summaries", "sig_geometry", "VARCHAR(64) NULL"),
    ("model_summaries", "sig_property", "VARCHAR(64) NULL"),
    ("model_summaries", "sig_material", "VARCHAR(64) NULL"),
    ("model_summaries", "sig_load", "VARCHAR(64) NULL"),
    ("model_summaries", "sig_other", "VARCHAR(64) NULL"),
    ("users", "role", "VARCHAR(12) NOT NULL DEFAULT 'member'"),              # 13 — 사용자 등급
    ("entries", "access", "VARCHAR(10) NOT NULL DEFAULT 'public'"),          # 13 — 공개 범위
    ("entries", "private_min_role", "VARCHAR(12) NOT NULL DEFAULT 'viewer_all'"),
    ("users", "level", "INT NULL"),                                          # 15 — LogBook 등급(migrate_levels 가 채운다)
    ("users", "wb_admin", "TINYINT(1) NOT NULL DEFAULT 0"),                  # 15 — WorkBench 관리자 캐시
    ("batches", "allow_duplicates", "TINYINT(1) NOT NULL DEFAULT 0"),        # 17 — LV3 가 '그래도 올리기' 한 배치
    ("user_sessions", "wb_ref", "VARCHAR(64) NULL"),                         # 18 — WorkBench 세션 연결 고리
    ("entries", "no_hull", "TINYINT(1) NOT NULL DEFAULT 0"),                 # 20 — 호선 없음(공용)
    ("entries", "title_source", "VARCHAR(255) NULL"),                        # 20 — 제목 초안의 원래 이름
    ("hulls", "plm_status", "VARCHAR(12) NULL"),   # 30 — PLM 선박 정보
    ("hulls", "plm_checked_at", "DATETIME NULL"),
    ("hulls", "plm_ship_type", "VARCHAR(60) NULL"),
    ("hulls", "ship_capacity", "VARCHAR(20) NULL"),
    ("hulls", "ship_kind", "VARCHAR(40) NULL"),
    ("hulls", "ship_variant", "VARCHAR(60) NULL"),
    ("hulls", "main_engine", "VARCHAR(100) NULL"),
    ("hulls", "ship_class", "VARCHAR(20) NULL"),
    ("hulls", "delivery_date", "VARCHAR(10) NULL"),
    ("hulls", "delivered", "TINYINT(1) NULL"),
    ("files", "removed_from_id", "INT NULL"),      # 37 — 자료에서 뺀 파일(원래 자료 pk)
    ("files", "trash_rel", "VARCHAR(80) NULL"),
    ("batches", "origin", "JSON NULL"),            # 39 — WorkBench 해석 출처
    ("batches", "wb_analysis_id", "INT NULL"),
    ("wb_target_rules", "targets", "JSON NULL"),   # 40 — WorkBench 보내기 규칙의 대상
)
# 기존 표에 더하는 색인 (표, 색인 이름, 열들). 이름은 SQLAlchemy index=True 가 새 표에 만드는 이름과 같게 둔다.
ADDED_INDEXES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("model_summaries", "ix_model_summaries_sig_geometry", ("sig_geometry",)),   # 12 — 같은 형상 찾기
    ("user_sessions", "ix_user_sessions_wb_ref", ("wb_ref",)),                    # 18 — WorkBench 로그아웃 연동
    ("files", "ix_files_removed_from_id", ("removed_from_id",)),                  # 37 — 자료에서 뺀 파일
    ("batches", "ix_batches_wb_analysis_id", ("wb_analysis_id",)),               # 39 — 'WB #123' 검색
)


def ensure_columns(bind=None) -> list[str]:
    """ADDED_COLUMNS 중 없는 열, ADDED_INDEXES 중 없는 색인을 더한다(여러 번 불러도 같다).
    더한 '표.열'·'표.색인' 목록을 돌려준다."""
    bind = bind or engine
    insp = inspect(bind)
    tables = set(insp.get_table_names())
    added: list[str] = []
    for table, column, ddl in ADDED_COLUMNS:
        if table not in tables:
            continue   # 표가 없으면 create_all 이 열까지 만든다
        if column in {c["name"] for c in insp.get_columns(table)}:
            continue
        with bind.begin() as conn:
            conn.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{column}` {ddl}"))
        added.append(f"{table}.{column}")
    for table, name, columns in ADDED_INDEXES:
        if table not in tables or name in {i["name"] for i in inspect(bind).get_indexes(table)}:
            continue
        cols = ", ".join(f"`{c}`" for c in columns)
        with bind.begin() as conn:
            conn.execute(text(f"CREATE INDEX `{name}` ON `{table}` ({cols})"))
        added.append(f"{table}.{name}")
    return added


def migrate_levels(bind=None) -> int:
    """15 — 등급(level)이 비어 있는 사용자를 13 등급·예전 관리자 표시·상태로 채운다(여러 번 불러도 같다).

    승인 대기(pending)·비활성(disabled)·guest → 1, master·admin 또는 is_admin=1 → 3, viewer_all·member → 2.
    13 이전 DB(role 열이 막 생겨 모두 'member')도 같은 규칙으로 맞다. 바꾼 행 수를 돌려준다."""
    bind = bind or engine
    with bind.begin() as conn:
        n = conn.execute(text(
            "UPDATE users SET level = CASE "
            "WHEN status IN ('pending', 'disabled') THEN 1 "
            "WHEN role IN ('master', 'admin') OR is_admin = 1 THEN 3 "
            "WHEN role IN ('viewer_all', 'member') THEN 2 "
            "ELSE 1 END WHERE level IS NULL")).rowcount
    return n or 0


def migrate_access(bind=None) -> int:
    """15 — 자료 공개 범위(13 public/private)를 공개 단계로 옮긴다(여러 번 불러도 같다).

    public → normal(일반), private + 최소 등급 admin → blocked(블록), 그 밖 private → normal. 바꾼 행 수."""
    bind = bind or engine
    with bind.begin() as conn:
        n = conn.execute(text(
            "UPDATE entries SET access = CASE "
            "WHEN access = 'private' AND private_min_role = 'admin' THEN 'blocked' "
            "ELSE 'normal' END WHERE access IN ('public', 'private')")).rowcount
    return n or 0


def init_schema(bind=None) -> list[str]:
    """표 만들기(create_all) + 기존 표에 빠진 열 더하기 + 등급·공개 단계 이전(15). API·워커·CLI 시작 때 부른다."""
    from . import models  # noqa: F401  (테이블 등록)

    bind = bind or engine
    Base.metadata.create_all(bind=bind)
    added = ensure_columns(bind)
    if (n := migrate_levels(bind)):
        added.append(f"users.level(13 등급 → LV 이전 {n}명)")
    if (n := migrate_access(bind)):
        added.append(f"entries.access(공개/비공개 → 공유·일반·블록 이전 {n}건)")
    return added


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
