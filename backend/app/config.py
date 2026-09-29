"""Logbook 설정 — backend/.env 를 읽어 한곳에서 제공한다. 다른 모듈은 os.getenv 를 직접 쓰지 않는다."""
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

DEFAULT_STORAGE_ROOT = r"\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\999_LogBook"
APP_VERSION = "0.1.0"


@dataclass(frozen=True)
class Settings:
    db_user: str
    db_password: str
    db_host: str
    db_port: int
    db_name: str
    storage_root: str
    session_hours: int
    frontend_dist: Path


def load_settings() -> Settings:
    return Settings(
        db_user=os.getenv("LOGBOOK_DB_USER", "logbook_app"),
        db_password=os.getenv("LOGBOOK_DB_PASSWORD", ""),
        db_host=os.getenv("LOGBOOK_DB_HOST", "localhost"),
        db_port=int(os.getenv("LOGBOOK_DB_PORT", "3306")),
        db_name=os.getenv("LOGBOOK_DB_NAME", "logbook"),
        storage_root=os.getenv("LOGBOOK_STORAGE_ROOT", DEFAULT_STORAGE_ROOT),
        session_hours=int(os.getenv("LOGBOOK_SESSION_HOURS", "8")),
        frontend_dist=Path(
            os.getenv("LOGBOOK_FRONTEND_DIST", str(BACKEND_DIR.parent / "frontend" / "dist"))
        ),
    )


settings = load_settings()
