"""PDF — PyMuPDF 로 쪽 단위 본문, 문서 속성, 목차."""
import re

import fitz

from .base import ExtractError, ExtractResult, finish_summary

_PDF_DATE = re.compile(r"^D?:?(\d{4})(\d{2})(\d{2})")


def _pdf_date(value: str | None) -> str | None:
    m = _PDF_DATE.match(value or "")
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


def extract_pdf(data: bytes) -> ExtractResult:
    r = ExtractResult()
    with fitz.open(stream=data, filetype="pdf") as doc:
        if doc.needs_pass:
            raise ExtractError("encrypted_pdf")
        meta = doc.metadata or {}
        for i, page in enumerate(doc, start=1):
            if not r.add(f"page:{i}", page.get_text("text")):
                break
        toc = [t[1] for t in doc.get_toc(simple=True)]
        finish_summary(r, unit="page", count=doc.page_count, title=meta.get("title"),
                       author=meta.get("author"), created=_pdf_date(meta.get("creationDate")), headings=toc)
    return r
