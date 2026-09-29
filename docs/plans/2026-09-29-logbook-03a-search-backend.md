# Logbook 03a — 본문 추출·검색 백엔드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보고서(PDF·PPTX·XLSX·DOCX) 본문을 추출해 색인하고, 호선·제목·태그·파일명·본문을 한 번에 찾는 검색 API와 호선·태그·Entry 상세·파일 미리보기 API를 만든다.

**Architecture:**
- 워커가 `extract_file` 작업으로 공유 폴더의 파일을 `read()` 해서 쪽·슬라이드·시트 단위로 본문을 뽑는다. 뽑은 본문은 `file_texts`(MySQL `FULLTEXT ... WITH PARSER ngram`)에 넣고, 요약 카드는 `file_extracts.summary` 에 둔다. 같은 결과를 `20_Derived\_text\<sha 앞 2자>\<sha256>.json` 에도 남겨 재구축 때 다시 쓴다.
- 검색은 `app/search/` 인터페이스 뒤에 둔다(설계 §6.2 — 나중에 Meilisearch 로 바꿀 때 이 모듈만 교체한다). 검색어를 공백으로 나눈 **모든 낱말이 맞아야**(AND) 결과에 들고, 순위는 호선·Entry번호 > 제목 > 태그·해석종류 > 설명 > 파일명 > 본문이다. 필터 건수는 "자기 필터만 뺀 나머지 필터"를 적용해 센다.
- 파일 내려받기·PDF 보기는 10분짜리 **내려받기 링크 토큰**을 쓴다. 브라우저의 `<iframe>`·`<a download>` 는 Authorization 헤더를 못 붙이기 때문이다.

**Tech Stack:** FastAPI · SQLAlchemy 2.0 · MySQL 8(ngram) · PyMuPDF 1.27.2 · python-pptx 1.0.2 · openpyxl 3.1.5 · python-docx 1.2.0

**설계 근거:** `docs/specs/2026-09-28-logbook-design.md` §3(`20_Derived`), §4(`file_texts`·`tags.alias_of`), §5.2(본문 추출·요약 카드), §5.3(문서 안 호선 표기), §6.1(`/h/{hull}`·`/e/{id}`·`/tags`), §6.2(검색), §6.3(미리보기), §9(DRM 파일)

**설계에서 달라진 점(이 계획에서 확정):**
1. 추출 상태를 `files` 열이 아니라 **새 표 `file_extracts`** 에 둔다. 이 저장소에는 마이그레이션 도구가 없다(`create_all`). 그래서 기존 표에 열을 더하면 145 운영 DB 에 반영되지 않는다.
2. 파생 텍스트는 `20_Derived\<EntryID>\text\` 가 아니라 **`20_Derived\_text\<sha[:2]>\<sha256>.json`** 에 둔다.
   - 초안 Entry 번호는 합치기·버리기로 사라질 수 있다. 반면 sha256 은 재구축 뒤에도 그대로다.
   - 같은 파일이 여러 번 올라와도 한 번만 추출한다.
3. 동의어는 `tags` 표(구역 `zone`·자유 태그 `free`)에만 적용한다. 해석 종류는 `entries.analysis_type` 열이라 03 에서는 동의어가 없다. 자동완성으로 표기를 맞추는 것으로 충분하다.
4. 동의어는 **한 단계**만 묶는다. 대표 태그 아래에 동의어들이 달리고, 동의어의 동의어는 만들지 않는다. 대표를 다른 태그에 묶으면 그 동의어들도 함께 옮겨 간다.

---

## 공통 규칙 (모든 태스크)

- 백엔드 명령은 `C:\Coding\Logbook\backend` 에서 `.venv\Scripts\python.exe -m pytest ...` 로 실행한다.
- **pytest 는 한 번에 하나만(순차)** — 테스트 DB `logbook_test` 를 공유한다. 병렬 실행 금지.
- **`backend\.env` 는 어떤 방법으로도 열지 않는다**(cat/type/Get-Content/Read 모두 금지). DB 계정은 건드리지 않는다.
- **git 명령 금지**(add/commit/push 포함). 각 태스크의 "커밋" 단계는 사람이 한다.
- 공유 폴더 경로는 항상 `to_long()` / `long_join()` 을 거친다(개발 PC 는 LongPathsEnabled=0).
- 파일은 `read()` 한 바이트 기준으로 다룬다. 로컬 C: 에 쓴 파일은 DRM 이 암호화할 수 있다(`HHIDRMC` + 4096B). 공유 폴더 파일은 평문이다.
- 주석·오류 문구는 한국어로 쓴다. API 오류 `detail` 은 영어 snake_case 코드다(프런트 `ERROR_LABELS` 가 번역한다).
- 실제 호선·기밀 자료를 테스트나 저장소에 넣지 않는다. 가상 호선은 `9999`(필요하면 `9998`)를 쓴다. 테스트 문서는 **테스트 안에서 라이브러리로 메모리에 만든다**(파일을 저장소에 넣지 않는다).
- MySQL InnoDB FULLTEXT 는 **커밋된 행만** 찾는다. 검색 테스트는 데이터를 넣고 `db.commit()` 한 뒤 검색한다.

## 파일 구조

| 파일 | 역할 |
|---|---|
| `backend/requirements.txt` (수정) | 추출 라이브러리 4종 |
| `backend/app/models.py` (수정) | `FileExtract`, `FileText`(FULLTEXT ngram), `DownloadToken` |
| `backend/tests/conftest.py` (수정) | `make_entry_file` 픽스처 |
| `backend/app/extract/__init__.py` (새) | 추출기 등록표 `can_extract`·`extract_bytes` |
| `backend/app/extract/base.py` (새) | `ExtractResult`, 공백 정리, 요약 카드 마무리, 상한 |
| `backend/app/extract/pdf.py`·`pptx.py`·`xlsx.py`·`docx.py` (새) | 형식별 추출 + `sheet_preview` |
| `backend/app/extract/store.py` (새) | `20_Derived\_text` 캐시 읽기·쓰기 |
| `backend/app/extract/job.py` (새) | `enqueue_extract`, `run_extract`, 문서 속 호선 근거 |
| `backend/app/entries/locate.py` (새) | File → 공유 폴더 실제 경로 |
| `backend/app/ingest/process.py` (수정) | 배치 처리 끝에 추출 작업 등록 |
| `backend/app/worker.py` (수정) | `extract_file` 작업 실행 |
| `backend/app/cli.py` (수정) | `enqueue-extract` 명령(기존 파일 일괄 등록) |
| `backend/app/tags.py` (새) | 동의어 묶음 계산·묶기·풀기·목록 |
| `backend/app/entries/service.py` (수정) | `set_tags`(종류별), 자유 태그, 추출 정보 포함 |
| `backend/app/entries/files.py` (수정) | `entry.json` 에 `tags` |
| `backend/app/search/__init__.py`·`base.py`·`mysql_backend.py`·`snippets.py` (새) | 검색 모듈 |
| `backend/app/hull_info.py` (새) | 호선 목록·상세(통계·월별 타임라인)·수정 |
| `backend/app/routers/search.py`·`tags.py`·`hulls.py`·`files.py` (새) | API |
| `backend/app/routers/entries.py` (수정) | `tags` 패치, `vault_unc`, 변경 이력 |
| `backend/app/routers/suggest.py` (수정) | `kind=tag`(자유 태그) |
| `backend/app/main.py` (수정) | 라우터 등록 |

---

### Task 1: 의존성과 모델 — 추출 상태·본문·내려받기 토큰

**Files:**
- Modify: `backend/requirements.txt`, `backend/app/models.py`, `backend/tests/conftest.py`
- Test: `backend/tests/test_models_03.py`

- [ ] **Step 1: 의존성 추가·설치**

`backend/requirements.txt` 끝에 추가:

```
PyMuPDF==1.27.2
python-pptx==1.0.2
openpyxl==3.1.5
python-docx==1.2.0
```

Run: `.venv\Scripts\python.exe -m pip install -r requirements.txt`
Expected: 네 패키지 설치 성공(사내망에서 pip 는 된다 — 사전 확인함)

- [ ] **Step 2: 실패하는 테스트 작성**

`backend/tests/conftest.py` 끝에 픽스처를 추가한다. 여러 테스트 파일이 공유한다.

```python
@pytest.fixture
def make_entry_file(db):
    """Entry(+배치) 와 파일 행을 한 번에 만든다(03 검색·추출 테스트 공용).

    entry 를 넘기면 그 Entry 에 파일만 더한다. 디스크에는 아무것도 쓰지 않는다 —
    디스크 파일이 필요한 테스트는 돌려받은 File 의 경로에 직접 쓴다."""
    from datetime import datetime

    from app import models

    seq = {"n": 0}

    def _make(*, entry=None, status="confirmed", title="구조 검토", hulls=("9999",), name="a.pdf",
              kind="report", uploaded_by="A100001", analysis_type=None, period=None, sha=None,
              location=None, confirmed_at=datetime(2026, 9, 1, 9, 0, 0)):
        seq["n"] += 1
        n = seq["n"]
        if entry is None:
            b = models.Batch(key=f"20260929-{n:06d}-test", source="inbox", original_name=title,
                             uploader=uploaded_by)
            db.add(b)
            db.flush()
            entry = models.Entry(title=title, status=status, batch_id=b.id, uploaded_by=uploaded_by,
                                 analysis_type=analysis_type, analysis_period=period,
                                 confirmed_at=confirmed_at if status == "confirmed" else None,
                                 confirmed_by=uploaded_by if status == "confirmed" else None)
            db.add(entry)
            db.flush()
            entry.entry_id = f"E{entry.id:06d}"
            if status in ("confirmed", "trashed"):
                entry.vault_rel = f"2026/{entry.entry_id}"
            for i, h in enumerate(hulls):
                db.add(models.EntryHull(entry_id=entry.id, hull_no=h, is_primary=(i == 0)))
                if status == "confirmed" and db.get(models.Hull, h) is None:
                    db.add(models.Hull(hull_no=h))
        loc = location or {"confirmed": "vault", "draft": "staging", "trashed": "trash"}[entry.status]
        ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
        f = models.File(batch_id=entry.batch_id, entry_id=entry.id, rel_path=name, name=name.split("/")[-1],
                        ext=ext, kind=kind, size=10, sha256=sha or f"{n:064d}", location=loc)
        db.add(f)
        db.commit()
        return entry, f

    return _make
```

`backend/tests/test_models_03.py`:

```python
from sqlalchemy import text

from app import models


def test_file_texts_has_ngram_fulltext_index(db):
    rows = db.execute(text("SHOW INDEX FROM file_texts WHERE Key_name = 'ft_file_texts_text'")).mappings().all()
    assert rows and rows[0]["Index_type"] == "FULLTEXT"


def test_ngram_fulltext_finds_korean_substring(db, make_entry_file):
    _e, f = make_entry_file()
    db.add(models.FileText(file_id=f.id, seq=0, locator="page:1", text="선체 구조 강도 평가 보고서"))
    db.commit()
    n = db.execute(text("SELECT COUNT(*) FROM file_texts WHERE MATCH(text) AGAINST(:q IN BOOLEAN MODE)"),
                   {"q": '"강도"'}).scalar()
    assert n == 1


def test_file_extract_row_defaults(db, make_entry_file):
    _e, f = make_entry_file()
    db.add(models.FileExtract(file_id=f.id))
    db.commit()
    row = db.get(models.FileExtract, f.id)
    assert row.state == "queued" and row.chars == 0 and row.summary is None


def test_download_token_row(db):
    from datetime import datetime, timedelta

    db.add(models.DownloadToken(token="t" * 36, file_id=1, employee_id="A100001",
                                expires_at=datetime.now() + timedelta(minutes=10)))
    db.commit()
    assert db.get(models.DownloadToken, "t" * 36).file_id == 1
```

- [ ] **Step 3: 실패 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_models_03.py -v`
Expected: FAIL — `AttributeError: module 'app.models' has no attribute 'FileText'` (또는 테이블 없음)

- [ ] **Step 4: 모델 구현**

`backend/app/models.py` 상단 import 에 `from sqlalchemy.dialects import mysql` 를 더하고, 파일 끝(Job 뒤)에 추가:

```python
# 본문 조각 하나가 64KB(TEXT) 를 넘을 수 있어 MySQL 에서는 MEDIUMTEXT(16MB) 를 쓴다.
LONG_TEXT = Text().with_variant(mysql.MEDIUMTEXT(), "mysql")

EXTRACT_STATES = ("queued", "done", "failed", "skipped")


class FileExtract(Base):
    """파일 본문 추출 상태와 규칙 기반 요약 카드(설계 §5.2).

    files 표에 열을 더하지 않고 표를 따로 둔다 — 이 저장소는 마이그레이션 도구 없이
    create_all 로만 표를 만들어서, 기존 표에 더한 열은 운영 DB 에 생기지 않는다."""

    __tablename__ = "file_extracts"

    file_id = Column(Integer, ForeignKey("files.id", ondelete="CASCADE"), primary_key=True)
    state = Column(String(10), nullable=False, default="queued")
    error = Column(String(500), nullable=True)   # skipped 사유(drm·too_large·trashed) 또는 실패 메시지
    summary = Column(JSON, nullable=True)        # 요약 카드 — extract.base.finish_summary() 참고
    chars = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)


class FileText(Base):
    """쪽·슬라이드·시트 단위 본문. ngram 전문 색인으로 한글 부분 일치를 찾는다(설계 §4)."""

    __tablename__ = "file_texts"
    __table_args__ = (
        Index("ft_file_texts_text", "text", mysql_prefix="FULLTEXT", mysql_with_parser="ngram"),
    )

    id = Column(Integer, primary_key=True)
    file_id = Column(Integer, ForeignKey("files.id", ondelete="CASCADE"), nullable=False, index=True)
    seq = Column(Integer, nullable=False)
    locator = Column(String(120), nullable=False)  # page:3 | slide:5 | notes:5 | sheet:<이름> | body
    text = Column(LONG_TEXT, nullable=False)


class DownloadToken(Base):
    """짧게 사는 내려받기 링크. <iframe>·<a> 는 Authorization 헤더를 붙일 수 없어서
    API 가 토큰을 주소에 담은 링크를 만들어 준다. 세션 토큰을 주소에 싣지 않기 위한 것이다."""

    __tablename__ = "download_tokens"

    token = Column(String(36), primary_key=True)
    file_id = Column(Integer, nullable=False)
    employee_id = Column(String(20), nullable=False)
    expires_at = Column(DateTime, nullable=False, index=True)
```

- [ ] **Step 5: 통과 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_models_03.py -v`
Expected: PASS (4 passed)

Run: `.venv\Scripts\python.exe -m pytest -q`
Expected: 전체 PASS(기존 306 + 4)

- [ ] **Step 6: 커밋(사람)** — `feat: 03a 추출·본문·내려받기 토큰 모델`

---

### Task 2: 형식별 본문 추출기

**Files:**
- Create: `backend/app/extract/__init__.py`, `backend/app/extract/base.py`, `backend/app/extract/pdf.py`, `backend/app/extract/pptx.py`, `backend/app/extract/xlsx.py`, `backend/app/extract/docx.py`
- Test: `backend/tests/test_extractors.py`

추출기는 **바이트를 받아** 결과를 돌려준다(파일 경로를 모른다). 파일 읽기와 DRM 판정은 Task 4 의 작업이 맡는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_extractors.py`:

```python
"""추출기 테스트 — 표본 문서는 라이브러리로 메모리에서 만든다(저장소에 파일을 넣지 않는다)."""
import io
from datetime import datetime

import pytest

from app.extract import can_extract, extract_bytes
from app.extract.base import MAX_TOTAL_CHARS, ExtractResult, clean
from app.extract.xlsx import sheet_preview


def _pdf() -> bytes:
    import fitz

    doc = fitz.open()
    for i, body in enumerate(["HULL NO. 9999 Structural Strength Review", "Result summary page"], start=1):
        page = doc.new_page()
        page.insert_text((72, 72), body)
    doc.set_metadata({"title": "Strength Review", "author": "Tester", "creationDate": "D:20260901120000+09'00'"})
    doc.set_toc([[1, "1. Overview", 1], [1, "2. Result", 2]])
    data = doc.tobytes()
    doc.close()
    return data


def _pptx() -> bytes:
    from pptx import Presentation

    prs = Presentation()
    s1 = prs.slides.add_slide(prs.slide_layouts[1])
    s1.shapes.title.text = "9999 호선 계류 구조 검토"
    s1.placeholders[1].text = "선체 구조 강도 평가"
    s1.notes_slide.notes_text_frame.text = "발표자 노트: 보강재 추가 필요"
    s2 = prs.slides.add_slide(prs.slide_layouts[5])
    s2.shapes.title.text = "결론"
    prs.core_properties.title = "계류 검토"
    prs.core_properties.author = "홍길동"
    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


def _xlsx() -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "응력"
    ws.append(["부재", "응력(MPa)", None])
    ws.append(["L100x100x10", 123.5, None])
    ws2 = wb.create_sheet("요약")
    ws2["A1"] = "허용응력 초과 없음"
    wb.properties.title = "응력 표"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _docx() -> bytes:
    import docx

    d = docx.Document()
    d.add_heading("1. 개요", level=1)
    d.add_paragraph("호선 9999 의 갑판 구조 검토")
    t = d.add_table(rows=1, cols=2)
    t.rows[0].cells[0].text = "항목"
    t.rows[0].cells[1].text = "결과"
    d.core_properties.title = "갑판 검토"
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def test_can_extract_by_ext():
    assert can_extract(".pdf") and can_extract(".PPTX") and can_extract(".xlsm") and can_extract(".docx")
    assert not can_extract(".bdf") and not can_extract(".ppt") and not can_extract("")


def test_clean_collapses_whitespace():
    assert clean("  a \t b\r\n\r\n\r\n\r\nc\x00 ") == "a b\n\nc"


def test_result_add_respects_total_limit():
    r = ExtractResult()
    assert r.add("page:1", "x" * (MAX_TOTAL_CHARS - 5))
    r.add("page:2", "y" * 100)
    assert sum(len(t) for _, t in r.chunks) == MAX_TOTAL_CHARS
    assert r.truncated
    assert r.add("page:3", "z") is False


def test_pdf_pages_and_summary():
    r = extract_bytes(".pdf", _pdf())
    assert [loc for loc, _ in r.chunks] == ["page:1", "page:2"]
    assert "HULL NO. 9999" in r.chunks[0][1]
    s = r.summary
    assert s["unit"] == "page" and s["count"] == 2
    assert s["title"] == "Strength Review" and s["author"] == "Tester" and s["created"] == "2026-09-01"
    assert s["headings"] == ["1. Overview", "2. Result"]
    assert s["cover"].startswith("HULL NO. 9999")


def test_pptx_slides_notes_titles():
    r = extract_bytes(".pptx", _pptx())
    locs = [loc for loc, _ in r.chunks]
    assert locs == ["slide:1", "notes:1", "slide:2"]
    assert "선체 구조 강도 평가" in r.chunks[0][1]
    assert "보강재 추가 필요" in r.chunks[1][1]
    s = r.summary
    assert s["unit"] == "slide" and s["count"] == 2
    assert s["title"] == "계류 검토" and s["author"] == "홍길동"
    assert s["headings"] == ["9999 호선 계류 구조 검토", "결론"]
    assert s["slide_titles"] == ["9999 호선 계류 구조 검토", "결론"]


def test_xlsx_sheets():
    r = extract_bytes(".xlsx", _xlsx())
    assert [loc for loc, _ in r.chunks] == ["sheet:응력", "sheet:요약"]
    assert "L100x100x10 123.5" in r.chunks[0][1]
    assert r.summary["unit"] == "sheet" and r.summary["count"] == 2
    assert r.summary["headings"] == ["응력", "요약"] and r.summary["title"] == "응력 표"


def test_docx_body_headings_tables():
    r = extract_bytes(".docx", _docx())
    assert [loc for loc, _ in r.chunks] == ["body"]
    assert "갑판 구조 검토" in r.chunks[0][1] and "항목 결과" in r.chunks[0][1]
    assert r.summary["headings"] == ["1. 개요"] and r.summary["title"] == "갑판 검토"


def test_title_falls_back_to_first_line():
    import fitz

    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "First Line Title\nsecond")
    r = extract_bytes(".pdf", doc.tobytes())
    assert r.summary["title"] == "First Line Title"


def test_broken_bytes_raise():
    with pytest.raises(Exception):
        extract_bytes(".pptx", b"not a zip")


def test_sheet_preview_rows_and_trim():
    p = sheet_preview(_xlsx())
    assert p["sheets"] == ["응력", "요약"] and p["name"] == "응력"
    assert p["rows"] == [["부재", "응력(MPa)"], ["L100x100x10", "123.5"]]
    assert p["truncated"] is False
    assert sheet_preview(_xlsx(), "요약")["rows"] == [["허용응력 초과 없음"]]
    assert sheet_preview(_xlsx(), "없는시트")["name"] == "응력"


def test_sheet_preview_truncates_rows():
    from openpyxl import Workbook

    wb = Workbook()
    for i in range(250):
        wb.active.append([i])
    buf = io.BytesIO()
    wb.save(buf)
    p = sheet_preview(buf.getvalue(), max_rows=200)
    assert len(p["rows"]) == 200 and p["truncated"] is True
```

- [ ] **Step 2: 실패 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_extractors.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.extract'`

- [ ] **Step 3: 구현**

`backend/app/extract/base.py`:

```python
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
```

`backend/app/extract/pdf.py`:

```python
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
```

`backend/app/extract/pptx.py`:

```python
"""PPTX — 슬라이드 본문(표·그룹 포함) + 발표자 노트(설계 §5.2)."""
import io

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

from .base import ExtractResult, finish_summary

MAX_SLIDE_TITLES = 300


def _shape_texts(shape) -> list[str]:
    if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
        return [t for s in shape.shapes for t in _shape_texts(s)]
    out: list[str] = []
    if getattr(shape, "has_text_frame", False) and shape.has_text_frame:
        out.append(shape.text_frame.text)
    if getattr(shape, "has_table", False) and shape.has_table:
        for row in shape.table.rows:
            out.append(" ".join(c.text for c in row.cells if c.text.strip()))
    return out


def extract_pptx(data: bytes) -> ExtractResult:
    prs = Presentation(io.BytesIO(data))
    r = ExtractResult()
    titles: list[str] = []
    for i, slide in enumerate(prs.slides, start=1):
        title_shape = slide.shapes.title
        titles.append(title_shape.text_frame.text.strip() if title_shape is not None else "")
        texts = [t for shape in slide.shapes for t in _shape_texts(shape)]
        if not r.add(f"slide:{i}", "\n".join(texts)):
            break
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame is not None:
            if not r.add(f"notes:{i}", slide.notes_slide.notes_text_frame.text):
                break
    cp = prs.core_properties
    finish_summary(r, unit="slide", count=len(prs.slides), title=cp.title, author=cp.author,
                   created=cp.created, headings=titles, slide_titles=titles[:MAX_SLIDE_TITLES])
    return r
```

`backend/app/extract/xlsx.py`:

```python
"""XLSX — 시트별 셀 값(계산값 기준, data_only). 미리보기용 앞 N행 표도 여기서 만든다."""
import io
from datetime import date, datetime

from openpyxl import load_workbook

from .base import ExtractResult, finish_summary

MAX_ROWS = 5000
MAX_COLS = 100


def _cell(v) -> str:
    if isinstance(v, float):
        return f"{v:g}"
    if isinstance(v, datetime):
        return v.isoformat(sep=" ", timespec="minutes") if (v.hour or v.minute) else v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return str(v).strip()


def _open(data: bytes):
    return load_workbook(io.BytesIO(data), read_only=True, data_only=True)


def extract_xlsx(data: bytes) -> ExtractResult:
    wb = _open(data)
    try:
        r = ExtractResult()
        names = wb.sheetnames
        for ws in wb.worksheets:
            lines = []
            for row in ws.iter_rows(max_row=MAX_ROWS, max_col=MAX_COLS, values_only=True):
                vals = [_cell(v) for v in row if v is not None and _cell(v)]
                if vals:
                    lines.append(" ".join(vals))
            if not r.add(f"sheet:{ws.title}", "\n".join(lines)):
                break
        props = wb.properties
        finish_summary(r, unit="sheet", count=len(names), title=props.title, author=props.creator,
                       created=props.created, headings=names)
        return r
    finally:
        wb.close()


def sheet_preview(data: bytes, name: str | None = None, *, max_rows: int = 200, max_cols: int = 50) -> dict:
    """시트 탭 + 앞 max_rows 행 표(설계 §6.3). 뒤쪽 빈 열은 잘라 낸다."""
    wb = _open(data)
    try:
        names = wb.sheetnames
        if not names:
            return {"sheets": [], "name": None, "rows": [], "truncated": False}
        target = name if name in names else names[0]
        rows: list[list[str]] = []
        truncated = False
        for i, row in enumerate(wb[target].iter_rows(max_col=max_cols, values_only=True)):
            if i >= max_rows:
                truncated = True
                break
            rows.append(["" if v is None else _cell(v) for v in row])
        width = max((max((j + 1 for j, v in enumerate(r) if v != ""), default=0) for r in rows), default=0)
        rows = [r[:width] for r in rows]
        while rows and not any(rows[-1]):
            rows.pop()
        return {"sheets": names, "name": target, "rows": rows, "truncated": truncated}
    finally:
        wb.close()
```

`backend/app/extract/docx.py`:

```python
"""DOCX — 문단(제목 스타일은 목차로) + 표."""
import io

import docx

from .base import ExtractResult, finish_summary

HEADING_STYLES = ("heading", "제목", "title")


def extract_docx(data: bytes) -> ExtractResult:
    d = docx.Document(io.BytesIO(data))
    lines: list[str] = []
    headings: list[str] = []
    for p in d.paragraphs:
        t = p.text.strip()
        if not t:
            continue
        lines.append(t)
        style = (p.style.name if p.style is not None else "") or ""
        if style.lower().startswith(HEADING_STYLES):
            headings.append(t)
    for table in d.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells if c.text.strip()]
            if cells:
                lines.append(" ".join(cells))
    r = ExtractResult()
    r.add("body", "\n".join(lines))
    cp = d.core_properties
    finish_summary(r, unit="paragraph", count=len(lines), title=cp.title, author=cp.author,
                   created=cp.created, headings=headings)
    return r
```

`backend/app/extract/__init__.py`:

```python
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
```

⚠ 테스트의 `test_title_falls_back_to_first_line` 에서 PDF 속성 `title` 이 빈 문자열이어야 한다. PyMuPDF 새 문서의 metadata `title` 은 `""` 이다. 한글 PDF 테스트는 넣지 않았다. PyMuPDF 기본 글꼴(Helvetica)은 한글을 그리지 못하기 때문이다. 한글 본문은 PPTX·XLSX·DOCX 테스트가 다룬다.

- [ ] **Step 4: 통과 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_extractors.py -v`
Expected: PASS (12 passed)

- [ ] **Step 5: 커밋(사람)** — `feat: 03a PDF·PPTX·XLSX·DOCX 본문 추출기`

---

### Task 3: 파일 위치 찾기와 파생 텍스트 캐시

**Files:**
- Create: `backend/app/entries/locate.py`, `backend/app/extract/store.py`
- Test: `backend/tests/test_locate_store.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_locate_store.py`:

```python
import os

import pytest

from app.entries.locate import FileUnavailable, file_path
from app.extract.base import ExtractResult
from app.extract.store import cache_path, load_cached, save_cached
from app.storage.paths import to_long


def test_file_path_for_staging_and_vault(db, storage, make_entry_file):
    draft, f1 = make_entry_file(status="draft", name="sub/a.pdf")
    p = file_path(db, storage, f1)
    batch_key = db.get(type(draft), draft.id).batch_id
    assert p.startswith("\\\\?\\") and p.endswith("\\sub\\a.pdf")
    assert "_staging" in p

    entry, f2 = make_entry_file(status="confirmed", name="r.pdf")
    p2 = file_path(db, storage, f2)
    assert p2.endswith(f"10_Vault\\2026\\{entry.entry_id}\\files\\r.pdf")


def test_file_path_rejects_trash(db, storage, make_entry_file):
    _e, f = make_entry_file(status="trashed")
    with pytest.raises(FileUnavailable):
        file_path(db, storage, f)


def test_cache_roundtrip(storage):
    r = ExtractResult(chunks=[("page:1", "본문")], summary={"unit": "page", "count": 1}, truncated=True)
    sha = "ab" + "0" * 62
    save_cached(storage, sha, r)
    assert os.path.exists(to_long(cache_path(storage, sha)))
    back = load_cached(storage, sha)
    assert back.chunks == [("page:1", "본문")] and back.summary["count"] == 1 and back.truncated is True


def test_cache_missing_or_corrupt_is_none(storage):
    sha = "cd" + "1" * 62
    assert load_cached(storage, sha) is None
    p = cache_path(storage, sha)
    os.makedirs(to_long(p.parent), exist_ok=True)
    with open(to_long(p), "w", encoding="utf-8") as fh:
        fh.write("{not json")
    assert load_cached(storage, sha) is None


def test_cache_ignores_other_version(storage):
    import json

    sha = "ef" + "2" * 62
    p = cache_path(storage, sha)
    os.makedirs(to_long(p.parent), exist_ok=True)
    with open(to_long(p), "w", encoding="utf-8") as fh:
        json.dump({"version": 999, "chunks": [], "summary": {}}, fh)
    assert load_cached(storage, sha) is None
```

- [ ] **Step 2: 실패 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_locate_store.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.entries.locate'`

- [ ] **Step 3: 구현**

`backend/app/entries/locate.py`:

```python
"""File 행 → 공유 폴더 안 실제 경로(긴 경로 접두사 포함)."""
from sqlalchemy.orm import Session

from .. import models
from ..storage.paths import StoragePaths, long_join
from .files import entry_dir


class FileUnavailable(Exception):
    """파일이 휴지통에 있거나 배치·Entry 정보가 없어 경로를 만들 수 없다."""


def file_path(db: Session, storage: StoragePaths, f: models.File) -> str:
    if f.location == "staging":
        batch = db.get(models.Batch, f.batch_id)
        if batch is None:
            raise FileUnavailable("batch_missing")
        return long_join(storage.staging / batch.key, f.rel_path)
    if f.location == "vault":
        entry = db.get(models.Entry, f.entry_id) if f.entry_id else None
        if entry is None or not entry.vault_rel:
            raise FileUnavailable("entry_missing")
        return long_join(entry_dir(storage, entry) / "files", f.rel_path)
    raise FileUnavailable(f.location)
```

`backend/app/extract/store.py`:

```python
"""파생 텍스트 캐시 — 20_Derived\\_text\\<sha 앞 2자>\\<sha256>.json.

sha256 기준이라 같은 파일이 여러 번 올라와도 한 번만 추출하고, DB 재구축 때 다시 쓴다.
캐시 쓰기 실패는 추출 자체를 실패시키지 않는다(DB 가 먼저다)."""
import json
import logging
import os
from pathlib import Path

from ..storage.paths import StoragePaths, to_long
from .base import ExtractResult

log = logging.getLogger(__name__)
CACHE_VERSION = 1


def cache_path(storage: StoragePaths, sha256: str) -> Path:
    return storage.derived / "_text" / sha256[:2] / f"{sha256}.json"


def load_cached(storage: StoragePaths, sha256: str) -> ExtractResult | None:
    try:
        with open(to_long(cache_path(storage, sha256)), encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or data.get("version") != CACHE_VERSION:
        return None
    return ExtractResult(chunks=[(loc, text) for loc, text in data.get("chunks", [])],
                         summary=data.get("summary") or {}, truncated=bool(data.get("truncated")))


def save_cached(storage: StoragePaths, sha256: str, r: ExtractResult) -> None:
    p = cache_path(storage, sha256)
    tmp = p.with_name(p.name + ".tmp")
    try:
        os.makedirs(to_long(p.parent), exist_ok=True)
        with open(to_long(tmp), "w", encoding="utf-8") as fh:
            json.dump({"version": CACHE_VERSION, "sha256": sha256, "chunks": r.chunks,
                       "summary": r.summary, "truncated": r.truncated}, fh, ensure_ascii=False)
        os.replace(to_long(tmp), to_long(p))
    except OSError as exc:
        log.warning("파생 텍스트 캐시 쓰기 실패(추출 결과는 DB 에 유지): %s — %s", sha256, exc)
```

테스트 `test_file_path_for_staging_and_vault` 의 `batch_key` 줄은 쓰지 않는 변수다. 구현 중 지워도 된다.

- [ ] **Step 4: 통과 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_locate_store.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: 커밋(사람)** — `feat: 03a 파일 위치·파생 텍스트 캐시`

---

### Task 4: 추출 작업 — 워커·배치 처리 연결, 문서 속 호선

**Files:**
- Create: `backend/app/extract/job.py`
- Modify: `backend/app/ingest/process.py`, `backend/app/worker.py`, `backend/app/cli.py`
- Test: `backend/tests/test_extract_job.py`

동작 규칙:
- `process_batch` 는 추출할 수 있는 확장자의 파일마다 `FileExtract(state=queued)` 행을 만들고 `extract_file` 작업을 건다.
- `run_extract` 는 다음 순서로 처리한다.
  1. DRM 표시·휴지통·200MB 초과는 `skipped` 로 끝낸다.
  2. 캐시가 있으면 캐시를 쓴다.
  3. 캐시가 없으면 파일을 읽는다. 읽은 머리가 `HHIDRMC` 면 `skipped(drm)` 로 끝내고 `File.drm_encrypted=True` 로 고친다.
  4. 추출기가 예외를 던지면 `failed` 로 기록하고 **작업은 완료 처리**한다. 같은 파일은 다시 돌려도 같은 결과라 재시도가 쓸모없다.
  5. 파일 읽기 `OSError`(이동 중·잠김)와 `FileUnavailable` 은 위로 던져 작업 큐가 재시도하게 한다.
- 문서 앞 3조각에서 `HULL NO. 9999`·`호선: 9999`·`9999 호선` 표기를 찾으면 설계 §5.3 의 "매우 높음" 근거로 다룬다.
  - 대상 Entry 가 **초안일 때만** `hull_evidence` 에 +5점과 근거 `보고서 본문: <파일명>` 을 더한다.
  - 초안에 호선이 하나도 없으면 그 호선을 대표 호선으로 넣는다.
  - `version` 은 올리지 않는다. 사용자가 편집 중인 초안 카드가 충돌 오류를 받지 않게 하려는 것이다.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_extract_job.py`:

```python
import io
import os

import pytest

from app import jobs, models
from app.entries.locate import FileUnavailable, file_path
from app.extract.job import enqueue_extract, run_extract
from app.extract.store import cache_path
from app.storage.paths import to_long


def _pptx(title="9999 호선 계류 구조 검토", body="선체 구조 강도 평가") -> bytes:
    from pptx import Presentation

    prs = Presentation()
    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.title.text = title
    s.placeholders[1].text = body
    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


def _write(db, storage, f, data: bytes):
    p = file_path(db, storage, f)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as fh:
        fh.write(data)


def test_enqueue_only_extractable(db, make_entry_file):
    _e, pdf = make_entry_file(name="a.pdf")
    _e2, bdf = make_entry_file(name="m.bdf", kind="model")
    assert enqueue_extract(db, pdf) is True
    assert enqueue_extract(db, bdf) is False
    db.commit()
    assert db.get(models.FileExtract, pdf.id).state == "queued"
    assert db.get(models.FileExtract, bdf.id) is None
    assert [j.type for j in db.query(models.Job)] == ["extract_file"]


def test_run_extract_stores_texts_summary_and_cache(db, storage, make_entry_file):
    _e, f = make_entry_file(name="r.pptx", sha="1" * 64)
    _write(db, storage, f, _pptx())
    run_extract(db, storage, f)
    row = db.get(models.FileExtract, f.id)
    assert row.state == "done" and row.error is None and row.chars > 0
    assert row.summary["unit"] == "slide" and row.summary["truncated"] is False
    texts = db.query(models.FileText).filter_by(file_id=f.id).order_by(models.FileText.seq).all()
    assert [t.locator for t in texts] == ["slide:1"] and "강도" in texts[0].text
    assert os.path.exists(to_long(cache_path(storage, "1" * 64)))


def test_run_extract_is_idempotent(db, storage, make_entry_file):
    _e, f = make_entry_file(name="r.pptx")
    _write(db, storage, f, _pptx())
    run_extract(db, storage, f)
    run_extract(db, storage, f)
    assert db.query(models.FileText).filter_by(file_id=f.id).count() == 1


def test_run_extract_uses_cache_without_reading_file(db, storage, make_entry_file):
    _e, f1 = make_entry_file(name="r.pptx", sha="2" * 64)
    _write(db, storage, f1, _pptx())
    run_extract(db, storage, f1)
    _e2, f2 = make_entry_file(name="copy.pptx", sha="2" * 64)  # 디스크에 없음 — 캐시로만
    run_extract(db, storage, f2)
    assert db.get(models.FileExtract, f2.id).state == "done"


def test_drm_flag_skips(db, storage, make_entry_file):
    _e, f = make_entry_file(name="r.pdf")
    f.drm_encrypted = True
    db.commit()
    run_extract(db, storage, f)
    row = db.get(models.FileExtract, f.id)
    assert row.state == "skipped" and row.error == "drm"


def test_drm_magic_detected_when_reading(db, storage, make_entry_file):
    _e, f = make_entry_file(name="r.pdf", sha="3" * 64)
    _write(db, storage, f, b"HHIDRMC" + b"\0" * 100)
    run_extract(db, storage, f)
    assert db.get(models.FileExtract, f.id).error == "drm"
    assert db.get(models.File, f.id).drm_encrypted is True


def test_too_large_skips(db, storage, make_entry_file):
    _e, f = make_entry_file(name="r.pdf")
    f.size = 300 * 1024 * 1024
    db.commit()
    run_extract(db, storage, f)
    assert db.get(models.FileExtract, f.id).error == "too_large"


def test_broken_file_fails_without_raising(db, storage, make_entry_file):
    _e, f = make_entry_file(name="r.pptx", sha="4" * 64)
    _write(db, storage, f, b"not a zip at all")
    run_extract(db, storage, f)
    row = db.get(models.FileExtract, f.id)
    assert row.state == "failed" and row.error


def test_missing_file_raises_for_retry(db, storage, make_entry_file):
    _e, f = make_entry_file(name="r.pptx", sha="5" * 64)
    with pytest.raises(OSError):
        run_extract(db, storage, f)


def test_trashed_file_skips(db, storage, make_entry_file):
    _e, f = make_entry_file(status="trashed", name="r.pdf")
    run_extract(db, storage, f)
    assert db.get(models.FileExtract, f.id).error == "trashed"


def test_doc_hull_fills_draft_without_hull(db, storage, make_entry_file):
    e, f = make_entry_file(status="draft", hulls=(), name="r.pptx", sha="6" * 64)
    e.hull_evidence = [{"hull_no": "1234", "score": 1, "reasons": ["이름 1개에 등장"]}]
    version = e.version
    db.commit()
    _write(db, storage, f, _pptx(title="HULL NO. 9999 검토"))
    run_extract(db, storage, f)
    e = db.get(models.Entry, e.id)
    assert [h.hull_no for h in db.query(models.EntryHull).filter_by(entry_id=e.id)] == ["9999"]
    assert e.hull_evidence[0]["hull_no"] == "9999" and e.hull_evidence[0]["score"] == 5
    assert "보고서 본문: r.pptx" in e.hull_evidence[0]["reasons"]
    assert e.version == version


def test_doc_hull_adds_score_to_existing_candidate_but_keeps_hull(db, storage, make_entry_file):
    e, f = make_entry_file(status="draft", hulls=("1234",), name="r.pptx", sha="7" * 64)
    e.hull_evidence = [{"hull_no": "1234", "score": 3, "reasons": ["이름 맨 앞: 1234_x"]},
                       {"hull_no": "9999", "score": 1, "reasons": ["이름 1개에 등장"]}]
    db.commit()
    _write(db, storage, f, _pptx(title="9999 호선 검토"))
    run_extract(db, storage, f)
    e = db.get(models.Entry, e.id)
    assert [h.hull_no for h in db.query(models.EntryHull).filter_by(entry_id=e.id)] == ["1234"]
    top = e.hull_evidence[0]
    assert top["hull_no"] == "9999" and top["score"] == 6


def test_doc_hull_ignored_for_confirmed(db, storage, make_entry_file):
    e, f = make_entry_file(status="confirmed", hulls=("1234",), name="r.pptx", sha="8" * 64)
    _write(db, storage, f, _pptx(title="HULL NO. 9999"))
    run_extract(db, storage, f)
    assert db.get(models.Entry, e.id).hull_evidence is None


def test_process_batch_enqueues_extract(db, storage):
    from app.ingest.process import process_batch

    b = models.Batch(key="20260929-111111-aaaa", source="inbox", original_name="9999_검토", uploader="A100001")
    db.add(b)
    db.commit()
    root = storage.staging / b.key / "9999_검토"
    root.mkdir(parents=True)
    (root / "r.pptx").write_bytes(_pptx())
    (root / "m.bdf").write_bytes(b"GRID,1,,0.,0.,0.\n")
    process_batch(db, storage, b)
    types = sorted(j.type for j in db.query(models.Job))
    assert types == ["extract_file"]
    assert db.query(models.FileExtract).count() == 1


def test_worker_runs_extract_job(db, storage):
    from app.ingest.inbox import InboxWatcher
    from app.worker import run_once

    b = models.Batch(key="20260929-222222-bbbb", source="inbox", original_name="9999_검토", uploader="A100001")
    db.add(b)
    db.flush()
    jobs.enqueue(db, "process_batch", b.id)
    db.commit()
    root = storage.staging / b.key / "9999_검토"
    root.mkdir(parents=True)
    (root / "r.pptx").write_bytes(_pptx())
    stats = run_once(db, storage, InboxWatcher(storage))
    assert stats["failed"] == 0 and stats["processed"] == 2
    f = db.query(models.File).one()
    assert db.get(models.FileExtract, f.id).state == "done"
```

- [ ] **Step 2: 실패 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_extract_job.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.extract.job'`

- [ ] **Step 3: 구현**

`backend/app/extract/job.py`:

```python
"""extract_file 작업 — 파일 본문을 뽑아 file_texts·file_extracts 에 넣는다(설계 §5.2)."""
import logging
import re

from sqlalchemy.orm import Session

from .. import jobs, models
from ..entries.locate import file_path
from ..storage.paths import StoragePaths
from . import can_extract, extract_bytes
from .store import load_cached, save_cached

log = logging.getLogger(__name__)

MAX_FILE_BYTES = 200 * 1024 * 1024
DRM_MAGIC = b"HHIDRMC"
DOC_HULL_SCORE = 5
DOC_HULL_CHUNKS = 3  # 표지·첫 장 근처에서만 찾는다(본문 깊숙한 숫자는 호선이 아닐 가능성이 크다)

# "HULL NO. 9999", "Hull No 9999", "호선: 9999", "호선번호 9999", "9999 호선"
_HULL_BEFORE = re.compile(r"(?:HULL\s*(?:NO\.?|NUMBER)?|호선\s*(?:번호)?)\s*[:：.]?\s*(\d{4})(?!\d)", re.IGNORECASE)
_HULL_AFTER = re.compile(r"(?<!\d)(\d{4})\s*호선")


def enqueue_extract(db: Session, f: models.File) -> bool:
    """추출할 수 있는 파일이면 대기 행과 작업을 만든다(커밋은 호출자)."""
    if not can_extract(f.ext):
        return False
    row = db.get(models.FileExtract, f.id)
    if row is None:
        db.add(models.FileExtract(file_id=f.id, state="queued"))
    else:
        row.state, row.error = "queued", None
    jobs.enqueue(db, "extract_file", f.id)
    return True


def _row(db: Session, f: models.File) -> models.FileExtract:
    row = db.get(models.FileExtract, f.id)
    if row is None:
        row = models.FileExtract(file_id=f.id)
        db.add(row)
    return row


def _finish(db: Session, row: models.FileExtract, state: str, error: str | None = None) -> None:
    row.state, row.error = state, (error or None) and error[:500]
    if state != "done":
        db.query(models.FileText).filter_by(file_id=row.file_id).delete(synchronize_session=False)
        row.chars = 0
    db.commit()


def find_doc_hull(chunks: list[tuple[str, str]]) -> str | None:
    for _loc, text in chunks[:DOC_HULL_CHUNKS]:
        m = _HULL_BEFORE.search(text) or _HULL_AFTER.search(text)
        if m:
            return m.group(1)
    return None


def _apply_doc_hull(db: Session, f: models.File, hull_no: str) -> None:
    entry = db.get(models.Entry, f.entry_id) if f.entry_id else None
    if entry is None or entry.status != "draft":
        return
    reason = f"보고서 본문: {f.name}"
    evidence = [dict(c) for c in (entry.hull_evidence or [])]
    cand = next((c for c in evidence if c.get("hull_no") == hull_no), None)
    if cand is None:
        cand = {"hull_no": hull_no, "score": 0, "reasons": []}
        evidence.append(cand)
    if reason not in cand["reasons"]:
        cand["score"] += DOC_HULL_SCORE
        cand["reasons"] = [*cand["reasons"], reason]
    evidence.sort(key=lambda c: (-c["score"], c["hull_no"]))
    entry.hull_evidence = evidence  # 새 리스트를 대입해야 JSON 열 변경이 잡힌다
    if db.query(models.EntryHull).filter_by(entry_id=entry.id).count() == 0:
        db.add(models.EntryHull(entry_id=entry.id, hull_no=hull_no, is_primary=True))


def run_extract(db: Session, storage: StoragePaths, f: models.File) -> None:
    row = _row(db, f)
    if f.location == "trash":
        return _finish(db, row, "skipped", "trashed")
    if f.drm_encrypted:
        return _finish(db, row, "skipped", "drm")
    if f.size > MAX_FILE_BYTES:
        return _finish(db, row, "skipped", "too_large")

    result = load_cached(storage, f.sha256)
    if result is None:
        with open(file_path(db, storage, f), "rb") as fh:  # OSError·FileUnavailable → 작업 재시도
            data = fh.read()
        if data.startswith(DRM_MAGIC):
            f.drm_encrypted = True
            return _finish(db, row, "skipped", "drm")
        try:
            result = extract_bytes(f.ext, data)
        except Exception as exc:  # 문서가 깨졌다 — 다시 돌려도 같으니 실패로 기록하고 끝낸다
            log.warning("본문 추출 실패: file=%s %s — %s", f.id, f.name, exc)
            return _finish(db, row, "failed", f"{type(exc).__name__}: {exc}")
        save_cached(storage, f.sha256, result)

    db.query(models.FileText).filter_by(file_id=f.id).delete(synchronize_session=False)
    for seq, (loc, text) in enumerate(result.chunks):
        db.add(models.FileText(file_id=f.id, seq=seq, locator=loc[:120], text=text))
    row.state, row.error = "done", None
    row.summary = {**result.summary, "truncated": result.truncated}
    row.chars = result.chars
    hull_no = find_doc_hull(result.chunks)
    if hull_no:
        _apply_doc_hull(db, f, hull_no)
    db.commit()
```

`FileUnavailable` 은 `OSError` 가 아니다. 그래서 `test_missing_file_raises_for_retry` 는 `open()` 의 `FileNotFoundError` 를 기대한다. 워커는 모든 예외를 잡아 `jobs.fail` 로 재시도하므로 두 예외 모두 재시도된다.

`backend/app/ingest/process.py` — import 에 `from ..extract.job import enqueue_extract` 를 더한다. `for p in propose(...)` 루프가 끝난 뒤, `batch.excluded = ...` 앞에 넣는다:

```python
    # 보고서 본문 추출은 워커가 따로 처리한다(배치 처리를 무겁게 만들지 않게).
    for f in rows.values():
        enqueue_extract(db, f)
```

`backend/app/worker.py` — import 에 `from .extract.job import run_extract` 를 더하고, `elif job.type == "write_meta":` 블록 뒤에 넣는다:

```python
            elif job.type == "extract_file":
                f = db.get(models.File, job.target_id)
                if f is None:
                    raise RuntimeError(f"파일을 찾을 수 없음: {job.target_id}")
                run_extract(db, storage, f)
```

`backend/app/cli.py` — 기존 파일(03 이전에 올라온 것)을 한꺼번에 추출 대기열에 넣는 명령을 추가한다.

```python
def enqueue_extract_all(db: Session, *, force: bool = False) -> int:
    """추출 기록이 없는(force 면 실패·건너뜀 포함 전부) 파일을 추출 작업에 넣는다."""
    from .extract.job import enqueue_extract

    n = 0
    for f in db.query(models.File).filter(models.File.location != "trash").order_by(models.File.id):
        row = db.get(models.FileExtract, f.id)
        if row is not None and not force and row.state in ("done", "queued", "skipped"):
            continue
        if enqueue_extract(db, f):
            n += 1
    db.commit()
    return n
```

`main()` 을 서브명령 두 개로 나눈다. `create-admin` 동작은 그대로 둔다:

```python
    q = sub.add_parser("enqueue-extract", help="본문 추출이 안 된 파일을 워커 작업에 넣는다")
    q.add_argument("--force", action="store_true", help="이미 추출·건너뜀된 파일도 다시")
    args = parser.parse_args(argv)

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if args.cmd == "enqueue-extract":
            print(f"추출 작업 {enqueue_extract_all(db, force=args.force)}건을 넣었습니다.")
            return 0
        u = create_admin(db, get_storage(), args.employee_id, args.name, args.department)
    except ValueError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 2
    finally:
        db.close()
    print(f"관리자 준비됨: {u.employee_id} {u.name}")
    return 0
```

`backend/tests/test_cli.py` 에 추가:

```python
def test_enqueue_extract_all(db, make_entry_file):
    from app import models
    from app.cli import enqueue_extract_all

    _e, a = make_entry_file(name="a.pdf")
    _e2, b = make_entry_file(name="b.pdf")
    make_entry_file(name="m.bdf", kind="model")
    db.add(models.FileExtract(file_id=b.id, state="done"))
    db.commit()
    assert enqueue_extract_all(db) == 1
    assert enqueue_extract_all(db, force=True) == 2
```

- [ ] **Step 4: 통과 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_extract_job.py tests/test_cli.py tests/test_process.py tests/test_worker.py -v`
Expected: PASS

주의: 기존 `test_process.py`·`test_worker.py` 에서 작업 수(`jobs` 개수)나 `processed` 수를 세는 단언이 `.pdf`·`.pptx` 등 파일 때문에 달라질 수 있다. 달라지면 그 단언을 새 동작(추출 작업이 더해짐)에 맞게 고친다. **단언을 지우지는 않는다.**

Run: `.venv\Scripts\python.exe -m pytest -q`
Expected: 전체 PASS

- [ ] **Step 5: 커밋(사람)** — `feat: 03a 본문 추출 작업·문서 속 호선 근거`

---

### Task 5: 태그 동의어와 자유 태그

**Files:**
- Create: `backend/app/tags.py`, `backend/app/routers/tags.py`
- Modify: `backend/app/entries/service.py`, `backend/app/entries/files.py`, `backend/app/routers/entries.py`, `backend/app/routers/suggest.py`, `backend/app/main.py`
- Test: `backend/tests/test_tags.py`

⚠ 지금의 `set_zones` 는 Entry 의 **모든** `entry_tags` 를 지운다. 자유 태그가 생기면 구역을 고칠 때 자유 태그까지 지워지는 버그가 된다. 그래서 종류별로 지우는 `set_tags` 로 바꾼다.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_tags.py`:

```python
from app import models
from app.entries import service
from app.tags import group_ids, group_values, root_value


def _tag(db, value, kind="zone", alias_of=None):
    t = models.Tag(kind=kind, value=value, alias_of_id=alias_of.id if alias_of else None)
    db.add(t)
    db.commit()
    return t


def test_group_values_and_root(db):
    bow = _tag(db, "선수부")
    fwd = _tag(db, "FWD", alias_of=bow)
    _tag(db, "Fore", alias_of=bow)
    assert group_values(db, "zone", "fwd") == {"선수부", "FWD", "Fore"}
    assert group_values(db, "zone", "선수부") == {"선수부", "FWD", "Fore"}
    assert group_values(db, "zone", "없는값") == {"없는값"}
    assert root_value(db, "zone", "Fore") == "선수부"
    assert set(group_ids(db, [fwd.id])) == {t.id for t in db.query(models.Tag)}


def test_set_tags_keeps_other_kind(db, storage, make_user, make_entry_file):
    u = make_user()
    e, _f = make_entry_file(status="draft")
    service.update_entry(db, storage, e, u, {"version": e.version, "zones": ["선수부"], "tags": ["계류"]})
    e = db.get(models.Entry, e.id)
    service.update_entry(db, storage, e, u, {"version": e.version, "zones": ["선미부"]})
    d = service.entry_to_dict(db, db.get(models.Entry, e.id))
    assert d["zones"] == ["선미부"] and d["tags"] == ["계류"]


def test_confirmed_update_audits_tags(db, storage, make_user, make_entry_file):
    u = make_user()
    e, _f = make_entry_file(status="confirmed")
    service.update_entry(db, storage, e, u, {"version": e.version, "tags": ["피로", "계류"]})
    row = db.query(models.AuditLog).filter_by(action="ENTRY_UPDATE").one()
    assert row.before["tags"] == [] and row.after["tags"] == ["계류", "피로"]


def test_tags_api_list_alias_unalias(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    e, _f = make_entry_file(status="confirmed")
    bow, fwd = _tag(db, "선수부"), _tag(db, "FWD")
    db.add(models.EntryTag(entry_id=e.id, tag_id=fwd.id))
    db.commit()

    res = client.get("/api/tags?kind=zone", headers=h)
    assert res.status_code == 200
    by_value = {t["value"]: t for t in res.json()}
    assert by_value["FWD"]["count"] == 1 and by_value["선수부"]["count"] == 0

    res = client.post(f"/api/tags/{fwd.id}/alias", json={"target_id": bow.id}, headers=h)
    assert res.status_code == 200 and res.json()["alias_of"] == {"id": bow.id, "value": "선수부"}
    assert db.query(models.AuditLog).filter_by(action="TAG_ALIAS").count() == 1

    res = client.delete(f"/api/tags/{fwd.id}/alias", headers=h)
    assert res.status_code == 200 and res.json()["alias_of"] is None
    assert db.query(models.AuditLog).filter_by(action="TAG_UNALIAS").count() == 1


def test_alias_moves_children_to_new_root(client, db, make_user, auth_headers):
    make_user("A100001")
    h = auth_headers("A100001")
    a, b, c = _tag(db, "A"), _tag(db, "B"), _tag(db, "C")
    client.post(f"/api/tags/{b.id}/alias", json={"target_id": a.id}, headers=h)
    res = client.post(f"/api/tags/{a.id}/alias", json={"target_id": c.id}, headers=h)
    assert res.status_code == 200
    db.expire_all()
    assert db.get(models.Tag, b.id).alias_of_id == c.id and db.get(models.Tag, a.id).alias_of_id == c.id


def test_alias_to_child_resolves_to_root(client, db, make_user, auth_headers):
    make_user("A100001")
    h = auth_headers("A100001")
    a, b, c = _tag(db, "A"), _tag(db, "B"), _tag(db, "C")
    client.post(f"/api/tags/{b.id}/alias", json={"target_id": a.id}, headers=h)
    res = client.post(f"/api/tags/{c.id}/alias", json={"target_id": b.id}, headers=h)
    assert res.json()["alias_of"]["value"] == "A"


def test_alias_rejections(client, db, make_user, auth_headers):
    make_user("A100001")
    h = auth_headers("A100001")
    z, f = _tag(db, "Z"), _tag(db, "F", kind="free")
    assert client.post(f"/api/tags/{z.id}/alias", json={"target_id": f.id}, headers=h).json()["detail"] == "kind_mismatch"
    assert client.post(f"/api/tags/{z.id}/alias", json={"target_id": z.id}, headers=h).json()["detail"] == "same_tag"
    child = _tag(db, "Y", alias_of=z)
    assert client.post(f"/api/tags/{z.id}/alias", json={"target_id": child.id}, headers=h).json()["detail"] == "same_tag"
    assert client.post("/api/tags/99999/alias", json={"target_id": z.id}, headers=h).status_code == 404


def test_suggest_free_tags(client, db, make_user, auth_headers):
    make_user("A100001")
    _tag(db, "계류", kind="free")
    _tag(db, "계류부", kind="zone")
    res = client.get("/api/suggest?kind=tag&q=계", headers=auth_headers("A100001"))
    assert res.json() == ["계류"]
```

- [ ] **Step 2: 실패 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_tags.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.tags'`

- [ ] **Step 3: 구현**

`backend/app/tags.py`:

```python
"""태그 동의어(설계 §6.2 — alias 로 묶인 값을 함께 찾는다, 원래 입력값은 보존).

한 단계만 묶는다. 대표 태그(alias_of 없음) 아래에 동의어들이 달린다. 어떤 태그를
다른 태그에 묶으면 대상의 대표로 묶는다. 묶이는 태그의 동의어들도 함께 옮긴다."""
from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from . import audit, models
from .storage.paths import StoragePaths

TAG_KINDS = ("zone", "free")


def root(db: Session, tag: models.Tag) -> models.Tag:
    return db.get(models.Tag, tag.alias_of_id) if tag.alias_of_id else tag


def _find(db: Session, kind: str, value: str) -> models.Tag | None:
    # MySQL 기본 정렬 규칙(utf8mb4_0900_ai_ci)이라 대소문자를 가리지 않고 찾는다.
    return db.query(models.Tag).filter(models.Tag.kind == kind, models.Tag.value == value).first()


def group_ids(db: Session, tag_ids) -> list[int]:
    """태그들의 동의어 묶음 전체 id(대표 + 동의어)."""
    ids = list(tag_ids)
    if not ids:
        return []
    roots = {t.alias_of_id or t.id for t in db.query(models.Tag).filter(models.Tag.id.in_(ids))}
    if not roots:
        return []
    rows = db.query(models.Tag.id).filter((models.Tag.id.in_(roots)) | (models.Tag.alias_of_id.in_(roots)))
    return [i for (i,) in rows]


def group_values(db: Session, kind: str, value: str) -> set[str]:
    tag = _find(db, kind, value)
    if tag is None:
        return {value}
    return {v for (v,) in db.query(models.Tag.value).filter(models.Tag.id.in_(group_ids(db, [tag.id])))}


def root_value(db: Session, kind: str, value: str) -> str:
    tag = _find(db, kind, value)
    return root(db, tag).value if tag else value


def tag_to_dict(db: Session, tag: models.Tag, count: int | None = None) -> dict:
    target = db.get(models.Tag, tag.alias_of_id) if tag.alias_of_id else None
    d = {"id": tag.id, "kind": tag.kind, "value": tag.value,
         "alias_of": {"id": target.id, "value": target.value} if target else None}
    if count is not None:
        d["count"] = count
    return d


def list_tags(db: Session, kind: str) -> list[dict]:
    counts = dict(
        db.query(models.EntryTag.tag_id, func.count(models.EntryTag.entry_id))
        .join(models.Entry, models.Entry.id == models.EntryTag.entry_id)
        .filter(models.Entry.status.in_(("draft", "confirmed")))
        .group_by(models.EntryTag.tag_id).all())
    tags = db.query(models.Tag).filter_by(kind=kind).order_by(models.Tag.value).all()
    return [tag_to_dict(db, t, counts.get(t.id, 0)) for t in tags]


def set_alias(db: Session, storage: StoragePaths, actor: str, tag: models.Tag, target: models.Tag,
              ip: str | None = None) -> models.Tag:
    if tag.kind != target.kind:
        raise HTTPException(status_code=422, detail="kind_mismatch")
    new_root = root(db, target)
    if new_root.id == tag.id:
        raise HTTPException(status_code=422, detail="same_tag")
    before = {"alias_of": db.get(models.Tag, tag.alias_of_id).value if tag.alias_of_id else None}
    db.query(models.Tag).filter_by(alias_of_id=tag.id).update({"alias_of_id": new_root.id},
                                                              synchronize_session=False)
    tag.alias_of_id = new_root.id
    db.flush()
    audit.record(db, storage, actor=actor, action="TAG_ALIAS", target_type="tag",
                 target_id=f"{tag.kind}:{tag.value}", before=before, after={"alias_of": new_root.value}, ip=ip)
    return tag


def clear_alias(db: Session, storage: StoragePaths, actor: str, tag: models.Tag,
                ip: str | None = None) -> models.Tag:
    if tag.alias_of_id is None:
        return tag
    before = {"alias_of": db.get(models.Tag, tag.alias_of_id).value}
    tag.alias_of_id = None
    db.flush()
    audit.record(db, storage, actor=actor, action="TAG_UNALIAS", target_type="tag",
                 target_id=f"{tag.kind}:{tag.value}", before=before, after={"alias_of": None}, ip=ip)
    return tag
```

`backend/app/routers/tags.py`:

```python
"""태그 목록·동의어 묶기/풀기(설계 §6.1 `/tags`). 팀원 누구나 할 수 있고 모두 기록된다."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models, tags
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_auth
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/tags", tags=["tags"])


class AliasBody(BaseModel):
    target_id: int


def _tag(db: Session, tag_id: int) -> models.Tag:
    t = db.get(models.Tag, tag_id)
    if t is None:
        raise HTTPException(status_code=404, detail="tag_not_found")
    return t


@router.get("")
def list_tags(kind: str = Query(default="zone", pattern="^(zone|free)$"),
              db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return tags.list_tags(db, kind)


@router.post("/{tag_id}/alias")
def alias(tag_id: int, body: AliasBody, request: Request, db: Session = Depends(get_db),
          storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    t = tags.set_alias(db, storage, user.employee_id, _tag(db, tag_id), _tag(db, body.target_id),
                       client_ip(request))
    return tags.tag_to_dict(db, t)


@router.delete("/{tag_id}/alias")
def unalias(tag_id: int, request: Request, db: Session = Depends(get_db),
            storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    t = tags.clear_alias(db, storage, user.employee_id, _tag(db, tag_id), client_ip(request))
    return tags.tag_to_dict(db, t)
```

`backend/app/entries/service.py` 를 수정한다.

`zones_of` 와 `set_zones` 를 아래로 바꾼다. 이름은 유지해 기존 호출부를 깨지 않는다.

```python
def tags_of(db: Session, entry: models.Entry, kind: str) -> list[str]:
    rows = (db.query(models.Tag.value).join(models.EntryTag, models.EntryTag.tag_id == models.Tag.id)
            .filter(models.EntryTag.entry_id == entry.id, models.Tag.kind == kind)
            .order_by(models.Tag.value).all())
    return [v for (v,) in rows]


def zones_of(db: Session, entry: models.Entry) -> list[str]:
    return tags_of(db, entry, "zone")


def set_tags(db: Session, entry: models.Entry, kind: str, values: list[str]) -> None:
    """이 종류(kind)의 태그만 바꾼다 — 다른 종류(구역 ↔ 자유 태그)는 건드리지 않는다."""
    old = [i for (i,) in db.query(models.EntryTag.tag_id).join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
           .filter(models.EntryTag.entry_id == entry.id, models.Tag.kind == kind)]
    if old:
        db.query(models.EntryTag).filter(models.EntryTag.entry_id == entry.id,
                                         models.EntryTag.tag_id.in_(old)).delete(synchronize_session=False)
    for v in dict.fromkeys(x.strip()[:100] for x in values if x and x.strip()):
        tag = db.query(models.Tag).filter_by(kind=kind, value=v).first()
        if tag is None:
            tag = models.Tag(kind=kind, value=v)
            db.add(tag)
            db.flush()
        if db.query(models.EntryTag).filter_by(entry_id=entry.id, tag_id=tag.id).first() is None:
            db.add(models.EntryTag(entry_id=entry.id, tag_id=tag.id))


def set_zones(db: Session, entry: models.Entry, values: list[str]) -> None:
    set_tags(db, entry, "zone", values)
```

(`FWD`·`fwd` 처럼 대소문자만 다른 값은 MySQL 정렬 규칙상 같은 태그 한 개로 합쳐진다. 그래서 `EntryTag` 중복을 확인한 뒤 넣는다.)

그 밖의 수정:
- `entry_to_dict` 의 `"zones": zones_of(db, entry),` 다음 줄에 `"tags": tags_of(db, entry, "free"),` 를 넣는다.
- `snapshot` 의 키 목록 `("title", "analysis_type", "description", "analysis_period", "zones")` 에 `"tags"` 를 더한다.
- `update_entry` 의 `if "zones" in patch:` 다음에 넣는다:

```python
    if "tags" in patch:
        set_tags(db, entry, "free", patch["tags"] or [])
```

- `backend/app/entries/files.py` `write_entry_files` 의 meta 키 튜플에 `"tags"` 를 더한다(`"zones"` 다음). `_INFO.txt` 의 구역 줄 다음에 `f"태그: {', '.join(d['tags']) or '-'}\n"` 를 넣는다.
- `backend/app/routers/entries.py` `EntryPatch` 에 `tags: list[str] | None = None`
- `backend/app/routers/suggest.py`
  - `kind` 패턴을 `"^(hull|zone|tag|analysis_type)$"` 로 바꾼다.
  - zone 분기를 `elif kind in ("zone", "tag"):` 로 바꾼다.
  - 필터를 `models.Tag.kind == ("zone" if kind == "zone" else "free")` 로 바꾼다.
- `backend/app/main.py` — `from .routers import ... tags ...` 와 `app.include_router(tags.router)` 를 더한다. 이름이 겹치지 않게 `from .routers import tags as tags_router` 로 import 하고 `app.include_router(tags_router.router)` 로 등록한다.

- [ ] **Step 4: 통과 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_tags.py tests/test_entry_service.py tests/test_entries_api.py tests/test_suggest_api.py tests/test_confirm.py -v`
Expected: PASS

- [ ] **Step 5: 커밋(사람)** — `feat: 03a 태그 동의어·자유 태그`

---

### Task 6: 검색 모듈과 `/api/search`

**Files:**
- Create: `backend/app/search/__init__.py`, `backend/app/search/base.py`, `backend/app/search/snippets.py`, `backend/app/search/mysql_backend.py`, `backend/app/routers/search.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_search_snippets.py`, `backend/tests/test_search.py`

**검색 규칙**(이 태스크의 명세):

1. **낱말 나누기.** 검색어를 공백으로 나눈다(최대 8낱말, 전체 200자). 모든 낱말이 Entry 의 어딘가에 맞아야 결과에 든다(AND).
2. **낱말별 점수.** Entry 마다 그 낱말이 맞은 곳 중 가장 높은 점수 하나만 친다.

   | 맞은 곳 | 점수 |
   |---|---|
   | Entry 번호 일치 | 100 |
   | 호선 일치 | 100 |
   | 제목 완전 일치(대소문자 무시) | 90 |
   | 제목 포함 | 70 |
   | 태그·구역 포함(동의어 묶음 전체로 확장) | 50 |
   | 해석 종류 포함 | 50 |
   | 설명 포함 | 40 |
   | 파일명 포함 | 30 |
   | 본문 | 10 |

   본문은 FULLTEXT ngram 구절 검색이다. 2글자 미만 낱말은 본문을 찾지 않는다(ngram 토큰이 2글자라서).
3. **순위.** 낱말별 점수의 합이 높은 순이다. 같으면 최근 순(확정 시각, 없으면 생성 시각), 그다음 id 역순이다. 검색어가 없으면 최근 순이다.
4. **대상.** 기본은 확정 Entry 만이다. `drafts=true` 면 초안도 넣는다. 휴지통은 넣지 않는다.
5. **필터**: `hull`, `ship_type`, `analysis_type`, `zone`(동의어 묶음), `year`, `uploaded_by`, `kind`(그 종류 파일이 있는 Entry).
   - 연도는 `analysis_period` 앞 4자리를 쓴다. 없으면 확정 연도, 그것도 없으면 생성 연도다.
6. **필터 건수**(`facets`).
   - 각 차원의 건수는 **그 차원 필터만 뺀** 나머지 필터를 적용해 센다. 예를 들어 호선 9999 를 골라도 호선 목록에는 다른 호선 건수가 계속 보인다.
   - 구역 건수는 대표 태그 값으로 모은다.
   - 차원마다 건수 많은 순으로 최대 30개를 준다.
7. **발췌문.** 본문이 맞은 Entry 는 파일 조각 최대 3개를 준다: `file_id`, 파일명, `locator`, 발췌문, 강조 위치 `[[시작, 끝], ...]`.
   - 발췌문은 앞뒤 80자이고 줄바꿈은 공백으로 바꾼다. HTML 이 아닌 글자 위치로 주어 XSS 걱정이 없다.
8. **호선 필터 제안.** 4자리 숫자 낱말이 있고 호선 필터가 그 값이 아니면 `hull_suggestion: {"hull_no", "known"}` 을 준다. 자동으로 적용하지는 않는다(설계 §6.2).
9. **파일 보기**(`unit=file`).
   - 필터를 통과한 Entry 의 파일(휴지통 제외) 가운데, 모든 낱말이 "파일(이름·본문) 또는 그 Entry" 에 맞는 파일을 보여 준다. 적어도 한 낱말은 파일 자체에 맞아야 한다.
   - 점수는 낱말마다 파일 점수와 Entry 점수 중 큰 값의 합이다.
   - 검색어가 없으면 모든 파일을 보여 준다. `kind` 필터는 파일 종류에 바로 적용한다.

- [ ] **Step 1: 실패하는 테스트 작성 — 발췌문**

`backend/tests/test_search_snippets.py`:

```python
from app.search.snippets import make_snippet


def test_snippet_centers_on_first_hit_with_highlights():
    text = "가" * 200 + "구조 강도 평가" + "나" * 200
    s = make_snippet(text, ["강도"], width=10)
    assert s["text"].startswith("…") and s["text"].endswith("…")
    start, end = s["highlights"][0]
    assert s["text"][start:end] == "강도"


def test_snippet_multiple_terms_and_case_insensitive():
    s = make_snippet("HULL No 9999 strength\nreview", ["hull", "REVIEW"], width=80)
    assert s["text"] == "HULL No 9999 strength review"
    assert [s["text"][a:b] for a, b in s["highlights"]] == ["HULL", "review"]


def test_snippet_merges_overlaps():
    s = make_snippet("aaaa", ["aa", "aaa"], width=10)
    assert s["highlights"] == [[0, 4]]


def test_snippet_without_hit_uses_head():
    s = make_snippet("x" * 500, ["없음"], width=80)
    assert s["text"] == "x" * 160 + "…" and s["highlights"] == []
```

- [ ] **Step 2: 실패하는 테스트 작성 — 검색**

`backend/tests/test_search.py`:

```python
from datetime import datetime

import pytest

from app import models
from app.search import SearchQuery, get_search


def _q(db, q="", **kw):
    filters = kw.pop("filters", {})
    return get_search().search(db, SearchQuery(q=q, filters=filters, **kw))


def _ids(res):
    return [i["entry_id"] for i in res["items"]]


def _text(db, f, text, locator="page:1"):
    db.add(models.FileText(file_id=f.id, seq=0, locator=locator, text=text))
    db.commit()


@pytest.fixture
def corpus(db, make_entry_file):
    """E1: 9999 계류 검토(보고서 본문 '선체 구조 강도'), E2: 9998 갑판 강도, E3: 초안, E4: 휴지통."""
    e1, f1 = make_entry_file(title="계류 구조 검토", hulls=("9999",), name="9999_mooring.pptx",
                             analysis_type="Mooring", period="2026-08", confirmed_at=datetime(2026, 9, 2))
    make_entry_file(entry=e1, name="model.bdf", kind="model")
    _text(db, f1, "보고서 표지\n선체 구조 강도 평가 결과 허용응력 이내", locator="slide:3")
    e2, f2 = make_entry_file(title="갑판 강도", hulls=("9998",), name="deck.xlsx", uploaded_by="A100002",
                             analysis_type="Strength", confirmed_at=datetime(2026, 9, 5))
    e3, _ = make_entry_file(status="draft", title="계류 초안", hulls=("9999",), name="draft.pdf")
    e4, _ = make_entry_file(status="trashed", title="계류 버림", hulls=("9999",), name="trash.pdf")
    db.add(models.Hull(hull_no="9998", ship_type="LNGC")) if db.get(models.Hull, "9998") is None else None
    db.get(models.Hull, "9998").ship_type = "LNGC"
    db.commit()
    return {"e1": e1, "e2": e2, "e3": e3, "e4": e4, "f1": f1, "f2": f2}


def test_empty_query_lists_confirmed_recent_first(db, corpus):
    res = _q(db)
    assert _ids(res) == [corpus["e2"].entry_id, corpus["e1"].entry_id]
    assert res["total"] == 2


def test_drafts_included_on_request_never_trash(db, corpus):
    ids = _ids(_q(db, include_drafts=True))
    assert corpus["e3"].entry_id in ids and corpus["e4"].entry_id not in ids


def test_hull_exact_ranks_first(db, corpus):
    res = _q(db, "9999")
    assert _ids(res) == [corpus["e1"].entry_id]
    assert "hull" in res["items"][0]["matched"]


def test_body_match_with_snippet(db, corpus):
    res = _q(db, "강도")
    assert _ids(res) == [corpus["e2"].entry_id, corpus["e1"].entry_id]  # 제목 70 > 본문 10
    item = next(i for i in res["items"] if i["entry_id"] == corpus["e1"].entry_id)
    snip = item["snippets"][0]
    assert snip["file_id"] == corpus["f1"].id and snip["locator"] == "slide:3"
    a, b = snip["highlights"][0]
    assert snip["text"][a:b] == "강도"


def test_all_terms_must_match(db, corpus):
    assert _ids(_q(db, "9999 강도")) == [corpus["e1"].entry_id]
    assert _ids(_q(db, "9998 계류")) == []


def test_filename_match(db, corpus):
    res = _q(db, "mooring")
    assert _ids(res) == [corpus["e1"].entry_id] and "file" in res["items"][0]["matched"]


def test_like_wildcards_are_literal(db, corpus):
    assert _q(db, "%")["total"] == 0 and _q(db, "_")["total"] == 0


def test_tag_alias_expansion(db, corpus):
    bow = models.Tag(kind="zone", value="선수부")
    db.add(bow)
    db.flush()
    fwd = models.Tag(kind="zone", value="FWD", alias_of_id=bow.id)
    db.add(fwd)
    db.flush()
    db.add(models.EntryTag(entry_id=corpus["e2"].id, tag_id=fwd.id))
    db.commit()
    assert _ids(_q(db, "선수부")) == [corpus["e2"].entry_id]
    assert _ids(_q(db, filters={"zone": "선수부"})) == [corpus["e2"].entry_id]
    zone_facet = _q(db)["facets"]["zone"]
    assert zone_facet == [{"value": "선수부", "count": 1}]


def test_filters_and_disjunctive_facets(db, corpus):
    res = _q(db, filters={"hull": "9999"})
    assert _ids(res) == [corpus["e1"].entry_id]
    hull_counts = {f["value"]: f["count"] for f in res["facets"]["hull"]}
    assert hull_counts == {"9999": 1, "9998": 1}  # 자기 필터는 빼고 센다
    assert res["facets"]["analysis_type"] == [{"value": "Mooring", "count": 1}]
    kinds = {f["value"]: f["count"] for f in res["facets"]["kind"]}
    assert kinds == {"report": 1, "model": 1}


def test_other_filters(db, corpus):
    assert _ids(_q(db, filters={"ship_type": "LNGC"})) == [corpus["e2"].entry_id]
    assert _ids(_q(db, filters={"year": "2026"})) == [corpus["e2"].entry_id, corpus["e1"].entry_id]
    assert _ids(_q(db, filters={"uploaded_by": "A100002"})) == [corpus["e2"].entry_id]
    assert _ids(_q(db, filters={"kind": "model"})) == [corpus["e1"].entry_id]
    assert _ids(_q(db, filters={"analysis_type": "Strength"})) == [corpus["e2"].entry_id]


def test_year_prefers_analysis_period(db, corpus, make_entry_file):
    e, _ = make_entry_file(title="옛 해석", period="2019-03", confirmed_at=datetime(2026, 9, 9))
    assert _ids(_q(db, filters={"year": "2019"})) == [e.entry_id]


def test_uploaded_by_facet_has_name(db, corpus, make_user):
    make_user("A100002", name="김해석")
    labels = {f["value"]: f.get("label") for f in _q(db)["facets"]["uploaded_by"]}
    assert labels["A100002"] == "김해석"


def test_hull_suggestion(db, corpus):
    assert _q(db, "9999 강도")["hull_suggestion"] == {"hull_no": "9999", "known": True}
    assert _q(db, "1234")["hull_suggestion"] == {"hull_no": "1234", "known": False}
    assert _q(db, "9999", filters={"hull": "9999"})["hull_suggestion"] is None
    assert _q(db, "강도")["hull_suggestion"] is None


def test_paging(db, corpus):
    res = _q(db, limit=1, offset=1)
    assert res["total"] == 2 and _ids(res) == [corpus["e1"].entry_id]


def test_file_unit(db, corpus):
    res = _q(db, "강도", unit="file")
    # deck.xlsx 는 Entry 제목만 맞고 파일 자체(이름·본문)는 안 맞아서 빠진다(규칙 9).
    assert [i["name"] for i in res["items"]] == ["9999_mooring.pptx"]
    item = res["items"][0]
    assert item["entry_id"] == corpus["e1"].entry_id and item["snippets"]
    assert [i["name"] for i in _q(db, "", unit="file", filters={"kind": "model"})["items"]] == ["model.bdf"]


def test_item_shape(db, corpus):
    item = _q(db, "9999")["items"][0]
    for key in ("entry_id", "title", "status", "analysis_type", "analysis_period", "hulls", "zones", "tags",
                "uploaded_by", "confirmed_at", "file_count", "kinds", "score", "matched", "snippets"):
        assert key in item
    assert item["file_count"] == 2 and sorted(item["kinds"]) == ["model", "report"]


def test_search_api(client, db, corpus, make_user, auth_headers):
    make_user("A100001")
    assert client.get("/api/search?q=9999").status_code == 401
    res = client.get("/api/search?q=9999&drafts=true", headers=auth_headers("A100001"))
    assert res.status_code == 200
    assert {i["entry_id"] for i in res.json()["items"]} == {corpus["e1"].entry_id, corpus["e3"].entry_id}
    res = client.get("/api/search?hull=9998&unit=file", headers=auth_headers("A100001"))
    assert [i["name"] for i in res.json()["items"]] == ["deck.xlsx"]
    assert client.get("/api/search?unit=bad", headers=auth_headers("A100001")).status_code == 422
```

(`corpus` 픽스처의 `db.add(...) if ... else None` 줄은 문법상 동작하지만 읽기 어렵다. 구현 중에 `if db.get(...) is None: db.add(...)` 두 줄로 고쳐도 된다.)

- [ ] **Step 3: 실패 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_search_snippets.py tests/test_search.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.search'`

- [ ] **Step 4: 구현**

`backend/app/search/base.py`:

```python
"""검색 인터페이스(설계 §6.2 — 나중에 Meilisearch 로 바꿀 때 구현만 교체한다)."""
from dataclasses import dataclass, field
from typing import Protocol

from sqlalchemy.orm import Session

FILTER_KEYS = ("hull", "ship_type", "analysis_type", "zone", "year", "uploaded_by", "kind")


@dataclass
class SearchQuery:
    q: str = ""
    unit: str = "entry"               # entry | file
    filters: dict = field(default_factory=dict)
    include_drafts: bool = False
    limit: int = 50
    offset: int = 0


class SearchBackend(Protocol):
    def search(self, db: Session, query: SearchQuery) -> dict: ...
```

`backend/app/search/snippets.py`:

```python
"""본문 발췌문 — 강조는 HTML 이 아니라 글자 위치로 준다(화면이 안전하게 칠한다)."""


def make_snippet(text: str, terms: list[str], width: int = 80) -> dict:
    low = text.lower()
    hits = [p for p in (low.find(t.lower()) for t in terms if t) if p >= 0]
    if not hits:
        head = text[: width * 2].replace("\n", " ")
        return {"text": head + ("…" if len(text) > len(head) else ""), "highlights": []}
    pos = min(hits)
    start, end = max(0, pos - width), min(len(text), pos + width)
    prefix = "…" if start > 0 else ""
    body = text[start:end].replace("\n", " ")
    out = prefix + body + ("…" if end < len(text) else "")
    body_low = body.lower()
    spans = []
    for t in terms:
        t = t.lower()
        if not t:
            continue
        i = body_low.find(t)
        while i >= 0:
            spans.append([i + len(prefix), i + len(prefix) + len(t)])
            i = body_low.find(t, i + 1)
    spans.sort()
    merged: list[list[int]] = []
    for s in spans:
        if merged and s[0] <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], s[1])
        else:
            merged.append(s)
    return {"text": out, "highlights": merged}
```

`backend/app/search/mysql_backend.py`:

```python
"""MySQL 검색 구현 — LIKE(메타데이터·파일명) + FULLTEXT ngram(본문).

Entry 수가 수만 건을 넘지 않는다는 전제로, 후보 Entry 의 필터용 속성을 한 번에 읽어
파이썬에서 거르고 센다(필터 건수를 "자기 필터만 뺀" 방식으로 세기 쉽다). 규모가 커지면
이 모듈만 Meilisearch 구현으로 바꾼다(base.SearchBackend)."""
import re
from collections import Counter, defaultdict
from datetime import datetime

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from .. import models
from ..tags import group_ids
from .base import FILTER_KEYS, SearchQuery
from .snippets import make_snippet

MAX_TERMS = 8
MAX_SNIPPETS = 3
FACET_LIMIT = 30
HULL_TERM = re.compile(r"^[0-9]{4}$")
S_ID, S_HULL, S_TITLE_EXACT, S_TITLE, S_TAG, S_TYPE, S_DESC, S_FILE, S_BODY = 100, 100, 90, 70, 50, 50, 40, 30, 10
_EPOCH = datetime(1970, 1, 1)


def _like(term: str) -> str:
    return "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _phrase(term: str) -> str | None:
    cleaned = term.replace('"', " ").strip()
    return f'"{cleaned}"' if len(cleaned) >= 2 else None


_MATCH = "MATCH(file_texts.text) AGAINST (:p IN BOOLEAN MODE)"


class _Hits:
    """낱말 하나의 적중 — Entry pk → (점수, 맞은 곳), 파일 id → (점수, 맞은 곳)."""

    def __init__(self):
        self.entries: dict[int, tuple[int, str]] = {}
        self.files: dict[int, tuple[int, str]] = {}

    def entry(self, eid: int, score: int, where: str) -> None:
        if score > self.entries.get(eid, (0, ""))[0]:
            self.entries[eid] = (score, where)

    def file(self, fid: int, score: int, where: str) -> None:
        if score > self.files.get(fid, (0, ""))[0]:
            self.files[fid] = (score, where)


class MySqlSearch:
    def search(self, db: Session, query: SearchQuery) -> dict:
        statuses = ("confirmed", "draft") if query.include_drafts else ("confirmed",)
        terms = [t for t in query.q.split()][:MAX_TERMS]
        filters = {k: str(v) for k, v in (query.filters or {}).items() if k in FILTER_KEYS and v}

        hits = [self._term_hits(db, t, statuses) for t in terms]
        if terms:
            ids = set(hits[0].entries)
            for h in hits[1:]:
                ids &= set(h.entries)
        else:
            ids = {i for (i,) in db.query(models.Entry.id).filter(models.Entry.status.in_(statuses))}

        rows = self._rows(db, ids)
        zone_root = self._zone_root(db, filters.get("zone"))
        passed = [r for r in rows.values() if self._passes(r, filters, zone_root)]
        facets = self._facets(db, rows.values(), filters, zone_root)
        suggestion = self._hull_suggestion(db, terms, filters)

        if query.unit == "file":
            items, total = self._file_items(db, passed, terms, hits, filters, query)
        else:
            for r in passed:
                r["score"] = sum(h.entries[r["id"]][0] for h in hits)
                r["matched"] = sorted({h.entries[r["id"]][1] for h in hits})
            passed.sort(key=lambda r: (-r["score"], -(r["sort_at"] - _EPOCH).total_seconds(), -r["id"]))
            total = len(passed)
            page = passed[query.offset: query.offset + query.limit]
            items = [self._entry_item(db, r, terms, hits) for r in page]
        return {"unit": query.unit, "total": total, "items": items, "facets": facets,
                "hull_suggestion": suggestion, "terms": terms}

    # ---- 낱말 적중 ----
    def _term_hits(self, db: Session, term: str, statuses) -> _Hits:
        h = _Hits()
        E, F = models.Entry, models.File
        like = _like(term)
        live = E.status.in_(statuses)
        for (eid,) in db.query(E.id).filter(live, E.entry_id == term.upper()):
            h.entry(eid, S_ID, "entry_id")
        for (eid,) in (db.query(models.EntryHull.entry_id).join(E, E.id == models.EntryHull.entry_id)
                       .filter(live, models.EntryHull.hull_no == term)):
            h.entry(eid, S_HULL, "hull")
        for eid, title in db.query(E.id, E.title).filter(live, E.title.like(like, escape="\\")):
            h.entry(eid, S_TITLE_EXACT if title.lower() == term.lower() else S_TITLE, "title")
        tag_ids = [i for (i,) in db.query(models.Tag.id).filter(models.Tag.value.like(like, escape="\\"))]
        if tag_ids:
            for (eid,) in (db.query(models.EntryTag.entry_id).join(E, E.id == models.EntryTag.entry_id)
                           .filter(live, models.EntryTag.tag_id.in_(group_ids(db, tag_ids)))):
                h.entry(eid, S_TAG, "tag")
        for (eid,) in db.query(E.id).filter(live, E.analysis_type.like(like, escape="\\")):
            h.entry(eid, S_TYPE, "analysis_type")
        for (eid,) in db.query(E.id).filter(live, E.description.like(like, escape="\\")):
            h.entry(eid, S_DESC, "description")
        for fid, eid in (db.query(F.id, F.entry_id).join(E, E.id == F.entry_id)
                         .filter(live, F.location != "trash", F.name.like(like, escape="\\"))):
            h.entry(eid, S_FILE, "file")
            h.file(fid, S_FILE, "file")
        phrase = _phrase(term)
        if phrase:
            q = (db.query(models.FileText.file_id, F.entry_id).join(F, F.id == models.FileText.file_id)
                 .join(E, E.id == F.entry_id)
                 .filter(live, F.location != "trash", sql_text(_MATCH).bindparams(p=phrase)).distinct())
            for fid, eid in q:
                h.entry(eid, S_BODY, "body")
                h.file(fid, S_BODY, "body")
        return h

    # ---- 필터용 속성 ----
    def _rows(self, db: Session, ids: set[int]) -> dict[int, dict]:
        if not ids:
            return {}
        rows: dict[int, dict] = {}
        id_list = list(ids)
        for e in db.query(models.Entry).filter(models.Entry.id.in_(id_list)):
            year = (e.analysis_period or "")[:4] or str((e.confirmed_at or e.created_at).year)
            rows[e.id] = {"id": e.id, "entry": e, "hulls": [], "ship_types": set(), "zones": set(),
                          "kinds": set(), "file_count": 0, "year": year,
                          "analysis_type": e.analysis_type, "uploaded_by": e.uploaded_by,
                          "sort_at": e.confirmed_at or e.created_at}
        hull_rows = (db.query(models.EntryHull.entry_id, models.EntryHull.hull_no, models.Hull.ship_type)
                     .outerjoin(models.Hull, models.Hull.hull_no == models.EntryHull.hull_no)
                     .filter(models.EntryHull.entry_id.in_(id_list))
                     .order_by(models.EntryHull.is_primary.desc(), models.EntryHull.hull_no))
        for eid, hull_no, ship in hull_rows:
            rows[eid]["hulls"].append(hull_no)
            if ship:
                rows[eid]["ship_types"].add(ship)
        tag_rows = (db.query(models.EntryTag.entry_id, models.Tag)
                    .join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
                    .filter(models.EntryTag.entry_id.in_(id_list), models.Tag.kind == "zone"))
        roots = {}
        for eid, tag in tag_rows:
            if tag.alias_of_id and tag.alias_of_id not in roots:
                roots[tag.alias_of_id] = db.get(models.Tag, tag.alias_of_id).value
            rows[eid]["zones"].add(roots[tag.alias_of_id] if tag.alias_of_id else tag.value)
        for eid, kind, n in (db.query(models.File.entry_id, models.File.kind, models.File.id)
                             .filter(models.File.entry_id.in_(id_list), models.File.location != "trash")):
            rows[eid]["kinds"].add(kind)
            rows[eid]["file_count"] += 1
        return rows

    def _zone_root(self, db: Session, zone: str | None) -> str | None:
        if not zone:
            return None
        tag = db.query(models.Tag).filter(models.Tag.kind == "zone", models.Tag.value == zone).first()
        if tag is None:
            return zone
        return db.get(models.Tag, tag.alias_of_id).value if tag.alias_of_id else tag.value

    @staticmethod
    def _values(r: dict, key: str) -> list[str]:
        if key == "hull":
            return r["hulls"]
        if key == "ship_type":
            return sorted(r["ship_types"])
        if key == "zone":
            return sorted(r["zones"])
        if key == "kind":
            return sorted(r["kinds"])
        v = r[key]
        return [v] if v else []

    def _passes(self, r: dict, filters: dict, zone_root: str | None, skip: str | None = None) -> bool:
        for key, val in filters.items():
            if key == skip:
                continue
            want = zone_root if key == "zone" else val
            if want not in self._values(r, key):
                return False
        return True

    def _facets(self, db: Session, rows, filters: dict, zone_root: str | None) -> dict:
        rows = list(rows)
        out = {}
        for key in FILTER_KEYS:
            c = Counter()
            for r in rows:
                if self._passes(r, filters, zone_root, skip=key):
                    c.update(self._values(r, key))
            out[key] = [{"value": v, "count": n} for v, n in sorted(c.items(), key=lambda x: (-x[1], x[0]))][:FACET_LIMIT]
        names = dict(db.query(models.User.employee_id, models.User.name)
                     .filter(models.User.employee_id.in_([f["value"] for f in out["uploaded_by"]] or [""])))
        for f in out["uploaded_by"]:
            f["label"] = names.get(f["value"])
        return out

    def _hull_suggestion(self, db: Session, terms: list[str], filters: dict) -> dict | None:
        for t in terms:
            if HULL_TERM.fullmatch(t) and filters.get("hull") != t:
                return {"hull_no": t, "known": db.get(models.Hull, t) is not None}
        return None

    # ---- 결과 항목 ----
    def _snippets(self, db: Session, file_ids: list[int], terms: list[str]) -> list[dict]:
        if not file_ids:
            return []
        phrases = [p for p in (_phrase(t) for t in terms) if p]
        if not phrases:
            return []
        q = (db.query(models.FileText, models.File.name).join(models.File, models.File.id == models.FileText.file_id)
             .filter(models.FileText.file_id.in_(file_ids),
                     sql_text("MATCH(file_texts.text) AGAINST (:p IN BOOLEAN MODE)").bindparams(p=" ".join(phrases)))
             .order_by(models.FileText.file_id, models.FileText.seq).limit(MAX_SNIPPETS))
        return [{"file_id": ft.file_id, "name": name, "locator": ft.locator, **make_snippet(ft.text, terms)}
                for ft, name in q]

    def _entry_item(self, db: Session, r: dict, terms: list[str], hits: list[_Hits]) -> dict:
        e = r["entry"]
        body_files = sorted({fid for h in hits for fid, (_s, where) in h.files.items() if where == "body"})
        body_files = [fid for fid in body_files
                      if db.query(models.File.id).filter_by(id=fid, entry_id=e.id).first()]
        return {
            "entry_id": e.entry_id, "title": e.title, "status": e.status, "analysis_type": e.analysis_type,
            "analysis_period": e.analysis_period, "hulls": r["hulls"], "ship_types": sorted(r["ship_types"]),
            "zones": sorted(r["zones"]),
            "tags": [v for (v,) in db.query(models.Tag.value).join(models.EntryTag, models.EntryTag.tag_id == models.Tag.id)
                     .filter(models.EntryTag.entry_id == e.id, models.Tag.kind == "free").order_by(models.Tag.value)],
            "uploaded_by": e.uploaded_by,
            "confirmed_at": e.confirmed_at.isoformat() if e.confirmed_at else None,
            "file_count": r["file_count"], "kinds": sorted(r["kinds"]),
            "score": r.get("score", 0), "matched": r.get("matched", []),
            "snippets": self._snippets(db, body_files, terms),
        }

    def _file_items(self, db: Session, passed: list[dict], terms: list[str], hits: list[_Hits],
                    filters: dict, query: SearchQuery) -> tuple[list[dict], int]:
        by_entry = {r["id"]: r for r in passed}
        if not by_entry:
            return [], 0
        q = db.query(models.File).filter(models.File.entry_id.in_(list(by_entry)), models.File.location != "trash")
        if filters.get("kind"):
            q = q.filter(models.File.kind == filters["kind"])
        scored = []
        for f in q:
            score, matched, own = 0, set(), False
            ok = True
            for h in hits:
                fs = h.files.get(f.id)
                es = h.entries.get(f.entry_id)
                best = max((fs or (0, ""))[0], (es or (0, ""))[0])
                if best == 0:
                    ok = False
                    break
                if fs:
                    own = True
                    matched.add(fs[1])
                score += best
            if not ok or (terms and not own):
                continue
            scored.append((score, f, sorted(matched)))
        scored.sort(key=lambda x: (-x[0], -(by_entry[x[1].entry_id]["sort_at"] - _EPOCH).total_seconds(), x[1].id))
        total = len(scored)
        items = []
        for score, f, matched in scored[query.offset: query.offset + query.limit]:
            r = by_entry[f.entry_id]
            items.append({"file_id": f.id, "name": f.name, "rel_path": f.rel_path, "kind": f.kind, "size": f.size,
                          "entry_id": r["entry"].entry_id, "entry_title": r["entry"].title,
                          "entry_status": r["entry"].status, "hulls": r["hulls"], "score": score,
                          "matched": matched,
                          "snippets": self._snippets(db, [f.id] if "body" in matched else [], terms)})
        return items, total
```

`backend/app/search/__init__.py`:

```python
from .base import FILTER_KEYS, SearchBackend, SearchQuery
from .mysql_backend import MySqlSearch

_backend: SearchBackend = MySqlSearch()


def get_search() -> SearchBackend:
    return _backend


__all__ = ["FILTER_KEYS", "SearchBackend", "SearchQuery", "get_search"]
```

`backend/app/routers/search.py`:

```python
"""검색 API(설계 §6.2)."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..dependencies import require_auth
from ..search import SearchQuery, get_search

router = APIRouter(prefix="/api", tags=["search"])


@router.get("/search")
def search(q: str = "", unit: str = Query(default="entry", pattern="^(entry|file)$"),
           hull: str | None = None, ship_type: str | None = None, analysis_type: str | None = None,
           zone: str | None = None, year: str | None = None, uploaded_by: str | None = None,
           kind: str | None = None, drafts: bool = False,
           limit: int = Query(default=50, ge=1, le=200), offset: int = Query(default=0, ge=0),
           db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    filters = {"hull": hull, "ship_type": ship_type, "analysis_type": analysis_type, "zone": zone,
               "year": year, "uploaded_by": uploaded_by, "kind": kind}
    query = SearchQuery(q=q.strip()[:200], unit=unit, filters={k: v for k, v in filters.items() if v},
                        include_drafts=drafts, limit=limit, offset=offset)
    return get_search().search(db, query)
```

`backend/app/main.py` 에 `search` 라우터를 등록한다.

구현 메모:
- `_entry_item` 의 `body_files` 거르기는 파일마다 쿼리를 한 번씩 보낸다. 페이지당 최대 50건이라 괜찮다. 다만 `h.files` 를 모을 때 `entry_id` 도 같이 담아 두면 쿼리 없이 거를 수 있다. 그 방식으로 바꿔도 된다(권장).
- `_rows` 의 `File` 쿼리 변수명 `n` 은 쓰지 않는다. `_fid` 로 바꾼다.

- [ ] **Step 5: 통과 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_search_snippets.py tests/test_search.py -v`
Expected: PASS

Run: `.venv\Scripts\python.exe -m pytest -q`
Expected: 전체 PASS

- [ ] **Step 6: 커밋(사람)** — `feat: 03a 검색 모듈·필터 건수·본문 발췌`

---

### Task 7: Entry 상세 — 추출 정보·경로·변경 이력

**Files:**
- Modify: `backend/app/entries/service.py`, `backend/app/routers/entries.py`
- Test: `backend/tests/test_entry_detail.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_entry_detail.py`:

```python
from app import audit, models
from app.entries import service


def test_files_include_extract(db, make_entry_file):
    e, f = make_entry_file(name="r.pdf")
    make_entry_file(entry=e, name="m.bdf", kind="model")
    db.add(models.FileExtract(file_id=f.id, state="done", summary={"unit": "page", "count": 3}))
    db.commit()
    d = service.entry_to_dict(db, e)
    by_name = {x["name"]: x for x in d["files"]}
    assert by_name["r.pdf"]["extract"] == {"state": "done", "error": None, "summary": {"unit": "page", "count": 3}}
    assert by_name["m.bdf"]["extract"] is None


def test_get_entry_has_vault_unc(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    e, _f = make_entry_file(status="confirmed")
    d, _ = make_entry_file(status="draft")
    h = auth_headers("A100001")
    res = client.get(f"/api/entries/{e.entry_id}", headers=h)
    assert res.json()["vault_unc"] == str(storage.vault / "2026" / e.entry_id)
    assert client.get(f"/api/entries/{d.entry_id}", headers=h).json()["vault_unc"] is None


def test_history(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001", name="홍길동")
    e, _f = make_entry_file(status="confirmed")
    audit.record(db, storage, actor="A100001", action="ENTRY_CONFIRM", target_type="entry", target_id=e.entry_id)
    audit.record(db, storage, actor="A100001", action="ENTRY_UPDATE", target_type="entry", target_id=e.entry_id,
                 before={"title": "a"}, after={"title": "b"})
    audit.record(db, storage, actor="A100001", action="ENTRY_UPDATE", target_type="entry", target_id="E999999")
    res = client.get(f"/api/entries/{e.entry_id}/history", headers=auth_headers("A100001"))
    rows = res.json()
    assert [r["action"] for r in rows] == ["ENTRY_UPDATE", "ENTRY_CONFIRM"]
    assert rows[0]["name"] == "홍길동" and rows[0]["before"] == {"title": "a"} and rows[0]["at"]


def test_history_404(client, make_user, auth_headers):
    make_user("A100001")
    assert client.get("/api/entries/E999999/history", headers=auth_headers("A100001")).status_code == 404
```

- [ ] **Step 2: 실패 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_entry_detail.py -v`
Expected: FAIL — `KeyError: 'extract'`

- [ ] **Step 3: 구현**

`backend/app/entries/service.py`:

```python
def file_to_dict(f: models.File, duplicate_entries: dict[int, str] | None = None,
                 extracts: dict[int, models.FileExtract] | None = None) -> dict:
    x = (extracts or {}).get(f.id)
    return {"id": f.id, "rel_path": f.rel_path, "name": f.name, "kind": f.kind, "size": f.size,
            "sha256": f.sha256, "drm_encrypted": f.drm_encrypted, "duplicate_of_id": f.duplicate_of_id,
            "duplicate_of_entry": (duplicate_entries or {}).get(f.duplicate_of_id),
            "location": f.location,
            "extract": {"state": x.state, "error": x.error, "summary": x.summary} if x else None}
```

`entry_to_dict` 안, `dup_entries` 를 만든 다음 줄에 넣는다:

```python
    extracts = {x.file_id: x for x in db.query(models.FileExtract)
                .filter(models.FileExtract.file_id.in_([f.id for f in files]))} if files else {}
```

`"files": [file_to_dict(f, dup_entries, extracts) for f in files],` 로 바꾼다.

`backend/app/routers/entries.py`:

```python
from ..entries.files import entry_dir


def _detail(db: Session, storage: StoragePaths, e: models.Entry) -> dict:
    d = service.entry_to_dict(db, e)
    d["vault_unc"] = str(entry_dir(storage, e)) if e.status == "confirmed" and e.vault_rel else None
    return d


@router.get("/entries/{entry_id}")
def get_entry(entry_id: str, db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
              user: models.User = Depends(require_auth)):
    return _detail(db, storage, _entry(db, entry_id))


@router.get("/entries/{entry_id}/history")
def entry_history(entry_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    e = _entry(db, entry_id)
    rows = (db.query(models.AuditLog).filter_by(target_type="entry", target_id=e.entry_id)
            .order_by(models.AuditLog.at.desc(), models.AuditLog.id.desc()).limit(200).all())
    names = dict(db.query(models.User.employee_id, models.User.name)
                 .filter(models.User.employee_id.in_({r.employee_id for r in rows if r.employee_id} or {""})))
    return [{"at": r.at.isoformat(), "employee_id": r.employee_id, "name": names.get(r.employee_id),
             "action": r.action, "before": r.before, "after": r.after} for r in rows]
```

`patch_entry`·`confirm_entry`·`restore_entry` 의 응답도 `_detail(db, storage, e)` 로 바꾼다. 화면이 수정 응답으로 상태를 갈아끼울 때 `vault_unc` 가 사라지면 안 되기 때문이다. `get_entry` 는 원래 `storage` 를 받지 않았으므로 의존성을 새로 더한다.

- [ ] **Step 4: 통과 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_entry_detail.py tests/test_entries_api.py tests/test_entry_service.py tests/test_batches_api.py -v`
Expected: PASS

- [ ] **Step 5: 커밋(사람)** — `feat: 03a Entry 상세 추출 정보·경로·변경 이력`

---

### Task 8: 호선 API — 목록·상세(통계·월별 타임라인)·수정

**Files:**
- Create: `backend/app/hull_info.py`, `backend/app/routers/hulls.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_hulls_api.py`

규칙:
- 호선 화면은 **확정 Entry** 만 센다. 초안 수는 `drafts` 로 따로 준다.
- 타임라인 월은 `analysis_period` 를 쓴다. 없으면 확정 월, 그것도 없으면 생성 월이다. 최근 월이 먼저 온다.
- 상세는 `Hull` 행도 Entry 도 없으면 404 `hull_not_found` 다.
- 수정(`ship_type`·`memo`)은 `Hull` 행이 없으면 만든다(호선 번호는 4자리 숫자여야 한다). 그리고 `HULL_UPDATE` 로 기록한다.
  - 선종은 그 호선 Entry 들의 `entry.json` 에도 들어간다. 그래서 확정 Entry 마다 `write_meta` 작업을 건다.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_hulls_api.py`:

```python
from datetime import datetime

from app import models


def _setup(db, make_entry_file, make_user):
    make_user("A100001", name="홍길동")
    make_user("A100002", name="김해석")
    e1, _ = make_entry_file(title="계류 검토", hulls=("9999",), name="a.pptx", analysis_type="Mooring",
                            period="2026-08", confirmed_at=datetime(2026, 9, 2))
    make_entry_file(entry=e1, name="m.bdf", kind="model")
    e2, _ = make_entry_file(title="갑판 강도", hulls=("9999", "9998"), name="b.pdf", uploaded_by="A100002",
                            analysis_type="Strength", confirmed_at=datetime(2026, 9, 5))
    make_entry_file(status="draft", title="초안", hulls=("9999",), name="c.pdf")
    zone = models.Tag(kind="zone", value="선수부")
    db.add(zone)
    db.flush()
    db.add(models.EntryTag(entry_id=e1.id, tag_id=zone.id))
    db.commit()
    return e1, e2


def test_hull_detail(client, db, make_entry_file, make_user, auth_headers):
    e1, e2 = _setup(db, make_entry_file, make_user)
    res = client.get("/api/hulls/9999", headers=auth_headers("A100001"))
    assert res.status_code == 200
    d = res.json()
    assert d["hull_no"] == "9999" and d["drafts"] == 1
    assert d["stats"]["entries"] == 2 and d["stats"]["files"] == 3
    assert d["stats"]["kinds"] == {"report": 2, "model": 1}
    assert {x["value"] for x in d["stats"]["analysis_types"]} == {"Mooring", "Strength"}
    assert d["stats"]["zones"] == [{"value": "선수부", "count": 1}]
    people = {p["employee_id"]: p for p in d["stats"]["people"]}
    assert people["A100002"]["name"] == "김해석" and people["A100002"]["count"] == 1
    assert [m["month"] for m in d["timeline"]] == ["2026-09", "2026-08"]
    assert d["timeline"][0]["entries"][0]["entry_id"] == e2.entry_id
    assert d["timeline"][1]["entries"][0]["zones"] == ["선수부"]


def test_hull_detail_404(client, make_user, auth_headers):
    make_user("A100001")
    assert client.get("/api/hulls/1234", headers=auth_headers("A100001")).status_code == 404


def test_hull_list(client, db, make_entry_file, make_user, auth_headers):
    _setup(db, make_entry_file, make_user)
    rows = client.get("/api/hulls", headers=auth_headers("A100001")).json()
    by_no = {r["hull_no"]: r for r in rows}
    assert by_no["9999"]["entries"] == 2 and by_no["9998"]["entries"] == 1
    assert rows[0]["last_at"] >= rows[-1]["last_at"]
    only = client.get("/api/hulls?q=99", headers=auth_headers("A100001")).json()
    assert {r["hull_no"] for r in only} == {"9999", "9998"}


def test_hull_patch(client, db, make_entry_file, make_user, auth_headers):
    _setup(db, make_entry_file, make_user)
    h = auth_headers("A100001")
    res = client.patch("/api/hulls/9999", json={"ship_type": "LNGC", "memo": "174K"}, headers=h)
    assert res.status_code == 200 and res.json()["ship_type"] == "LNGC"
    assert db.query(models.AuditLog).filter_by(action="HULL_UPDATE").count() == 1
    assert db.query(models.Job).filter_by(type="write_meta").count() == 2
    assert client.patch("/api/hulls/12ab", json={"ship_type": "x"}, headers=h).status_code == 422
```

- [ ] **Step 2: 실패 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_hulls_api.py -v`
Expected: FAIL — 404(라우트 없음)

- [ ] **Step 3: 구현**

`backend/app/hull_info.py`:

```python
"""호선 화면용 조회·수정(설계 §6.1 `/h/{hull}` — 통계·월별 타임라인·구역 분포·참여자)."""
from collections import Counter, defaultdict

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from . import audit, jobs, models
from .entries.service import HULL_PATTERN, tags_of
from .storage.paths import StoragePaths


def _month(e: models.Entry) -> str:
    if e.analysis_period:
        return e.analysis_period
    return f"{(e.confirmed_at or e.created_at):%Y-%m}"


def _confirmed_entries(db: Session, hull_no: str) -> list[models.Entry]:
    return (db.query(models.Entry).join(models.EntryHull, models.EntryHull.entry_id == models.Entry.id)
            .filter(models.EntryHull.hull_no == hull_no, models.Entry.status == "confirmed")
            .order_by(models.Entry.confirmed_at.desc(), models.Entry.id.desc()).all())


def list_hulls(db: Session, q: str = "") -> list[dict]:
    rows = (db.query(models.EntryHull.hull_no, func.count(models.Entry.id), func.max(models.Entry.confirmed_at))
            .join(models.Entry, models.Entry.id == models.EntryHull.entry_id)
            .filter(models.Entry.status == "confirmed")
            .group_by(models.EntryHull.hull_no))
    if q:
        rows = rows.filter(models.EntryHull.hull_no.like(f"{q.strip()}%"))
    ships = dict(db.query(models.Hull.hull_no, models.Hull.ship_type))
    out = [{"hull_no": h, "ship_type": ships.get(h), "entries": n, "last_at": last.isoformat() if last else None}
           for h, n, last in rows]
    return sorted(out, key=lambda r: (r["last_at"] or "", r["hull_no"]), reverse=True)[:500]


def hull_detail(db: Session, hull_no: str) -> dict:
    hull = db.get(models.Hull, hull_no)
    entries = _confirmed_entries(db, hull_no)
    drafts = (db.query(models.Entry.id).join(models.EntryHull, models.EntryHull.entry_id == models.Entry.id)
              .filter(models.EntryHull.hull_no == hull_no, models.Entry.status == "draft").count())
    if hull is None and not entries and not drafts:
        raise HTTPException(status_code=404, detail="hull_not_found")

    ids = [e.id for e in entries]
    kinds_by_entry: dict[int, set] = defaultdict(set)
    kinds = Counter()
    files = 0
    if ids:
        for eid, kind in (db.query(models.File.entry_id, models.File.kind)
                          .filter(models.File.entry_id.in_(ids), models.File.location != "trash")):
            kinds_by_entry[eid].add(kind)
            kinds[kind] += 1
            files += 1
    zones, types, people = Counter(), Counter(), Counter()
    months: dict[str, list] = defaultdict(list)
    for e in entries:
        z = tags_of(db, e, "zone")
        zones.update(z)
        if e.analysis_type:
            types[e.analysis_type] += 1
        if e.uploaded_by:
            people[e.uploaded_by] += 1
        months[_month(e)].append({"entry_id": e.entry_id, "title": e.title, "analysis_type": e.analysis_type,
                                  "zones": z, "uploaded_by": e.uploaded_by,
                                  "confirmed_at": e.confirmed_at.isoformat() if e.confirmed_at else None,
                                  "kinds": sorted(kinds_by_entry[e.id])})
    names = dict(db.query(models.User.employee_id, models.User.name)
                 .filter(models.User.employee_id.in_(list(people) or [""])))

    def ranked(c: Counter) -> list[dict]:
        return [{"value": v, "count": n} for v, n in sorted(c.items(), key=lambda x: (-x[1], x[0]))]

    return {
        "hull_no": hull_no, "ship_type": hull.ship_type if hull else None, "memo": hull.memo if hull else None,
        "drafts": drafts,
        "stats": {"entries": len(entries), "files": files, "kinds": dict(kinds),
                  "analysis_types": ranked(types), "zones": ranked(zones),
                  "people": [{"employee_id": p, "name": names.get(p), "count": n}
                             for p, n in sorted(people.items(), key=lambda x: (-x[1], x[0]))]},
        "timeline": [{"month": m, "entries": months[m]} for m in sorted(months, reverse=True)],
    }


def update_hull(db: Session, storage: StoragePaths, actor: str, hull_no: str, patch: dict,
                ip: str | None = None) -> models.Hull:
    if not HULL_PATTERN.fullmatch(hull_no):
        raise HTTPException(status_code=422, detail="invalid_hull")
    hull = db.get(models.Hull, hull_no)
    if hull is None:
        hull = models.Hull(hull_no=hull_no)
        db.add(hull)
        db.flush()
    before = {"ship_type": hull.ship_type, "memo": hull.memo}
    for key in ("ship_type", "memo"):
        if key in patch:
            setattr(hull, key, (patch[key] or "").strip() or None)
    for e in _confirmed_entries(db, hull_no):
        jobs.enqueue(db, "write_meta", e.id)  # entry.json 의 호선 선종을 맞춘다
    db.flush()
    audit.record(db, storage, actor=actor, action="HULL_UPDATE", target_type="hull", target_id=hull_no,
                 before=before, after={"ship_type": hull.ship_type, "memo": hull.memo}, ip=ip)
    return hull
```

`backend/app/routers/hulls.py`:

```python
"""호선 API — 목록·상세·선종/메모 수정."""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import hull_info, models
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_auth
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/hulls", tags=["hulls"])


class HullPatch(BaseModel):
    ship_type: str | None = Field(default=None, max_length=50)
    memo: str | None = Field(default=None, max_length=2000)


@router.get("")
def list_hulls(q: str = "", db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return hull_info.list_hulls(db, q)


@router.get("/{hull_no}")
def get_hull(hull_no: str, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return hull_info.hull_detail(db, hull_no)


@router.patch("/{hull_no}")
def patch_hull(hull_no: str, body: HullPatch, request: Request, db: Session = Depends(get_db),
               storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    h = hull_info.update_hull(db, storage, user.employee_id, hull_no, body.model_dump(exclude_unset=True),
                              client_ip(request))
    return {"hull_no": h.hull_no, "ship_type": h.ship_type, "memo": h.memo}
```

`backend/app/main.py` 에 `hulls` 라우터를 등록한다.

- [ ] **Step 4: 통과 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_hulls_api.py -v`
Expected: PASS

- [ ] **Step 5: 커밋(사람)** — `feat: 03a 호선 목록·타임라인·선종 수정 API`

---

### Task 9: 파일 API — 내려받기 링크·본문·시트 미리보기

**Files:**
- Create: `backend/app/routers/files.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_files_api.py`

규칙:
- `POST /api/files/{id}/link?inline=` → `{url, expires_at}`.
  - 토큰은 10분 동안 산다. 같은 파일 보기(PDF 뷰어의 재요청)에 여러 번 쓸 수 있다.
  - 링크를 만들 때 만료된 토큰을 지운다.
  - 휴지통 파일은 404 `file_not_found` 다.
- `GET /api/files/{id}/content?t=&inline=` 는 **Bearer 인증 없이** 토큰으로만 연다.
  - 토큰이 없거나, 다른 파일 것이거나, 만료됐으면 403 `link_invalid` 다.
  - 파일은 1MB 조각으로 흘려보낸다.
  - `Content-Length` 는 공유 폴더 파일 크기(`fstat`)다. 공유 폴더 파일은 평문이라 `read()` 길이와 같다. 단 `drm_encrypted` 파일은 서버 DRM 훅이 읽으며 풀 수 있어 길이를 붙이지 않는다(chunked). WorkBench 의 `ERR_CONTENT_LENGTH_MISMATCH` 교훈이다.
  - `inline=1` 은 pdf·png·jpg·jpeg 에만 적용하고, 나머지는 항상 attachment 로 준다. html 등을 브라우저가 실행하지 못하게 하려는 것이다.
  - 파일명은 `filename*=UTF-8''…` 로 준다.
- `GET /api/files/{id}/text` → `{state, error, summary, chunks:[{locator, text}]}`. 조각마다 20,000자까지 준다. 추출 기록이 없으면 `state: null` 이다.
- `GET /api/files/{id}/sheet?name=` → `.xlsx/.xlsm` 만 받는다(그 밖은 422 `not_sheet`).
  - 50MB 초과는 413 `too_large`, DRM 은 409 `drm_encrypted`, 못 여는 파일은 422 `unreadable`, 파일 없음은 404 `file_missing` 이다.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_files_api.py`:

```python
import io
import os
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse

from app import models
from app.entries.locate import file_path


def _write(db, storage, f, data: bytes):
    p = file_path(db, storage, f)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as fh:
        fh.write(data)


def _xlsx() -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    wb.active.title = "응력"
    wb.active.append(["부재", 1.5])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_link_and_download(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    _e, f = make_entry_file(name="보고서 최종.pdf")
    _write(db, storage, f, b"%PDF-1.7 hello")
    res = client.post(f"/api/files/{f.id}/link", headers=auth_headers("A100001"))
    assert res.status_code == 200
    url = res.json()["url"]
    got = client.get(url)  # Authorization 없이
    assert got.status_code == 200 and got.content == b"%PDF-1.7 hello"
    assert got.headers["content-length"] == "14"
    assert got.headers["content-type"] == "application/octet-stream"
    assert "attachment" in got.headers["content-disposition"]
    assert "filename*=UTF-8''%EB%B3%B4%EA%B3%A0%EC%84%9C%20%EC%B5%9C%EC%A2%85.pdf" in got.headers["content-disposition"]


def test_inline_pdf_only(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    _e, pdf = make_entry_file(name="r.pdf")
    _write(db, storage, pdf, b"%PDF")
    url = client.post(f"/api/files/{pdf.id}/link?inline=true", headers=h).json()["url"]
    got = client.get(url)
    assert got.headers["content-type"] == "application/pdf" and got.headers["content-disposition"].startswith("inline")
    _e2, html = make_entry_file(name="x.html", kind="other")
    _write(db, storage, html, b"<script>")
    url = client.post(f"/api/files/{html.id}/link?inline=true", headers=h).json()["url"]
    got = client.get(url)
    assert got.headers["content-disposition"].startswith("attachment")


def test_link_rejections(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    _e, f = make_entry_file(name="r.pdf")
    _e2, g = make_entry_file(name="s.pdf")
    _write(db, storage, f, b"x")
    token = parse_qs(urlparse(client.post(f"/api/files/{f.id}/link", headers=h).json()["url"]).query)["t"][0]
    assert client.get(f"/api/files/{g.id}/content?t={token}").status_code == 403
    assert client.get(f"/api/files/{f.id}/content?t=nope").status_code == 403
    db.get(models.DownloadToken, token).expires_at = datetime.now() - timedelta(seconds=1)
    db.commit()
    assert client.get(f"/api/files/{f.id}/content?t={token}").status_code == 403
    assert client.post(f"/api/files/{f.id}/link").status_code == 401
    assert client.post("/api/files/999999/link", headers=h).status_code == 404
    _e3, t = make_entry_file(status="trashed", name="t.pdf")
    assert client.post(f"/api/files/{t.id}/link", headers=h).status_code == 404


def test_expired_tokens_cleaned(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    _e, f = make_entry_file(name="r.pdf")
    db.add(models.DownloadToken(token="old", file_id=f.id, employee_id="A100001",
                                expires_at=datetime.now() - timedelta(minutes=1)))
    db.commit()
    client.post(f"/api/files/{f.id}/link", headers=auth_headers("A100001"))
    db.expire_all()
    assert db.get(models.DownloadToken, "old") is None


def test_missing_file_404(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    _e, f = make_entry_file(name="r.pdf")
    url = client.post(f"/api/files/{f.id}/link", headers=auth_headers("A100001")).json()["url"]
    assert client.get(url).status_code == 404


def test_drm_file_streams_without_length(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    _e, f = make_entry_file(name="r.pdf")
    f.drm_encrypted = True
    db.commit()
    _write(db, storage, f, b"HHIDRMC....")
    got = client.get(client.post(f"/api/files/{f.id}/link", headers=auth_headers("A100001")).json()["url"])
    assert got.status_code == 200 and "content-length" not in {k.lower() for k in got.headers
                                                               if got.headers.get("transfer-encoding")} | set()


def test_text_endpoint(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    _e, f = make_entry_file(name="r.pptx")
    assert client.get(f"/api/files/{f.id}/text", headers=h).json()["state"] is None
    db.add(models.FileExtract(file_id=f.id, state="done", summary={"unit": "slide", "count": 1}))
    db.add(models.FileText(file_id=f.id, seq=0, locator="slide:1", text="가" * 30000))
    db.commit()
    d = client.get(f"/api/files/{f.id}/text", headers=h).json()
    assert d["state"] == "done" and d["summary"]["unit"] == "slide"
    assert d["chunks"][0]["locator"] == "slide:1" and len(d["chunks"][0]["text"]) == 20000


def test_sheet_endpoint(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    _e, f = make_entry_file(name="s.xlsx")
    _write(db, storage, f, _xlsx())
    d = client.get(f"/api/files/{f.id}/sheet", headers=h).json()
    assert d["sheets"] == ["응력"] and d["rows"] == [["부재", "1.5"]]
    _e2, p = make_entry_file(name="r.pdf")
    assert client.get(f"/api/files/{p.id}/sheet", headers=h).json()["detail"] == "not_sheet"
    _e3, bad = make_entry_file(name="b.xlsx")
    _write(db, storage, bad, b"garbage")
    assert client.get(f"/api/files/{bad.id}/sheet", headers=h).json()["detail"] == "unreadable"
    _e4, gone = make_entry_file(name="g.xlsx")
    assert client.get(f"/api/files/{gone.id}/sheet", headers=h).status_code == 404
```

`test_drm_file_streams_without_length` 의 마지막 단언은 복잡하게 쓰였다. 구현 때 `assert "content-length" not in got.headers` 로 단순하게 바꾼다. TestClient 는 스트리밍 응답에 길이 헤더를 스스로 붙이지 않는다. 붙는다면 실제 동작을 확인해 단언을 맞춘다.

- [ ] **Step 2: 실패 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_files_api.py -v`
Expected: FAIL — 404/405(라우트 없음)

- [ ] **Step 3: 구현**

`backend/app/routers/files.py`:

```python
"""파일 API — 내려받기 링크(토큰)·원본 스트리밍·추출 본문·엑셀 시트 미리보기(설계 §6.3)."""
import os
import uuid
from datetime import datetime, timedelta
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..dependencies import get_storage, require_auth
from ..entries.locate import FileUnavailable, file_path
from ..extract.xlsx import sheet_preview
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/files", tags=["files"])

LINK_TTL = timedelta(minutes=10)
STREAM_CHUNK = 1024 * 1024
TEXT_PREVIEW_CHARS = 20_000
SHEET_MAX_BYTES = 50 * 1024 * 1024
INLINE_TYPES = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def _file(db: Session, file_id: int) -> models.File:
    f = db.get(models.File, file_id)
    if f is None or f.location == "trash":
        raise HTTPException(status_code=404, detail="file_not_found")
    return f


def _path(db: Session, storage: StoragePaths, f: models.File) -> str:
    try:
        return file_path(db, storage, f)
    except FileUnavailable:
        raise HTTPException(status_code=404, detail="file_missing")


def _disposition(name: str, inline: bool) -> str:
    fallback = "".join(c if 32 <= ord(c) < 127 and c not in '"\\' else "_" for c in name) or "file"
    return f"{'inline' if inline else 'attachment'}; filename=\"{fallback}\"; filename*=UTF-8''{quote(name)}"


@router.post("/{file_id}/link")
def create_link(file_id: int, inline: bool = False, db: Session = Depends(get_db),
                user: models.User = Depends(require_auth)):
    f = _file(db, file_id)
    now = _now()
    db.query(models.DownloadToken).filter(models.DownloadToken.expires_at < now).delete(synchronize_session=False)
    tok = models.DownloadToken(token=str(uuid.uuid4()), file_id=f.id, employee_id=user.employee_id,
                               expires_at=now + LINK_TTL)
    db.add(tok)
    db.commit()
    url = f"/api/files/{f.id}/content?t={tok.token}" + ("&inline=1" if inline else "")
    return {"url": url, "expires_at": tok.expires_at.isoformat()}


@router.get("/{file_id}/content")
def content(file_id: int, t: str = Query(default=""), inline: bool = False, db: Session = Depends(get_db),
            storage: StoragePaths = Depends(get_storage)):
    tok = db.get(models.DownloadToken, t) if t else None
    if tok is None or tok.file_id != file_id or tok.expires_at < _now():
        raise HTTPException(status_code=403, detail="link_invalid")
    f = _file(db, file_id)
    try:
        fh = open(_path(db, storage, f), "rb")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="file_missing")
    except OSError:
        raise HTTPException(status_code=503, detail="storage_unreachable")
    as_inline = inline and f.ext in INLINE_TYPES
    headers = {"Content-Disposition": _disposition(f.name, as_inline), "Cache-Control": "private, no-store",
               "X-Content-Type-Options": "nosniff"}
    if not f.drm_encrypted:
        headers["Content-Length"] = str(os.fstat(fh.fileno()).st_size)

    def stream():
        with fh:
            while chunk := fh.read(STREAM_CHUNK):
                yield chunk

    media = INLINE_TYPES[f.ext] if as_inline else "application/octet-stream"
    return StreamingResponse(stream(), media_type=media, headers=headers)


@router.get("/{file_id}/text")
def text(file_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    f = _file(db, file_id)
    x = db.get(models.FileExtract, f.id)
    chunks = (db.query(models.FileText).filter_by(file_id=f.id).order_by(models.FileText.seq).all()) if x else []
    return {"state": x.state if x else None, "error": x.error if x else None, "summary": x.summary if x else None,
            "chunks": [{"locator": c.locator, "text": c.text[:TEXT_PREVIEW_CHARS]} for c in chunks]}


@router.get("/{file_id}/sheet")
def sheet(file_id: int, name: str | None = None, db: Session = Depends(get_db),
          storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    f = _file(db, file_id)
    if f.ext not in (".xlsx", ".xlsm"):
        raise HTTPException(status_code=422, detail="not_sheet")
    if f.drm_encrypted:
        raise HTTPException(status_code=409, detail="drm_encrypted")
    if f.size > SHEET_MAX_BYTES:
        raise HTTPException(status_code=413, detail="too_large")
    try:
        with open(_path(db, storage, f), "rb") as fh:
            data = fh.read()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="file_missing")
    except OSError:
        raise HTTPException(status_code=503, detail="storage_unreachable")
    try:
        return sheet_preview(data, name)
    except Exception:
        raise HTTPException(status_code=422, detail="unreadable")
```

`backend/app/main.py` 에 `files` 라우터를 등록한다.

⚠ 라우트 충돌을 확인한다. `entries.router` 에는 이미 `POST /api/files/{file_id}/move` 가 있다. 경로 끝이 달라 겹치지 않는다.

- [ ] **Step 4: 통과 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_files_api.py -v`
Expected: PASS

Run: `.venv\Scripts\python.exe -m pytest -q`
Expected: 전체 PASS

- [ ] **Step 5: 커밋(사람)** — `feat: 03a 파일 내려받기 링크·본문·시트 미리보기 API`

---

### Task 10: 실제 공유 폴더 통합 시험 (컨트롤러가 직접 수행)

에이전트가 아니라 컨트롤러(메인 세션)가 개발 PC 에서 실제 `999_LogBook` 에 대고 확인한다. 145 는 건드리지 않는다.

- [ ] **Step 1:** API(`uvicorn app.main:app --port 9095`)와 워커(`python -m app.worker`)를 띄운다. `backend\.env` 는 열지 않는다. 서버가 스스로 읽는다.
- [ ] **Step 2:** 합성 문서를 만든다.
  - 호선 9999, 표지 `HULL NO. 9999`, 본문 "선체 구조 강도" 를 담은 PPTX·XLSX 와 영문 PDF 를 스크래치패드에서 파이썬으로 만든다.
  - `/api/uploads` 로 올린다(E2E 와 같은 흐름: begin → chunk → finish).
- [ ] **Step 3:** 워커 처리 결과를 확인한다.
  - 초안의 호선 근거에 `보고서 본문:` 이 들어가는지 확인한다.
  - `file_extracts.state=done` 인지 확인한다.
  - 공유 폴더 `20_Derived\_text\..\<sha>.json` 이 생기고 평문 JSON 인지 확인한다(첫 바이트 `{`).
- [ ] **Step 4:** 확정한 뒤 API 로 확인한다.
  - `/api/search?q=강도` 결과에 발췌문과 강조 위치가 맞는지 확인한다.
  - `/api/search?q=9999` 가 호선 적중인지 확인한다.
  - `/api/hulls/9999` 의 타임라인을 확인한다.
  - `/api/files/{id}/link` → `content` 로 받은 바이트가 원본과 같은지(sha256) 확인한다.
  - `/api/files/{id}/sheet` 를 확인한다.
- [ ] **Step 5:** 시험 Entry 를 휴지통으로 보내고 API·워커를 멈춘다.
- [ ] **Step 6:** `docs/plans/README.md` 의 03 줄을 03a(이 문서)·03b(화면)로 나눠 적는다.

---

## 자체 점검 (계획 작성 시)

- 설계 §5.2 본문 추출·요약 카드 → Task 2·4. §5.3 문서 속 호선 → Task 4. §6.2 검색(순위·필터 건수·발췌·동의어·호선 제안·보기 단위·인터페이스) → Task 5·6. §6.1 호선·태그·Entry 상세 → Task 5·7·8. §6.3 미리보기 백엔드(PDF 링크·PPTX 본문·XLSX 표·경로 복사용 UNC) → Task 7·9. §9 DRM 파일 → Task 4·9.
- 03b(화면)에 남긴 것: 검색 화면·미리보기 패널·Ctrl+K 결과 이동, 호선 화면, Entry 상세 인라인 수정·파일 추가, 태그 화면.
