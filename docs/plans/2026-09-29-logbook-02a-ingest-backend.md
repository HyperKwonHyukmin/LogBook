# Logbook 02a — 올리기 파이프라인(백엔드) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀원이 탐색기로 `999_LogBook\00_Inbox` 에 폴더·파일을 복사하면 워커가 복사 완료를 감지해 배치로 받고, 파일을 해시·분류·중복 검사하고, 호선을 추정해 **초안 Entry** 로 묶어 제안하며, 올린 사람이 API 로 수정·쪼개기·합치기·확정하면 `10_Vault\<연도>\<EntryID>\files\` 로 옮기고 `entry.json`·`_INFO.txt` 를 쓰고, 삭제는 휴지통으로 보내고 복원할 수 있게 한다.

**Architecture:** 초안(제안)도 `entries` 행(status=`draft`)으로 표현한다 — 묶음 수정이 곧 `files.entry_id` 변경이라 단순하다. EntryID(`E000123`)는 초안 생성 시 발급한다(합치기·버리기로 번호에 빈칸이 생기는 것은 허용). 파일은 `00_Inbox → 10_Vault\_staging\<배치키>\ → 10_Vault\<연도>\<EntryID>\files\` 로 **같은 공유 폴더 안에서 `os.rename`** 으로만 옮긴다(PoC 실험 2: 이동 후 평문 유지 확인). 워커는 별도 프로세스(`python -m app.worker`)로 30초마다 Inbox 를 보고, 무거운 처리는 MySQL `jobs` 큐로 돌린다. 원자적 이동·해시·경로 격리 규칙은 WorkBench `model_registry_storage.py` 를 이식한다.

**Tech Stack:** 01 과 동일 + pywin32(파일 소유자 판별). 화면(02b)은 이 계획의 API 를 쓴다.

**근거:** 설계 `docs/specs/2026-09-28-logbook-design.md` §3·4·5·8·9, 재사용 목록 `docs/reuse-inventory.md` §7, PoC 결과(`poc/RESULTS.md` — 공유 폴더 평문·이동 후 평문·소유자 판별 OK, 긴 경로는 `to_long()` 필수).

**실행 환경·규칙:** 개발 PC 에서 개발·테스트. 테스트 DB `logbook_test`(전용 계정 `logbook_app`). 에이전트는 **git add/commit 을 하지 않는다**(각 태스크의 커밋은 사용자). **DB 자격증명을 읽거나 출력하거나 추측하지 않는다.**

**이 계획의 결정 사항:**
- 초안 편집·쪼개기·합치기·버리기·확정은 **배치의 올린 사람**만(관리자는 배치를 받은 지 30일이 지나면 대신 확정 가능 — 설계 §5.5). 확정된 Entry 의 수정·휴지통·복원은 **로그인 사용자 누구나**(설계 §8).
- 감사 로그 대상: 배치 수신·주인 지정, 확정, 확정 Entry 수정, 휴지통, 복원, 초안 버리기, 기존 Entry 에 파일 추가. **초안 편집(작업 중 상태)은 기록하지 않는다.**
- 자동 제외 파일(`~$*`, `Thumbs.db`, `desktop.ini`, `*.MASTER`, `*.DBALL`, `*.SCRATCH`, `*.tmp`)은 staging 에서 **삭제**하고 배치의 `excluded` 목록에 이름·크기를 남긴다.
- 호선 추정은 이번 단계에서 **파일·폴더 이름만** 근거로 쓴다. 보고서 표지·본문 근거는 03(본문 추출) 에서 더한다.
- `hulls` 행(선종 등 호선 속성)은 **확정 시점**에 없으면 만든다. `entry_hulls.hull_no` 는 `hulls` 에 외래키를 걸지 않는다(초안이 추정 호선을 가질 수 있게).

---

## 파일 구조

```
backend\
├─ requirements.txt                     (수정: pywin32 추가)
├─ app\
│  ├─ models.py                         (수정: Hull·Entry·EntryHull·Tag·EntryTag·Batch·File·Job)
│  ├─ storage\paths.py                  (수정: staging 경로)
│  ├─ jobs.py                           작업 큐 (enqueue / claim_next / complete / fail)
│  ├─ ingest\__init__.py
│  ├─ ingest\rules.py                   제외 규칙·파일 분류
│  ├─ ingest\hashing.py                 SHA-256 (WorkBench sha256_of 이식)
│  ├─ ingest\hulls.py                   호선 후보 추출(점수·근거)
│  ├─ ingest\proposal.py                묶음 제안(순수 함수)
│  ├─ ingest\owner.py                   파일 소유자 → 사번
│  ├─ ingest\inbox.py                   InboxWatcher(복사 완료 감지) · stage_item(→ 배치)
│  ├─ ingest\process.py                 process_batch(해시·분류·중복·제안)
│  ├─ entries\__init__.py
│  ├─ entries\service.py                조회 변환·수정·호선/구역·확정·휴지통·복원·쪼개기·합치기
│  ├─ entries\files.py                  파일 이동(롤백)·entry.json·_INFO.txt
│  ├─ routers\batches.py                배치 목록·주인 지정
│  ├─ routers\entries.py                Entry 조회·수정·확정·쪼개기·합치기·파일 이동·휴지통·복원
│  ├─ worker.py                         run_once() · main()
│  └─ main.py                           (수정: 라우터 등록)
└─ tests\
   ├─ conftest.py                       (수정: storage 픽스처가 매 테스트 폴더를 비움, 헬퍼)
   ├─ test_ingest_rules.py  test_hulls.py  test_proposal.py  test_owner.py  test_jobs.py
   ├─ test_inbox.py  test_process.py  test_entry_service.py  test_confirm.py
   ├─ test_trash_split.py  test_batches_api.py  test_entries_api.py  test_worker.py
```

---

### Task 1: 모델·경로·의존성

**Files:**
- Modify: `backend\requirements.txt`, `backend\app\models.py`, `backend\app\storage\paths.py`, `backend\tests\conftest.py`
- Create: `backend\tests\test_ingest_models.py`

- [ ] **Step 1: `requirements.txt` 에 한 줄 추가 후 설치**

```text
pywin32==312
```
Run: `cd C:\Coding\Logbook\backend; .venv\Scripts\python.exe -m pip install -r requirements.txt`

- [ ] **Step 2: `conftest.py` 의 `storage` 픽스처를 교체** — 테스트마다 저장소 폴더를 비운다(공유 `_TEST_ROOT` 에 이전 테스트 파일이 남지 않게)

```python
@pytest.fixture
def storage():
    from app.storage.paths import LAYOUT, StoragePaths

    root = Path(_TEST_ROOT)
    for name in LAYOUT:
        shutil.rmtree(root / name, ignore_errors=True)
    sp = StoragePaths(root)
    sp.ensure_layout()
    return sp
```

- [ ] **Step 3: 실패하는 테스트 `backend\tests\test_ingest_models.py`**

```python
import pytest
from sqlalchemy.exc import IntegrityError, OperationalError

from app import models


def test_entry_defaults_and_entry_id_assignment(db):
    e = models.Entry(title="검토")
    db.add(e)
    db.flush()
    e.entry_id = f"E{e.id:06d}"
    db.commit()
    db.refresh(e)
    assert e.status == "draft"
    assert e.version == 1
    assert e.entry_id == f"E{e.id:06d}"


def test_entry_status_is_constrained(db):
    db.add(models.Entry(title="x", status="bogus"))
    with pytest.raises((IntegrityError, OperationalError)):
        db.commit()


def test_batch_file_and_job_rows(db):
    b = models.Batch(key="20260929-083015-a1b2", source="inbox", original_name="3496_검토")
    db.add(b)
    db.flush()
    db.add(models.File(batch_id=b.id, rel_path="3496_검토/a.bdf", name="a.bdf", ext=".bdf",
                       kind="model", size=10, sha256="0" * 64))
    db.add(models.Job(type="process_batch", target_id=b.id))
    db.commit()
    assert db.query(models.File).one().location == "staging"
    assert db.query(models.Job).one().state == "queued"


def test_tag_kind_value_unique(db):
    db.add(models.Tag(kind="zone", value="Fore Deck"))
    db.commit()
    db.add(models.Tag(kind="zone", value="Fore Deck"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_staging_path(storage):
    assert storage.staging == storage.vault / "_staging"
```

- [ ] **Step 4: 실패 확인** — `.venv\Scripts\pytest.exe tests\test_ingest_models.py -v` → `AttributeError: module 'app.models' has no attribute 'Entry'`

- [ ] **Step 5: `models.py` 끝에 추가** (import 줄은 파일 상단에 병합: `BigInteger, ForeignKey, Text, UniqueConstraint`)

```python
from sqlalchemy import BigInteger, ForeignKey, Text, UniqueConstraint  # 상단 import 에 병합

ENTRY_STATUSES = ("draft", "confirmed", "trashed")
FILE_KINDS = ("model", "result", "report", "drawing", "other")


class Hull(Base):
    """호선 속성. 선종은 호선에 딸린 값이다(설계 §4)."""

    __tablename__ = "hulls"

    hull_no = Column(String(8), primary_key=True)
    ship_type = Column(String(50), nullable=True)
    memo = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now)


class Entry(Base):
    """해석 건. 묶음 제안(초안)도 status='draft' 로 같은 테이블에 둔다."""

    __tablename__ = "entries"
    __table_args__ = (
        CheckConstraint("status IN ('draft','confirmed','trashed')", name="ck_entries_status"),
    )

    id = Column(Integer, primary_key=True)
    entry_id = Column(String(10), unique=True, nullable=True)  # E000123 — 행 생성 직후 채움
    title = Column(String(200), nullable=False, default="")
    analysis_type = Column(String(50), nullable=True)
    description = Column(Text, nullable=True)
    analysis_period = Column(String(7), nullable=True)  # YYYY-MM
    status = Column(String(10), nullable=False, default="draft")
    batch_id = Column(Integer, ForeignKey("batches.id"), nullable=True, index=True)
    merge_into_id = Column(Integer, ForeignKey("entries.id"), nullable=True)
    suggested_entry_id = Column(Integer, ForeignKey("entries.id"), nullable=True)
    hull_evidence = Column(JSON, nullable=True)
    uploaded_by = Column(String(20), nullable=True, index=True)
    confirmed_by = Column(String(20), nullable=True)
    confirmed_at = Column(DateTime, nullable=True)
    vault_rel = Column(String(40), nullable=True)   # "2026/E000123"
    trash_rel = Column(String(80), nullable=True)   # "E000123_20260929-101500"
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, default=_now)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)


class EntryHull(Base):
    __tablename__ = "entry_hulls"

    entry_id = Column(Integer, ForeignKey("entries.id", ondelete="CASCADE"), primary_key=True)
    hull_no = Column(String(8), primary_key=True)  # hulls 외래키 없음(초안의 추정 호선 허용)
    is_primary = Column(Boolean, nullable=False, default=False)


class Tag(Base):
    """자유 입력 태그(구역 등). alias_of 로 동의어를 묶는다(03 에서 화면 제공)."""

    __tablename__ = "tags"
    __table_args__ = (UniqueConstraint("kind", "value", name="uq_tags_kind_value"),)

    id = Column(Integer, primary_key=True)
    kind = Column(String(10), nullable=False)  # zone | free
    value = Column(String(100), nullable=False)
    alias_of_id = Column(Integer, ForeignKey("tags.id"), nullable=True)


class EntryTag(Base):
    __tablename__ = "entry_tags"

    entry_id = Column(Integer, ForeignKey("entries.id", ondelete="CASCADE"), primary_key=True)
    tag_id = Column(Integer, ForeignKey("tags.id"), primary_key=True)


class Batch(Base):
    """한 번에 올라온 묶음(Inbox 폴더 1개 또는 낱개 파일 묶음)."""

    __tablename__ = "batches"

    id = Column(Integer, primary_key=True)
    key = Column(String(24), unique=True, nullable=False)  # 20260929-083015-a1b2
    source = Column(String(10), nullable=False)            # inbox | web
    original_name = Column(String(255), nullable=False)
    state = Column(String(12), nullable=False, default="staged")  # staged|processed|failed|done
    owner_account = Column(String(64), nullable=True)
    uploader_guess = Column(String(20), nullable=True)
    uploader = Column(String(20), nullable=True, index=True)
    target_entry_id = Column(
        Integer, ForeignKey("entries.id", use_alter=True, name="fk_batches_target_entry"), nullable=True
    )
    excluded = Column(JSON, nullable=True)
    error = Column(Text, nullable=True)
    received_at = Column(DateTime, nullable=False, default=_now)
    processed_at = Column(DateTime, nullable=True)


class File(Base):
    __tablename__ = "files"

    id = Column(Integer, primary_key=True)
    batch_id = Column(Integer, ForeignKey("batches.id"), nullable=False, index=True)
    entry_id = Column(Integer, ForeignKey("entries.id"), nullable=True, index=True)
    rel_path = Column(String(500), nullable=False)  # posix. staging: 배치 루트 기준 / vault: files\ 기준
    name = Column(String(255), nullable=False)
    ext = Column(String(16), nullable=False, default="")
    kind = Column(String(10), nullable=False)
    size = Column(BigInteger, nullable=False, default=0)
    sha256 = Column(String(64), nullable=False, index=True)
    duplicate_of_id = Column(Integer, ForeignKey("files.id"), nullable=True)
    drm_encrypted = Column(Boolean, nullable=False, default=False)
    location = Column(String(8), nullable=False, default="staging")  # staging|vault|trash
    created_at = Column(DateTime, nullable=False, default=_now)


class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True)
    type = Column(String(30), nullable=False)
    target_id = Column(Integer, nullable=False)
    state = Column(String(10), nullable=False, default="queued")  # queued|running|done|failed
    attempts = Column(Integer, nullable=False, default=0)
    last_error = Column(Text, nullable=True)
    run_after = Column(DateTime, nullable=False, default=_now)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)
```
`CheckConstraint`·`Boolean`·`JSON` 이 이미 import 돼 있는지 확인하고 없으면 추가한다.

- [ ] **Step 6: `storage/paths.py` 의 `StoragePaths` 에 속성 추가**

```python
    @property
    def staging(self) -> Path:
        return self.vault / "_staging"
```
`ensure_layout()` 가 만드는 목록에 `self.staging` 을 추가한다.

- [ ] **Step 7: 통과 확인** — `.venv\Scripts\pytest.exe -q` → 기존 81 + 5 = `86 passed`

- [ ] **Step 8: 커밋 (사용자)** — `git add backend` → `git commit -m "✨ feat: 올리기 파이프라인 모델(Entry·Batch·File·Job 등)"`

---

### Task 2: 제외 규칙·분류·해시 (`ingest/rules.py`, `ingest/hashing.py`)

**Files:**
- Create: `backend\app\ingest\__init__.py`, `backend\app\ingest\rules.py`, `backend\app\ingest\hashing.py`, `backend\tests\test_ingest_rules.py`

- [ ] **Step 1: 실패하는 테스트**

```python
# backend/tests/test_ingest_rules.py
import hashlib

import pytest

from app.ingest.hashing import sha256_of
from app.ingest.rules import classify, is_excluded


@pytest.mark.parametrize("name", ["~$검토.pptx", "Thumbs.db", "desktop.ini", "a.MASTER", "a.dball",
                                  "job.SCRATCH", "x.tmp"])
def test_excluded(name):
    assert is_excluded(name) is True


@pytest.mark.parametrize("name", ["a.bdf", "보고서.pptx", "Thumbs.db.bak"])
def test_not_excluded(name):
    assert is_excluded(name) is False


@pytest.mark.parametrize("name,kind", [
    ("a.bdf", "model"), ("a.DAT", "model"), ("a.nas", "model"), ("inc.blk", "model"),
    ("a.f06", "result"), ("a.op2", "result"), ("a.h5", "result"), ("a.log", "result"),
    ("검토.pptx", "report"), ("계산.xlsx", "report"), ("보고서.pdf", "report"), ("메모.docx", "report"),
    ("도면.dwg", "drawing"), ("a.dxf", "drawing"), ("캡처.png", "drawing"), ("사진.JPG", "drawing"),
    ("a.zip", "other"), ("README", "other"),
])
def test_classify(name, kind):
    assert classify(name) == kind


def test_sha256_of(tmp_path):
    p = tmp_path / "a.bin"
    p.write_bytes(b"logbook" * 1000)
    assert sha256_of(p) == hashlib.sha256(b"logbook" * 1000).hexdigest()
```

- [ ] **Step 2: 실패 확인** — `ModuleNotFoundError: No module named 'app.ingest'`

- [ ] **Step 3: 구현**

`backend\app\ingest\__init__.py`:
```python
"""올리기 파이프라인 — Inbox 감시·배치·해시·분류·호선 추정·묶음 제안."""
```

`backend\app\ingest\rules.py`:
```python
"""자동 제외 규칙과 파일 분류(설계 §5.1·§5.2)."""
import fnmatch
import os

# Office 임시 파일, 윈도우 탐색기 부산물, Nastran 스크래치(수 GB)
EXCLUDE_PATTERNS = ("~$*", "thumbs.db", "desktop.ini", "*.master", "*.dball", "*.scratch", "*.tmp")

KIND_BY_EXT = {
    ".bdf": "model", ".dat": "model", ".nas": "model", ".blk": "model",
    ".f06": "result", ".op2": "result", ".h5": "result", ".log": "result",
    ".pdf": "report", ".pptx": "report", ".ppt": "report", ".xlsx": "report", ".xls": "report",
    ".docx": "report", ".doc": "report",
    ".dwg": "drawing", ".dxf": "drawing", ".png": "drawing", ".jpg": "drawing", ".jpeg": "drawing",
}


def is_excluded(name: str) -> bool:
    lower = name.lower()
    return any(fnmatch.fnmatchcase(lower, pat) for pat in EXCLUDE_PATTERNS)


def classify(name: str) -> str:
    return KIND_BY_EXT.get(os.path.splitext(name)[1].lower(), "other")
```

`backend\app\ingest\hashing.py`:
```python
"""SHA-256. WorkBench app/services/model_registry_storage.py 의 sha256_of 를 이식(긴 경로 대응 추가)."""
import hashlib
import os

from ..storage.paths import to_long


def sha256_of(path: str | os.PathLike) -> str:
    h = hashlib.sha256()
    with open(to_long(path), "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()
```

- [ ] **Step 4: 통과 확인** — `.venv\Scripts\pytest.exe tests\test_ingest_rules.py -v` → `29 passed`

- [ ] **Step 5: 커밋 (사용자)** — `git commit -m "✨ feat: 제외 규칙·파일 분류·SHA-256"`

---

### Task 3: 호선 후보 추출 (`ingest/hulls.py`)

**Files:**
- Create: `backend\app\ingest\hulls.py`, `backend\tests\test_hulls.py`

규칙(설계 §5.3 중 이름 근거): 이름 **맨 앞 4자리 + 구분자** +3, 등장한 이름 수 +1씩(최대 +5), 이미 등록된 호선 +2, 날짜처럼 보이는 문맥(`2026-09`, `2026.09`)이면서 미등록이면 −3. 점수 ≥3 이고 2위보다 높을 때만 "최선 호선"으로 채택한다.

- [ ] **Step 1: 실패하는 테스트**

```python
# backend/tests/test_hulls.py
from app.ingest.hulls import best_hull, extract_hull_candidates


def _nos(cands):
    return [c.hull_no for c in cands]


def test_leading_number_with_separator_scores_high():
    cands = extract_hull_candidates(["3496-35210-A508372_20260108_edit.bdf"], known=set())
    assert cands[0].hull_no == "3496"
    assert cands[0].score >= 3
    assert any("맨 앞" in r for r in cands[0].reasons)


def test_repeated_across_names_accumulates():
    names = ["3496_Mooring", "3496_Mooring_FWD.bdf", "3496 검토보고서.pptx"]
    top = extract_hull_candidates(names, known=set())[0]
    assert top.hull_no == "3496" and top.score >= 3 + 3


def test_digits_inside_longer_numbers_are_ignored():
    assert extract_hull_candidates(["20260108.bdf", "A508372.f06"], known=set()) == []


def test_date_context_penalized_unless_known():
    cands = extract_hull_candidates(["2026-09 회의자료.pdf"], known=set())
    assert "2026" not in _nos(cands)
    known = extract_hull_candidates(["2026-09 회의자료.pdf"], known={"2026"})
    assert "2026" in _nos(known)


def test_known_hull_bonus():
    a = extract_hull_candidates(["검토 3370 모델.bdf"], known=set())[0]
    b = extract_hull_candidates(["검토 3370 모델.bdf"], known={"3370"})[0]
    assert b.score == a.score + 2


def test_best_hull_requires_score_and_margin():
    assert best_hull(extract_hull_candidates(["3496_a.bdf"], known=set())) == "3496"
    tie = extract_hull_candidates(["3496_a.bdf", "3370_b.bdf"], known=set())
    assert best_hull(tie) is None
    assert best_hull(extract_hull_candidates(["모델 3496.bdf"], known=set())) is None  # 점수 부족
```

- [ ] **Step 2: 실패 확인** — `ModuleNotFoundError: No module named 'app.ingest.hulls'`

- [ ] **Step 3: 구현**

```python
# backend/app/ingest/hulls.py
"""호선(4자리) 후보를 이름에서 뽑아 점수·근거와 함께 돌려준다(설계 §5.3).

4자리 숫자는 흔하다(연도·치수·PID). 그래서 단정하지 않고 점수로 제안만 하며,
사람이 정리 대기 화면에서 근거를 보고 확정한다.
"""
import re
from dataclasses import dataclass, field
from typing import Iterable

TOKEN = re.compile(r"(?<![0-9])([0-9]{4})(?![0-9])")
LEADING = re.compile(r"^([0-9]{4})(?:[-_ .]|$)")
DATE_CONTEXT = re.compile(r"^[-_.](?:0[1-9]|1[0-2])(?![0-9])")
MAX_OCCURRENCE_BONUS = 5


@dataclass
class HullCandidate:
    hull_no: str
    score: int = 0
    reasons: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"hull_no": self.hull_no, "score": self.score, "reasons": self.reasons}


def extract_hull_candidates(names: Iterable[str], known: set[str]) -> list[HullCandidate]:
    leading: dict[str, list[str]] = {}
    seen_in: dict[str, set[str]] = {}
    date_like: set[str] = set()
    for name in dict.fromkeys(names):  # 순서 유지 중복 제거
        m = LEADING.match(name)
        if m:
            leading.setdefault(m.group(1), []).append(name)
        for t in TOKEN.finditer(name):
            no = t.group(1)
            seen_in.setdefault(no, set()).add(name)
            if DATE_CONTEXT.match(name[t.end():]):
                date_like.add(no)

    cands = []
    for no, where in seen_in.items():
        c = HullCandidate(no)
        if no in leading:
            c.score += 3
            c.reasons.append(f"이름 맨 앞: {leading[no][0]}")
        c.score += min(len(where), MAX_OCCURRENCE_BONUS)
        c.reasons.append(f"이름 {len(where)}개에 등장")
        if no in known:
            c.score += 2
            c.reasons.append("등록된 호선")
        elif no in date_like:
            c.score -= 3
            c.reasons.append("날짜처럼 보임")
        if c.score > 0:
            cands.append(c)
    return sorted(cands, key=lambda c: (-c.score, c.hull_no))


def best_hull(cands: list[HullCandidate]) -> str | None:
    if not cands or cands[0].score < 3:
        return None
    if len(cands) > 1 and cands[1].score >= cands[0].score:
        return None
    return cands[0].hull_no
```

- [ ] **Step 4: 통과 확인** — `.venv\Scripts\pytest.exe tests\test_hulls.py -v` → `6 passed`

- [ ] **Step 5: 커밋 (사용자)** — `git commit -m "✨ feat: 호선 후보 점수 추출"`

---

### Task 4: 묶음 제안 (`ingest/proposal.py`)

**Files:**
- Create: `backend\app\ingest\proposal.py`, `backend\tests\test_proposal.py`

규칙(설계 §5.4): 배치 안 **최상위 이름(올린 폴더 또는 낱개 파일)** 단위로 1차 묶음. 1차 묶음 안의 **하위 폴더들이 서로 다른 최선 호선**을 가지면 하위 폴더 단위로 쪼갠다. 제목은 폴더 이름(밑줄→공백), 낱개 파일 묶음은 첫 파일 이름(확장자 제외).

- [ ] **Step 1: 실패하는 테스트**

```python
# backend/tests/test_proposal.py
from app.ingest.proposal import FileInfo, propose


def _f(i, rel):
    return FileInfo(key=i, rel_path=rel)


def test_single_uploaded_folder_is_one_proposal():
    files = [_f(1, "3496_Mooring_검토/model/a.bdf"), _f(2, "3496_Mooring_검토/report/검토.pptx")]
    [p] = propose(files, known=set())
    assert p.title == "3496 Mooring 검토"
    assert sorted(p.file_keys) == [1, 2]
    assert p.best_hull == "3496"


def test_subfolders_with_different_hulls_are_split():
    files = [_f(1, "자료/3496_Mooring/a.bdf"), _f(2, "자료/3496_Mooring/r.pdf"),
             _f(3, "자료/3370_권상/b.bdf")]
    props = sorted(propose(files, known=set()), key=lambda p: p.title)
    assert [p.title for p in props] == ["3370 권상", "3496 Mooring"]
    assert [p.best_hull for p in props] == ["3370", "3496"]


def test_subfolders_with_same_hull_stay_together():
    files = [_f(1, "3496/Mooring/a.bdf"), _f(2, "3496/권상/b.bdf")]
    [p] = propose(files, known=set())
    assert p.title == "3496"


def test_loose_files_group():
    files = [_f(1, "3496-35210_model.bdf"), _f(2, "3496-35210_model.f06")]
    [p] = propose(files, known=set())
    assert p.title == "3496-35210 model"
    assert p.best_hull == "3496"


def test_candidates_are_serializable():
    [p] = propose([_f(1, "3496_x/a.bdf")], known=set())
    assert p.hull_candidates[0]["hull_no"] == "3496"
```

- [ ] **Step 2: 실패 확인** — `ModuleNotFoundError`

- [ ] **Step 3: 구현**

```python
# backend/app/ingest/proposal.py
"""배치 안 파일을 Entry 후보로 묶는다(설계 §5.4). DB 와 무관한 순수 함수."""
import os
from dataclasses import dataclass, field
from pathlib import PurePosixPath

from .hulls import best_hull, extract_hull_candidates

LOOSE = ""  # 폴더 없이 올라온 낱개 파일들


@dataclass
class FileInfo:
    key: int
    rel_path: str  # 배치 루트 기준 posix 경로


@dataclass
class Proposal:
    title: str
    file_keys: list[int]
    best_hull: str | None
    hull_candidates: list[dict] = field(default_factory=list)


def _names(files: list[FileInfo]) -> list[str]:
    names: list[str] = []
    for f in files:
        names.extend(PurePosixPath(f.rel_path).parts)
    return names


def _title(label: str) -> str:
    return os.path.splitext(label)[0].replace("_", " ").strip() if label else ""


def _make(label: str, files: list[FileInfo], known: set[str]) -> Proposal:
    cands = extract_hull_candidates(_names(files), known)
    title = _title(label) or _title(PurePosixPath(files[0].rel_path).name)
    return Proposal(title=title, file_keys=[f.key for f in files], best_hull=best_hull(cands),
                    hull_candidates=[c.as_dict() for c in cands])


def propose(files: list[FileInfo], known: set[str]) -> list[Proposal]:
    top: dict[str, list[FileInfo]] = {}
    for f in files:
        parts = PurePosixPath(f.rel_path).parts
        top.setdefault(parts[0] if len(parts) > 1 else LOOSE, []).append(f)

    proposals: list[Proposal] = []
    for label, group in top.items():
        subs: dict[str, list[FileInfo]] = {}
        for f in group:
            parts = PurePosixPath(f.rel_path).parts
            subs.setdefault(parts[1] if label != LOOSE and len(parts) > 2 else "", []).append(f)
        sub_hulls = {s: best_hull(extract_hull_candidates(_names(fs), known)) for s, fs in subs.items() if s}
        distinct = {h for h in sub_hulls.values() if h}
        if len(distinct) >= 2:
            for s, fs in subs.items():
                proposals.append(_make(s or label, fs, known))
        else:
            proposals.append(_make(label, group, known))
    return proposals
```

- [ ] **Step 4: 통과 확인** — `.venv\Scripts\pytest.exe tests\test_proposal.py -v` → `5 passed`

- [ ] **Step 5: 커밋 (사용자)** — `git commit -m "✨ feat: Entry 묶음 제안"`

---

### Task 5: 파일 소유자 → 사번 (`ingest/owner.py`)

**Files:**
- Create: `backend\app\ingest\owner.py`, `backend\tests\test_owner.py`

PoC 실험 4 결과: 공유 폴더 파일 소유자가 `HDRND\a476854` 로 읽히고 사번과 일치. 그룹 소유(예: `BUILTIN\Administrators`)·조회 실패는 `None`.

- [ ] **Step 1: 실패하는 테스트**

```python
# backend/tests/test_owner.py
from app.ingest import owner


def test_owner_account_of_local_file_is_lowercase_user(tmp_path):
    p = tmp_path / "a.txt"
    p.write_text("x", encoding="utf-8")
    acc = owner.owner_account(p)
    assert acc is None or acc == acc.lower()


def test_owner_account_missing_file_is_none(tmp_path):
    assert owner.owner_account(tmp_path / "없음.txt") is None


def test_employee_for_account(db, make_user):
    make_user("A476854")
    assert owner.employee_for_account(db, "a476854") == "A476854"
    assert owner.employee_for_account(db, "b999999") is None
    assert owner.employee_for_account(db, None) is None
```

- [ ] **Step 2: 실패 확인** — `ImportError`

- [ ] **Step 3: 구현**

```python
# backend/app/ingest/owner.py
"""파일 소유자(Windows 보안 설명자)로 올린 사람을 추정한다(PoC 실험 4 로 검증된 방식)."""
import os

from sqlalchemy.orm import Session

from .. import models
from ..storage.paths import to_long


def owner_account(path: str | os.PathLike) -> str | None:
    """사용자 계정이 소유자면 소문자 계정명('a476854'), 그룹 소유·실패면 None."""
    try:
        import win32security

        sd = win32security.GetFileSecurity(to_long(path), win32security.OWNER_SECURITY_INFORMATION)
        name, _domain, sid_type = win32security.LookupAccountSid(None, sd.GetSecurityDescriptorOwner())
    except Exception:
        return None
    return name.lower() if sid_type == win32security.SidTypeUser else None


def employee_for_account(db: Session, account: str | None) -> str | None:
    if not account:
        return None
    employee_id = account.upper()
    exists = db.query(models.User.id).filter_by(employee_id=employee_id).first()
    return employee_id if exists else None
```

- [ ] **Step 4: 통과 확인** — `3 passed`

- [ ] **Step 5: 커밋 (사용자)** — `git commit -m "✨ feat: 파일 소유자로 올린 사람 추정"`

---

### Task 6: 작업 큐 (`jobs.py`)

**Files:**
- Create: `backend\app\jobs.py`, `backend\tests\test_jobs.py`

- [ ] **Step 1: 실패하는 테스트**

```python
# backend/tests/test_jobs.py
from datetime import datetime, timedelta

from app import jobs, models


def test_enqueue_claim_complete(db):
    jobs.enqueue(db, "process_batch", 7)
    db.commit()
    job = jobs.claim_next(db)
    assert (job.type, job.target_id, job.state, job.attempts) == ("process_batch", 7, "running", 1)
    assert jobs.claim_next(db) is None
    jobs.complete(db, job)
    assert db.get(models.Job, job.id).state == "done"


def test_fail_retries_with_backoff_then_gives_up(db):
    jobs.enqueue(db, "process_batch", 1)
    db.commit()
    job = jobs.claim_next(db)
    jobs.fail(db, job, "공유 폴더 끊김", max_attempts=2)
    assert job.state == "queued" and job.run_after > datetime.now()
    assert jobs.claim_next(db) is None  # 아직 run_after 전
    assert jobs.claim_next(db, now=datetime.now() + timedelta(minutes=5)).id == job.id
    jobs.fail(db, job, "또 실패", max_attempts=2)
    assert job.state == "failed" and job.last_error == "또 실패"
```

- [ ] **Step 2: 실패 확인** — `ImportError`

- [ ] **Step 3: 구현**

```python
# backend/app/jobs.py
"""MySQL 기반 작업 큐(설계 §2: Redis 없음). 워커 하나가 돌지만 SKIP LOCKED 로 중복 실행을 막는다."""
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from . import models

RETRY_STEP = timedelta(minutes=1)


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def enqueue(db: Session, job_type: str, target_id: int) -> models.Job:
    job = models.Job(type=job_type, target_id=target_id)
    db.add(job)
    return job


def claim_next(db: Session, now: datetime | None = None) -> models.Job | None:
    now = now or _now()
    job = (
        db.query(models.Job)
        .filter(models.Job.state == "queued", models.Job.run_after <= now)
        .order_by(models.Job.id)
        .with_for_update(skip_locked=True)
        .first()
    )
    if job is None:
        db.rollback()
        return None
    job.state = "running"
    job.attempts += 1
    db.commit()
    return job


def complete(db: Session, job: models.Job) -> None:
    job.state = "done"
    job.last_error = None
    db.commit()


def fail(db: Session, job: models.Job, error: str, *, max_attempts: int = 3) -> None:
    job.last_error = error[:2000]
    if job.attempts >= max_attempts:
        job.state = "failed"
    else:
        job.state = "queued"
        job.run_after = _now() + RETRY_STEP * job.attempts
    db.commit()
```

- [ ] **Step 4: 통과 확인** — `2 passed`

- [ ] **Step 5: 커밋 (사용자)** — `git commit -m "✨ feat: MySQL 작업 큐"`

---

### Task 7: Inbox 감시 (`ingest/inbox.py` — 복사 완료 감지)

**Files:**
- Create: `backend\app\ingest\inbox.py`, `backend\tests\test_inbox.py`

규칙(설계 §5.1): Inbox 바로 아래 **폴더 1개 = 항목 1개**. 낱개 파일은 **같은 소유자가 2분 안에 넣은 것 = 항목 1개**. **60초 동안 (파일 수·총 크기·최신 수정 시각) 서명이 그대로**이고 모든 파일이 쓰기 모드로 열리면 복사 완료. 이름이 `_` 로 시작하는 항목(예: `_web`)과 제외 규칙에 걸리는 항목은 건너뛴다. 시계는 주입해 테스트한다.

- [ ] **Step 1: 실패하는 테스트**

```python
# backend/tests/test_inbox.py
import os
import time

from app.ingest import inbox


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def _watcher(storage, clock, owner="a476854"):
    return inbox.InboxWatcher(storage, stable_seconds=60, clock=clock, owner_of=lambda p: owner)


def test_folder_ready_only_after_stable_period(storage):
    d = storage.inbox / "3496_검토"
    d.mkdir()
    (d / "a.bdf").write_text("GRID", encoding="utf-8")
    clock = Clock()
    w = _watcher(storage, clock)
    assert w.poll() == []            # 처음 봄
    clock.t += 30
    assert w.poll() == []            # 아직 60초 안 됨
    clock.t += 31
    [item] = w.poll()
    assert (item.kind, item.name, item.owner) == ("folder", "3496_검토", "a476854")


def test_change_resets_stability(storage):
    d = storage.inbox / "x"
    d.mkdir()
    (d / "a.bdf").write_text("1", encoding="utf-8")
    clock = Clock()
    w = _watcher(storage, clock)
    w.poll()
    clock.t += 50
    (d / "b.bdf").write_text("2", encoding="utf-8")  # 복사 진행 중
    assert w.poll() == []
    clock.t += 59
    assert w.poll() == []
    clock.t += 2
    assert len(w.poll()) == 1


def test_loose_files_grouped_by_owner_and_time(storage):
    now = time.time()
    for name, age in [("3496_a.bdf", 0), ("3496_a.f06", 30), ("다른날.pdf", 1000)]:
        p = storage.inbox / name
        p.write_text("x", encoding="utf-8")
        os.utime(p, (now - age, now - age))
    clock = Clock()
    w = _watcher(storage, clock)
    w.poll()
    clock.t += 61
    items = sorted(w.poll(), key=lambda i: len(i.paths))
    assert [len(i.paths) for i in items] == [1, 2]
    assert all(i.kind == "loose" for i in items)


def test_reserved_and_excluded_names_skipped(storage):
    (storage.inbox / "_web").mkdir()
    (storage.inbox / "Thumbs.db").write_text("x", encoding="utf-8")
    clock = Clock()
    w = _watcher(storage, clock)
    w.poll()
    clock.t += 61
    assert w.poll() == []


def test_locked_file_is_not_ready(storage, monkeypatch):
    d = storage.inbox / "잠김"
    d.mkdir()
    (d / "a.bdf").write_text("x", encoding="utf-8")
    monkeypatch.setattr(inbox, "_all_writable", lambda paths: False)
    clock = Clock()
    w = _watcher(storage, clock)
    w.poll()
    clock.t += 61
    assert w.poll() == []
```

- [ ] **Step 2: 실패 확인** — `ImportError`

- [ ] **Step 3: 구현**

```python
# backend/app/ingest/inbox.py
"""00_Inbox 감시 — 복사가 끝난 항목을 골라낸다(설계 §5.1).

SMB 변경 알림은 믿기 어려워 주기적으로 훑는다. '복사 완료' 는 일정 시간 동안
(파일 수·총 크기·최신 수정 시각) 서명이 변하지 않고 모든 파일을 쓰기 모드로 열 수 있는 것.
워커 재시작 시 관찰 기록은 사라지므로 다시 60초를 기다린다(안전한 쪽).
"""
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from ..storage.paths import StoragePaths, to_long
from .owner import owner_account
from .rules import is_excluded

STABLE_SECONDS = 60
LOOSE_GROUP_SECONDS = 120


@dataclass
class ReadyItem:
    kind: str                 # folder | loose
    name: str
    paths: list[Path] = field(default_factory=list)
    owner: str | None = None


def _files_under(path: Path) -> list[Path]:
    if not path.is_dir():
        return [path]
    out = []
    for dirpath, _dirs, files in os.walk(to_long(path)):
        out.extend(Path(dirpath) / f for f in files)
    return out


def _signature(path: Path) -> tuple:
    files = _files_under(path)
    total, newest = 0, 0.0
    for f in files:
        st = os.stat(to_long(f))
        total += st.st_size
        newest = max(newest, st.st_mtime)
    return (len(files), total, newest)


def _all_writable(paths: list[Path]) -> bool:
    for p in paths:
        try:
            with open(to_long(p), "rb+"):
                pass
        except OSError:
            return False
    return True


class InboxWatcher:
    def __init__(self, storage: StoragePaths, *, stable_seconds: float = STABLE_SECONDS,
                 clock: Callable[[], float] = time.monotonic,
                 owner_of: Callable[[Path], str | None] = owner_account):
        self.storage = storage
        self.stable_seconds = stable_seconds
        self.clock = clock
        self.owner_of = owner_of
        self._seen: dict[str, tuple[tuple, float]] = {}

    def poll(self) -> list[ReadyItem]:
        now = self.clock()
        ready_folders: list[ReadyItem] = []
        ready_loose: list[Path] = []
        current: set[str] = set()
        with os.scandir(to_long(self.storage.inbox)) as it:
            entries = list(it)
        for entry in entries:
            name = entry.name
            if name.startswith("_") or is_excluded(name):
                continue
            path = self.storage.inbox / name
            current.add(name)
            try:
                sig = _signature(path)
            except OSError:
                continue
            prev = self._seen.get(name)
            if prev is None or prev[0] != sig:
                self._seen[name] = (sig, now)
                continue
            if now - prev[1] < self.stable_seconds or not _all_writable(_files_under(path)):
                continue
            if entry.is_dir():
                ready_folders.append(ReadyItem("folder", name, [path], self.owner_of(path)))
            else:
                ready_loose.append(path)
        for gone in set(self._seen) - current:
            del self._seen[gone]
        return ready_folders + self._group_loose(ready_loose)

    def _group_loose(self, paths: list[Path]) -> list[ReadyItem]:
        keyed = sorted(
            ((self.owner_of(p) or "", os.stat(to_long(p)).st_mtime, p) for p in paths),
            key=lambda t: (t[0], t[1]),
        )
        groups: list[ReadyItem] = []
        last_owner, last_time = None, None
        for owner, mtime, p in keyed:
            if groups and owner == last_owner and mtime - last_time <= LOOSE_GROUP_SECONDS:
                groups[-1].paths.append(p)
            else:
                groups.append(ReadyItem("loose", p.name, [p], owner or None))
            last_owner, last_time = owner, mtime
        return groups

    def forget(self, item: ReadyItem) -> None:
        for p in item.paths:
            self._seen.pop(p.name, None)
```

- [ ] **Step 4: 통과 확인** — `5 passed`

- [ ] **Step 5: 커밋 (사용자)** — `git commit -m "✨ feat: Inbox 복사 완료 감지"`

---

### Task 8: 배치로 받기 (`stage_item`) 

**Files:**
- Modify: `backend\app\ingest\inbox.py` (함수 추가)
- Create: `backend\tests\test_stage.py`

`10_Vault\_staging\<배치키>\` 로 **rename** 한다(같은 공유 폴더 안이라 즉시·평문 유지). 폴더 항목은 폴더째(`<키>\<폴더명>\...`), 낱개는 `<키>\<파일>`. 배치 행 생성 + `process_batch` 작업 등록 + 감사 `BATCH_RECEIVED`. 이동 도중 실패하면 이미 옮긴 것을 되돌리고 예외를 올린다.

- [ ] **Step 1: 실패하는 테스트**

```python
# backend/tests/test_stage.py
import pytest

from app import models
from app.ingest.inbox import ReadyItem, stage_item


def test_stage_folder(db, storage, make_user):
    make_user("A476854")
    d = storage.inbox / "3496_검토"
    (d / "model").mkdir(parents=True)
    (d / "model" / "a.bdf").write_text("GRID", encoding="utf-8")
    batch = stage_item(db, storage, ReadyItem("folder", "3496_검토", [d], "a476854"))
    assert not d.exists()
    assert (storage.staging / batch.key / "3496_검토" / "model" / "a.bdf").is_file()
    assert (batch.source, batch.original_name, batch.uploader, batch.uploader_guess) == \
        ("inbox", "3496_검토", "A476854", "A476854")
    assert db.query(models.Job).filter_by(type="process_batch", target_id=batch.id).count() == 1
    assert db.query(models.AuditLog).filter_by(action="BATCH_RECEIVED").count() == 1


def test_stage_loose_files_unknown_owner(db, storage):
    a, b = storage.inbox / "a.bdf", storage.inbox / "a.f06"
    a.write_text("1", encoding="utf-8")
    b.write_text("2", encoding="utf-8")
    batch = stage_item(db, storage, ReadyItem("loose", "a.bdf", [a, b], "z000000"))
    assert sorted(p.name for p in (storage.staging / batch.key).iterdir()) == ["a.bdf", "a.f06"]
    assert batch.uploader is None and batch.owner_account == "z000000"


def test_stage_rolls_back_on_failure(db, storage, monkeypatch):
    a, b = storage.inbox / "a.bdf", storage.inbox / "b.bdf"
    a.write_text("1", encoding="utf-8")
    b.write_text("2", encoding="utf-8")
    import app.ingest.inbox as mod

    real = mod.os.rename
    calls = {"n": 0}

    def flaky(src, dst):
        calls["n"] += 1
        if calls["n"] == 2:
            raise OSError("잠김")
        return real(src, dst)

    monkeypatch.setattr(mod.os, "rename", flaky)
    with pytest.raises(OSError):
        stage_item(db, storage, ReadyItem("loose", "a.bdf", [a, b], None))
    assert a.exists() and b.exists()
    assert db.query(models.Batch).count() == 0
```

- [ ] **Step 2: 실패 확인** — `ImportError: cannot import name 'stage_item'`

- [ ] **Step 3: `inbox.py` 에 추가** (import 에 `uuid`, `from datetime import datetime`, `from sqlalchemy.orm import Session`, `from .. import audit, jobs, models`, `from .owner import employee_for_account` 추가)

```python
def new_batch_key() -> str:
    return f"{datetime.now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:4]}"


def stage_item(db: Session, storage: StoragePaths, item: ReadyItem) -> models.Batch:
    """ReadyItem 을 staging 으로 옮기고 배치를 만든다. 이동 실패 시 되돌리고 예외."""
    key = new_batch_key()
    dest_root = storage.staging / key
    os.makedirs(to_long(dest_root), exist_ok=True)
    moved: list[tuple[Path, Path]] = []
    try:
        for src in item.paths:
            dst = dest_root / src.name
            os.rename(to_long(src), to_long(dst))
            moved.append((src, dst))
    except OSError:
        for src, dst in reversed(moved):
            try:
                os.rename(to_long(dst), to_long(src))
            except OSError:
                pass
        try:
            os.rmdir(to_long(dest_root))
        except OSError:
            pass
        raise

    guess = employee_for_account(db, item.owner)
    batch = models.Batch(key=key, source="inbox", original_name=item.name, owner_account=item.owner,
                         uploader_guess=guess, uploader=guess, state="staged")
    db.add(batch)
    db.flush()
    jobs.enqueue(db, "process_batch", batch.id)
    audit.record(db, storage, actor=guess, action="BATCH_RECEIVED", target_type="batch", target_id=key,
                 after={"name": item.name, "files": len(item.paths), "owner": item.owner})
    return batch
```

- [ ] **Step 4: 통과 확인** — `3 passed`

- [ ] **Step 5: 커밋 (사용자)** — `git commit -m "✨ feat: Inbox 항목을 배치로 받아 staging 으로 이동"`

---

### Task 9: 배치 처리 (`ingest/process.py`)

**Files:**
- Create: `backend\app\ingest\process.py`, `backend\app\entries\__init__.py`, `backend\tests\test_process.py`

처리: staging 을 훑어 제외 파일은 지우고 `excluded` 에 기록 → 나머지는 SHA-256·분류·DRM 머리(`HHIDRMC`)·중복(같은 해시가 vault 에 있으면 `duplicate_of_id`) → `propose()` → 제안마다 초안 Entry(EntryID 발급, 추정 호선은 `entry_hulls` 주 호선으로, 근거는 `hull_evidence`) → 대상 Entry 가 지정된 배치(`target_entry_id`)는 모든 초안의 `merge_into_id` 로 → 확정된 Entry 중 같은 주 호선·제목 단어가 절반 이상 겹치면 `suggested_entry_id`. 배치 상태 `processed`.

- [ ] **Step 1: 실패하는 테스트**

```python
# backend/tests/test_process.py
from app import models
from app.ingest.process import process_batch


def _batch(db, storage, key="20260929-000000-aaaa", uploader="A476854", target=None):
    b = models.Batch(key=key, source="inbox", original_name="x", uploader=uploader, target_entry_id=target)
    db.add(b)
    db.commit()
    (storage.staging / key).mkdir(parents=True)
    return b


def _write(path, data=b"GRID"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def test_process_creates_files_and_draft(db, storage):
    b = _batch(db, storage)
    root = storage.staging / b.key / "3496_Mooring_검토"
    _write(root / "model" / "3496_FWD.bdf")
    _write(root / "report" / "검토.pptx", b"PK\x03\x04")
    _write(root / "~$검토.pptx", b"lock")
    process_batch(db, storage, b)
    db.expire_all()
    [e] = db.query(models.Entry).all()
    assert (e.status, e.title, e.uploaded_by, e.batch_id) == ("draft", "3496 Mooring 검토", "A476854", b.id)
    assert e.entry_id == f"E{e.id:06d}"
    assert db.query(models.EntryHull).filter_by(entry_id=e.id, hull_no="3496", is_primary=True).count() == 1
    files = db.query(models.File).order_by(models.File.rel_path).all()
    assert [(f.rel_path, f.kind) for f in files] == [
        ("3496_Mooring_검토/model/3496_FWD.bdf", "model"),
        ("3496_Mooring_검토/report/검토.pptx", "report"),
    ]
    assert all(f.entry_id == e.id and len(f.sha256) == 64 for f in files)
    assert not (root / "~$검토.pptx").exists()
    assert db.get(models.Batch, b.id).excluded == [{"name": "3496_Mooring_검토/~$검토.pptx", "size": 4}]
    assert db.get(models.Batch, b.id).state == "processed"


def test_drm_and_duplicate_flags(db, storage):
    old = _batch(db, storage, key="20260101-000000-old0")
    db.add(models.File(batch_id=old.id, rel_path="r.pdf", name="r.pdf", ext=".pdf", kind="report",
                       size=4, sha256=__import__("hashlib").sha256(b"%PDF").hexdigest(), location="vault"))
    db.commit()
    b = _batch(db, storage)
    _write(storage.staging / b.key / "r.pdf", b"%PDF")
    _write(storage.staging / b.key / "enc.pptx", b"HHIDRMC\x00\x00")
    process_batch(db, storage, b)
    db.expire_all()
    by_name = {f.name: f for f in db.query(models.File).filter_by(batch_id=b.id)}
    assert by_name["r.pdf"].duplicate_of_id is not None
    assert by_name["enc.pptx"].drm_encrypted is True


def test_target_entry_sets_merge_into(db, storage):
    target = models.Entry(title="기존", status="confirmed")
    db.add(target)
    db.commit()
    b = _batch(db, storage, target=target.id)
    _write(storage.staging / b.key / "추가보고서.pdf", b"%PDF")
    process_batch(db, storage, b)
    db.expire_all()
    draft = db.query(models.Entry).filter_by(status="draft").one()
    assert draft.merge_into_id == target.id


def test_suggests_similar_confirmed_entry(db, storage):
    existing = models.Entry(title="3496 Mooring 검토", status="confirmed")
    db.add(existing)
    db.flush()
    db.add(models.EntryHull(entry_id=existing.id, hull_no="3496", is_primary=True))
    db.commit()
    b = _batch(db, storage)
    _write(storage.staging / b.key / "3496_Mooring_보고서" / "r.pdf", b"%PDF")
    process_batch(db, storage, b)
    db.expire_all()
    draft = db.query(models.Entry).filter_by(status="draft").one()
    assert draft.suggested_entry_id == existing.id
```

- [ ] **Step 2: 실패 확인** — `ModuleNotFoundError`

- [ ] **Step 3: 구현**

`backend\app\entries\__init__.py`:
```python
"""Entry(해석 건) — 조회 변환·수정·확정·휴지통."""
```

```python
# backend/app/ingest/process.py
"""배치 처리: 제외·해시·분류·DRM·중복 → 묶음 제안 → 초안 Entry (설계 §5.2~5.4)."""
import os
import re
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from .. import models
from ..storage.paths import StoragePaths, to_long
from .hashing import sha256_of
from .proposal import FileInfo, propose
from .rules import classify, is_excluded

DRM_MAGIC = b"HHIDRMC"
WORD = re.compile(r"[0-9A-Za-z가-힣]+")


def _words(title: str) -> set[str]:
    return {w.lower() for w in WORD.findall(title or "")}


def _find_similar(db: Session, hull_no: str | None, title: str) -> int | None:
    if not hull_no:
        return None
    mine = _words(title)
    rows = (
        db.query(models.Entry)
        .join(models.EntryHull, models.EntryHull.entry_id == models.Entry.id)
        .filter(models.Entry.status == "confirmed", models.EntryHull.hull_no == hull_no)
        .all()
    )
    for e in rows:
        theirs = _words(e.title)
        if mine and theirs and len(mine & theirs) / len(mine | theirs) >= 0.5:
            return e.id
    return None


def process_batch(db: Session, storage: StoragePaths, batch: models.Batch) -> None:
    root = storage.staging / batch.key
    long_root = to_long(root)
    excluded: list[dict] = []
    infos: list[FileInfo] = []
    rows: dict[int, models.File] = {}

    for dirpath, _dirs, files in os.walk(long_root):
        for name in files:
            full = os.path.join(dirpath, name)
            rel = Path(os.path.relpath(full, long_root)).as_posix()
            size = os.path.getsize(full)
            if is_excluded(name):
                os.remove(full)
                excluded.append({"name": rel, "size": size})
                continue
            with open(full, "rb") as fh:
                head = fh.read(16)
            digest = sha256_of(full)
            dup = (
                db.query(models.File.id)
                .filter(models.File.sha256 == digest, models.File.location == "vault")
                .first()
            )
            f = models.File(batch_id=batch.id, rel_path=rel, name=name, ext=os.path.splitext(name)[1].lower(),
                            kind=classify(name), size=size, sha256=digest,
                            duplicate_of_id=dup[0] if dup else None,
                            drm_encrypted=head.startswith(DRM_MAGIC), location="staging")
            db.add(f)
            db.flush()
            rows[f.id] = f
            infos.append(FileInfo(key=f.id, rel_path=rel))

    known = {h for (h,) in db.query(models.Hull.hull_no)}
    for p in propose(infos, known):
        entry = models.Entry(title=p.title, status="draft", batch_id=batch.id, uploaded_by=batch.uploader,
                             hull_evidence=p.hull_candidates, merge_into_id=batch.target_entry_id)
        db.add(entry)
        db.flush()
        entry.entry_id = f"E{entry.id:06d}"
        if p.best_hull:
            db.add(models.EntryHull(entry_id=entry.id, hull_no=p.best_hull, is_primary=True))
        if batch.target_entry_id is None:
            entry.suggested_entry_id = _find_similar(db, p.best_hull, p.title)
        for key in p.file_keys:
            rows[key].entry_id = entry.id

    batch.excluded = excluded
    batch.state = "processed"
    batch.processed_at = datetime.now().replace(microsecond=0)
    db.commit()
```

- [ ] **Step 4: 통과 확인** — `4 passed`

- [ ] **Step 5: 커밋 (사용자)** — `git commit -m "✨ feat: 배치 처리(해시·분류·DRM·중복·초안 Entry)"`

---

### Task 10: Entry 조회·수정 (`entries/service.py` 1부)

**Files:**
- Create: `backend\app\entries\service.py`, `backend\tests\test_entry_service.py`

권한: 초안은 배치 올린 사람 또는 관리자만, 확정 Entry 는 로그인 사용자 누구나, 휴지통은 수정 불가. 낙관적 잠금: 요청의 `version` 이 현재와 다르면 409 `version_conflict`. 호선 목록 첫 번째가 주 호선. 구역은 `tags(kind='zone')` get-or-create. 확정 Entry 수정은 감사 `ENTRY_UPDATE`(before/after) + `entry.json` 다시 쓰기(Task 11 의 `write_entry_files` — 이 태스크에서는 훅만 호출하고 Task 11 에서 구현).

- [ ] **Step 1: 실패하는 테스트**

```python
# backend/tests/test_entry_service.py
import pytest
from fastapi import HTTPException

from app import models
from app.entries import service


def _draft(db, uploaded_by="A100001", title="초안"):
    e = models.Entry(title=title, status="draft", uploaded_by=uploaded_by)
    db.add(e)
    db.flush()
    e.entry_id = f"E{e.id:06d}"
    db.commit()
    return e


def test_entry_to_dict_shape(db):
    e = _draft(db)
    db.add(models.EntryHull(entry_id=e.id, hull_no="3496", is_primary=True))
    db.add(models.Hull(hull_no="3496", ship_type="LNGC"))
    db.commit()
    d = service.entry_to_dict(db, e)
    assert d["entry_id"] == e.entry_id
    assert d["hulls"] == [{"hull_no": "3496", "ship_type": "LNGC", "is_primary": True}]
    assert d["zones"] == [] and d["files"] == [] and d["version"] == 1


def test_update_draft_by_uploader(db, storage, make_user):
    u = make_user("A100001")
    e = _draft(db)
    service.update_entry(db, storage, e, u, {"version": 1, "title": "3496 Mooring", "hulls": ["3370", "3496"],
                                             "zones": ["Fore Deck", "Bow"], "analysis_type": "Mooring"})
    d = service.entry_to_dict(db, e)
    assert d["title"] == "3496 Mooring" and d["version"] == 2
    assert [h["hull_no"] for h in d["hulls"]] == ["3370", "3496"] and d["hulls"][0]["is_primary"] is True
    assert d["zones"] == ["Bow", "Fore Deck"]
    assert db.query(models.AuditLog).count() == 0  # 초안 편집은 기록하지 않음


def test_update_draft_forbidden_for_others(db, storage, make_user):
    other = make_user("B200002")
    e = _draft(db)
    with pytest.raises(HTTPException) as ei:
        service.update_entry(db, storage, e, other, {"version": 1, "title": "x"})
    assert ei.value.status_code == 403


def test_version_conflict(db, storage, make_user):
    u = make_user("A100001")
    e = _draft(db)
    with pytest.raises(HTTPException) as ei:
        service.update_entry(db, storage, e, u, {"version": 5, "title": "x"})
    assert (ei.value.status_code, ei.value.detail) == (409, "version_conflict")


def test_invalid_hull_rejected(db, storage, make_user):
    u = make_user("A100001")
    e = _draft(db)
    with pytest.raises(HTTPException) as ei:
        service.update_entry(db, storage, e, u, {"version": 1, "hulls": ["34a6"]})
    assert ei.value.detail == "invalid_hull"
```

- [ ] **Step 2: 실패 확인** — `ImportError`

- [ ] **Step 3: 구현**

```python
# backend/app/entries/service.py
"""Entry 서비스 — 조회 변환·수정·호선/구역 (확정·휴지통은 Task 11·12 에서 추가)."""
import re

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import audit, models
from ..storage.paths import StoragePaths

HULL_PATTERN = re.compile(r"^[0-9]{4}$")
EDITABLE_FIELDS = ("title", "analysis_type", "description", "analysis_period")
PERIOD_PATTERN = re.compile(r"^[0-9]{4}-(0[1-9]|1[0-2])$")


def hulls_of(db: Session, entry: models.Entry) -> list[models.EntryHull]:
    return (db.query(models.EntryHull).filter_by(entry_id=entry.id)
            .order_by(models.EntryHull.is_primary.desc(), models.EntryHull.hull_no).all())


def zones_of(db: Session, entry: models.Entry) -> list[str]:
    rows = (db.query(models.Tag.value).join(models.EntryTag, models.EntryTag.tag_id == models.Tag.id)
            .filter(models.EntryTag.entry_id == entry.id, models.Tag.kind == "zone")
            .order_by(models.Tag.value).all())
    return [v for (v,) in rows]


def file_to_dict(f: models.File) -> dict:
    return {"id": f.id, "rel_path": f.rel_path, "name": f.name, "kind": f.kind, "size": f.size,
            "sha256": f.sha256, "drm_encrypted": f.drm_encrypted, "duplicate_of_id": f.duplicate_of_id,
            "location": f.location}


def entry_to_dict(db: Session, entry: models.Entry) -> dict:
    hulls = hulls_of(db, entry)
    ship = {h.hull_no: h.ship_type for h in
            db.query(models.Hull).filter(models.Hull.hull_no.in_([x.hull_no for x in hulls]))} if hulls else {}
    files = db.query(models.File).filter_by(entry_id=entry.id).order_by(models.File.rel_path).all()
    return {
        "id": entry.id, "entry_id": entry.entry_id, "status": entry.status, "title": entry.title,
        "analysis_type": entry.analysis_type, "description": entry.description,
        "analysis_period": entry.analysis_period, "version": entry.version,
        "hulls": [{"hull_no": h.hull_no, "ship_type": ship.get(h.hull_no), "is_primary": bool(h.is_primary)}
                  for h in hulls],
        "zones": zones_of(db, entry),
        "hull_evidence": entry.hull_evidence or [],
        "uploaded_by": entry.uploaded_by, "confirmed_by": entry.confirmed_by,
        "confirmed_at": entry.confirmed_at.isoformat() if entry.confirmed_at else None,
        "batch_id": entry.batch_id, "merge_into_id": entry.merge_into_id,
        "suggested_entry_id": entry.suggested_entry_id, "vault_rel": entry.vault_rel,
        "files": [file_to_dict(f) for f in files],
    }


def snapshot(db: Session, entry: models.Entry) -> dict:
    d = entry_to_dict(db, entry)
    return {k: d[k] for k in ("title", "analysis_type", "description", "analysis_period", "zones")} | {
        "hulls": [h["hull_no"] for h in d["hulls"]]}


def can_edit_draft(user: models.User, entry: models.Entry) -> bool:
    return user.is_admin or (entry.uploaded_by is not None and entry.uploaded_by == user.employee_id)


def ensure_editable(user: models.User, entry: models.Entry) -> None:
    if entry.status == "trashed":
        raise HTTPException(status_code=409, detail="entry_trashed")
    if entry.status == "draft" and not can_edit_draft(user, entry):
        raise HTTPException(status_code=403, detail="not_uploader")


def set_hulls(db: Session, entry: models.Entry, hull_nos: list[str]) -> None:
    clean = list(dict.fromkeys(h.strip() for h in hull_nos if h.strip()))
    if any(not HULL_PATTERN.fullmatch(h) for h in clean):
        raise HTTPException(status_code=422, detail="invalid_hull")
    db.query(models.EntryHull).filter_by(entry_id=entry.id).delete(synchronize_session=False)
    for i, h in enumerate(clean):
        db.add(models.EntryHull(entry_id=entry.id, hull_no=h, is_primary=(i == 0)))


def set_zones(db: Session, entry: models.Entry, values: list[str]) -> None:
    db.query(models.EntryTag).filter_by(entry_id=entry.id).delete(synchronize_session=False)
    for v in dict.fromkeys(x.strip() for x in values if x.strip()):
        tag = db.query(models.Tag).filter_by(kind="zone", value=v[:100]).first()
        if tag is None:
            tag = models.Tag(kind="zone", value=v[:100])
            db.add(tag)
            db.flush()
        db.add(models.EntryTag(entry_id=entry.id, tag_id=tag.id))


def update_entry(db: Session, storage: StoragePaths, entry: models.Entry, user: models.User,
                 patch: dict, ip: str | None = None) -> models.Entry:
    ensure_editable(user, entry)
    if patch.get("version") != entry.version:
        raise HTTPException(status_code=409, detail="version_conflict")
    period = patch.get("analysis_period")
    if period and not PERIOD_PATTERN.fullmatch(period):
        raise HTTPException(status_code=422, detail="invalid_period")
    before = snapshot(db, entry) if entry.status == "confirmed" else None
    for field_name in EDITABLE_FIELDS:
        if field_name in patch:
            value = patch[field_name]
            setattr(entry, field_name, (value or "").strip() if field_name == "title" else (value or None))
    if "hulls" in patch:
        set_hulls(db, entry, patch["hulls"] or [])
    if "zones" in patch:
        set_zones(db, entry, patch["zones"] or [])
    entry.version += 1
    db.flush()
    if entry.status == "confirmed":
        from .files import write_entry_files

        audit.record(db, storage, actor=user.employee_id, action="ENTRY_UPDATE", target_type="entry",
                     target_id=entry.entry_id, before=before, after=snapshot(db, entry), ip=ip)
        write_entry_files(db, storage, entry)
    else:
        db.commit()
    return entry
```

- [ ] **Step 4: 통과 확인** — `5 passed` (확정 Entry 수정 경로는 Task 11 에서 테스트)

- [ ] **Step 5: 커밋 (사용자)** — `git commit -m "✨ feat: Entry 조회 변환·수정·호선/구역"`

---

### Task 11: 확정 — Vault 이동·entry.json (`entries/files.py`, `service.confirm`)

**Files:**
- Create: `backend\app\entries\files.py`, `backend\tests\test_confirm.py`
- Modify: `backend\app\entries\service.py` (confirm 추가)

- 확정 권한: 배치 올린 사람. 관리자는 배치 수신 30일 경과 시 대신 확정. 제목이 비면 422 `title_required`.
- 일반 확정: `vault_rel = <확정 연도>/<EntryID>`, 파일을 `10_Vault\<vault_rel>\files\<rel_path>` 로 rename(이름 충돌 시 ` (2)` 접미), `entry.json`·`_INFO.txt` 작성, 호선 행 보장, 감사 `ENTRY_CONFIRM`.
- 기존 Entry 에 추가(`merge_into_id`): 대상의 files 로 이동, 초안 삭제, 대상 version+1, 감사 `ENTRY_FILES_ADDED`.
- 이동 중 실패: 이미 옮긴 파일을 되돌리고 503 `storage_error`.
- 배치에 남은 초안이 없으면 배치 `done`, staging 빈 폴더 정리.

- [ ] **Step 1: 실패하는 테스트**

```python
# backend/tests/test_confirm.py
import json
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException

from app import models
from app.entries import service


def _setup(db, storage, uploader="A100001", rels=("3496_검토/model/a.bdf", "3496_검토/r.pdf")):
    b = models.Batch(key="20260929-000000-bbbb", source="inbox", original_name="3496_검토", uploader=uploader)
    db.add(b)
    db.flush()
    e = models.Entry(title="3496 검토", status="draft", batch_id=b.id, uploaded_by=uploader)
    db.add(e)
    db.flush()
    e.entry_id = f"E{e.id:06d}"
    db.add(models.EntryHull(entry_id=e.id, hull_no="3496", is_primary=True))
    for rel in rels:
        p = storage.staging / b.key / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"data")
        db.add(models.File(batch_id=b.id, entry_id=e.id, rel_path=rel, name=p.name, ext=p.suffix,
                           kind="model", size=4, sha256="a" * 64))
    db.commit()
    return b, e


def test_confirm_moves_to_vault_and_writes_metadata(db, storage, make_user):
    u = make_user("A100001", name="권혁민")
    b, e = _setup(db, storage)
    service.confirm(db, storage, e, u)
    db.expire_all()
    e = db.get(models.Entry, e.id)
    year = datetime.now().year
    assert (e.status, e.vault_rel, e.confirmed_by) == ("confirmed", f"{year}/{e.entry_id}", "A100001")
    base = storage.vault / str(year) / e.entry_id
    assert (base / "files" / "3496_검토" / "model" / "a.bdf").is_file()
    meta = json.loads((base / "entry.json").read_text(encoding="utf-8"))
    assert meta["entry_id"] == e.entry_id and meta["hulls"][0]["hull_no"] == "3496"
    assert len(meta["files"]) == 2
    assert "3496 검토" in (base / "_INFO.txt").read_text(encoding="utf-8")
    assert all(f.location == "vault" for f in db.query(models.File))
    assert db.get(models.Hull, "3496") is not None
    assert db.get(models.Batch, b.id).state == "done"
    assert not (storage.staging / b.key).exists()
    assert db.query(models.AuditLog).filter_by(action="ENTRY_CONFIRM").count() == 1


def test_only_uploader_can_confirm(db, storage, make_user):
    other = make_user("B200002")
    _, e = _setup(db, storage)
    with pytest.raises(HTTPException) as ei:
        service.confirm(db, storage, e, other)
    assert ei.value.status_code == 403


def test_admin_can_confirm_stale_batch(db, storage, make_user):
    admin = make_user("C300003", is_admin=True)
    b, e = _setup(db, storage)
    with pytest.raises(HTTPException):
        service.confirm(db, storage, e, admin)
    b.received_at = datetime.now() - timedelta(days=31)
    db.commit()
    service.confirm(db, storage, e, admin)
    assert db.get(models.Entry, e.id).status == "confirmed"


def test_title_required(db, storage, make_user):
    u = make_user("A100001")
    _, e = _setup(db, storage)
    e.title = "  "
    db.commit()
    with pytest.raises(HTTPException) as ei:
        service.confirm(db, storage, e, u)
    assert ei.value.detail == "title_required"


def test_move_failure_rolls_back(db, storage, make_user, monkeypatch):
    u = make_user("A100001")
    b, e = _setup(db, storage)
    import app.entries.files as files_mod

    real = files_mod.os.rename
    n = {"i": 0}

    def flaky(src, dst):
        n["i"] += 1
        if n["i"] == 2:
            raise OSError("잠김")
        return real(src, dst)

    monkeypatch.setattr(files_mod.os, "rename", flaky)
    with pytest.raises(HTTPException) as ei:
        service.confirm(db, storage, e, u)
    assert ei.value.status_code == 503
    assert (storage.staging / b.key / "3496_검토" / "model" / "a.bdf").is_file()
    db.expire_all()
    assert db.get(models.Entry, e.id).status == "draft"


def test_merge_into_existing_entry(db, storage, make_user):
    u = make_user("A100001")
    b1, first = _setup(db, storage)
    service.confirm(db, storage, first, u)
    b2 = models.Batch(key="20260930-000000-cccc", source="inbox", original_name="추가", uploader="A100001",
                      target_entry_id=first.id)
    db.add(b2)
    db.flush()
    d = models.Entry(title="추가", status="draft", batch_id=b2.id, uploaded_by="A100001", merge_into_id=first.id)
    db.add(d)
    db.flush()
    d.entry_id = f"E{d.id:06d}"
    p = storage.staging / b2.key / "r.pdf"  # 기존과 같은 이름 → 충돌 접미
    p.parent.mkdir(parents=True)
    p.write_bytes(b"new")
    db.add(models.File(batch_id=b2.id, entry_id=d.id, rel_path="3496_검토/r.pdf", name="r.pdf", ext=".pdf",
                       kind="report", size=3, sha256="b" * 64))
    (storage.staging / b2.key / "3496_검토").mkdir()
    p.rename(storage.staging / b2.key / "3496_검토" / "r.pdf")
    db.commit()
    service.confirm(db, storage, d, u)
    db.expire_all()
    first = db.get(models.Entry, first.id)
    names = sorted(f.rel_path for f in db.query(models.File).filter_by(entry_id=first.id))
    assert names == ["3496_검토/model/a.bdf", "3496_검토/r (2).pdf", "3496_검토/r.pdf"]
    assert db.get(models.Entry, d.id) is None
    assert first.version == 2
    assert db.query(models.AuditLog).filter_by(action="ENTRY_FILES_ADDED").count() == 1
```

- [ ] **Step 2: 실패 확인** — `AttributeError: module 'app.entries.service' has no attribute 'confirm'`

- [ ] **Step 3: `backend\app\entries\files.py`**

```python
# backend/app/entries/files.py
"""Entry 파일 이동(실패 시 되돌림)과 메타데이터 파일(entry.json·_INFO.txt).

같은 공유 폴더 안에서 os.rename 으로만 옮긴다(PoC 실험 2: 이동 후 평문 유지).
WorkBench model_registry_storage.py 의 원칙과 같다 — 같은 볼륨 안 rename 은 원자적이다.
"""
import json
import os
from pathlib import Path, PurePosixPath

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..storage.paths import StoragePaths, to_long


def entry_dir(storage: StoragePaths, entry: models.Entry) -> Path:
    return storage.vault / Path(*PurePosixPath(entry.vault_rel).parts)


def unique_rel(files_root: Path, rel: str) -> str:
    """files_root 안에 rel 이 이미 있으면 'name (2).ext' 형태로 비어 있는 이름을 찾는다."""
    p = PurePosixPath(rel)
    candidate, n = p, 2
    while os.path.exists(to_long(files_root / Path(*candidate.parts))):
        candidate = p.with_name(f"{p.stem} ({n}){p.suffix}")
        n += 1
    return candidate.as_posix()


def move_all(moves: list[tuple[Path, Path]]) -> None:
    """(src, dst) 목록을 옮긴다. 하나라도 실패하면 옮긴 것을 되돌리고 503."""
    done: list[tuple[Path, Path]] = []
    try:
        for src, dst in moves:
            os.makedirs(to_long(dst.parent), exist_ok=True)
            os.rename(to_long(src), to_long(dst))
            done.append((src, dst))
    except OSError as exc:
        for src, dst in reversed(done):
            try:
                os.rename(to_long(dst), to_long(src))
            except OSError:
                pass
        raise HTTPException(status_code=503, detail="storage_error") from exc


def remove_empty_dirs(root: Path) -> None:
    long_root = to_long(root)
    if not os.path.isdir(long_root):
        return
    for dirpath, _dirs, _files in os.walk(long_root, topdown=False):
        try:
            os.rmdir(dirpath)
        except OSError:
            pass


def write_entry_files(db: Session, storage: StoragePaths, entry: models.Entry) -> None:
    """entry.json(DB 재구축 원천)과 사람용 _INFO.txt 를 쓴다(설계 §3·§4.1)."""
    from .service import entry_to_dict

    d = entry_to_dict(db, entry)
    meta = {k: d[k] for k in ("entry_id", "title", "analysis_type", "description", "analysis_period",
                              "hulls", "zones", "uploaded_by", "confirmed_by", "confirmed_at", "version")}
    meta["files"] = [{k: f[k] for k in ("rel_path", "kind", "size", "sha256")} for f in d["files"]]
    base = entry_dir(storage, entry)
    os.makedirs(to_long(base), exist_ok=True)
    with open(to_long(base / "entry.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
    hulls = ", ".join(h["hull_no"] + (f" ({h['ship_type']})" if h["ship_type"] else "") for h in d["hulls"])
    info = (f"{d['entry_id']}  {d['title']}\n호선: {hulls or '-'}\n구역: {', '.join(d['zones']) or '-'}\n"
            f"올린 사람: {d['uploaded_by'] or '-'}  확정: {d['confirmed_by'] or '-'} {d['confirmed_at'] or ''}\n"
            f"파일 {len(d['files'])}개 — 원본은 files 폴더. 이 폴더는 Logbook 이 관리합니다(직접 수정 금지).\n")
    with open(to_long(base / "_INFO.txt"), "w", encoding="utf-8") as fh:
        fh.write(info)
```

- [ ] **Step 4: `service.py` 에 추가** (상단 import 에 `from datetime import datetime, timedelta`, `from pathlib import Path, PurePosixPath`)

```python
ADMIN_TAKEOVER_DAYS = 30


def _now():
    return datetime.now().replace(microsecond=0)


def _check_confirmer(db: Session, user: models.User, entry: models.Entry) -> models.Batch | None:
    batch = db.get(models.Batch, entry.batch_id) if entry.batch_id else None
    if entry.uploaded_by and entry.uploaded_by == user.employee_id:
        return batch
    if user.is_admin and batch and batch.received_at <= datetime.now() - timedelta(days=ADMIN_TAKEOVER_DAYS):
        return batch
    raise HTTPException(status_code=403, detail="not_uploader")


def _finish_batch(db: Session, storage: StoragePaths, batch: models.Batch | None) -> None:
    from .files import remove_empty_dirs

    if batch is None:
        return
    left = db.query(models.Entry.id).filter_by(batch_id=batch.id, status="draft").count()
    if left == 0:
        batch.state = "done"
        remove_empty_dirs(storage.staging / batch.key)


def _ensure_hulls(db: Session, entry: models.Entry) -> None:
    for h in hulls_of(db, entry):
        if db.get(models.Hull, h.hull_no) is None:
            db.add(models.Hull(hull_no=h.hull_no))


def confirm(db: Session, storage: StoragePaths, entry: models.Entry, user: models.User,
            ip: str | None = None) -> models.Entry:
    from .files import entry_dir, move_all, unique_rel, write_entry_files

    if entry.status != "draft":
        raise HTTPException(status_code=409, detail="not_draft")
    batch = _check_confirmer(db, user, entry)
    files = db.query(models.File).filter_by(entry_id=entry.id).all()
    staging_root = storage.staging / batch.key if batch else None

    if entry.merge_into_id:
        target = db.get(models.Entry, entry.merge_into_id)
        if target is None or target.status != "confirmed":
            raise HTTPException(status_code=409, detail="target_not_confirmed")
        files_root = entry_dir(storage, target) / "files"
        plans = [(f, unique_rel(files_root, f.rel_path)) for f in files]
        move_all([(staging_root / Path(*PurePosixPath(f.rel_path).parts), files_root / Path(*PurePosixPath(r).parts))
                  for f, r in plans])
        for f, r in plans:
            f.entry_id, f.rel_path, f.location = target.id, r, "vault"
        db.delete(entry)
        target.version += 1
        db.flush()
        audit.record(db, storage, actor=user.employee_id, action="ENTRY_FILES_ADDED", target_type="entry",
                     target_id=target.entry_id, after={"files": [r for _, r in plans]}, ip=ip)
        write_entry_files(db, storage, target)
        _finish_batch(db, storage, batch)
        db.commit()
        return target

    if not (entry.title or "").strip():
        raise HTTPException(status_code=422, detail="title_required")
    now = _now()
    entry.vault_rel = f"{now.year}/{entry.entry_id}"
    files_root = entry_dir(storage, entry) / "files"
    move_all([(staging_root / Path(*PurePosixPath(f.rel_path).parts), files_root / Path(*PurePosixPath(f.rel_path).parts))
              for f in files])
    for f in files:
        f.location = "vault"
    entry.status, entry.confirmed_by, entry.confirmed_at = "confirmed", user.employee_id, now
    _ensure_hulls(db, entry)
    db.flush()
    audit.record(db, storage, actor=user.employee_id, action="ENTRY_CONFIRM", target_type="entry",
                 target_id=entry.entry_id, after=snapshot(db, entry) | {"files": len(files)}, ip=ip)
    write_entry_files(db, storage, entry)
    _finish_batch(db, storage, batch)
    db.commit()
    return entry
```
주의: `move_all` 이 503 을 던지면 DB 변경 전이므로 세션을 그대로 두면 된다(`vault_rel` 만 메모리에 바뀌어 있으니 호출 측 세션이 커밋하지 않게 — 테스트는 `expire_all` 로 확인). 예외 경로에서 `db.rollback()` 을 호출하도록 `confirm` 본문의 `move_all(...)` 두 곳을 `try: ... except HTTPException: db.rollback(); raise` 로 감싼다.

- [ ] **Step 5: 통과 확인** — `.venv\Scripts\pytest.exe tests\test_confirm.py -v` → `6 passed`, 그리고 전체 `-q`

- [ ] **Step 6: 커밋 (사용자)** — `git commit -m "✨ feat: 확정 — Vault 이동·entry.json·기존 Entry 에 추가"`

---

### Task 12: 휴지통·복원·쪼개기·합치기·파일 이동 (`service.py` 2부)

**Files:**
- Modify: `backend\app\entries\service.py`
- Create: `backend\tests\test_trash_split.py`

- 휴지통: 확정 Entry → `95_Trash\<EntryID>_<YYYYmmdd-HHMMSS>` 로 폴더째 rename, status `trashed`, 파일 location `trash`, 감사 `ENTRY_TRASH`(누구나). 초안 → 파일을 `95_Trash\draft_<EntryID>_<시각>\` 로 옮기고 `trashed`, 감사 `DRAFT_DISCARD`(올린 사람만).
- 복원: 확정됐던 Entry(`vault_rel` 있음)만. 원래 자리에 폴더가 있으면 409 `vault_conflict`. 감사 `ENTRY_RESTORE`, `entry.json` 다시 쓰기. 초안 복원은 409 `not_restorable`.
- 쪼개기: 초안의 파일 일부로 새 초안(같은 배치, 호선 근거·주 호선 복사). 합치기: 같은 배치의 다른 초안 파일을 모두 옮기고 그 초안 삭제. 파일 이동: 같은 배치 초안 사이만. 모두 올린 사람(또는 관리자)만, 초안만.

- [ ] **Step 1: 실패하는 테스트**

```python
# backend/tests/test_trash_split.py
import pytest
from fastapi import HTTPException

from app import models
from app.entries import service
from tests.test_confirm import _setup


def test_trash_and_restore_confirmed(db, storage, make_user):
    u = make_user("A100001")
    other = make_user("B200002")
    _, e = _setup(db, storage)
    service.confirm(db, storage, e, u)
    base = storage.vault / e.vault_rel.replace("/", "\\")
    service.trash(db, storage, e, other)  # 누구나 휴지통
    db.expire_all()
    e = db.get(models.Entry, e.id)
    assert e.status == "trashed" and not base.exists()
    assert (storage.trash / e.trash_rel / "entry.json").is_file()
    service.restore(db, storage, e, other)
    db.expire_all()
    e = db.get(models.Entry, e.id)
    assert e.status == "confirmed" and (base / "files").is_dir()
    actions = [a for (a,) in db.query(models.AuditLog.action)]
    assert "ENTRY_TRASH" in actions and "ENTRY_RESTORE" in actions


def test_restore_conflict(db, storage, make_user):
    u = make_user("A100001")
    _, e = _setup(db, storage)
    service.confirm(db, storage, e, u)
    service.trash(db, storage, e, u)
    (storage.vault / e.vault_rel.replace("/", "\\")).mkdir(parents=True)
    with pytest.raises(HTTPException) as ei:
        service.restore(db, storage, e, u)
    assert ei.value.detail == "vault_conflict"


def test_discard_draft_only_by_uploader(db, storage, make_user):
    u = make_user("A100001")
    other = make_user("B200002")
    b, e = _setup(db, storage)
    with pytest.raises(HTTPException):
        service.trash(db, storage, e, other)
    service.trash(db, storage, e, u)
    db.expire_all()
    assert db.get(models.Entry, e.id).status == "trashed"
    assert not any((storage.staging / b.key).rglob("*.bdf"))
    assert db.query(models.AuditLog).filter_by(action="DRAFT_DISCARD").count() == 1


def test_split_merge_and_move(db, storage, make_user):
    u = make_user("A100001")
    b, e = _setup(db, storage)
    f1, f2 = db.query(models.File).order_by(models.File.rel_path).all()
    new = service.split(db, e, u, [f2.id])
    assert new.batch_id == b.id and new.status == "draft"
    assert db.get(models.File, f2.id).entry_id == new.id
    assert [h.hull_no for h in service.hulls_of(db, new)] == ["3496"]
    service.move_file(db, db.get(models.File, f1.id), new, u)
    assert db.get(models.File, f1.id).entry_id == new.id
    service.merge(db, e, new, u)  # new 의 파일을 e 로 모두 옮기고 new 삭제
    assert db.get(models.Entry, new.id) is None
    assert {f.entry_id for f in db.query(models.File)} == {e.id}


def test_split_rejects_foreign_files(db, storage, make_user):
    u = make_user("A100001")
    _, e = _setup(db, storage)
    with pytest.raises(HTTPException) as ei:
        service.split(db, e, u, [999999])
    assert ei.value.detail == "file_not_in_entry"
```

- [ ] **Step 2: 실패 확인** — `AttributeError: ... 'trash'`

- [ ] **Step 3: `service.py` 에 추가**

```python
def _stamp() -> str:
    return f"{datetime.now():%Y%m%d-%H%M%S}"


def trash(db: Session, storage: StoragePaths, entry: models.Entry, user: models.User,
          ip: str | None = None) -> models.Entry:
    from .files import entry_dir, move_all

    if entry.status == "trashed":
        raise HTTPException(status_code=409, detail="entry_trashed")
    files = db.query(models.File).filter_by(entry_id=entry.id).all()
    if entry.status == "confirmed":
        rel = f"{entry.entry_id}_{_stamp()}"
        try:
            move_all([(entry_dir(storage, entry), storage.trash / rel)])
        except HTTPException:
            db.rollback()
            raise
        action = "ENTRY_TRASH"
    else:
        if not can_edit_draft(user, entry):
            raise HTTPException(status_code=403, detail="not_uploader")
        batch = db.get(models.Batch, entry.batch_id)
        rel = f"draft_{entry.entry_id}_{_stamp()}"
        src_root = storage.staging / batch.key
        try:
            move_all([(src_root / Path(*PurePosixPath(f.rel_path).parts), storage.trash / rel / Path(*PurePosixPath(f.rel_path).parts))
                      for f in files])
        except HTTPException:
            db.rollback()
            raise
        action = "DRAFT_DISCARD"
    before = snapshot(db, entry)
    for f in files:
        f.location = "trash"
    entry.status, entry.trash_rel = "trashed", rel
    entry.version += 1
    audit.record(db, storage, actor=user.employee_id, action=action, target_type="entry",
                 target_id=entry.entry_id, before=before, after={"trash_rel": rel}, ip=ip)
    if action == "DRAFT_DISCARD":
        _finish_batch(db, storage, db.get(models.Batch, entry.batch_id))
        db.commit()
    return entry


def restore(db: Session, storage: StoragePaths, entry: models.Entry, user: models.User,
            ip: str | None = None) -> models.Entry:
    from .files import entry_dir, move_all, write_entry_files

    if entry.status != "trashed" or not entry.vault_rel:
        raise HTTPException(status_code=409, detail="not_restorable")
    dest = entry_dir(storage, entry)
    if os.path.exists(to_long(dest)):
        raise HTTPException(status_code=409, detail="vault_conflict")
    try:
        move_all([(storage.trash / entry.trash_rel, dest)])
    except HTTPException:
        db.rollback()
        raise
    for f in db.query(models.File).filter_by(entry_id=entry.id):
        f.location = "vault"
    entry.status, entry.trash_rel = "confirmed", None
    entry.version += 1
    audit.record(db, storage, actor=user.employee_id, action="ENTRY_RESTORE", target_type="entry",
                 target_id=entry.entry_id, ip=ip)
    write_entry_files(db, storage, entry)
    return entry


def _require_draft_owner(user: models.User, *entries: models.Entry) -> None:
    for e in entries:
        if e.status != "draft":
            raise HTTPException(status_code=409, detail="not_draft")
        if not can_edit_draft(user, e):
            raise HTTPException(status_code=403, detail="not_uploader")


def split(db: Session, entry: models.Entry, user: models.User, file_ids: list[int]) -> models.Entry:
    _require_draft_owner(user, entry)
    files = db.query(models.File).filter(models.File.id.in_(file_ids or [0])).all()
    if not files or len(files) != len(set(file_ids)) or any(f.entry_id != entry.id for f in files):
        raise HTTPException(status_code=422, detail="file_not_in_entry")
    new = models.Entry(title=entry.title, status="draft", batch_id=entry.batch_id, uploaded_by=entry.uploaded_by,
                       hull_evidence=entry.hull_evidence, merge_into_id=entry.merge_into_id)
    db.add(new)
    db.flush()
    new.entry_id = f"E{new.id:06d}"
    for h in hulls_of(db, entry):
        db.add(models.EntryHull(entry_id=new.id, hull_no=h.hull_no, is_primary=h.is_primary))
    for f in files:
        f.entry_id = new.id
    entry.version += 1
    db.commit()
    return new


def merge(db: Session, entry: models.Entry, other: models.Entry, user: models.User) -> models.Entry:
    _require_draft_owner(user, entry, other)
    if entry.id == other.id or entry.batch_id != other.batch_id:
        raise HTTPException(status_code=422, detail="different_batch")
    db.query(models.File).filter_by(entry_id=other.id).update({"entry_id": entry.id}, synchronize_session=False)
    db.delete(other)
    entry.version += 1
    db.commit()
    return entry


def move_file(db: Session, f: models.File, target: models.Entry, user: models.User) -> None:
    source = db.get(models.Entry, f.entry_id)
    _require_draft_owner(user, source, target)
    if source.batch_id != target.batch_id:
        raise HTTPException(status_code=422, detail="different_batch")
    f.entry_id = target.id
    source.version += 1
    target.version += 1
    db.commit()
```
상단 import 에 `import os` 와 `from ..storage.paths import StoragePaths, to_long` 를 맞춘다. 파일이 모두 빠진 초안은 그대로 둔다(화면에서 버리기 가능).

- [ ] **Step 4: 통과 확인** — `5 passed`, 전체 `-q`

- [ ] **Step 5: 커밋 (사용자)** — `git commit -m "✨ feat: 휴지통·복원·초안 쪼개기·합치기·파일 이동"`

---

### Task 13: API (`routers/batches.py`, `routers/entries.py`)

**Files:**
- Create: `backend\app\routers\batches.py`, `backend\app\routers\entries.py`, `backend\tests\test_batches_api.py`, `backend\tests\test_entries_api.py`
- Modify: `backend\app\main.py`

| 메서드·경로 | 동작 |
|---|---|
| `GET /api/batches?scope=mine\|unclaimed\|all` | 배치 목록(초안 Entry·파일 포함). mine=내가 올린 것, unclaimed=올린 사람 없음 |
| `POST /api/batches/{key}/claim` | 주인 없는 배치를 내 것으로(초안 uploaded_by 도). 감사 `BATCH_CLAIM` |
| `GET /api/entries/{entry_id}` | Entry 상세 (`E000123`) |
| `PATCH /api/entries/{entry_id}` | 수정(본문에 `version` 필수) |
| `POST /api/entries/{entry_id}/confirm` | 확정 |
| `POST /api/entries/{entry_id}/split` `{file_ids}` | 쪼개기 → 새 초안 |
| `POST /api/entries/{entry_id}/merge` `{from_entry_id}` | 합치기 |
| `POST /api/files/{file_id}/move` `{to_entry_id}` | 파일을 다른 초안으로 |
| `DELETE /api/entries/{entry_id}` | 휴지통/초안 버리기 |
| `POST /api/entries/{entry_id}/restore` | 복원 |
| `GET /api/trash` | 휴지통 목록(최근 순) |

- [ ] **Step 1: 실패하는 테스트**

```python
# backend/tests/test_batches_api.py
from app import models


def _batch(db, key, uploader):
    b = models.Batch(key=key, source="inbox", original_name=key, uploader=uploader, state="processed")
    db.add(b)
    db.flush()
    e = models.Entry(title=f"t-{key}", status="draft", batch_id=b.id, uploaded_by=uploader)
    db.add(e)
    db.flush()
    e.entry_id = f"E{e.id:06d}"
    db.commit()
    return b, e


def test_list_mine_and_unclaimed(client, db, make_user, auth_headers):
    make_user("A100001")
    _batch(db, "k-mine", "A100001")
    _batch(db, "k-none", None)
    _batch(db, "k-other", "B200002")
    h = auth_headers("A100001")
    mine = client.get("/api/batches?scope=mine", headers=h).json()
    assert [b["key"] for b in mine] == ["k-mine"]
    assert mine[0]["entries"][0]["title"] == "t-k-mine"
    unclaimed = client.get("/api/batches?scope=unclaimed", headers=h).json()
    assert [b["key"] for b in unclaimed] == ["k-none"]


def test_claim(client, db, make_user, auth_headers):
    make_user("A100001")
    b, e = _batch(db, "k-none", None)
    h = auth_headers("A100001")
    assert client.post("/api/batches/k-none/claim", headers=h).status_code == 200
    db.expire_all()
    assert db.get(models.Batch, b.id).uploader == "A100001"
    assert db.get(models.Entry, e.id).uploaded_by == "A100001"
    assert client.post("/api/batches/k-none/claim", headers=h).status_code == 409
```

```python
# backend/tests/test_entries_api.py
from app import models
from tests.test_confirm import _setup


def test_entry_lifecycle_via_api(client, db, storage, make_user, auth_headers):
    make_user("A100001")
    _, e = _setup(db, storage)
    h = auth_headers("A100001")
    eid = e.entry_id
    got = client.get(f"/api/entries/{eid}", headers=h).json()
    assert got["status"] == "draft" and len(got["files"]) == 2
    res = client.patch(f"/api/entries/{eid}", headers=h,
                       json={"version": got["version"], "title": "3496 Mooring 검토", "zones": ["Fore Deck"]})
    assert res.status_code == 200 and res.json()["version"] == 2
    assert client.patch(f"/api/entries/{eid}", headers=h, json={"version": 1, "title": "x"}).status_code == 409
    assert client.post(f"/api/entries/{eid}/confirm", headers=h).json()["status"] == "confirmed"
    assert client.delete(f"/api/entries/{eid}", headers=h).json()["status"] == "trashed"
    assert [t["entry_id"] for t in client.get("/api/trash", headers=h).json()] == [eid]
    assert client.post(f"/api/entries/{eid}/restore", headers=h).json()["status"] == "confirmed"


def test_split_merge_move_via_api(client, db, storage, make_user, auth_headers):
    make_user("A100001")
    _, e = _setup(db, storage)
    h = auth_headers("A100001")
    f1, f2 = db.query(models.File).order_by(models.File.rel_path).all()
    new = client.post(f"/api/entries/{e.entry_id}/split", headers=h, json={"file_ids": [f2.id]}).json()
    assert [f["id"] for f in new["files"]] == [f2.id]
    assert client.post(f"/api/files/{f1.id}/move", headers=h, json={"to_entry_id": new["entry_id"]}).status_code == 200
    merged = client.post(f"/api/entries/{e.entry_id}/merge", headers=h, json={"from_entry_id": new["entry_id"]}).json()
    assert len(merged["files"]) == 2


def test_unknown_entry_404_and_auth(client, make_user, auth_headers):
    assert client.get("/api/entries/E999999").status_code == 401
    make_user("A100001")
    assert client.get("/api/entries/E999999", headers=auth_headers("A100001")).status_code == 404
```

- [ ] **Step 2: 실패 확인** — 404

- [ ] **Step 3: `backend\app\routers\batches.py`**

```python
"""배치 목록·주인 지정(정리 대기 화면용)."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from .. import audit, models
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_auth
from ..entries.service import entry_to_dict
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/batches", tags=["batches"])


def batch_to_dict(db: Session, b: models.Batch) -> dict:
    drafts = db.query(models.Entry).filter_by(batch_id=b.id, status="draft").order_by(models.Entry.id).all()
    return {"key": b.key, "source": b.source, "original_name": b.original_name, "state": b.state,
            "uploader": b.uploader, "uploader_guess": b.uploader_guess, "owner_account": b.owner_account,
            "received_at": b.received_at.isoformat(), "excluded": b.excluded or [], "error": b.error,
            "target_entry_id": b.target_entry_id, "entries": [entry_to_dict(db, e) for e in drafts]}


@router.get("")
def list_batches(scope: str = Query(default="mine", pattern="^(mine|unclaimed|all)$"),
                 db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    q = db.query(models.Batch).filter(models.Batch.state.in_(("staged", "processed", "failed")))
    if scope == "mine":
        q = q.filter(models.Batch.uploader == user.employee_id)
    elif scope == "unclaimed":
        q = q.filter(models.Batch.uploader.is_(None))
    return [batch_to_dict(db, b) for b in q.order_by(models.Batch.received_at.desc(), models.Batch.id.desc()).limit(200)]


@router.post("/{key}/claim")
def claim(key: str, request: Request, db: Session = Depends(get_db),
          storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    b = db.query(models.Batch).filter_by(key=key).first()
    if b is None:
        raise HTTPException(status_code=404, detail="batch_not_found")
    if b.uploader is not None:
        raise HTTPException(status_code=409, detail="already_claimed")
    b.uploader = user.employee_id
    db.query(models.Entry).filter_by(batch_id=b.id).update({"uploaded_by": user.employee_id},
                                                           synchronize_session=False)
    audit.record(db, storage, actor=user.employee_id, action="BATCH_CLAIM", target_type="batch",
                 target_id=key, after={"uploader": user.employee_id}, ip=client_ip(request))
    return batch_to_dict(db, b)
```

- [ ] **Step 4: `backend\app\routers\entries.py`**

```python
"""Entry API — 조회·수정·확정·쪼개기·합치기·파일 이동·휴지통·복원."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_auth
from ..entries import service
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api", tags=["entries"])


class EntryPatch(BaseModel):
    version: int
    title: str | None = Field(default=None, max_length=200)
    analysis_type: str | None = Field(default=None, max_length=50)
    description: str | None = None
    analysis_period: str | None = None
    hulls: list[str] | None = None
    zones: list[str] | None = None


class SplitBody(BaseModel):
    file_ids: list[int]


class MergeBody(BaseModel):
    from_entry_id: str


class MoveBody(BaseModel):
    to_entry_id: str


def _entry(db: Session, entry_id: str) -> models.Entry:
    e = db.query(models.Entry).filter_by(entry_id=entry_id.upper()).first()
    if e is None:
        raise HTTPException(status_code=404, detail="entry_not_found")
    return e


@router.get("/entries/{entry_id}")
def get_entry(entry_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return service.entry_to_dict(db, _entry(db, entry_id))


@router.patch("/entries/{entry_id}")
def patch_entry(entry_id: str, body: EntryPatch, request: Request, db: Session = Depends(get_db),
                storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    e = service.update_entry(db, storage, _entry(db, entry_id), user, body.model_dump(exclude_unset=True),
                             client_ip(request))
    return service.entry_to_dict(db, e)


@router.post("/entries/{entry_id}/confirm")
def confirm_entry(entry_id: str, request: Request, db: Session = Depends(get_db),
                  storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    e = service.confirm(db, storage, _entry(db, entry_id), user, client_ip(request))
    return service.entry_to_dict(db, e)


@router.post("/entries/{entry_id}/split")
def split_entry(entry_id: str, body: SplitBody, db: Session = Depends(get_db),
                user: models.User = Depends(require_auth)):
    return service.entry_to_dict(db, service.split(db, _entry(db, entry_id), user, body.file_ids))


@router.post("/entries/{entry_id}/merge")
def merge_entry(entry_id: str, body: MergeBody, db: Session = Depends(get_db),
                user: models.User = Depends(require_auth)):
    e = service.merge(db, _entry(db, entry_id), _entry(db, body.from_entry_id), user)
    return service.entry_to_dict(db, e)


@router.post("/files/{file_id}/move")
def move_file(file_id: int, body: MoveBody, db: Session = Depends(get_db),
              user: models.User = Depends(require_auth)):
    f = db.get(models.File, file_id)
    if f is None or f.entry_id is None:
        raise HTTPException(status_code=404, detail="file_not_found")
    service.move_file(db, f, _entry(db, body.to_entry_id), user)
    return {"ok": True}


@router.delete("/entries/{entry_id}")
def trash_entry(entry_id: str, request: Request, db: Session = Depends(get_db),
                storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    e = service.trash(db, storage, _entry(db, entry_id), user, client_ip(request))
    return service.entry_to_dict(db, e)


@router.post("/entries/{entry_id}/restore")
def restore_entry(entry_id: str, request: Request, db: Session = Depends(get_db),
                  storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    e = service.restore(db, storage, _entry(db, entry_id), user, client_ip(request))
    return service.entry_to_dict(db, e)


@router.get("/trash")
def list_trash(db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    rows = (db.query(models.Entry).filter_by(status="trashed")
            .order_by(models.Entry.updated_at.desc(), models.Entry.id.desc()).limit(200))
    return [{"entry_id": e.entry_id, "title": e.title, "trash_rel": e.trash_rel,
             "restorable": bool(e.vault_rel), "updated_at": e.updated_at.isoformat()} for e in rows]
```

- [ ] **Step 5: `main.py` 등록** — `from .routers import auth, batches, entries, system, users` 와 `app.include_router(batches.router)`, `app.include_router(entries.router)` (SPA mount 보다 앞)

- [ ] **Step 6: 통과 확인** — `5 passed`, 전체 `-q`

- [ ] **Step 7: 커밋 (사용자)** — `git commit -m "✨ feat: 배치·Entry API"`

---

### Task 14: 워커 (`worker.py`)

**Files:**
- Create: `backend\app\worker.py`, `backend\tests\test_worker.py`

`run_once()` = Inbox poll → 준비된 항목 stage → 큐의 `process_batch` 모두 처리(실패 시 재시도, 3회 실패면 배치 `failed` + `error`). `main()` = 30초 주기 무한 루프, 공유 폴더가 끊기면 건너뛰고 로그, 로그 파일 `90_System\logs\worker.log`.

실행: `backend` 폴더에서 `.venv\Scripts\python.exe -m app.worker`

- [ ] **Step 1: 실패하는 테스트**

```python
# backend/tests/test_worker.py
from app import models
from app.ingest.inbox import InboxWatcher
from app.worker import run_once


class Clock:
    t = 0.0

    def __call__(self):
        return self.t


def test_run_once_end_to_end(db, storage, make_user):
    make_user("A476854")
    d = storage.inbox / "3496_Mooring_검토"
    d.mkdir()
    (d / "3496_FWD.bdf").write_text("GRID", encoding="utf-8")
    (d / "검토.pdf").write_bytes(b"%PDF-1.7")
    clock = Clock()
    w = InboxWatcher(storage, stable_seconds=60, clock=clock, owner_of=lambda p: "a476854")
    assert run_once(db, storage, w) == {"staged": 0, "processed": 0, "failed": 0}
    clock.t += 61
    assert run_once(db, storage, w) == {"staged": 1, "processed": 1, "failed": 0}
    db.expire_all()
    [e] = db.query(models.Entry).all()
    assert e.title == "3496 Mooring 검토" and e.uploaded_by == "A476854"


def test_failed_processing_marks_batch_after_retries(db, storage, monkeypatch):
    import app.worker as worker

    b = models.Batch(key="k1", source="inbox", original_name="x")
    db.add(b)
    db.flush()
    db.add(models.Job(type="process_batch", target_id=b.id))
    db.commit()

    def boom(*a, **k):
        raise RuntimeError("처리 실패")

    monkeypatch.setattr(worker, "process_batch", boom)
    monkeypatch.setattr(worker.jobs, "RETRY_STEP", worker.timedelta(0))
    w = InboxWatcher(storage, clock=Clock(), owner_of=lambda p: None)
    for _ in range(3):
        run_once(db, storage, w)
    db.expire_all()
    assert db.get(models.Batch, b.id).state == "failed"
    assert "처리 실패" in db.get(models.Batch, b.id).error
```

- [ ] **Step 2: 실패 확인** — `ModuleNotFoundError: No module named 'app.worker'`

- [ ] **Step 3: 구현**

```python
# backend/app/worker.py
"""Logbook 워커 — Inbox 감시와 배치 처리(설계 §2: API 와 별도 프로세스).

실행 (backend 폴더): .venv\\Scripts\\python.exe -m app.worker
"""
import logging
import time
from datetime import timedelta  # noqa: F401  (테스트가 RETRY_STEP 을 바꿀 때 사용)
from logging.handlers import RotatingFileHandler

from sqlalchemy.orm import Session

from . import jobs, models
from .database import Base, SessionLocal, engine
from .dependencies import get_storage
from .ingest.inbox import InboxWatcher, stage_item
from .ingest.process import process_batch
from .storage.paths import StoragePaths, to_long

log = logging.getLogger("logbook.worker")
POLL_SECONDS = 30
MAX_ATTEMPTS = 3


def run_once(db: Session, storage: StoragePaths, watcher: InboxWatcher) -> dict:
    stats = {"staged": 0, "processed": 0, "failed": 0}
    for item in watcher.poll():
        try:
            stage_item(db, storage, item)
            watcher.forget(item)
            stats["staged"] += 1
        except OSError as exc:
            db.rollback()
            log.warning("배치 받기 실패(다음 주기에 재시도): %s — %s", item.name, exc)
    while (job := jobs.claim_next(db)) is not None:
        batch = db.get(models.Batch, job.target_id)
        try:
            if job.type != "process_batch" or batch is None:
                raise RuntimeError(f"알 수 없는 작업: {job.type} {job.target_id}")
            process_batch(db, storage, batch)
            jobs.complete(db, job)
            stats["processed"] += 1
        except Exception as exc:  # 작업 하나의 실패가 워커를 멈추지 않게
            db.rollback()
            job = db.get(models.Job, job.id)
            jobs.fail(db, job, str(exc), max_attempts=MAX_ATTEMPTS)
            if job.state == "failed" and batch is not None:
                batch = db.get(models.Batch, batch.id)
                batch.state, batch.error = "failed", str(exc)[:2000]
                db.commit()
            stats["failed"] += 1
            log.exception("배치 처리 실패: %s", job.target_id)
    return stats


def _setup_logging(storage: StoragePaths) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    try:
        handler = RotatingFileHandler(to_long(storage.logs_dir / "worker.log"), maxBytes=5_000_000,
                                      backupCount=5, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        logging.getLogger().addHandler(handler)
    except OSError as exc:
        log.warning("로그 파일을 열 수 없습니다(콘솔만 사용): %s", exc)


def main() -> None:
    storage = get_storage()
    Base.metadata.create_all(bind=engine)
    try:
        storage.ensure_layout()
    except OSError:
        pass
    _setup_logging(storage)
    watcher = InboxWatcher(storage)
    log.info("워커 시작 — 저장소 %s, %s초 주기", storage.root, POLL_SECONDS)
    while True:
        if storage.check_reachable():
            db = SessionLocal()
            try:
                stats = run_once(db, storage, watcher)
                if any(stats.values()):
                    log.info("처리 결과 %s", stats)
            except Exception:
                log.exception("주기 처리 중 오류")
            finally:
                db.close()
        else:
            log.warning("공유 폴더에 연결할 수 없어 이번 주기를 건너뜁니다.")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 통과 확인** — `2 passed`, 전체 `-q` 두 번

- [ ] **Step 5: 커밋 (사용자)** — `git commit -m "✨ feat: Inbox 감시·배치 처리 워커"`

---

### Task 15: 개발 PC 통합 확인 (실제 공유 폴더)

- [ ] **Step 1: 전체 테스트** — `cd backend; .venv\Scripts\pytest.exe -q` (두 번, 전부 통과)

- [ ] **Step 2: 워커와 API 실행** — 두 창에서
```powershell
.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 9095
.venv\Scripts\python.exe -m app.worker
```

- [ ] **Step 3: 실제 Inbox 로 올리기** — 탐색기로 `999_LogBook\00_Inbox\` 에 테스트 폴더 `9999_Logbook_연결시험\` (안에 작은 `9999_test.bdf`, 합성 `test.pdf`) 을 복사. **실제 호선·기밀 자료는 쓰지 않는다**(9999 는 가상 호선).
  90초 안에 워커 로그에 `처리 결과 {'staged': 1, 'processed': 1, ...}` 확인, `00_Inbox` 에서 사라지고 `10_Vault\_staging\<키>\` 에 있는지 확인.

- [ ] **Step 4: API 로 확정** — 관리자(A476854)로 로그인 토큰을 받아:
```powershell
$h = @{ Authorization = "Bearer <token>" }
curl.exe -H "Authorization: Bearer <token>" "http://localhost:9095/api/batches?scope=mine"
curl.exe -X POST -H "Authorization: Bearer <token>" http://localhost:9095/api/entries/<E번호>/confirm
```
`10_Vault\2026\<E번호>\files\9999_Logbook_연결시험\...`, `entry.json`, `_INFO.txt` 생성 확인 → `DELETE` 로 휴지통 → `95_Trash` 확인 → `restore` 로 복원 확인. 끝나면 다시 `DELETE` 로 휴지통에 두어 검색 대상에서 빼 둔다.

- [ ] **Step 5: 보고** — 각 단계 결과, 워커 로그 발췌, 공유 폴더에 남은 시험 자료 위치(휴지통)를 보고한다.
