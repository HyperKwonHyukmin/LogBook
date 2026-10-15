"""22 — 보고서 본문 색인 설정. 환경 변수는 import 시점이 아니라 load_config() 를 부를 때 읽는다(테스트가 바꿀 수 있게)."""
import os
from dataclasses import dataclass
from pathlib import Path

from ..config import BACKEND_DIR, settings

DEFAULT_INDEX_PATH = BACKEND_DIR / ".report-search" / "index.sqlite3"


def _int(name, default, minimum):
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except ValueError:
        return default


def _float(name, default):
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class IndexConfig:
    index_path: Path = DEFAULT_INDEX_PATH
    storage_root: Path = Path(settings.storage_root)
    interval_seconds: int = 300
    batch_size: int = 25
    verify_seconds: int = 86400
    ocr: bool = True
    ocr_languages: str = "kor+eng"
    conversion_timeout: int = 120
    # 보고서 한 건 추출(OCR 포함) 전체 제한(초, 리뷰 9). 자식 프로세스에서 돌리고 넘으면 끝낸다(0 = 제한 없이 그 자리에서).
    # 스캔본은 쪽마다 OCR 이라 길게 잡는다
    extract_timeout: int = 3600
    # 비우면 Tesseract 설치 폴더의 tessdata(LOGBOOK_REPORT_TESSDATA 로 바꾼다)
    tessdata: Path | None = None
    # 실패 파일 재시도 간격: 처음 5분, 실패할 때마다 두 배, 최대 24시간(파일·추출기가 바뀌면 바로 다시)
    retry_base_seconds: int = 300
    retry_max_seconds: int = 86400

    @property
    def cache_root(self):
        return self.storage_root / "20_Derived" / "_report_search"


def load_config():
    tessdata = os.getenv("LOGBOOK_REPORT_TESSDATA", "").strip()
    config = IndexConfig(
        index_path=Path(os.getenv("LOGBOOK_REPORT_INDEX_PATH", "").strip() or str(DEFAULT_INDEX_PATH)),
        storage_root=Path(settings.storage_root),
        interval_seconds=_int("LOGBOOK_REPORT_INTERVAL", 300, 10),
        batch_size=_int("LOGBOOK_REPORT_BATCH_SIZE", 25, 1),
        verify_seconds=_int("LOGBOOK_REPORT_VERIFY_SECONDS", 86400, 60),
        ocr=os.getenv("LOGBOOK_REPORT_OCR", "1").lower() in ("1", "true", "yes"),
        ocr_languages=os.getenv("LOGBOOK_REPORT_OCR_LANGUAGES", "kor+eng"),
        conversion_timeout=_int("LOGBOOK_REPORT_CONVERSION_TIMEOUT", 120, 10),
        extract_timeout=_int("LOGBOOK_REPORT_EXTRACT_TIMEOUT", 3600, 0),
        tessdata=Path(tessdata) if tessdata else None,
    )
    if str(config.index_path).startswith(("\\\\", "//")):
        # SQLite 잠금은 SMB 에서 믿을 수 없다 — 색인은 서버 로컬 디스크에만 둔다
        raise ValueError("보고서 색인(SQLite)은 로컬 디스크에 두어야 합니다(SMB 경로 불가)")
    return config


def semantic_threshold():
    return _float("LOGBOOK_REPORT_SEMANTIC_THRESHOLD", 0.5)


def semantic_limit():
    return max(1, min(200, _int("LOGBOOK_REPORT_SEMANTIC_LIMIT", 50, 1)))


def vector_cache_bytes():
    """API 프로세스가 의미 검색용 벡터 행렬을 메모리에 들고 있을 상한(기본 512MB, float16 기준). 넘으면 매번 나눠 읽는다."""
    return _int("LOGBOOK_REPORT_VECTOR_CACHE_MB", 512, 0) * 1024 * 1024


def rag_concurrency():
    """요약(RAG) 전체 동시 실행 상한 — Ollama 는 WorkBench AI 와 같은 서버를 쓴다."""
    return _int("LOGBOOK_REPORT_RAG_CONCURRENCY", 2, 1)
