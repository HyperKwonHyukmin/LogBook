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
)


def ensure_columns(bind=None) -> list[str]:
    """ADDED_COLUMNS 중 없는 열을 더한다(여러 번 불러도 같다). 더한 '표.열' 목록을 돌려준다."""
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
    return added


def init_schema(bind=None) -> list[str]:
    """표 만들기(create_all) + 기존 표에 빠진 열 더하기. API·워커·CLI 시작 때 부른다."""
    from . import models  # noqa: F401  (테이블 등록)

    bind = bind or engine
    Base.metadata.create_all(bind=bind)
    return ensure_columns(bind)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
