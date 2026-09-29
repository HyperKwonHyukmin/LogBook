"""MySQL 연결. WorkBench app/database.py 를 이식했다(예약문자 안전 URL, pool_pre_ping)."""
from sqlalchemy import create_engine, event
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


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
