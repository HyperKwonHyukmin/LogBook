# Logbook 04a — BDF 변환 백엔드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 올라온 BDF 모델을 워커가 자체 파서로 읽어, 다음 네 가지를 만든다.
- 브라우저 3D 뷰어용 `model.lbm`(gzip 바이너리)
- 썸네일 PNG
- 검색용 모델 지문
- 요약 API

**Architecture:**
- `app/bdf/` 는 순수 파서다(DB·저장소 모름).
  - `deck.py`: 줄 → 카드. INCLUDE, 고정·대형·자유 필드를 처리한다.
  - `coords.py`: CORD2R/C/S·CORD1R/C/S → 전역 좌표.
  - `model.py`: 카드 → `Model`.
  - `lbm.py` · `fingerprint.py` · `thumbnail.py`: `Model` 을 쓴다.
- `app/convert/job.py` 의 `convert_model` 작업이 공유 폴더에서 파일을 읽어 결과를 남긴다.
  - 파생물은 `20_Derived\_model\<key[:2]>\<key>.lbm|.png` 에 쓴다. key 는 본 파일과 INCLUDE 파일 바이트의 sha256 이다.
  - 상태는 새 표 `model_summaries` 에 둔다.
  - 지문은 `file_texts`(locator `model`)에도 넣어, 03 검색이 그대로 찾게 한다.

**Tech Stack:** Python 3.11 · numpy 2.4.6 · Pillow 12.3.0 · FastAPI · SQLAlchemy · MySQL

**설계 근거:** `docs/specs/2026-09-28-logbook-design.md` §7.1(파서·INCLUDE·좌표계·미지원 카드 경고·is_include), §7.2(model.lbm 블록), §7.5(썸네일), §7.6(모델 지문), §7.7(실패해도 등록·다운로드 가능, INCLUDE 없음 안내, 파일 추가 시 자동 재변환)

**이식 근거(재사용 목록 §1):**
- WorkBench `InHouseProgram/NastranBridge/nastran_bridge.py` 46~500행에서 가져올 것:
  - `split_fields`(8칸 고정 / 쉼표 자유)
  - `parse_int`·`parse_float`(`1.-3` 같은 Nastran 지수 약식)
  - `read_records`(연속행 결합)
  - 카드별 필드 위치(GRID·CBAR·CBEAM·CROD·CONROD·CTRIA3·CQUAD4·RBE2·PBEAML·PSHELL·MAT1·CONM2·SPC·SPC1)
- 이식하면서 고치는 점: WorkBench 판은 다음을 못 한다. 그래서 `deck.py` 는 **물리 줄마다 데이터 8칸(대형 필드는 줄당 4칸)** 을 채워 필드 위치를 형식과 무관하게 맞춘다.
  - 고정 필드의 10번째 칸(연속 표시)을 데이터로 섞는다.
  - 대형 필드(`GRID*`, 16칸)를 처리하지 못한다.
  - INCLUDE·좌표계·RBE3 를 처리하지 못한다.
- 한글 `$` 주석: `utf-8, errors="replace"` 로 읽는다. 데이터 칸은 ASCII 라 cp949 로 저장된 파일도 안전하다(설계 §7.1).

**설계에서 확정한 점:**
1. 좌표계는 CORD2R 와 CORD1R 에 더해 C(원통)·S(구)도 지원한다. 변환식이 몇 줄이라 빼는 이득이 없다. GRID 의 CD(변위 좌표계)는 표시와 무관해 무시한다.
2. `model.lbm` 은 gzip 으로 저장하고, API 가 `Content-Encoding: gzip` 으로 보낸다. 그러면 브라우저가 스스로 풀어 준다.
3. INCLUDE 경로가 절대경로(개인 PC 경로)면 파일 이름만 떼서 같은 폴더에서 찾는다. 그래도 없으면 경고 `include_missing: <이름>` 을 남기고 변환은 계속한다(설계 §7.7).
4. 같은 Entry 의 다른 BDF 가 INCLUDE 하는 파일은 상태 `include` 로 두고 단독 모델로 만들지 않는다(설계 §7.1).
   - 판정은 변환 결과에 기록된 `includes` 목록으로 한다.
   - 순서가 바뀌어도 수렴한다. INCLUDE 하는 쪽이 변환되면 대상 파일을 `include` 로 고쳐 쓰기 때문이다.
5. 요소가 하나도 없는 BDF(재료·하중만 든 파일)는 `skipped`(`no_elements`) 로 둔다.

---

## 공통 규칙 (모든 태스크)

- 백엔드 명령은 `C:\Coding\Logbook\backend` 에서 `.venv\Scripts\python.exe -m pytest ...` 로 실행한다. **한 번에 하나만(순차)**.
- **`backend\.env` 는 어떤 방법으로도 열지 않는다.** **git 명령 금지.** "커밋" 단계는 사람이 한다.
- 공유 폴더 경로는 `to_long()` / `long_join()` 을 거친다.
- **실제 호선 BDF 를 저장소에 넣지 않는다.** 테스트 BDF 는 테스트 코드 안 문자열로 만든다(가상 호선 9999).
  - WorkBench 샘플 BDF 는 환경변수 `LOGBOOK_SAMPLE_BDF` 가 가리킬 때만 도는 선택 시험(Task 9)에서만 쓴다.
- 주석·경고 문구는 한국어로 쓴다. 경고는 `"<코드>: <내용>"` 형식이다(예: `include_missing: mat.bdf`). 앞부분 코드는 영어 snake_case 다.
- 03 의 추출 작업(`extract_file`)과 같은 규칙을 따른다.
  - 문서가 깨졌으면 `failed` 로 기록하고 작업은 완료 처리한다.
  - 파일 읽기 `OSError` 는 위로 던져 작업 큐가 재시도하게 한다.

## 파일 구조

| 파일 | 역할 |
|---|---|
| `backend/requirements.txt` (수정) | numpy, Pillow |
| `backend/app/bdf/__init__.py` (새) | 공개 함수 모음 |
| `backend/app/bdf/fields.py` (새) | `parse_int`·`parse_float`·`is_real` |
| `backend/app/bdf/deck.py` (새) | `DeckReader` — 줄 → `Card`, INCLUDE, SOL, 바이트 해시 |
| `backend/app/bdf/coords.py` (새) | 좌표계 변환, `resolve_coords` |
| `backend/app/bdf/model.py` (새) | `Model`·`build_model` — 카드 해석 |
| `backend/app/bdf/lbm.py` (새) | `write_lbm`·`read_lbm` |
| `backend/app/bdf/fingerprint.py` (새) | `section_label`·`fingerprint` |
| `backend/app/bdf/thumbnail.py` (새) | `render_thumbnail` (numpy + Pillow 등각 투영) |
| `backend/app/models.py` (수정) | `ModelSummary` |
| `backend/app/convert/__init__.py`·`job.py` (새) | `enqueue_convert`·`run_convert`·`requeue_entry_models`·`model_paths` |
| `backend/app/jobs.py`·`worker.py` (수정) | `convert_model` 작업, 무거운 작업 묶음 |
| `backend/app/ingest/process.py` (수정) | 배치 처리 끝에 변환 작업 등록 |
| `backend/app/entries/service.py` (수정) | 파일 추가 확정 시 재변환, 파일 dict 에 `model` |
| `backend/app/cli.py` (수정) | `enqueue-convert` |
| `backend/app/routers/files.py` (수정) | `/model`, `/model.lbm`, `/thumb.png` |

---

### Task 1: 의존성·필드 해석·덱 읽기

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/app/bdf/__init__.py`(빈 docstring 만), `backend/app/bdf/fields.py`, `backend/app/bdf/deck.py`
- Test: `backend/tests/test_bdf_deck.py`

- [ ] **Step 1: 의존성**

`requirements.txt` 끝에 추가한다:

```
numpy==2.4.6
Pillow==12.3.0
```

Run: `.venv\Scripts\python.exe -m pip install -r requirements.txt` → 설치 성공

- [ ] **Step 2: 실패하는 테스트 작성**

`backend/tests/test_bdf_deck.py`:

```python
import pytest

from app.bdf.deck import Card, DeckReader
from app.bdf.fields import is_real, parse_float, parse_int


def _reader(files: dict[str, bytes | str]) -> DeckReader:
    def opener(rel: str) -> bytes:
        if rel not in files:
            raise FileNotFoundError(rel)
        v = files[rel]
        return v.encode("utf-8") if isinstance(v, str) else v
    return DeckReader(opener)


def _f(card: Card, n: int) -> list[str]:
    return card.fields[:n]


def test_parse_numbers():
    assert parse_int(" 12 ") == 12 and parse_int("") is None and parse_int("+") is None
    assert parse_float("1.-3") == pytest.approx(1e-3)
    assert parse_float("-2.5+2") == pytest.approx(-250.0)
    assert parse_float("1.0D2") == pytest.approx(100.0)
    assert parse_float(".5") == 0.5 and parse_float("abc") is None
    assert is_real("1.") and is_real("2.5E3") and not is_real("123") and not is_real("")


def test_small_fixed_with_continuation_marker_dropped():
    deck = (
        "BEGIN BULK\n"
        "CBEAM   101     1       1       2       0.      0.      1.      BGG     +CB1\n"
        "+CB1                                                                    \n"
        "ENDDATA\n"
    )
    cards = _reader({"m.bdf": deck}).read("m.bdf")
    assert [c.name for c in cards] == ["CBEAM"]
    assert _f(cards[0], 8) == ["101", "1", "1", "2", "0.", "0.", "1.", "BGG"]
    assert len(cards[0].fields) == 16  # 줄마다 8칸 — 연속 표시 '+CB1' 은 데이터에 섞이지 않는다


def test_large_field_grid():
    deck = (
        "GRID*                  7               0   1234.56789012       -50.25000000*G7\n"
        "*G7                 10.0000000               0\n"
    )
    c = _reader({"m.bdf": deck}).read("m.bdf")[0]
    assert c.name == "GRID"
    assert c.fields[0] == "7" and c.fields[1] == "0"
    assert parse_float(c.fields[2]) == pytest.approx(1234.56789012)
    assert parse_float(c.fields[3]) == pytest.approx(-50.25)
    assert parse_float(c.fields[4]) == pytest.approx(10.0)


def test_free_field_and_long_free_line():
    deck = "GRID,1,,0.,0.,0.\nRBE2,9,1,123456,2,3,4,5,6,7,8,9,10\nPBARL,5,1,MSCBML0,L\n+,100.,100.,10.,10.\n"
    cards = _reader({"m.bdf": deck}).read("m.bdf")
    grid, rbe2, pbarl = cards
    assert grid.fields[:5] == ["1", "", "0.", "0.", "0."]
    assert [x for x in rbe2.fields if x][:3] == ["9", "1", "123456"] and rbe2.fields[-1] == "10"
    assert pbarl.fields[:4] == ["5", "1", "MSCBML0", "L"] and pbarl.fields[8:12] == ["100.", "100.", "10.", "10."]


def test_comments_tabs_korean_cp949():
    deck = "$ 한글 주석\nGRID\t1\t\t1.\t2.\t3.\t$ 끝 주석\n".encode("cp949")
    c = _reader({"m.bdf": deck}).read("m.bdf")[0]
    assert c.fields[:5] == ["1", "", "1.", "2.", "3."]


def test_exec_section_sol_and_begin_bulk():
    deck = "SOL 101\nCEND\nSUBCASE 1\n  SPC = 1\nBEGIN BULK\nGRID,1,,0.,0.,0.\nENDDATA\nGRID,2,,0.,0.,0.\n"
    r = _reader({"m.bdf": deck})
    cards = r.read("m.bdf")
    assert r.sol == "101" and [c.fields[0] for c in cards] == ["1"]


def test_include_relative_absolute_missing_and_loop():
    files = {
        "model/main.bdf": "BEGIN BULK\nINCLUDE 'sub/mesh.bdf'\nINCLUDE 'C:\\Users\\kim\\mat.bdf'\nINCLUDE 'none.bdf'\nENDDATA\n",
        "model/sub/mesh.bdf": "GRID,1,,0.,0.,0.\nINCLUDE '../main.bdf'\n",
        "model/mat.bdf": "MAT1,1,206000.,,0.3,7.85-9\n",
    }
    r = _reader(files)
    cards = r.read("model/main.bdf")
    assert [c.name for c in cards] == ["GRID", "MAT1"]
    assert r.includes == ["model/sub/mesh.bdf", "model/mat.bdf"]
    assert r.missing == ["none.bdf"]
    assert any(w.startswith("include_missing: none.bdf") for w in r.warnings)
    assert any(w.startswith("include_loop") for w in r.warnings)
    assert cards[1].source == "model/mat.bdf"


def test_include_cannot_escape_root():
    r = _reader({"a.bdf": "INCLUDE '../../etc/x.bdf'\n"})
    r.read("a.bdf")
    assert r.missing == ["../../etc/x.bdf"]


def test_include_split_over_lines():
    files = {"m.bdf": "INCLUDE 'very/long/\n path.bdf'\n", "very/long/path.bdf": "GRID,1,,0.,0.,0.\n"}
    r = _reader(files)
    assert [c.name for c in r.read("m.bdf")] == ["GRID"]


def test_digest_changes_with_include_content():
    a = _reader({"m.bdf": "INCLUDE 'i.bdf'\n", "i.bdf": "GRID,1,,0.,0.,0.\n"})
    a.read("m.bdf")
    b = _reader({"m.bdf": "INCLUDE 'i.bdf'\n", "i.bdf": "GRID,1,,1.,0.,0.\n"})
    b.read("m.bdf")
    assert a.digest != b.digest and len(a.digest) == 64
```

- [ ] **Step 3: 실패 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_bdf_deck.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.bdf'`

- [ ] **Step 4: 구현**

`backend/app/bdf/__init__.py`:

```python
"""자체 BDF 파서(설계 §7.1) — WorkBench nastran_bridge 의 파싱 기법을 이식했다. DB·저장소를 모른다."""
```

`backend/app/bdf/fields.py`:

```python
"""BDF 필드 값 해석 — WorkBench nastran_bridge.parse_int/parse_float 이식."""
import re

_INT = re.compile(r"^[+-]?\d+")
_SHORT_EXP = re.compile(r"^([+-]?(?:\d+(?:\.\d*)?|\.\d+))([+-]\d+)$")  # 1.-3 → 1.e-3


def _token(value: str | None) -> str:
    if value is None:
        return ""
    value = value.strip()
    return "" if value in ("+", "*") else value


def parse_int(value: str | None) -> int | None:
    token = _token(value)
    m = _INT.match(token) if token else None
    return int(m.group(0)) if m else None


def parse_float(value: str | None) -> float | None:
    token = _token(value)
    if not token:
        return None
    token = token.replace("D", "E").replace("d", "e")
    if "e" not in token.lower():
        token = _SHORT_EXP.sub(r"\1e\2", token)
    try:
        return float(token)
    except ValueError:
        return None


def is_real(value: str | None) -> bool:
    """실수 표기인가(소수점·지수 포함) — RBE3 의 가중치와 정수(성분·절점)를 가른다."""
    token = _token(value)
    return bool(token) and ("." in token or "e" in token.lower()) and parse_float(token) is not None
```

`backend/app/bdf/deck.py`:

```python
"""BDF 덱 읽기 — 줄을 카드(이름 + 필드)로 묶는다.

필드 위치를 형식과 무관하게 맞추려고 **물리 줄마다 데이터 8칸**을 채운다(대형 필드는 줄당 4칸이라
두 줄이 8칸). 그래서 PBARL 의 DIM1 은 고정·자유 형식 모두 fields[8] 에 있다.
고정 필드의 10번째 칸(연속 표시, 73~80열)은 데이터에 넣지 않는다 — WorkBench 판이 섞던 부분이다.
"""
import hashlib
import posixpath
import re
from dataclasses import dataclass
from typing import Callable

_SOL = re.compile(r"^\s*SOL\s+([A-Za-z0-9]+)", re.IGNORECASE)
_BEGIN = re.compile(r"^\s*BEGIN\s+BULK", re.IGNORECASE)
_ENDDATA = re.compile(r"^\s*ENDDATA", re.IGNORECASE)
_INCLUDE = re.compile(r"^\s*INCLUDE\b", re.IGNORECASE)
_QUOTED = re.compile(r"'([^']*)'")
_BARE = re.compile(r"INCLUDE\s+(\S+)", re.IGNORECASE)
_ABSOLUTE = re.compile(r"^(?:[A-Za-z]:/|//|/)")
MAX_INCLUDE_DEPTH = 10


@dataclass
class Card:
    name: str
    fields: list[str]
    source: str


def _free(line: str) -> list[str]:
    data = [t.strip() for t in line.split(",")][1:]
    if len(data) == 9 and data[8].startswith("+"):
        return data[:8]          # 10번째 칸 = 연속 표시
    if len(data) < 8:
        data += [""] * (8 - len(data))
    return data                   # 8칸 넘는 긴 자유 형식 줄(WorkBench 출력)은 그대로 잇는다


def _small(line: str) -> list[str]:
    return [line[8 + 8 * k:16 + 8 * k].strip() for k in range(8)]


def _large(line: str) -> list[str]:
    return [line[8 + 16 * k:24 + 16 * k].strip() for k in range(4)]


def _first_line(line: str) -> tuple[str, list[str]]:
    if "," in line:
        return line.split(",", 1)[0].strip().upper().rstrip("*"), _free(line)
    name = line[:8].strip().upper()
    if name.endswith("*"):
        return name[:-1], _large(line)
    return name, _small(line)


def _continuation(line: str) -> list[str]:
    if "," in line:
        return _free(line)
    if line.startswith("*"):
        return _large(line)
    return _small(line)


class DeckReader:
    """opener(rel_posix) → bytes. 본 파일을 못 읽으면 opener 의 예외가 그대로 올라간다."""

    def __init__(self, opener: Callable[[str], bytes]):
        self.opener = opener
        self.cards: list[Card] = []
        self.sol: str | None = None
        self.warnings: list[str] = []
        self.includes: list[str] = []
        self.missing: list[str] = []
        self._seen: set[str] = set()
        self._hash = hashlib.sha256()

    @property
    def digest(self) -> str:
        """본 파일과 INCLUDE 파일 바이트를 읽은 순서대로 이은 sha256 — 파생물 열쇠."""
        return self._hash.hexdigest()

    def read(self, rel: str) -> list[Card]:
        self._read_file(rel, depth=0, main=True)
        return self.cards

    def _read_file(self, rel: str, depth: int, main: bool) -> None:
        key = rel.casefold()
        if key in self._seen:
            self.warnings.append(f"include_loop: {rel}")
            return
        self._seen.add(key)
        data = self.opener(rel)
        self._hash.update(rel.encode("utf-8") + b"\0" + data)
        lines = data.decode("utf-8", errors="replace").splitlines()
        bulk = not main or not any(_BEGIN.match(x) for x in lines)
        current: Card | None = None
        i = 0
        while i < len(lines):
            raw = lines[i].expandtabs(8)
            i += 1
            if not bulk:
                m = _SOL.match(raw)
                if m and self.sol is None:
                    self.sol = m.group(1).upper()
                if _BEGIN.match(raw):
                    bulk = True
                continue
            line = raw.split("$", 1)[0].rstrip()
            if not line.strip():
                continue
            if _ENDDATA.match(line):
                break
            if _INCLUDE.match(line):
                text = line
                while text.count("'") == 1 and i < len(lines):  # 따옴표가 닫힐 때까지 다음 줄을 잇는다
                    text += lines[i].split("$", 1)[0].strip()
                    i += 1
                current = None
                self._include(rel, text, depth)
                continue
            if line[0] in "+*," or not line[:8].strip():
                if current is not None:
                    current.fields.extend(_continuation(line))
                continue
            name, fields = _first_line(line)
            current = Card(name, fields, rel)
            self.cards.append(current)

    def _include(self, rel: str, text: str, depth: int) -> None:
        m = _QUOTED.search(text) or _BARE.search(text)
        name = (m.group(1) if m else "").strip()
        if not name:
            self.warnings.append(f"include_unreadable: {text[:80]}")
            return
        try:
            target = self._resolve(rel, name)
            if depth + 1 > MAX_INCLUDE_DEPTH:
                raise ValueError("depth")
            self._read_file(target, depth + 1, main=False)
            if target not in self.includes:
                self.includes.append(target)
        except (OSError, ValueError):
            self.missing.append(name)
            self.warnings.append(f"include_missing: {name}")

    @staticmethod
    def _resolve(rel: str, name: str) -> str:
        name = name.replace("\\", "/")
        if _ABSOLUTE.match(name):
            name = posixpath.basename(name)   # 개인 PC 절대경로 — 같은 폴더에서 이름으로 찾는다
        joined = posixpath.normpath(posixpath.join(posixpath.dirname(rel), name))
        if joined == ".." or joined.startswith("../") or joined.startswith("/"):
            raise ValueError(f"루트 밖 경로: {name}")
        return joined
```

참고: `test_include_split_over_lines` 의 이어진 경로는 `'very/long/` + `path.bdf'` 로 붙어 `very/long/path.bdf` 가 된다. 앞 공백은 `strip()` 한다.

- [ ] **Step 5: 통과 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_bdf_deck.py -v`
Expected: PASS (10 passed)

- [ ] **Step 6: 커밋(사람)** — `feat: 04a BDF 덱 읽기(고정·대형·자유 필드, INCLUDE)`

---

### Task 2: 좌표계와 모델 해석

**Files:**
- Create: `backend/app/bdf/coords.py`, `backend/app/bdf/model.py`
- Test: `backend/tests/test_bdf_model.py`

규칙:
- **요소**
  - 1D: CBAR·CBEAM·CROD·CBUSH 는 `[EID PID GA GB]`, CONROD 는 `[EID G1 G2 MID A]` 이다. CONROD 의 PID 는 0 이고, MID·A 는 `conrods[eid]` 에 둔다.
  - 2D: CTRIA3·CTRIA6·CTRIAR 은 앞 3절점, CQUAD4·CQUAD8·CQUADR 은 앞 4절점을 쓴다. 중간 절점은 무시한다(설계 §7.2).
- **RBE2**: 중심 = GN, 나머지 = 종속 GM(정수 칸만, 실수 ALPHA 는 뺀다).
- **RBE3**: 중심 = REFGRID(종속), 나머지 = 가중 독립 절점이다.
  - 실수 칸은 WT, 바로 다음 정수는 성분, 그다음 정수들이 절점이다.
  - `UM`·`ALPHA` 에서 멈춘다.
- **CONM2**: `[EID G CID M]`.
- **SPC**: `[SID G1 C1 D1 G2 C2 D2]`. **SPC1**: `[SID C G1 …]`, `G1 THRU G2` 를 지원한다.
- **속성**
  - PSHELL `t`.
  - PBARL·PBEAML `type`·`dims`. DIM 개수는 형상표에 따르고, 나머지 칸(NSM 등)은 버린다.
  - PBAR·PBEAM·PROD `A`, PCOMP `t`(층 두께 합). 그 밖의 P 카드는 `{"card": 이름}`.
- **재료**: MAT1 `E`·`G`·`nu`·`rho`. 그 밖의 MAT 카드는 `{"card": 이름}`.
- **무시·미지원**: 하중·해석 제어 카드는 조용히 무시한다. 나머지 모르는 카드는 `unsupported` 에 센다.
- **누락**: 없는 절점을 가리키는 요소·RBE·질량·SPC 는 빼고, 경고 `missing_node: N` 을 남긴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_bdf_model.py`:

```python
import math

import pytest

from app.bdf.coords import resolve_coords
from app.bdf.deck import DeckReader
from app.bdf.model import build_model


def _model(text: str):
    r = DeckReader(lambda rel: text.encode("utf-8"))
    return build_model(r.read("m.bdf"), sol=r.sol, warnings=r.warnings)


def test_basic_elements_properties_materials():
    m = _model(
        "GRID,1,,0.,0.,0.\nGRID,2,,1000.,0.,0.\nGRID,3,,1000.,1000.,0.\nGRID,4,,0.,1000.,0.\n"
        "CBEAM,10,1,1,2,0.,0.,1.\nCROD,11,2,2,3\nCONROD,12,3,4,1,25.\nCBUSH,13,4,1,\n"
        "CQUAD4,20,5,1,2,3,4\nCTRIA6,21,5,1,2,3,7,8,9\n"
        "PBEAML,1,1,MSCBML0,L\n,100.,100.,10.,10.,0.\nPROD,2,1,50.\nPSHELL,5,1,12.\n"
        "MAT1,1,206000.,,0.3,7.85-9\n"
    )
    assert [e.card for e in m.beams] == ["CBEAM", "CROD", "CONROD"]  # 접지 CBUSH(GB 없음)는 뺀다
    assert m.conrods[12] == {"mid": 1, "A": 25.0}
    assert [e.card for e in m.quads] == ["CQUAD4"] and m.tris[0].nodes == (1, 2, 3)
    assert m.properties[1] == {"card": "PBEAML", "mid": 1, "type": "L", "dims": [100.0, 100.0, 10.0, 10.0]}
    assert m.properties[2]["A"] == 50.0 and m.properties[5] == {"card": "PSHELL", "mid": 1, "t": 12.0}
    assert m.materials[1] == {"card": "MAT1", "E": 206000.0, "G": None, "nu": 0.3, "rho": pytest.approx(7.85e-9)}
    assert m.counts()["CBEAM"] == 1 and m.counts()["GRID"] == 4
    assert m.element_total() == 5
    assert m.bbox() == {"min": [0.0, 0.0, 0.0], "max": [1000.0, 1000.0, 0.0]}
    assert any(w.startswith("grounded_cbush") for w in m.warnings)


def test_rigids_masses_spcs():
    m = _model(
        "".join(f"GRID,{i},,{i}.,0.,0.\n" for i in range(1, 9))
        + "RBE2,100,1,123456,2,3,0.5\n"
        "RBE3,101,,4,123,1.0,123,5,6,0.5,12,7\n"
        "CONM2,200,8,,1.5\n"
        "SPC,1,1,123,0.,2,456\nSPC1,1,123456,3,THRU,5\n"
    )
    r2, r3 = m.rigids
    assert (r2.card, r2.center, r2.others) == ("RBE2", 1, [2, 3])
    assert (r3.card, r3.center, r3.others) == ("RBE3", 4, [5, 6, 7])
    assert m.masses == [(200, 8, 1.5)]
    assert m.spcs == {1: "123", 2: "456", 3: "123456", 4: "123456", 5: "123456"}


def test_missing_nodes_and_unsupported():
    m = _model("GRID,1,,0.,0.,0.\nCBAR,1,1,1,99\nFOO,1,2\nFOO,2\nFORCE,1,1,,1.,1.,0.,0.\n")
    assert m.beams == [] and any(w == "missing_node: 1" for w in m.warnings)
    assert m.unsupported == {"FOO": 2}


def test_cord2r_rotated_and_chained():
    # CID 10: 원점 (100,0,0), z 축 = 전역 z, x 축 = 전역 y 방향(90° 회전)
    # CID 20: CID 10 안에서 원점 (0,0,50)
    m = _model(
        "CORD2R,10,0,100.,0.,0.,100.,0.,1.\n,100.,1.,0.\n"
        "CORD2R,20,10,0.,0.,50.,0.,0.,51.\n,1.,0.,50.\n"
        "GRID,1,10,1.,0.,0.\nGRID,2,20,0.,0.,0.\n"
    )
    assert m.nodes[1] == pytest.approx((100.0, 1.0, 0.0))
    assert m.nodes[2] == pytest.approx((100.0, 0.0, 50.0))


def test_cylindrical_and_spherical():
    m = _model(
        "CORD2C,1,0,0.,0.,0.,0.,0.,1.\n,1.,0.,0.\nCORD2S,2,0,0.,0.,0.,0.,0.,1.\n,1.,0.,0.\n"
        "GRID,1,1,10.,90.,5.\nGRID,2,2,10.,90.,0.\n"
    )
    assert m.nodes[1] == pytest.approx((0.0, 10.0, 5.0), abs=1e-9)
    assert m.nodes[2] == pytest.approx((10.0, 0.0, 0.0), abs=1e-9)


def test_cord1r_defined_by_grids():
    m = _model(
        "GRID,1,,0.,0.,0.\nGRID,2,,0.,0.,1.\nGRID,3,,0.,1.,0.\n"
        "CORD1R,5,1,2,3\nGRID,4,5,2.,0.,0.\n"
    )
    assert m.nodes[4] == pytest.approx((0.0, 2.0, 0.0))


def test_unresolved_coord_warns():
    m = _model("GRID,1,77,1.,0.,0.\n")
    assert 1 not in m.nodes and any(w.startswith("coord_unresolved: 1") for w in m.warnings)


def test_resolve_coords_degenerate_system():
    nodes, unresolved, bad = resolve_coords({1: (9, 0.0, 0.0, 0.0)},
                                            [("2", "R", 9, 0, [0.0] * 9)])
    assert unresolved == 1 and bad == [9]


def test_section_dim_count_and_pcomp():
    m = _model(
        "PBARL,1,1,,TUBE\n,50.,40.,7.\nPBARL,2,1,,I\n,300.,150.,150.,9.,12.,12.\n"
        "PCOMP,3\n,1,2.,0.,,1,3.,45.\n"
    )
    assert m.properties[1]["dims"] == [50.0, 40.0]           # NSM 7. 은 버린다
    assert m.properties[2]["dims"] == [300.0, 150.0, 150.0, 9.0, 12.0, 12.0]
    assert m.properties[3] == {"card": "PCOMP", "t": 5.0}
```

- [ ] **Step 2: 실패 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_bdf_model.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.bdf.coords'`

- [ ] **Step 3: 구현**

`backend/app/bdf/coords.py`:

```python
"""좌표계 → 전역(basic) 좌표. CORD2R/C/S 는 세 점(A 원점, B z 축 위, C xz 평면 위), CORD1R/C/S 는 세 GRID 로 정한다.

정의가 서로를 참조하므로(좌표계가 다른 좌표계·GRID 를 기준으로 함) 더 풀리는 것이 없을 때까지 반복한다.
"""
import math

Vec = tuple[float, float, float]


def _sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a: Vec, b: Vec) -> Vec:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _unit(a: Vec) -> Vec:
    n = math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2)
    if n < 1e-12:
        raise ValueError("퇴화한 좌표계")
    return (a[0] / n, a[1] / n, a[2] / n)


class CoordSystem:
    def __init__(self, kind: str, origin: Vec, ex: Vec, ey: Vec, ez: Vec):
        self.kind, self.o, self.ex, self.ey, self.ez = kind, origin, ex, ey, ez
        self.is_basic = kind == "R" and origin == (0.0, 0.0, 0.0) and ex == (1.0, 0.0, 0.0) and ey == (0.0, 1.0, 0.0)

    def to_basic(self, p) -> Vec:
        a, b, c = float(p[0]), float(p[1]), float(p[2])
        if self.kind == "C":
            t = math.radians(b)
            a, b = a * math.cos(t), a * math.sin(t)
        elif self.kind == "S":
            th, ph = math.radians(b), math.radians(c)
            a, b, c = a * math.sin(th) * math.cos(ph), a * math.sin(th) * math.sin(ph), a * math.cos(th)
        if self.is_basic:
            return (a, b, c)
        o, x, y, z = self.o, self.ex, self.ey, self.ez
        return (o[0] + a * x[0] + b * y[0] + c * z[0],
                o[1] + a * x[1] + b * y[1] + c * z[1],
                o[2] + a * x[2] + b * y[2] + c * z[2])


BASIC = CoordSystem("R", (0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def from_points(kind: str, a: Vec, b: Vec, c: Vec) -> CoordSystem:
    ez = _unit(_sub(b, a))
    ey = _unit(_cross(ez, _sub(c, a)))
    ex = _cross(ey, ez)
    return CoordSystem(kind, a, ex, ey, ez)


def resolve_coords(raw_grids: dict[int, tuple[int, float, float, float]],
                   coord_defs: list[tuple]) -> tuple[dict[int, Vec], int, list[int]]:
    """raw_grids: gid → (cp, x, y, z). coord_defs: ("2", kind, cid, rid, [9 실수]) | ("1", kind, cid, None, [g1, g2, g3]).
    반환: (gid → 전역 좌표, 풀지 못한 GRID 수, 퇴화한 좌표계 cid 목록)."""
    systems: dict[int, CoordSystem] = {0: BASIC}
    nodes: dict[int, Vec] = {}
    pending = dict(raw_grids)
    defs = list(coord_defs)
    bad: list[int] = []
    progress = True
    while progress:
        progress = False
        for gid, (cp, x, y, z) in list(pending.items()):
            cs = systems.get(cp)
            if cs is not None:
                nodes[gid] = cs.to_basic((x, y, z))
                del pending[gid]
                progress = True
        for d in list(defs):
            form, kind, cid, rid, vals = d
            if form == "2":
                ref = systems.get(rid)
                if ref is None:
                    continue
                a, b, c = ref.to_basic(vals[0:3]), ref.to_basic(vals[3:6]), ref.to_basic(vals[6:9])
            else:
                if not all(g in nodes for g in vals):
                    continue
                a, b, c = (nodes[g] for g in vals)
            defs.remove(d)
            progress = True
            try:
                systems[cid] = from_points(kind, a, b, c)
            except ValueError:
                bad.append(cid)
    return nodes, len(pending), bad
```

`backend/app/bdf/model.py`:

```python
"""카드 → Model. 표시에 필요한 것만 해석한다(설계 §7.1·§7.2)."""
from collections import Counter
from dataclasses import dataclass, field

from .coords import resolve_coords
from .deck import Card
from .fields import is_real, parse_float, parse_int

BEAM_CARDS = ("CBAR", "CBEAM", "CROD", "CONROD", "CBUSH")
TRI_CARDS = ("CTRIA3", "CTRIA6", "CTRIAR")
QUAD_CARDS = ("CQUAD4", "CQUAD8", "CQUADR")
RIGID_CARDS = ("RBE2", "RBE3")
# PBARL/PBEAML 형상별 DIM 개수(MSC QRG). 표에 없는 형상은 4개로 본다.
DIM_COUNT = {"ROD": 1, "TUBE": 2, "TUBE2": 2, "BAR": 2, "BOX": 4, "BOX1": 6, "L": 4, "I": 6, "I1": 4, "T": 4,
             "T1": 4, "T2": 4, "CHAN": 4, "CHAN1": 4, "CHAN2": 4, "H": 4, "HAT": 4, "HAT1": 5, "Z": 4,
             "CROSS": 4, "HEXA": 3, "DBOX": 10}
# 표시와 무관해 조용히 넘기는 카드(하중·해석 제어 등)
IGNORED = {"PARAM", "EIGRL", "EIGR", "FORCE", "FORCE1", "FORCE2", "MOMENT", "MOMENT1", "GRAV", "LOAD",
           "PLOAD", "PLOAD1", "PLOAD2", "PLOAD4", "TEMP", "TEMPD", "SPCADD", "MPCADD", "LSEQ", "DLOAD",
           "RLOAD1", "RLOAD2", "TLOAD1", "TLOAD2", "TABLED1", "TABDMP1", "FREQ", "FREQ1", "NLPARM", "SPCD",
           "MPC", "DMIG", "ACCEL", "ACCEL1", "RFORCE", "SUPORT", "ASET", "ASET1", "OMIT1", "SESET",
           "DAREA", "DPHASE", "DELAY", "EIGB", "TSTEP", "PLOTEL", "GRDSET"}


@dataclass
class Element:
    eid: int
    card: str
    pid: int
    nodes: tuple[int, ...]


@dataclass
class Rigid:
    eid: int
    card: str
    center: int
    others: list[int]


@dataclass
class Model:
    nodes: dict[int, tuple[float, float, float]] = field(default_factory=dict)
    beams: list[Element] = field(default_factory=list)
    tris: list[Element] = field(default_factory=list)
    quads: list[Element] = field(default_factory=list)
    rigids: list[Rigid] = field(default_factory=list)
    masses: list[tuple[int, int, float]] = field(default_factory=list)
    spcs: dict[int, str] = field(default_factory=dict)
    properties: dict[int, dict] = field(default_factory=dict)
    materials: dict[int, dict] = field(default_factory=dict)
    conrods: dict[int, dict] = field(default_factory=dict)
    sol: str | None = None
    warnings: list[str] = field(default_factory=list)
    unsupported: dict[str, int] = field(default_factory=dict)
    includes: list[str] = field(default_factory=list)
    missing_includes: list[str] = field(default_factory=list)

    def element_total(self) -> int:
        return len(self.beams) + len(self.tris) + len(self.quads)

    def counts(self) -> dict[str, int]:
        c = Counter(e.card for e in (*self.beams, *self.tris, *self.quads))
        c.update(r.card for r in self.rigids)
        if self.masses:
            c["CONM2"] = len(self.masses)
        c["GRID"] = len(self.nodes)
        return dict(c)

    def bbox(self) -> dict | None:
        if not self.nodes:
            return None
        xs, ys, zs = zip(*self.nodes.values())
        return {"min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]}


def _ints(tokens) -> list[int]:
    return [v for v in (parse_int(t) for t in tokens if t and not is_real(t)) if v is not None]


def _property(name: str, f: list[str]) -> tuple[int | None, dict]:
    pid = parse_int(f[0])
    mid = parse_int(f[1])
    if name == "PSHELL":
        return pid, {"card": name, "mid": mid, "t": parse_float(f[2])}
    if name in ("PBARL", "PBEAML"):
        shape = (f[3] or "").upper()
        dims = [v for v in (parse_float(x) for x in f[4:]) if v is not None][:DIM_COUNT.get(shape, 4)]
        return pid, {"card": name, "mid": mid, "type": shape, "dims": dims}
    if name in ("PBAR", "PBEAM", "PROD"):
        return pid, {"card": name, "mid": mid, "A": parse_float(f[2])}
    if name == "PCOMP":
        plies = f[8:]
        t = sum(v for v in (parse_float(plies[k]) for k in range(1, len(plies), 4)) if v is not None)
        return pid, {"card": name, "t": t or None}
    return pid, {"card": name}


def _rbe3_others(tokens: list[str]) -> list[int]:
    others: list[int] = []
    expect_component = False
    for t in tokens:
        t = (t or "").strip().upper()
        if not t:
            continue
        if t in ("UM", "ALPHA"):
            break
        if is_real(t):
            expect_component = True
            continue
        v = parse_int(t)
        if v is None:
            continue
        if expect_component:
            expect_component = False
            continue
        others.append(v)
    return others


def _spc1_nodes(tokens: list[str]) -> list[int]:
    toks = [t for t in tokens if t]
    if len(toks) >= 3 and toks[1].upper() == "THRU":
        a, b = parse_int(toks[0]), parse_int(toks[2])
        if a is not None and b is not None and 0 <= b - a <= 1_000_000:
            return list(range(a, b + 1))
        return []
    return _ints(toks)


def build_model(cards: list[Card], *, sol: str | None = None, warnings=(), includes=(), missing=()) -> Model:
    m = Model(sol=sol, warnings=list(warnings), includes=list(includes), missing_includes=list(missing))
    raw_grids: dict[int, tuple[int, float, float, float]] = {}
    coord_defs: list[tuple] = []
    raw_beams, raw_tris, raw_quads = [], [], []
    unsupported: Counter = Counter()
    grounded = 0
    for c in cards:
        n, f = c.name, c.fields + [""] * max(0, 24 - len(c.fields))
        if n == "GRID":
            gid = parse_int(f[0])
            if gid is not None:
                raw_grids[gid] = (parse_int(f[1]) or 0, parse_float(f[2]) or 0.0,
                                  parse_float(f[3]) or 0.0, parse_float(f[4]) or 0.0)
        elif n in ("CORD2R", "CORD2C", "CORD2S"):
            cid = parse_int(f[0])
            if cid:
                coord_defs.append(("2", n[-1], cid, parse_int(f[1]) or 0,
                                   [parse_float(x) or 0.0 for x in (f[2:8] + f[8:11])]))
        elif n in ("CORD1R", "CORD1C", "CORD1S"):
            for k in (0, 4):
                cid = parse_int(f[k])
                gs = [parse_int(f[k + j]) for j in (1, 2, 3)]
                if cid and all(g is not None for g in gs):
                    coord_defs.append(("1", n[-1], cid, None, gs))
        elif n in BEAM_CARDS:
            eid = parse_int(f[0])
            if eid is None:
                continue
            if n == "CONROD":
                g1, g2 = parse_int(f[1]), parse_int(f[2])
                m.conrods[eid] = {"mid": parse_int(f[3]), "A": parse_float(f[4])}
                raw_beams.append(Element(eid, n, 0, (g1, g2)))
            else:
                ga, gb = parse_int(f[2]), parse_int(f[3])
                if gb is None:
                    grounded += 1
                    continue
                raw_beams.append(Element(eid, n, parse_int(f[1]) or 0, (ga, gb)))
        elif n in TRI_CARDS or n in QUAD_CARDS:
            eid = parse_int(f[0])
            k = 3 if n in TRI_CARDS else 4
            if eid is not None:
                target = raw_tris if k == 3 else raw_quads
                target.append(Element(eid, n, parse_int(f[1]) or 0, tuple(parse_int(x) for x in f[2:2 + k])))
        elif n == "RBE2":
            eid, gn = parse_int(f[0]), parse_int(f[1])
            if eid is not None and gn is not None:
                m.rigids.append(Rigid(eid, n, gn, _ints(f[3:])))
        elif n == "RBE3":
            eid, ref = parse_int(f[0]), parse_int(f[2])
            if eid is not None and ref is not None:
                m.rigids.append(Rigid(eid, n, ref, _rbe3_others(f[4:])))
        elif n == "CONM2":
            eid, g = parse_int(f[0]), parse_int(f[1])
            if eid is not None and g is not None:
                m.masses.append((eid, g, parse_float(f[3]) or 0.0))
        elif n == "SPC":
            for g_i, c_i in ((1, 2), (4, 5)):
                g, comp = parse_int(f[g_i]), (f[c_i] or "").strip()
                if g is not None and comp:
                    m.spcs[g] = "".join(sorted(set(m.spcs.get(g, "") + comp)))
        elif n == "SPC1":
            comp = (f[1] or "").strip()
            for g in _spc1_nodes(f[2:]):
                m.spcs[g] = "".join(sorted(set(m.spcs.get(g, "") + comp)))
        elif n.startswith("P") and n not in IGNORED and n != "PARAM":
            pid, prop = _property(n, f)
            if pid is not None:
                m.properties[pid] = prop
        elif n.startswith("MAT"):
            mid = parse_int(f[0])
            if mid is not None:
                m.materials[mid] = ({"card": n, "E": parse_float(f[1]), "G": parse_float(f[2]),
                                     "nu": parse_float(f[3]), "rho": parse_float(f[4])}
                                    if n == "MAT1" else {"card": n})
        elif n not in IGNORED:
            unsupported[n] += 1

    m.nodes, unresolved, bad = resolve_coords(raw_grids, coord_defs)
    if unresolved:
        m.warnings.append(f"coord_unresolved: {unresolved}")
    for cid in bad:
        m.warnings.append(f"coord_degenerate: {cid}")
    if grounded:
        m.warnings.append(f"grounded_cbush: {grounded}")

    missing = 0
    for raw, target in ((raw_beams, m.beams), (raw_tris, m.tris), (raw_quads, m.quads)):
        for e in raw:
            if all(nid in m.nodes for nid in e.nodes):
                target.append(e)
            else:
                missing += 1
    rigids = []
    for r in m.rigids:
        others = [g for g in r.others if g in m.nodes]
        if r.center in m.nodes and others:
            rigids.append(Rigid(r.eid, r.card, r.center, others))
        else:
            missing += 1
    m.rigids = rigids
    kept = [x for x in m.masses if x[1] in m.nodes]
    missing += len(m.masses) - len(kept)
    m.masses = kept
    m.spcs = {g: comp for g, comp in m.spcs.items() if g in m.nodes}
    if missing:
        m.warnings.append(f"missing_node: {missing}")
    m.unsupported = dict(unsupported.most_common(30))
    return m
```

구현 메모:
- `f = c.fields + [""] * ...` 는 짧은 카드에서 `IndexError` 를 막으려는 것이다. 24칸이면 CORD2R(11칸)·PCOMP 첫 층까지 충분하다.
- PCOMP 층은 `f[8:]` 를 쓰므로 원래 `c.fields` 가 더 길면 그대로 이어진다. `f` 는 `c.fields` 뒤에 빈칸만 덧붙이기 때문이다.
- 테스트 `test_rigids_masses_spcs` 의 RBE3 토큰 순서는 다음과 같다.

  | 토큰 | 해석 |
  |---|---|
  | `1.0` | WT |
  | `123` | 성분 |
  | `5`, `6` | 절점 |
  | `0.5` | WT |
  | `12` | 성분 |
  | `7` | 절점 |

  따라서 나머지 절점은 `[5, 6, 7]` 이다.

- [ ] **Step 4: 통과 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_bdf_model.py -v`
Expected: PASS (9 passed)

- [ ] **Step 5: 커밋(사람)** — `feat: 04a 좌표계·모델 해석(요소·RBE·질량·SPC·속성·재료)`

---

### Task 3: `model.lbm` 쓰기·읽기

**Files:**
- Create: `backend/app/bdf/lbm.py`
- Test: `backend/tests/test_lbm.py`

형식(리틀엔디언, 전체를 gzip):

```
"LBM1"(4B) | u32 머리말 길이 | 머리말 JSON(UTF-8, 4바이트 배수로 공백 채움) | 본문 블록들(각 4바이트 정렬)
```

머리말 JSON의 키:
- `version`, `bbox`, `counts`, `sol`, `warnings`(앞 50개), `unsupported`
- `properties`: `"<pid>": {...}`
- `materials`
- `conrods`: `"<eid>": {"mid","A"}`
- `cards`: `{"beam": [...BEAM_CARDS], "tri": [...TRI_CARDS], "quad": [...QUAD_CARDS], "rigid": ["RBE2","RBE3"]}`
- `blocks`: `{이름: {offset(본문 기준), dtype, count, width}}`

블록 목록. 모든 절점 참조는 **절점 id 가 아니라 `node_ids` 배열의 순번**이라 브라우저가 바로 쓴다.

| 이름 | dtype | width | 내용 |
|---|---|---|---|
| `node_ids` | `<i4` | 1 | 절점 id(오름차순) |
| `node_xyz` | `<f4` | 3 | 전역 좌표 |
| `beams` | `<i4` | 4 | eid, pid, 절점 순번 a, b |
| `beam_cards` | `|u1` | 1 | `cards.beam` 순번 |
| `tris` | `<i4` | 5 | eid, pid, a, b, c |
| `tri_cards` | `|u1` | 1 | |
| `quads` | `<i4` | 6 | eid, pid, a, b, c, d |
| `quad_cards` | `|u1` | 1 | |
| `rigid_lines` | `<i4` | 3 | eid, 중심 순번, 상대 순번 (RBE 하나가 여러 줄) |
| `rigid_kinds` | `|u1` | 1 | 0=RBE2, 1=RBE3 |
| `masses` | `<i4` | 2 | eid, 절점 순번 |
| `mass_values` | `<f4` | 1 | 질량 |
| `spcs` | `<i4` | 2 | 절점 순번, 구속 성분 정수(예 123456) |

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_lbm.py`:

```python
import gzip
import struct

import numpy as np

from app.bdf.deck import DeckReader
from app.bdf.lbm import read_lbm, write_lbm
from app.bdf.model import build_model

DECK = (
    "SOL 101\nCEND\nBEGIN BULK\n"
    "GRID,3,,0.,1000.,0.\nGRID,1,,0.,0.,0.\nGRID,2,,1000.,0.,0.\nGRID,4,,1000.,1000.,0.\n"
    "CBEAM,10,1,1,2,0.,0.,1.\nCONROD,11,2,3,1,25.\nCQUAD4,20,5,1,2,4,3\nCTRIA3,21,5,1,2,4\n"
    "RBE2,30,1,123456,2,3\nRBE3,31,,4,123,1.,123,1,2\nCONM2,40,4,,2.5\nSPC1,1,123456,1,3\n"
    "PBEAML,1,1,,L\n,100.,100.,10.,10.\nPSHELL,5,1,12.\nMAT1,1,206000.,,0.3,7.85-9\nFOO,1\nENDDATA\n"
)


def _model():
    r = DeckReader(lambda rel: DECK.encode())
    return build_model(r.read("m.bdf"), sol=r.sol, warnings=r.warnings)


def test_layout_and_alignment():
    raw = gzip.decompress(write_lbm(_model()))
    assert raw[:4] == b"LBM1"
    (hlen,) = struct.unpack("<I", raw[4:8])
    assert hlen % 4 == 0 and (8 + hlen) % 4 == 0
    header, blocks = read_lbm(write_lbm(_model()))
    for meta in header["blocks"].values():
        assert meta["offset"] % 4 == 0


def test_roundtrip_blocks():
    header, b = read_lbm(write_lbm(_model()))
    assert header["version"] == 1 and header["sol"] == "101"
    assert b["node_ids"].tolist() == [1, 2, 3, 4]
    assert b["node_xyz"].shape == (4, 3) and b["node_xyz"][1].tolist() == [1000.0, 0.0, 0.0]
    assert b["beams"].tolist() == [[10, 1, 0, 1], [11, 0, 1, 2]]  # CONROD 11: G1=2, G2=3 → 순번 1, 2
    assert [header["cards"]["beam"][i] for i in b["beam_cards"].tolist()] == ["CBEAM", "CONROD"]
    assert b["quads"].tolist() == [[20, 5, 0, 1, 3, 2]] and b["tris"].tolist() == [[21, 5, 0, 1, 3]]
    assert b["rigid_lines"].tolist() == [[30, 0, 1], [30, 0, 2], [31, 3, 0], [31, 3, 1]]
    assert b["rigid_kinds"].tolist() == [0, 0, 1, 1]
    assert b["masses"].tolist() == [[40, 3]] and b["mass_values"].tolist() == [2.5]
    assert b["spcs"].tolist() == [[0, 123456], [2, 123456]]
    assert header["properties"]["1"]["dims"] == [100.0, 100.0, 10.0, 10.0]
    assert header["conrods"]["11"] == {"mid": 1, "A": 25.0}
    assert header["counts"]["CQUAD4"] == 1 and header["unsupported"] == {"FOO": 1}
    assert header["bbox"] == {"min": [0.0, 0.0, 0.0], "max": [1000.0, 1000.0, 0.0]}


def test_empty_blocks_are_present():
    r = DeckReader(lambda rel: b"GRID,1,,0.,0.,0.\nGRID,2,,1.,0.,0.\nCROD,1,1,1,2\n")
    header, b = read_lbm(write_lbm(build_model(r.read("m.bdf"))))
    assert b["tris"].shape == (0, 5) and b["rigid_lines"].shape == (0, 3) and b["mass_values"].shape == (0,)
    assert isinstance(b["node_xyz"], np.ndarray)
```

- [ ] **Step 2: 실패 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_lbm.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: 구현**

`backend/app/bdf/lbm.py`:

```python
"""model.lbm — 브라우저 뷰어용 gzip 바이너리(설계 §7.2). 형식은 04a 계획서 Task 3 표를 따른다."""
import gzip
import json
import struct

import numpy as np

from .model import BEAM_CARDS, QUAD_CARDS, RIGID_CARDS, TRI_CARDS, Model

MAGIC = b"LBM1"
VERSION = 1
MAX_WARNINGS = 50


def _arr(rows, dtype, width: int) -> np.ndarray:
    a = np.array(rows, dtype=dtype)
    return a.reshape(-1, width) if width > 1 else a.reshape(-1)


def build_blocks(m: Model) -> dict[str, np.ndarray]:
    ids = sorted(m.nodes)
    idx = {nid: i for i, nid in enumerate(ids)}
    rigid_lines, rigid_kinds = [], []
    for r in m.rigids:
        for o in r.others:
            rigid_lines.append((r.eid, idx[r.center], idx[o]))
            rigid_kinds.append(RIGID_CARDS.index(r.card))
    return {
        "node_ids": _arr(ids, "<i4", 1),
        "node_xyz": _arr([m.nodes[n] for n in ids], "<f4", 3),
        "beams": _arr([(e.eid, e.pid, idx[e.nodes[0]], idx[e.nodes[1]]) for e in m.beams], "<i4", 4),
        "beam_cards": _arr([BEAM_CARDS.index(e.card) for e in m.beams], "|u1", 1),
        "tris": _arr([(e.eid, e.pid, *(idx[n] for n in e.nodes)) for e in m.tris], "<i4", 5),
        "tri_cards": _arr([TRI_CARDS.index(e.card) for e in m.tris], "|u1", 1),
        "quads": _arr([(e.eid, e.pid, *(idx[n] for n in e.nodes)) for e in m.quads], "<i4", 6),
        "quad_cards": _arr([QUAD_CARDS.index(e.card) for e in m.quads], "|u1", 1),
        "rigid_lines": _arr(rigid_lines, "<i4", 3),
        "rigid_kinds": _arr(rigid_kinds, "|u1", 1),
        "masses": _arr([(eid, idx[g]) for eid, g, _ in m.masses], "<i4", 2),
        "mass_values": _arr([mass for _, _, mass in m.masses], "<f4", 1),
        "spcs": _arr([(idx[g], int(comp)) for g, comp in sorted(m.spcs.items()) if comp.isdigit()], "<i4", 2),
    }


def write_lbm(m: Model) -> bytes:
    blocks = build_blocks(m)
    body = bytearray()
    metas = {}
    for name, arr in blocks.items():
        body += b"\0" * (-len(body) % 4)
        metas[name] = {"offset": len(body), "dtype": arr.dtype.str, "count": int(arr.shape[0]),
                       "width": int(arr.shape[1]) if arr.ndim == 2 else 1}
        body += arr.tobytes()
    header = {
        "version": VERSION, "bbox": m.bbox(), "counts": m.counts(), "sol": m.sol,
        "warnings": m.warnings[:MAX_WARNINGS], "unsupported": m.unsupported,
        "properties": {str(k): v for k, v in sorted(m.properties.items())},
        "materials": {str(k): v for k, v in sorted(m.materials.items())},
        "conrods": {str(k): v for k, v in sorted(m.conrods.items())},
        "cards": {"beam": list(BEAM_CARDS), "tri": list(TRI_CARDS), "quad": list(QUAD_CARDS),
                  "rigid": list(RIGID_CARDS)},
        "blocks": metas,
    }
    hj = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    hj += b" " * (-len(hj) % 4)
    return gzip.compress(MAGIC + struct.pack("<I", len(hj)) + hj + bytes(body), compresslevel=6)


def read_lbm(data: bytes) -> tuple[dict, dict[str, np.ndarray]]:
    raw = gzip.decompress(data)
    if raw[:4] != MAGIC:
        raise ValueError("LBM 형식이 아닙니다")
    (hlen,) = struct.unpack("<I", raw[4:8])
    header = json.loads(raw[8:8 + hlen].decode("utf-8"))
    body = memoryview(raw)[8 + hlen:]
    blocks = {}
    for name, meta in header["blocks"].items():
        dt = np.dtype(meta["dtype"])
        n = meta["count"] * meta["width"]
        a = np.frombuffer(body, dtype=dt, count=n, offset=meta["offset"]).copy()
        blocks[name] = a.reshape(-1, meta["width"]) if meta["width"] > 1 else a
    return header, blocks
```

메모: `bbox()` 의 값은 파이썬 float 이라 JSON 으로 그대로 나간다. 빈 배열은 `np.array([], dtype).reshape(-1, w)` 로 모양이 `(0, w)` 가 된다.

- [ ] **Step 4: 통과 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_lbm.py -v`
Expected: PASS

- [ ] **Step 5: 커밋(사람)** — `feat: 04a model.lbm 바이너리 형식`

---

### Task 4: 모델 지문과 썸네일

**Files:**
- Create: `backend/app/bdf/fingerprint.py`, `backend/app/bdf/thumbnail.py`
- Test: `backend/tests/test_fingerprint_thumbnail.py`

지문(설계 §7.6)은 다음을 ` · ` 로 이은 한 줄이다.
- 요소 종류별 개수(많은 순)
- `크기 <dx>x<dy>x<dz>`
- 단면 문자열(이름순, 중복 제거, 최대 200개)
- `MAT1 E<E>`
- `SOL <n>`

단면 문자열의 형식은 다음과 같다.
- PBARL·PBEAML: `PBEAML L 100x100x10x10`
- PSHELL: `PSHELL t12`
- PCOMP: `PCOMP t5`
- PBAR·PBEAM·PROD: `PROD A50`

숫자는 `%g`(6자리)로 쓴다.

썸네일(설계 §7.5)은 640×400 PNG, 바탕 `#F7F8FA` 이고 (1,1,1) 방향에서 본 등각 투영이다.
- 쉘 다각형은 PID 색에 법선과 시선 각도로 음영을 주어 먼 것부터 칠한다.
- 1D 요소는 위에 선으로 그린다.
- 쉘이 15만 개를 넘으면 고르게 솎는다. 1D 요소도 20만 개를 넘으면 마찬가지로 솎는다.
- 테두리선은 쉘 2만 개 이하일 때만 그린다.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_fingerprint_thumbnail.py`:

```python
import io

import pytest
from PIL import Image

from app.bdf.deck import DeckReader
from app.bdf.fingerprint import fingerprint, section_label
from app.bdf.model import build_model
from app.bdf.thumbnail import HEIGHT, WIDTH, render_thumbnail


def _model(text):
    r = DeckReader(lambda rel: text.encode())
    return build_model(r.read("m.bdf"), sol=r.sol)


PLATE = (
    "SOL 101\nCEND\nBEGIN BULK\n"
    + "".join(f"GRID,{i * 3 + j + 1},,{j * 500.},{i * 500.},0.\n" for i in range(3) for j in range(3))
    + "CQUAD4,1,5,1,2,5,4\nCQUAD4,2,5,2,3,6,5\nCQUAD4,3,5,4,5,8,7\nCQUAD4,4,5,5,6,9,8\n"
    "GRID,20,,0.,0.,800.\nCBEAM,10,1,1,20,1.,0.,0.\n"
    "PSHELL,5,1,12.\nPBEAML,1,1,,L\n,100.,100.,10.,10.\nMAT1,1,206000.,,0.3\nENDDATA\n"
)


def test_section_labels():
    assert section_label({"card": "PBEAML", "type": "L", "dims": [100.0, 100.0, 10.0, 10.0]}) == "PBEAML L 100x100x10x10"
    assert section_label({"card": "PSHELL", "t": 12.0}) == "PSHELL t12"
    assert section_label({"card": "PROD", "A": 50.5}) == "PROD A50.5"
    assert section_label({"card": "PELAS"}) == "PELAS"


def test_fingerprint_text():
    fp = fingerprint(_model(PLATE))
    assert fp.startswith("CQUAD4 4 · CBEAM 1")
    assert "크기 1000x1000x800" in fp
    assert "PBEAML L 100x100x10x10" in fp and "PSHELL t12" in fp
    assert "MAT1 E206000" in fp and fp.endswith("SOL 101")


def test_thumbnail_png():
    png = render_thumbnail(_model(PLATE))
    img = Image.open(io.BytesIO(png))
    assert img.format == "PNG" and img.size == (WIDTH, HEIGHT)
    colors = img.convert("RGB").getcolors(maxcolors=100000)
    assert len(colors) > 3  # 바탕만 있는 빈 그림이 아니다


def test_thumbnail_needs_nodes():
    with pytest.raises(ValueError):
        render_thumbnail(_model("PSHELL,1,1,1.\n"))
```

- [ ] **Step 2: 실패 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_fingerprint_thumbnail.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: 구현**

`backend/app/bdf/fingerprint.py`:

```python
"""모델 지문(설계 §7.6) — 요소 수·크기·단면·재료·SOL 을 한 줄로. 검색 색인(file_texts locator 'model')에 들어간다."""
from collections import Counter

from .model import Model

MAX_SECTIONS = 200


def fmt(v) -> str:
    return f"{float(v):.6g}"


def section_label(p: dict) -> str:
    card = p.get("card", "")
    if card in ("PBARL", "PBEAML") and p.get("dims"):
        return f"{card} {p.get('type', '')} " + "x".join(fmt(d) for d in p["dims"])
    if card in ("PSHELL", "PCOMP") and p.get("t"):
        return f"{card} t{fmt(p['t'])}"
    if card in ("PBAR", "PBEAM", "PROD") and p.get("A"):
        return f"{card} A{fmt(p['A'])}"
    return card


def fingerprint(m: Model) -> str:
    counts = Counter(e.card for e in (*m.beams, *m.tris, *m.quads))
    counts.update(r.card for r in m.rigids)
    parts = [f"{card} {n}" for card, n in sorted(counts.items(), key=lambda x: (-x[1], x[0]))]
    box = m.bbox()
    if box:
        dims = [box["max"][k] - box["min"][k] for k in range(3)]
        parts.append("크기 " + "x".join(fmt(d) for d in dims))
    parts += sorted({section_label(p) for p in m.properties.values()} - {""})[:MAX_SECTIONS]
    parts += sorted({f"MAT1 E{fmt(x['E'])}" for x in m.materials.values() if x.get("card") == "MAT1" and x.get("E")})
    if m.sol:
        parts.append(f"SOL {m.sol}")
    return " · ".join(parts)
```

`backend/app/bdf/thumbnail.py`:

```python
"""썸네일(설계 §7.5) — numpy + Pillow 로 등각 투영 PNG. 브라우저·GPU 가 필요 없다.

(1,1,1) 방향에서 바라본다(오른쪽 = (-1,1,0), 위 = (-1,-1,2)). 쉘은 먼 것부터 칠하고(화가 알고리즘)
1D 요소는 위에 선으로 그린다. 요소가 아주 많으면 고르게 솎아 몇 초 안에 끝나게 한다."""
import io
import math

import numpy as np
from PIL import Image, ImageDraw

from .model import Model

WIDTH, HEIGHT, MARGIN = 640, 400, 16
BACKGROUND = (247, 248, 250)
PALETTE = [(0, 61, 128), (0, 130, 51), (180, 83, 9), (124, 58, 237), (14, 116, 144), (190, 18, 60),
           (71, 85, 105), (161, 98, 7), (2, 132, 199), (101, 163, 13), (219, 39, 119), (87, 83, 78)]
MAX_SHELLS, MAX_BEAMS, OUTLINE_LIMIT = 150_000, 200_000, 20_000
_EYE = np.array([1.0, 1.0, 1.0]) / math.sqrt(3)
_RIGHT = np.array([-1.0, 1.0, 0.0]) / math.sqrt(2)
_UP = np.array([-1.0, -1.0, 2.0]) / math.sqrt(6)


def color_for(pid: int) -> tuple[int, int, int]:
    return PALETTE[pid % len(PALETTE)]


def _thin(items: list, limit: int) -> list:
    step = max(1, math.ceil(len(items) / limit))
    return items[::step]


def render_thumbnail(m: Model) -> bytes:
    if not m.nodes:
        raise ValueError("절점이 없어 썸네일을 만들 수 없습니다")
    ids = list(m.nodes)
    index = {n: i for i, n in enumerate(ids)}
    p = np.array([m.nodes[n] for n in ids], dtype=np.float64)
    sx, sy, depth = p @ _RIGHT, p @ _UP, p @ _EYE
    w = max(float(sx.max() - sx.min()), 1e-9)
    h = max(float(sy.max() - sy.min()), 1e-9)
    s = min((WIDTH - 2 * MARGIN) / w, (HEIGHT - 2 * MARGIN) / h)
    ox = (WIDTH - w * s) / 2
    oy = (HEIGHT - h * s) / 2
    X = (sx - sx.min()) * s + ox
    Y = HEIGHT - ((sy - sy.min()) * s + oy)

    img = Image.new("RGB", (WIDTH, HEIGHT), BACKGROUND)
    draw = ImageDraw.Draw(img)

    shells = _thin([*m.tris, *m.quads], MAX_SHELLS)
    if shells:
        idx = [[index[n] for n in e.nodes] for e in shells]
        order = sorted(range(len(shells)), key=lambda k: float(depth[idx[k]].mean()))
        outline = len(shells) <= OUTLINE_LIMIT
        for k in order:
            v = idx[k]
            a, b, c = p[v[0]], p[v[1]], p[v[2]]
            n = np.cross(b - a, c - a)
            norm = float(np.linalg.norm(n)) or 1.0
            shade = 0.55 + 0.45 * abs(float(n @ _EYE)) / norm
            base = color_for(shells[k].pid)
            fill = tuple(int(255 - (255 - ch) * shade * 0.75) for ch in base)
            edge = tuple(int(ch * 0.7) for ch in fill) if outline else None
            draw.polygon([(float(X[i]), float(Y[i])) for i in v], fill=fill, outline=edge)

    beams = _thin(m.beams, MAX_BEAMS)
    width = 2 if len(beams) < 20_000 else 1
    for e in beams:
        a, b = index[e.nodes[0]], index[e.nodes[1]]
        draw.line([(float(X[a]), float(Y[a])), (float(X[b]), float(Y[b]))], fill=color_for(e.pid), width=width)

    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()
```

- [ ] **Step 4: 통과 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_fingerprint_thumbnail.py -v`
Expected: PASS

- [ ] **Step 5: 커밋(사람)** — `feat: 04a 모델 지문·썸네일`

---

### Task 5: `ModelSummary` 와 변환 작업

**Files:**
- Modify: `backend/app/models.py`
- Create: `backend/app/convert/__init__.py`(빈 docstring), `backend/app/convert/job.py`
- Test: `backend/tests/test_convert_job.py`

규칙(설계 §7.1·§7.7):
- 상태 `queued|done|failed|skipped|include`.
  - `skipped` 사유: `drm`, `too_large`(1GB 초과), `trashed`, `no_elements`.
  - 휴지통 파일은 이미 `done` 이면 그대로 둔다(03 추출과 같다).
- 파일 위치(뿌리):
  - staging = `storage.staging/<batch.key>`, 같은 배치의 모델 파일이 형제다.
  - vault = `entry_dir/files`, 같은 Entry 의 모델 파일이 형제다.
- 본 파일이 `HHIDRMC` 로 시작하면 `skipped(drm)` 다. INCLUDE 파일이 암호문이면 경고 `include_missing` 으로 다룬다.
- 형제 중 누가 이 파일을 INCLUDE 한다고 기록돼 있으면(`includes` 에 rel_path) `include` 로 끝낸다.
- 변환이 끝나면 다음을 한다.
  - 내가 INCLUDE 한 형제를 모두 `include` 로 바꾸고, 그 파일들의 지문 색인 행을 지운다.
  - `20_Derived\_model\<key[:2]>\<key>.lbm|.png` 를 쓴다. 쓰기 실패 `OSError` 는 위로 던져 재시도한다.
  - `file_texts` 에 locator `model` 로 지문 한 줄을 둔다(기존 `model` 행은 지우고 다시 넣는다).
- 파싱·변환 중 예외는 `failed` 로 기록하고 작업은 완료 처리한다. 본 파일 읽기 `OSError` 는 위로 던진다.
- `requeue_entry_models(db, entry_id)`: Entry 의 모델 파일 중 INCLUDE 가 없었거나(`missing` 비어 있지 않음), `failed`·`no_elements` 인 것을 다시 큐에 넣는다. "파일 추가 시 자동 재변환"(설계 §7.7)에 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_convert_job.py`:

```python
import os

import pytest

from app import jobs, models
from app.bdf.lbm import read_lbm
from app.convert.job import enqueue_convert, model_paths, requeue_entry_models, run_convert
from app.entries.locate import file_path
from app.storage.paths import to_long

MAIN = "BEGIN BULK\nINCLUDE 'mesh.bdf'\nINCLUDE 'mat.bdf'\nPSHELL,5,1,12.\nENDDATA\n"
MESH = ("GRID,1,,0.,0.,0.\nGRID,2,,1000.,0.,0.\nGRID,3,,1000.,1000.,0.\nGRID,4,,0.,1000.,0.\n"
        "CQUAD4,1,5,1,2,3,4\n")
MAT = "MAT1,1,206000.,,0.3\n"


def _write(db, storage, f, text: str | bytes):
    p = file_path(db, storage, f)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as fh:
        fh.write(text.encode() if isinstance(text, str) else text)


@pytest.fixture
def entry3(db, storage, make_entry_file):
    e, main = make_entry_file(name="main.bdf", kind="model", sha="a" * 64)
    _e, mesh = make_entry_file(entry=e, name="mesh.bdf", kind="model", sha="b" * 64)
    _e, mat = make_entry_file(entry=e, name="mat.bdf", kind="model", sha="c" * 64)
    for f, t in ((main, MAIN), (mesh, MESH), (mat, MAT)):
        _write(db, storage, f, t)
    return e, main, mesh, mat


def test_enqueue_only_models(db, make_entry_file):
    _e, bdf = make_entry_file(name="a.bdf", kind="model")
    _e2, pdf = make_entry_file(name="r.pdf", kind="report")
    assert enqueue_convert(db, bdf) and not enqueue_convert(db, pdf)
    db.commit()
    assert db.get(models.ModelSummary, bdf.id).state == "queued"
    assert [j.type for j in db.query(models.Job)] == ["convert_model"]


def test_convert_with_includes(db, storage, entry3):
    _e, main, mesh, mat = entry3
    run_convert(db, storage, main)
    s = db.get(models.ModelSummary, main.id)
    assert s.state == "done" and s.error is None and len(s.key) == 64
    assert s.counts["CQUAD4"] == 1 and s.bbox["max"] == [1000.0, 1000.0, 0.0]
    assert s.includes == ["mesh.bdf", "mat.bdf"] and s.missing == []
    lbm, png = model_paths(storage, s.key)
    assert os.path.exists(to_long(lbm)) and os.path.exists(to_long(png))
    with open(to_long(lbm), "rb") as fh:
        header, blocks = read_lbm(fh.read())
    assert blocks["quads"].shape == (1, 6)
    assert db.get(models.ModelSummary, mesh.id).state == "include"
    assert db.get(models.ModelSummary, mat.id).state == "include"
    ft = db.query(models.FileText).filter_by(file_id=main.id, locator="model").one()
    assert "CQUAD4 1" in ft.text and "PSHELL t12" in ft.text


def test_included_file_converted_later_stays_include(db, storage, entry3):
    _e, main, mesh, _mat = entry3
    run_convert(db, storage, main)
    run_convert(db, storage, mesh)
    assert db.get(models.ModelSummary, mesh.id).state == "include"
    assert db.query(models.FileText).filter_by(file_id=mesh.id, locator="model").count() == 0


def test_included_file_first_then_overridden(db, storage, entry3):
    _e, main, mesh, _mat = entry3
    run_convert(db, storage, mesh)              # 단독으로 먼저 변환됨
    assert db.get(models.ModelSummary, mesh.id).state == "done"
    run_convert(db, storage, main)              # 본 파일이 INCLUDE 하므로 include 로 바뀐다
    assert db.get(models.ModelSummary, mesh.id).state == "include"
    assert db.query(models.FileText).filter_by(file_id=mesh.id, locator="model").count() == 0


def test_missing_include_warns_and_requeue(db, storage, make_entry_file):
    e, main = make_entry_file(name="main.bdf", kind="model")
    _write(db, storage, main, "INCLUDE 'C:\\pc\\mesh.bdf'\nGRID,1,,0.,0.,0.\nGRID,2,,1.,0.,0.\nCROD,1,1,1,2\n")
    run_convert(db, storage, main)
    s = db.get(models.ModelSummary, main.id)
    assert s.state == "done" and s.missing == ["C:\\pc\\mesh.bdf"]
    assert any(w.startswith("include_missing") for w in s.warnings)
    db.query(models.Job).delete()
    db.commit()
    assert requeue_entry_models(db, e.id) == 1
    db.commit()
    assert db.query(models.Job).filter_by(type="convert_model", target_id=main.id).count() == 1


def test_no_elements_skipped(db, storage, make_entry_file):
    _e, f = make_entry_file(name="mat.bdf", kind="model")
    _write(db, storage, f, MAT)
    run_convert(db, storage, f)
    s = db.get(models.ModelSummary, f.id)
    assert (s.state, s.error) == ("skipped", "no_elements")


def test_drm_and_trash_and_size(db, storage, make_entry_file):
    _e, a = make_entry_file(name="a.bdf", kind="model")
    _write(db, storage, a, b"HHIDRMC" + b"\0" * 64)
    run_convert(db, storage, a)
    assert db.get(models.ModelSummary, a.id).error == "drm"
    _e, t = make_entry_file(status="trashed", name="t.bdf", kind="model")
    run_convert(db, storage, t)
    assert db.get(models.ModelSummary, t.id).error == "trashed"
    _e, big = make_entry_file(name="big.bdf", kind="model")
    big.size = 2 * 1024 ** 3
    db.commit()
    run_convert(db, storage, big)
    assert db.get(models.ModelSummary, big.id).error == "too_large"


def test_parse_error_fails_without_raising(db, storage, make_entry_file, monkeypatch):
    _e, f = make_entry_file(name="a.bdf", kind="model")
    _write(db, storage, f, MESH)
    import app.convert.job as job

    def boom(*a, **k):
        raise RuntimeError("파서 오류")
    monkeypatch.setattr(job, "build_model", boom)
    run_convert(db, storage, f)
    s = db.get(models.ModelSummary, f.id)
    assert s.state == "failed" and "파서 오류" in s.error


def test_missing_main_file_raises(db, storage, make_entry_file):
    _e, f = make_entry_file(name="nope.bdf", kind="model")
    with pytest.raises(OSError):
        run_convert(db, storage, f)


def test_staging_siblings_by_batch(db, storage, make_entry_file):
    e, main = make_entry_file(status="draft", name="main.bdf", kind="model")
    _e, mesh = make_entry_file(entry=e, name="mesh.bdf", kind="model")
    _write(db, storage, main, "INCLUDE 'mesh.bdf'\n")
    _write(db, storage, mesh, MESH)
    run_convert(db, storage, main)
    assert db.get(models.ModelSummary, main.id).state == "done"
    assert db.get(models.ModelSummary, mesh.id).state == "include"
```

- [ ] **Step 2: 실패 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_convert_job.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.convert'`

- [ ] **Step 3: 구현**

`backend/app/models.py` 끝(DownloadToken 뒤)에 추가한다:

```python
MODEL_STATES = ("queued", "done", "failed", "skipped", "include")


class ModelSummary(Base):
    """BDF 변환 결과 요약(설계 §4 model_summaries). 파생물(lbm·png)은 key(바이트 sha256)로 20_Derived 에 있다."""

    __tablename__ = "model_summaries"

    file_id = Column(Integer, ForeignKey("files.id", ondelete="CASCADE"), primary_key=True)
    state = Column(String(10), nullable=False, default="queued")
    error = Column(String(500), nullable=True)
    key = Column(String(64), nullable=True)
    counts = Column(JSON, nullable=True)
    bbox = Column(JSON, nullable=True)
    sol = Column(String(20), nullable=True)
    fingerprint = Column(LONG_TEXT, nullable=True)
    warnings = Column(JSON, nullable=True)
    includes = Column(JSON, nullable=True)   # 이 파일이 INCLUDE 한 형제 rel_path
    missing = Column(JSON, nullable=True)    # 찾지 못한 INCLUDE 이름
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)
```

`backend/app/convert/__init__.py`:

```python
"""BDF 변환 작업(설계 §7)."""
```

`backend/app/convert/job.py`:

```python
"""convert_model 작업 — BDF 를 읽어 model.lbm·썸네일·지문을 만든다(설계 §7)."""
import logging
import os
from pathlib import Path

from sqlalchemy.orm import Session

from .. import jobs, models
from ..bdf.deck import DeckReader
from ..bdf.fingerprint import fingerprint
from ..bdf.lbm import write_lbm
from ..bdf.model import build_model
from ..bdf.thumbnail import render_thumbnail
from ..entries.files import entry_dir
from ..entries.locate import FileUnavailable
from ..storage.paths import StoragePaths, long_join, to_long

log = logging.getLogger(__name__)
MAX_MODEL_BYTES = 1024 ** 3
DRM_MAGIC = b"HHIDRMC"
MAX_WARNINGS = 50
RETRY_ERRORS = ("no_elements",)


class EncryptedFile(OSError):
    """DRM 암호문 — INCLUDE 쪽에서는 '찾지 못함'으로, 본 파일이면 skipped(drm)으로 다룬다."""


def model_paths(storage: StoragePaths, key: str) -> tuple[Path, Path]:
    base = storage.derived / "_model" / key[:2]
    return base / f"{key}.lbm", base / f"{key}.png"


def enqueue_convert(db: Session, f: models.File) -> bool:
    if f.kind != "model":
        return False
    row = db.get(models.ModelSummary, f.id)
    if row is None:
        db.add(models.ModelSummary(file_id=f.id, state="queued"))
    else:
        row.state, row.error = "queued", None
    jobs.enqueue(db, "convert_model", f.id)
    return True


def _row(db: Session, f: models.File) -> models.ModelSummary:
    row = db.get(models.ModelSummary, f.id)
    if row is None:
        row = models.ModelSummary(file_id=f.id)
        db.add(row)
    return row


def _finish(db: Session, row: models.ModelSummary, state: str, error: str | None = None) -> None:
    row.state, row.error = state, (error or None) and error[:500]
    if state != "done":
        db.query(models.FileText).filter_by(file_id=row.file_id, locator="model").delete(synchronize_session=False)
    db.commit()


def _root(db: Session, storage: StoragePaths, f: models.File) -> Path:
    if f.location == "staging":
        batch = db.get(models.Batch, f.batch_id)
        if batch is None:
            raise FileUnavailable("batch_missing")
        return storage.staging / batch.key
    if f.location == "vault":
        entry = db.get(models.Entry, f.entry_id) if f.entry_id else None
        if entry is None or not entry.vault_rel:
            raise FileUnavailable("entry_missing")
        return entry_dir(storage, entry) / "files"
    raise FileUnavailable(f.location)


def _siblings(db: Session, f: models.File) -> list[models.File]:
    q = db.query(models.File).filter(models.File.kind == "model", models.File.id != f.id,
                                     models.File.location == f.location)
    q = q.filter(models.File.batch_id == f.batch_id) if f.location == "staging" \
        else q.filter(models.File.entry_id == f.entry_id)
    return q.all()


def _included_by_sibling(db: Session, f: models.File, siblings: list[models.File]) -> bool:
    if not siblings:
        return False
    me = f.rel_path.casefold()
    rows = db.query(models.ModelSummary).filter(
        models.ModelSummary.file_id.in_([s.id for s in siblings]), models.ModelSummary.state == "done").all()
    return any(me in {r.casefold() for r in (row.includes or [])} for row in rows)


def _mark_included(db: Session, siblings: list[models.File], includes: list[str]) -> None:
    wanted = {r.casefold() for r in includes}
    for s in siblings:
        if s.rel_path.casefold() in wanted:
            row = _row(db, s)
            row.state, row.error = "include", None
            db.query(models.FileText).filter_by(file_id=s.id, locator="model").delete(synchronize_session=False)


def _opener(root: Path):
    def read(rel: str) -> bytes:
        with open(long_join(root, rel), "rb") as fh:
            data = fh.read()
        if data.startswith(DRM_MAGIC):
            raise EncryptedFile(rel)
        return data
    return read


def _write(path: Path, data: bytes) -> None:
    os.makedirs(to_long(path.parent), exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(to_long(tmp), "wb") as fh:
        fh.write(data)
    os.replace(to_long(tmp), to_long(path))


def run_convert(db: Session, storage: StoragePaths, f: models.File) -> None:
    row = _row(db, f)
    if f.location == "trash":
        if row.state == "done":
            return
        return _finish(db, row, "skipped", "trashed")
    if f.drm_encrypted:
        return _finish(db, row, "skipped", "drm")
    if f.size > MAX_MODEL_BYTES:
        return _finish(db, row, "skipped", "too_large")

    root = _root(db, storage, f)
    siblings = _siblings(db, f)
    if _included_by_sibling(db, f, siblings):
        return _finish(db, row, "include")

    reader = DeckReader(_opener(root))
    try:
        cards = reader.read(f.rel_path)
    except EncryptedFile:
        f.drm_encrypted = True
        return _finish(db, row, "skipped", "drm")
    # 그 밖의 OSError(파일 없음·잠김)는 위로 — 작업 큐가 재시도한다

    row.includes, row.missing = reader.includes, reader.missing
    try:
        model = build_model(cards, sol=reader.sol, warnings=reader.warnings,
                            includes=reader.includes, missing=reader.missing)
        if model.element_total() == 0:
            row.warnings = model.warnings[:MAX_WARNINGS]
            _mark_included(db, siblings, reader.includes)
            return _finish(db, row, "skipped", "no_elements")
        lbm = write_lbm(model)
        png = render_thumbnail(model)
        fp = fingerprint(model)
    except Exception as exc:  # 모델이 깨졌다 — 다시 돌려도 같으니 실패로 기록하고 끝낸다
        log.warning("BDF 변환 실패: file=%s %s — %s", f.id, f.name, exc)
        return _finish(db, row, "failed", f"{type(exc).__name__}: {exc}")

    key = reader.digest
    lbm_path, png_path = model_paths(storage, key)
    _write(lbm_path, lbm)       # 실패(OSError)는 위로 — 재시도
    _write(png_path, png)

    row.state, row.error, row.key = "done", None, key
    row.counts, row.bbox, row.sol = model.counts(), model.bbox(), model.sol
    row.fingerprint, row.warnings = fp, model.warnings[:MAX_WARNINGS]
    db.query(models.FileText).filter_by(file_id=f.id, locator="model").delete(synchronize_session=False)
    db.add(models.FileText(file_id=f.id, seq=0, locator="model", text=fp))
    _mark_included(db, siblings, reader.includes)
    db.commit()


def requeue_entry_models(db: Session, entry_id: int) -> int:
    """파일이 더해진 Entry 에서 INCLUDE 를 못 찾았던·실패했던 모델을 다시 변환한다(설계 §7.7)."""
    n = 0
    files = db.query(models.File).filter_by(entry_id=entry_id, kind="model").all()
    rows = {r.file_id: r for r in db.query(models.ModelSummary)
            .filter(models.ModelSummary.file_id.in_([x.id for x in files] or [0]))}
    for f in files:
        r = rows.get(f.id)
        if r is None or r.missing or r.state == "failed" or (r.state == "skipped" and r.error in RETRY_ERRORS):
            n += enqueue_convert(db, f)
    return n
```

메모:
- `test_missing_include_warns_and_requeue` 의 INCLUDE 이름은 `C:\pc\mesh.bdf` 다. 파일 이름(`mesh.bdf`)으로 찾아도 없어서 `missing` 에 원래 이름이 남는다. `DeckReader._include` 는 원래 이름을 `missing` 에 넣는다.
- `requeue_entry_models` 는 `missing` 이 있는 `done` 파일도 다시 넣으므로 1건이다.

- [ ] **Step 4: 통과 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_convert_job.py -v`
Expected: PASS

- [ ] **Step 5: 커밋(사람)** — `feat: 04a BDF 변환 작업·model_summaries`

---

### Task 6: 워커·배치 처리·파일 추가 연결, CLI

**Files:**
- Modify: `backend/app/jobs.py`, `backend/app/worker.py`, `backend/app/ingest/process.py`, `backend/app/entries/service.py`, `backend/app/cli.py`
- Test: `backend/tests/test_convert_wiring.py`

규칙:
- `jobs.py` 에 `HEAVY_JOB_TYPES = ("extract_file", "convert_model")` 를 두고 두 곳에 쓴다.
  - 03 에서 `extract_file` 만 뒤로 미루던 `claim_next` 정렬
  - `worker.run_once` 의 무거운 작업 시간 예산(`EXTRACT_BUDGET_SECONDS`, 이름은 `HEAVY_BUDGET_SECONDS` 로 바꾸고 옛 이름은 별칭으로 남긴다)
- 워커는 `convert_model` 작업을 `run_convert` 로 처리한다. 마지막으로 실패하면(재시도 소진) `ModelSummary` 를 `failed` 로 기록한다(03 추출의 `mark_failed` 와 같다).
- `process_batch` 는 `enqueue_extract` 다음에 `enqueue_convert` 를 부른다.
- `entries.service.confirm` 의 "기존 Entry 에 추가" 분기는 `target` 커밋 직전에 `requeue_entry_models(db, target.id)` 를 부른다(설계 §7.7).
- `restore()` 는 03 에서 추출을 다시 넣는 곳에서 `skipped/trashed` 인 모델도 다시 넣는다.
- `file_to_dict` 의 각 파일에 `"model": {"state", "error", "counts", "bbox", "missing", "warnings"(앞 10개)}` 를 단다. 모델 파일이 아니거나 기록이 없으면 `None` 이다. `entry_to_dict` 가 `ModelSummary` 를 한 번에 읽는다.
- CLI `enqueue-convert [--force]`
  - 기본: 기록 없음·`failed`·`skipped/trashed`(휴지통에서 나온 것)를 넣는다.
  - `--force`: 휴지통 밖 모델 파일 전부를 넣는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_convert_wiring.py`:

```python
import os

from app import jobs, models
from app.entries import service
from app.entries.locate import file_path

MESH = "GRID,1,,0.,0.,0.\nGRID,2,,1000.,0.,0.\nCROD,1,1,1,2\n"


def test_heavy_jobs_claimed_last(db):
    jobs.enqueue(db, "convert_model", 1)
    jobs.enqueue(db, "extract_file", 2)
    jobs.enqueue(db, "write_meta", 3)
    db.commit()
    assert jobs.claim_next(db).type == "write_meta"
    assert set(jobs.HEAVY_JOB_TYPES) == {"extract_file", "convert_model"}


def test_process_batch_enqueues_convert(db, storage):
    from app.ingest.process import process_batch

    b = models.Batch(key="20261002-111111-aaaa", source="inbox", original_name="9999_모델", uploader="A100001")
    db.add(b)
    db.commit()
    root = storage.staging / b.key / "9999_모델"
    root.mkdir(parents=True)
    (root / "m.bdf").write_text(MESH)
    process_batch(db, storage, b)
    assert [j.type for j in db.query(models.Job)] == ["convert_model"]


def test_worker_runs_convert(db, storage):
    from app.ingest.inbox import InboxWatcher
    from app.worker import run_once

    b = models.Batch(key="20261002-222222-bbbb", source="inbox", original_name="9999_모델", uploader="A100001")
    db.add(b)
    db.flush()
    jobs.enqueue(db, "process_batch", b.id)
    db.commit()
    root = storage.staging / b.key / "9999_모델"
    root.mkdir(parents=True)
    (root / "m.bdf").write_text(MESH)
    stats = run_once(db, storage, InboxWatcher(storage))
    assert stats["failed"] == 0
    f = db.query(models.File).one()
    assert db.get(models.ModelSummary, f.id).state == "done"


def test_convert_final_failure_marks_failed(db, storage, make_entry_file):
    from app.ingest.inbox import InboxWatcher
    from app.worker import run_once

    _e, f = make_entry_file(name="gone.bdf", kind="model")
    jobs.enqueue(db, "convert_model", f.id)
    db.commit()
    job = db.query(models.Job).one()
    job.attempts = 2  # 이번이 마지막 시도
    db.commit()
    run_once(db, storage, InboxWatcher(storage))
    assert db.get(models.ModelSummary, f.id).state == "failed"


def test_entry_dict_has_model(db, make_entry_file):
    e, f = make_entry_file(name="m.bdf", kind="model")
    make_entry_file(entry=e, name="r.pdf")
    db.add(models.ModelSummary(file_id=f.id, state="done", counts={"CROD": 1}, bbox={"min": [0, 0, 0], "max": [1, 0, 0]},
                               missing=[], warnings=["a"] * 20))
    db.commit()
    d = service.entry_to_dict(db, e)
    by = {x["name"]: x for x in d["files"]}
    assert by["m.bdf"]["model"]["state"] == "done" and len(by["m.bdf"]["model"]["warnings"]) == 10
    assert by["r.pdf"]["model"] is None


def test_confirm_into_existing_requeues_models(db, storage, make_user, setup_entry_with_files, make_entry_file):
    u = make_user("A100001")
    target, tf = make_entry_file(name="main.bdf", kind="model")
    db.add(models.ModelSummary(file_id=tf.id, state="done", missing=["mesh.bdf"], includes=[]))
    db.commit()
    batch, draft = setup_entry_with_files(rels=("mesh.bdf",))
    draft.merge_into_id = target.id
    db.commit()
    db.query(models.Job).delete()
    db.commit()
    service.confirm(db, storage, draft, u)
    assert db.query(models.Job).filter_by(type="convert_model", target_id=tf.id).count() == 1


def test_cli_enqueue_convert(db, make_entry_file):
    from app.cli import enqueue_convert_all

    _e, a = make_entry_file(name="a.bdf", kind="model")
    _e2, b = make_entry_file(name="b.bdf", kind="model")
    make_entry_file(name="r.pdf")
    db.add(models.ModelSummary(file_id=b.id, state="done"))
    db.commit()
    assert enqueue_convert_all(db) == 1
    assert enqueue_convert_all(db, force=True) == 2
```

`setup_entry_with_files` 는 conftest 의 기존 픽스처다. 초안 Entry 와 staging 파일을 만들고 파일 kind 를 `model` 로 둔다. 이 테스트는 그 초안을 기존 확정 Entry(`target`)에 추가하는 확정이다.
- `confirm` 의 merge 분기는 대상 Entry 의 `vault_rel` 아래 `files` 로 파일을 옮긴다.
- `make_entry_file` 로 만든 확정 Entry 에는 `vault_rel` 이 있다. 그래서 경로가 성립한다.
- 대상 폴더가 없으면 `move_all` 이 `os.makedirs` 로 만든다.

- [ ] **Step 2: 실패 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_convert_wiring.py -v`
Expected: FAIL

- [ ] **Step 3: 구현**

`backend/app/jobs.py` 를 고친다.
- `HEAVY_JOB_TYPES = ("extract_file", "convert_model")` 를 정의한다.
- 03 에서 만든 `claim_next` 의 "extract_file 을 뒤로" 정렬식을 `models.Job.type.in_(HEAVY_JOB_TYPES)` 기준으로 바꾼다. 예: `order_by(case((models.Job.type.in_(HEAVY_JOB_TYPES), 1), else_=0), models.Job.id)`. 이미 비슷한 `case` 식이 있으면 그 조건만 바꾼다.

`backend/app/worker.py` 를 고친다.
- import `from .convert.job import run_convert` 를 더한다.
- 디스패치에 아래 분기를 더한다.

```python
            elif job.type == "convert_model":
                f = db.get(models.File, job.target_id)
                if f is None:
                    raise RuntimeError(f"파일을 찾을 수 없음: {job.target_id}")
                run_convert(db, storage, f)
```

- 실패 처리부에서 `extract_file` 의 최종 실패를 기록하는 곳 옆에 같은 일을 하는 분기를 둔다. `convert_model` 이 최종 실패하면 `ModelSummary` 행을 `state="failed"`, `error=str(exc)[:500]` 로 두고(없으면 만든다) 커밋한다.
- 03 에서 만든 추출 시간 예산 검사를 `job.type in HEAVY_JOB_TYPES` 기준으로 바꾼다(`claim_next(..., exclude_types=HEAVY_JOB_TYPES)`).

`backend/app/ingest/process.py`: import `from ..convert.job import enqueue_convert`. `enqueue_extract(db, f)` 를 부르는 반복문 안에 `enqueue_convert(db, f)` 를 더한다.

`backend/app/entries/service.py` 를 고친다.
- `file_to_dict` 에 `model_rows: dict[int, models.ModelSummary] | None = None` 인자를 더하고 다음 키를 단다:

```python
    s = (model_rows or {}).get(f.id)
    ...
            "model": ({"state": s.state, "error": s.error, "counts": s.counts, "bbox": s.bbox,
                       "missing": s.missing or [], "warnings": (s.warnings or [])[:10]} if s else None),
```

- `entry_to_dict` 에서 `extracts` 를 만드는 줄 옆에 아래를 둔다. 그리고 `file_to_dict(f, dup_entries, extracts, model_rows)` 로 넘긴다.

```python
    model_rows = {s.file_id: s for s in db.query(models.ModelSummary)
                  .filter(models.ModelSummary.file_id.in_([f.id for f in files]))} if files else {}
```

- `confirm()` 의 merge 분기에서 `_finish_batch(db, storage, batch)` 다음, `db.commit()` 앞에 아래를 넣는다. `requeue_entry_models` 는 함수 안에서 import 한다(순환 import 방지).

```python
        from ..convert.job import requeue_entry_models
        requeue_entry_models(db, target.id)
```

- `restore()` 에서 03 이 추출을 다시 넣는 곳 바로 아래에 모델 파일 재변환을 더한다. 대상은 기록이 없거나 `skipped`/`trashed` 인 모델 파일이고, 각각 `enqueue_convert` 를 부른다.

`backend/app/cli.py`: 03 의 `enqueue_extract_all` 과 같은 모양으로 함수를 더한다.

```python
def enqueue_convert_all(db: Session, *, force: bool = False) -> int:
    """변환 기록이 없거나 실패·휴지통에서 나온 모델을 변환 작업에 넣는다(force 면 휴지통 밖 전부)."""
    from .convert.job import enqueue_convert

    files = db.query(models.File).filter(models.File.kind == "model", models.File.location != "trash").all()
    rows = {r.file_id: r for r in db.query(models.ModelSummary)
            .filter(models.ModelSummary.file_id.in_([f.id for f in files] or [0]))}
    n = 0
    for f in files:
        r = rows.get(f.id)
        if force or r is None or r.state == "failed" or (r.state == "skipped" and r.error == "trashed"):
            n += enqueue_convert(db, f)
    db.commit()
    return n
```

`main()` 에 서브명령 `enqueue-convert`(`--force`)를 더한다. 출력은 `변환 작업 N건을 넣었습니다.` 이다.

- [ ] **Step 4: 통과 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_convert_wiring.py tests/test_worker.py tests/test_jobs.py tests/test_process.py tests/test_confirm.py -v`
Expected: PASS. 기존 테스트에서 작업 개수를 세는 단언이 `.bdf` 파일 때문에 달라지면, 새 동작에 맞게 고친다. 단언은 지우지 않는다.

Run: `.venv\Scripts\python.exe -m pytest -q`
Expected: 전체 PASS

- [ ] **Step 5: 커밋(사람)** — `feat: 04a 변환 작업 연결(워커·배치·파일 추가·CLI)`

---

### Task 7: 모델 API — 요약·lbm·썸네일

**Files:**
- Modify: `backend/app/routers/files.py`
- Test: `backend/tests/test_model_api.py`

규칙:
- `GET /api/files/{id}/model`: 기록이 없으면 `{"state": null}` 이다. 있으면 아래를 준다.
  - `{state, error, counts, bbox, sol, fingerprint, warnings, includes, missing, has_lbm}`
  - `has_lbm` = done 이고 파일이 존재하는가.
- `GET /api/files/{id}/model.lbm` → gzip 바이트 그대로 보낸다.
  - 헤더: `Content-Encoding: gzip`, `Content-Type: application/octet-stream`, `ETag: "<key>"`, `Cache-Control: private, max-age=86400`
  - done 이 아니면 404 `model_not_ready` 이고, 파생 파일이 없으면 404 `model_missing` 이다.
- `GET /api/files/{id}/thumb.png` → `image/png`. 조건은 lbm 과 같다.
- 세 경로 모두 Bearer 인증이 필요하다. 프런트는 `fetch` 로 받아 blob URL 을 만든다.
- 휴지통 파일은 기존 `_file()` 이 404 로 막는다.
- 파생 파일은 작아서(수 MB~수십 MB) `read()` 바이트로 응답한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_model_api.py`:

```python
import gzip
import os

from app import models
from app.convert.job import model_paths, run_convert
from app.entries.locate import file_path

MESH = "GRID,1,,0.,0.,0.\nGRID,2,,1000.,0.,0.\nGRID,3,,1000.,1000.,0.\nCQUAD4,1,5,1,2,3,3\nPSHELL,5,1,8.\n"


def _converted(db, storage, make_entry_file):
    _e, f = make_entry_file(name="m.bdf", kind="model")
    p = file_path(db, storage, f)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as fh:
        fh.write(MESH)
    run_convert(db, storage, f)
    return f


def test_model_summary(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    f = _converted(db, storage, make_entry_file)
    d = client.get(f"/api/files/{f.id}/model", headers=h).json()
    assert d["state"] == "done" and d["has_lbm"] is True and d["counts"]["CQUAD4"] == 1
    assert "PSHELL t8" in d["fingerprint"]
    _e, other = make_entry_file(name="x.bdf", kind="model")
    assert client.get(f"/api/files/{other.id}/model", headers=h).json() == {"state": None}


def test_lbm_and_thumb(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    f = _converted(db, storage, make_entry_file)
    res = client.get(f"/api/files/{f.id}/model.lbm", headers=h)
    assert res.status_code == 200 and res.headers["content-encoding"] == "gzip"
    assert res.content[:4] == b"LBM1"  # httpx 가 gzip 을 풀어 준다(브라우저도 같다)
    s = db.get(models.ModelSummary, f.id)
    assert res.headers["etag"] == f'"{s.key}"'
    png = client.get(f"/api/files/{f.id}/thumb.png", headers=h)
    assert png.headers["content-type"] == "image/png" and png.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert client.get(f"/api/files/{f.id}/model.lbm").status_code == 401


def test_not_ready_and_missing(client, db, storage, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    _e, f = make_entry_file(name="q.bdf", kind="model")
    db.add(models.ModelSummary(file_id=f.id, state="queued"))
    db.commit()
    assert client.get(f"/api/files/{f.id}/model.lbm", headers=h).json()["detail"] == "model_not_ready"
    g = _converted(db, storage, make_entry_file)
    lbm, _png = model_paths(storage, db.get(models.ModelSummary, g.id).key)
    os.remove(lbm)
    assert client.get(f"/api/files/{g.id}/model.lbm", headers=h).json()["detail"] == "model_missing"
    assert client.get(f"/api/files/{g.id}/model", headers=h).json()["has_lbm"] is False
```

- [ ] **Step 2: 실패 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_model_api.py -v`
Expected: FAIL — 404(라우트 없음)

- [ ] **Step 3: 구현**

`backend/app/routers/files.py` 에 더한다. import 는 `from fastapi.responses import Response`, `from ..convert.job import model_paths`, `from ..storage.paths import to_long` 다.

```python
def _ready_model(db: Session, f: models.File) -> models.ModelSummary:
    s = db.get(models.ModelSummary, f.id)
    if s is None or s.state != "done" or not s.key:
        raise HTTPException(status_code=404, detail="model_not_ready")
    return s


def _derived(path) -> bytes:
    try:
        with open(to_long(path), "rb") as fh:
            return fh.read()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="model_missing")
    except OSError:
        raise HTTPException(status_code=503, detail="storage_unreachable")


@router.get("/{file_id}/model")
def model_summary(file_id: int, db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
                  user: models.User = Depends(require_auth)):
    f = _file(db, file_id)
    s = db.get(models.ModelSummary, f.id)
    if s is None:
        return {"state": None}
    has_lbm = bool(s.state == "done" and s.key and os.path.exists(to_long(model_paths(storage, s.key)[0])))
    return {"state": s.state, "error": s.error, "counts": s.counts, "bbox": s.bbox, "sol": s.sol,
            "fingerprint": s.fingerprint, "warnings": s.warnings or [], "includes": s.includes or [],
            "missing": s.missing or [], "has_lbm": has_lbm}


@router.get("/{file_id}/model.lbm")
def model_lbm(file_id: int, db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
              user: models.User = Depends(require_auth)):
    s = _ready_model(db, _file(db, file_id))
    data = _derived(model_paths(storage, s.key)[0])
    return Response(content=data, media_type="application/octet-stream",
                    headers={"Content-Encoding": "gzip", "ETag": f'"{s.key}"',
                             "Cache-Control": "private, max-age=86400"})


@router.get("/{file_id}/thumb.png")
def model_thumb(file_id: int, db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
                user: models.User = Depends(require_auth)):
    s = _ready_model(db, _file(db, file_id))
    data = _derived(model_paths(storage, s.key)[1])
    return Response(content=data, media_type="image/png",
                    headers={"ETag": f'"{s.key}"', "Cache-Control": "private, max-age=86400"})
```

`files.py` 상단에 `import os` 가 이미 있는지 확인한다.

- [ ] **Step 4: 통과 확인**

Run: `.venv\Scripts\python.exe -m pytest tests/test_model_api.py -v` → PASS
Run: `.venv\Scripts\python.exe -m pytest -q` → 전체 PASS

- [ ] **Step 5: 커밋(사람)** — `feat: 04a 모델 요약·lbm·썸네일 API`

---

### Task 8: 지문 검색 확인

**Files:**
- Test: `backend/tests/test_model_search.py`

03 검색은 `file_texts` 본문을 찾는다. 지문을 locator `model` 로 넣었으므로 별도 구현 없이 찾혀야 한다. 이 태스크는 그것을 확인하는 테스트만 더한다. 발췌문의 위치 라벨은 화면(04b)이 `model` → "모델 지문" 으로 보인다.

- [ ] **Step 1: 테스트 작성**

```python
import os

from app.convert.job import run_convert
from app.entries.locate import file_path
from app.search import SearchQuery, get_search

MESH = ("GRID,1,,0.,0.,0.\nGRID,2,,1000.,0.,0.\nCBEAM,1,1,1,2,0.,0.,1.\n"
        "PBEAML,1,1,,L\n,100.,100.,10.,10.\n")


def test_fingerprint_is_searchable(db, storage, make_entry_file):
    e, f = make_entry_file(title="모델 검토", name="m.bdf", kind="model")
    p = file_path(db, storage, f)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as fh:
        fh.write(MESH)
    run_convert(db, storage, f)
    res = get_search().search(db, SearchQuery(q="100x100x10x10"))
    assert [i["entry_id"] for i in res["items"]] == [e.entry_id]
    snip = res["items"][0]["snippets"][0]
    assert snip["locator"] == "model" and "PBEAML L 100x100x10x10" in snip["text"]
```

- [ ] **Step 2: 실행**

Run: `.venv\Scripts\python.exe -m pytest tests/test_model_search.py -v`
Expected: PASS. 실패하면 03 검색이 locator 를 거르는지 확인하고, 거른다면 `model` 을 허용하게 고친다.

- [ ] **Step 3: 커밋(사람)** — `test: 04a 모델 지문 검색`

---

### Task 9: 실제 표본 성능 확인(선택 시험)

**Files:**
- Test: `backend/tests/test_bdf_sample_optional.py`

환경변수 `LOGBOOK_SAMPLE_BDF` 가 BDF 파일 경로를 가리킬 때만 돈다. 가리키지 않으면 skip 한다. 표본 파일은 저장소에 넣지 않는다.

- [ ] **Step 1: 테스트 작성**

```python
import os
import time
from pathlib import Path

import pytest

from app.bdf.deck import DeckReader
from app.bdf.fingerprint import fingerprint
from app.bdf.lbm import write_lbm
from app.bdf.model import build_model
from app.bdf.thumbnail import render_thumbnail

SAMPLE = os.environ.get("LOGBOOK_SAMPLE_BDF")


@pytest.mark.skipif(not SAMPLE, reason="LOGBOOK_SAMPLE_BDF 미지정 — 실제 표본 성능 시험은 선택")
def test_sample_bdf_performance():
    path = Path(SAMPLE)
    root = path.parent

    def opener(rel):
        return (root / rel).read_bytes()

    t0 = time.perf_counter()
    r = DeckReader(opener)
    cards = r.read(path.name)
    m = build_model(cards, sol=r.sol, warnings=r.warnings, includes=r.includes, missing=r.missing)
    t1 = time.perf_counter()
    lbm = write_lbm(m)
    t2 = time.perf_counter()
    png = render_thumbnail(m)
    t3 = time.perf_counter()
    fp = fingerprint(m)
    print(f"\n요소 {m.element_total():,} 절점 {len(m.nodes):,} | 파싱 {t1 - t0:.1f}s lbm {t2 - t1:.1f}s "
          f"({len(lbm) / 1e6:.1f}MB) 썸네일 {t3 - t2:.1f}s | 경고 {m.warnings[:5]} 미지원 {m.unsupported}")
    print(f"지문: {fp[:300]}")
    assert m.element_total() > 0 and len(png) > 1000
```

- [ ] **Step 2: 실행(컨트롤러가 수행)**

WorkBench 표본 BDF 소·중·대 3개로 각각 돌린다. 경로는 PowerShell 에서 `Get-ChildItem C:\Coding\WorkBench\HiTessWorkBenchBackEnd\SampleFile -Recurse -Filter *.bdf | Sort Length` 로 고른다.
`$env:LOGBOOK_SAMPLE_BDF='<경로>'; .venv\Scripts\python.exe -m pytest tests/test_bdf_sample_optional.py -s`

시간·크기·경고·미지원 카드를 기록하고, 큰 모델이 너무 느리면 원인을 보고한다.

- [ ] **Step 3: 커밋(사람)** — `test: 04a 실제 표본 성능 선택 시험`

---

### Task 10: 실제 공유 폴더 통합 시험 (컨트롤러가 직접 수행)

- [ ] API·워커를 띄운다.
- [ ] 합성 BDF 묶음(호선 9999)을 크롬 업로드 API 로 올린다. 구성은 다음과 같다.
  - `9999_모델/main.bdf`: `INCLUDE 'mesh.bdf'` 와 `'mat.bdf'`, CORD2R 좌표계, 대형 필드 GRID 포함
  - `mesh.bdf`, `mat.bdf`
- [ ] 워커 처리 결과를 확인한다.
  - main 은 `done`, mesh 와 mat 은 `include` 다.
  - 공유 폴더 `20_Derived\_model\..\<key>.lbm|.png` 가 생겼다.
  - `/model.lbm` 이 `LBM1` 로 시작한다.
  - `/thumb.png` 를 눈으로 확인한다.
- [ ] `mesh.bdf` 를 빼고 올린 묶음에서 다음을 확인한다.
  - 경고 `include_missing` 이 남는다.
  - 나중에 Entry 상세의 "파일 추가"로 `mesh.bdf` 를 확정해 넣으면 자동 재변환되고 경고가 사라진다.
- [ ] 시험 Entry 를 휴지통으로 보내고 서버를 멈춘다.
- [ ] `docs/plans/README.md` 의 04 줄을 04a·04b 로 나눈다.

---

## 자체 점검 (계획 작성 시)

- §7.1
  - 자체 파서 → Task 1·2
  - 대형 필드·연속 행·INCLUDE → Task 1
  - CORD2R/CORD1R 전역 좌표 → Task 2
  - 참조 확인(없는 절점) → Task 2
  - 미지원 카드 경고 → Task 2
  - is_include → Task 5
- §7.2 lbm 블록(머리말·노드·1D·2D·강체·질량·구속·속성표) → Task 3
- §7.5 썸네일 → Task 4
- §7.6 지문 → Task 4·8
- §7.7 실패해도 등록·다운로드, INCLUDE 없음 안내, 파일 추가 시 자동 재변환 → Task 5·6
- §4 `model_summaries` → Task 5
- 3D 뷰어 화면(§7.3·§7.4)과 PID 피킹은 04b 에서 다룬다.
