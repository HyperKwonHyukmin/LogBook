"""추출 결과 형식과 공통 규칙 — 공백 정리, 크기 상한, 요약 카드(설계 §5.2)."""
import re
from dataclasses import dataclass, field
from datetime import date, datetime

MAX_TOTAL_CHARS = 2_000_000   # 파일 하나에서 색인하는 본문 상한(대형 엑셀 방어)
MAX_CHUNK_CHARS = 200_000     # 조각 하나(쪽·슬라이드·시트) 상한
MAX_HEADINGS = 40
COVER_CHARS = 400
TITLE_CHARS = 120

_SPACES = re.compile(r"[ \t\u00a0\u3000]+")
_BLANK_LINES = re.compile(r"\n{3,}")


class ExtractError(Exception):
    """문서를 열 수는 있었지만 본문을 뽑을 수 없는 경우(암호 걸린 PDF 등)."""


def clean(text: str) -> str:
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    text = _SPACES.sub(" ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    return _BLANK_LINES.sub("\n\n", text).strip()


@dataclass
class ExtractResult:
    chunks: list[tuple[str, str]] = field(default_factory=list)
    summary: dict = field(default_factory=dict)
    truncated: bool = False

    @property
    def chars(self) -> int:
        return sum(len(t) for _, t in self.chunks)

    def add(self, locator: str, text: str) -> bool:
        """본문 조각을 더한다. 전체 상한에 이미 닿았으면 False(호출자는 반복을 멈춘다)."""
        text = clean(text)
        room = MAX_TOTAL_CHARS - self.chars
        if room <= 0:
            self.truncated = True
            return False
        if not text:
            return True
        limit = min(room, MAX_CHUNK_CHARS)
        if len(text) > limit:
            text = text[:limit]
            self.truncated = True
        self.chunks.append((locator, text))
        return True


def _iso_date(value) -> str | None:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return None


def finish_summary(r: ExtractResult, *, unit: str, count: int, title=None, author=None, created=None,
                   headings=(), **extra) -> None:
    """요약 카드를 채운다. 제목이 문서 속성에 없으면 본문 첫 줄을 쓴다."""
    cover = r.chunks[0][1][:COVER_CHARS] if r.chunks else ""
    title = (title or "").strip() or None
    if title is None and cover:
        title = cover.split("\n", 1)[0][:TITLE_CHARS] or None
    r.summary = {
        "unit": unit,
        "count": count,
        "title": title,
        "author": (author or "").strip() or None,
        "created": created if isinstance(created, str) else _iso_date(created),
        "headings": [h for h in (x.strip() for x in headings) if h][:MAX_HEADINGS],
        "cover": cover,
        **extra,
    }
