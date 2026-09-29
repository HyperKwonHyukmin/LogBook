"""보고서 본문 추출(설계 §5.2). 확장자(File.ext — 점 포함 소문자)로 추출기를 고른다."""
from .base import ExtractResult
from .docx import extract_docx
from .pdf import extract_pdf
from .pptx import extract_pptx
from .xlsx import extract_xlsx

EXTRACTORS = {
    ".pdf": extract_pdf,
    ".pptx": extract_pptx,
    ".xlsx": extract_xlsx,
    ".xlsm": extract_xlsx,
    ".docx": extract_docx,
}


def can_extract(ext: str) -> bool:
    return (ext or "").lower() in EXTRACTORS


def extract_bytes(ext: str, data: bytes) -> ExtractResult:
    return EXTRACTORS[ext.lower()](data)
