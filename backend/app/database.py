"""MySQL 연결. WorkBench app/database.py 를 이식했다(예약문자 안전 URL, pool_pre_ping)."""
from sqlalchemy import create_engine
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
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
