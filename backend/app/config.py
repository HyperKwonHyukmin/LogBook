"""Hi-TESS LogBook 설정 — backend/.env 를 읽어 한곳에서 제공한다. 다른 모듈은 os.getenv 를 직접 쓰지 않는다."""
import os
import shutil
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

DEFAULT_STORAGE_ROOT = r"\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\999_LogBook"
APP_VERSION = "0.1.0"
DEFAULT_NASTRAN_EXE = r"C:\MSC.Software\MSC_Nastran\20131\bin\nastran.exe"


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
    # 05 운영 — 백업(mysqldump)·바로가기 주소·보관 개수·휴지통 보관일·일일 작업 시각
    mysqldump_path: str
    public_url: str
    backup_keep: int
    trash_days: int
    daily_hour: int
    # 06 해석 검증 — Nastran 실행 파일·제한 시간(초)
    nastran_exe: str
    solve_timeout: int
    # 15 — WorkBench 사용자 표(읽기 전용, `스키마.표`)와 활성 여부 캐시(초)
    wb_users_table: str
    wb_cache_seconds: int
    # 17 — 업로드 마무리 때 동기로 하는 '완전 동일 BDF' 검사 상한(모델 바이트 합·경과 초). 넘으면 워커가 검사한다
    dup_sync_max_bytes: int
    dup_sync_seconds: float
    # 18 — HiTESS WorkBench 연동. 서버 간 공유 비밀키(빈 값 = 연동 꺼짐, 경로를 404 로 숨긴다)와
    # LogBook 서버가 WorkBench 서버를 부르는 주소(일회 코드 교환 /api/logbook/redeem)
    wb_integration_secret: str
    wb_api_url: str
    # 리뷰 9 — 파일 하나의 본문 추출·BDF 변환 제한 시간(초). 자식 프로세스에서 돌리고 넘으면 끝낸다(0 = 제한 없이 워커 안에서)
    extract_timeout: int
    convert_timeout: int


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
        mysqldump_path=os.getenv("LOGBOOK_MYSQLDUMP",
                                 r"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe"),
        public_url=os.getenv("LOGBOOK_PUBLIC_URL", "http://10.14.42.145:9095"),
        backup_keep=int(os.getenv("LOGBOOK_BACKUP_KEEP", "30")),
        trash_days=int(os.getenv("LOGBOOK_TRASH_DAYS", "90")),
        daily_hour=int(os.getenv("LOGBOOK_DAILY_HOUR", "2")),
        # 기본: PATH 의 nastran → 없으면 MSC Nastran 2013.1 기본 설치 경로
        nastran_exe=os.getenv("LOGBOOK_NASTRAN_EXE") or shutil.which("nastran") or DEFAULT_NASTRAN_EXE,
        solve_timeout=int(os.getenv("LOGBOOK_SOLVE_TIMEOUT", "1800")),
        wb_users_table=os.getenv("LOGBOOK_WB_USERS_TABLE", "hitessworkbench.users"),
        wb_cache_seconds=int(os.getenv("LOGBOOK_WB_CACHE_SECONDS", "60")),
        dup_sync_max_bytes=int(os.getenv("LOGBOOK_DUP_SYNC_MAX_BYTES", str(32 * 1024 ** 2))),
        dup_sync_seconds=float(os.getenv("LOGBOOK_DUP_SYNC_SECONDS", "15")),
        wb_integration_secret=os.getenv("LOGBOOK_WB_INTEGRATION_SECRET", "").strip(),
        wb_api_url=os.getenv("LOGBOOK_WB_API_URL", "http://127.0.0.1:9091").strip().rstrip("/"),
        extract_timeout=int(os.getenv("LOGBOOK_EXTRACT_TIMEOUT", "600")),
        convert_timeout=int(os.getenv("LOGBOOK_CONVERT_TIMEOUT", "1800")),
    )


settings = load_settings()
