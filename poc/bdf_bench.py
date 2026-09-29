"""실험 5: 팀 BDF 를 읽는 시간·카드 통계를 잰다.

⚠ 2026-09-28 코드 리뷰: 처음엔 pyNastran 을 썼으나 **폐기했다(사용자 결정)** — 대신
WorkBench 가 실제로 쓰는 기법을 최대한 그대로 재사용한다(재사용 조사:
`C:\\Coding\\Logbook\\docs\\reuse-inventory.md` §1·§9).

- `split_fields`·`is_new_card`·`read_records` 의 **연속행 병합 로직**은
  `HiTessWorkBenchBackEnd\\InHouseProgram\\NastranBridge\\nastran_bridge.py`
  (46행 split_fields, 245행 is_new_card, 249행 read_records)를 그대로 가져왔다(주석에
  출처 표기). 원본은 `read_records(path)` 가 파일을 직접 읽지만, 여기서는 `bench()` 가
  이미 읽어 둔 텍스트를 재사용하도록 `text` 인자를 받게만 바꿨다 — 인코딩/치환 판정을
  한 번만 하기 위함이고, 로직 자체(연속행 판별·병합)는 손대지 않았다.
- **대형 필드(`GRID*` 등, 16칸)는 nastran_bridge.py 에 없다.** `C:\\Coding\\Csharp\\
  Projects\\FemScanner\\FemScanner\\Parsers\\CardReader.cs` 의 `ReadLargeField()` 를
  파이썬으로 이식했다(`split_fields_large`). ⚠ 원본 C# 의 대형 필드 판별은 "줄이 `*` 로
  시작하는가"만 보는데, 이건 **연속행만** 잡고 **카드의 첫 줄**("GRID*   ...")은 못 잡는다
  (카드명 필드 안의 `*` 이지 줄 맨 앞의 `*` 가 아니라서). 그 상태로 nastran_bridge 의
  8칸 고정폭을 그대로 썼더니 `GRID*` 카드의 필드가 반 토막으로 밀려 **ID·좌표가 엉뚱한
  값으로 읽혔다**(재검토에서 발견한 실제 버그) — 그래서 여기 `is_large_field_line()` 은
  "카드명 필드(첫 8칸)가 `*` 로 끝나는 첫 줄"도 같이 인식하도록 넓혔다.
- **카드 파싱은 전부 `read_records()` 가 만든 레코드 목록 위에서 한다** — 줄 단위로
  또 순회하는 즉흥 루프를 두지 않는다(`parse_bdf`). 단, `read_records()` 에 넘기는 텍스트
  범위는 `BEGIN BULK`~`ENDDATA` 로 미리 잘라 둔다(`_bulk_section_text`) — 안 자르면
  케이스 제어부의 `SUBCASE`·`LABEL=`·`SPC =` 같은 줄까지 "카드처럼 생긴 레코드"로 잡혀
  `all_cards`/`unknown_cards` 통계가 오염된다(실제 `nastran_bridge.py` 는 자기가 다루는
  카드 이름만 골라 쓰므로 이 문제가 드러나지 않았을 뿐, 통계용인 이 실험에서는 반드시
  걸러야 한다).

사용법: python bdf_bench.py <BDF 파일 또는 폴더> [-o 결과.json]
폴더를 주면 .bdf .dat .nas 를 모두 측정한다(.blk 는 INCLUDE 조각으로 보고 제외).

한계(README 에도 기록):
- INCLUDE 카드의 **경로만 기록**하고 내용은 따라 읽지 않는다(참조된 파일의 카드는
  통계에 없다).
- CORD1x/CORD2x 는 **존재만 감지**한다 — 좌표계 변환(GRID 의 CP/CD 실제 계산)은 하지
  않는다. `grid_cp_nonzero`/`grid_cd_nonzero` 도 "0이 아닌 값이 적혀 있다"는 신호일 뿐,
  그 변환이 맞는지는 보증하지 않는다.
- xref 는 "참조 ID 가 존재하는가"만 본다(재질·좌표계·중복 정의 등은 보지 않는다).
"""
import os
import sys
import time
from pathlib import Path

import psutil

from pocio import dump, parse_args

MODEL_EXTS = {".bdf", ".dat", ".nas"}

# ── 카드 분류 ────────────────────────────────────────────────────────────────
# 2026-09-28 재검토 반영: CONROD/CELAS2 는 필드2 가 PID 가 아니므로 PID 참조 검사에서
# 제외한다(PID_ELEMENT_TYPES). CHEXA/CPENTA/CTETRA 는 일부러 목록에 넣지 않는다 —
# unknown_cards 가마 실제로 "모르는 카드"를 잡아내는지 보여주는 픽스처로 쓴다.
ELEMENT_TYPES = {
    "CQUAD4", "CQUAD8", "CTRIA3", "CTRIA6",
    "CBAR", "CBEAM", "CROD", "CONROD",
    "CBUSH", "CBUSH1D", "CSHEAR", "CELAS1", "CELAS2",
}
PID_ELEMENT_TYPES = ELEMENT_TYPES - {"CONROD", "CELAS2"}
RIGID_TYPES = {"RBE2", "RBE3"}
MASS_TYPES = {"CONM1", "CONM2"}
PROPERTY_TYPES = {
    "PSHELL", "PBAR", "PBARL", "PBEAM", "PBEAML", "PROD",
    "PBUSH", "PBUSH1D", "PSHEAR", "PELAS", "PCOMP", "PCOMPG", "PSOLID", "PBEND",
}
COORD_TYPES = {"CORD1R", "CORD1C", "CORD1S", "CORD2R", "CORD2C", "CORD2S"}
KNOWN_CARDS = (
    {"GRID", "INCLUDE"}
    | ELEMENT_TYPES
    | RIGID_TYPES
    | MASS_TYPES
    | PROPERTY_TYPES
    | COORD_TYPES
    | {"MAT1", "MAT2", "MAT8", "SPC", "SPC1", "MPC", "PARAM"}
)

# 요소 카드 → (시작 인덱스, 끝 인덱스) — fields[lo:hi] 가 노드(GRID) 참조 필드다.
# CONROD 만 PID 가 없어 G1/G2 가 필드1~2 에 온다(다른 카드는 필드3 부터).
# 가변 길이(CHEXA 등)·구성이 복잡한 카드(CELAS1/2, CBUSH1D)는 넣지 않는다 — PoC 수준
# 통계라 전량 커버가 목적이 아니다.
ELEMENT_NODE_FIELDS = {
    "CQUAD4": (3, 7),
    "CQUAD8": (3, 11),
    "CTRIA3": (3, 6),
    "CTRIA6": (3, 9),
    "CBAR": (3, 5),
    "CBEAM": (3, 5),
    "CROD": (3, 5),
    "CONROD": (1, 3),
    "CBUSH": (3, 5),
    "CSHEAR": (3, 7),
}

GRID_CP_INDEX = 2
GRID_CD_INDEX = 6


# ---------------------------------------------------------------------------
# 출처: nastran_bridge.py:46 split_fields — 원문 그대로.
# ---------------------------------------------------------------------------
def split_fields(line: str) -> list[str]:
    line = line.rstrip("\r\n")
    if "$" in line:
        line = line.split("$", 1)[0].rstrip()
    if not line:
        return []
    if "," in line:
        return [field.strip() for field in line.split(",")]
    fields = [line[i : i + 8].strip() for i in range(0, len(line), 8)]
    return fields


# ---------------------------------------------------------------------------
# 출처: nastran_bridge.py:245 is_new_card — 원문 그대로.
# ---------------------------------------------------------------------------
def is_new_card(fields: list[str]) -> bool:
    return bool(fields and fields[0] and fields[0][0].isalpha())


# ---------------------------------------------------------------------------
# 대형 필드(16칸) — nastran_bridge.py 에는 없다. 이식 출처: CardReader.cs
# ReadLargeField()(C:\Coding\Csharp\Projects\FemScanner\FemScanner\Parsers\CardReader.cs).
# ---------------------------------------------------------------------------
def is_large_field_line(line_no_comment: str) -> bool:
    """카드명 필드(첫 8칸)가 '*' 로 끝나면(대형 필드 카드의 첫 줄) 또는 줄 자체가 '*' 로
    시작하면(연속행) 대형 필드다.

    ⚠ CardReader.cs 의 원본 판별(`line.TrimStart().StartsWith('*')`)은 연속행만 잡고
    카드 첫 줄("GRID*   ...")은 못 잡는다 — 첫 줄은 '*' 가 8칸 카드명 필드 *안에* 있지
    줄 맨 앞에 있지 않기 때문이다. 그 상태로 8칸 고정폭을 쓰면 16칸 필드가 반으로
    잘려 ID·좌표가 밀린다(2026-09-28 재검토에서 발견). 그래서 카드명 필드 검사를 추가했다.
    """
    if not line_no_comment:
        return False
    name_field = line_no_comment[:8].rstrip()
    if name_field.endswith("*"):
        return True
    return line_no_comment.lstrip().startswith("*")


def split_fields_large(line: str) -> list[str]:
    """이식 출처: CardReader.cs ReadLargeField() — 단, 원본(과 첫 이식판)의 두 결함을
    2026-09-28 재재검토에서 고쳤다:

    (a) 빈 16칸 필드를 통째로 건너뛰면(원래 `if token: tokens.append(token)`) 그 뒤
        필드가 전부 한 칸씩 밀린다. Patran/FEMAP 은 GRID* 의 CP 를 비워 두는 게
        흔한데, 그러면 X1 이 CP 자리로 밀려 grid_cp_nonzero 가 틀리게 센다 —
        빈 필드도 '' 로 그 자리에 남겨야 한다(위치 기반, 내용 기반 아님).
    (b) cols 73~80(0-based 72~80)은 데이터가 아니라 "연속행 매칭 식별자" 필드
        (field 10)다. 이전 판은 줄이 그 칸까지 있으면 5번째 데이터 필드인 것처럼
        읽어 버렸다(예: 끝에 '*' 하나만 있어도 토큰으로 들어가 뒤 필드를 밀었다).
        정확히 4개(cols 8~72)만 읽고 그 뒤는 절대 보지 않는다.
    """
    line = line.rstrip("\r\n")
    if "$" in line:
        line = line.split("$", 1)[0].rstrip()

    tokens: list[str] = [line[:8].strip()]
    for i in range(4):
        start = 8 + i * 16
        if start >= len(line):
            break  # 줄이 여기까지도 없다 — 더 볼 필드가 물리적으로 없다(끝만 잘림)
        end = min(start + 16, 72)  # 72 이후(연속행 매칭 필드)는 데이터로 읽지 않는다
        tokens.append(line[start:end].strip())
    return tokens


def _line_body(raw_line: str) -> str:
    """줄 끝 개행과 '$' 주석을 제거한 본문. 대형필드 판별·탭 검사 등에 공통으로 쓴다."""
    body = raw_line.rstrip("\r\n")
    if "$" in body:
        body = body.split("$", 1)[0].rstrip()
    return body


def split_fields_any(line: str) -> list[str]:
    """고정폭(8칸)/콤마 자유필드/대형필드(16칸) 중 맞는 방식으로 한 줄을 나눈다."""
    body = _line_body(line)
    if not body:
        return []
    if "," in body:
        return split_fields(line)
    if is_large_field_line(body):
        return split_fields_large(line)
    return split_fields(line)


# ---------------------------------------------------------------------------
# read_records — 출처: nastran_bridge.py:249 read_records. 연속행 병합 로직(공백/
# +/* 마커 판별)은 원문과 동일하다. 필드 분리만 split_fields_any 로 바꿔 대형 필드
# (GRID* 등)까지 하나의 레코드로 올바르게 합친다(원문 그대로면 대형 필드 첫 줄이
# 잘못 쪼개진다 — 위 is_large_field_line 코멘트 참고). path 대신 text 를 받도록 바꿔
# bench() 가 이미 읽어 둔 문자열을 재사용한다(파일을 두 번 읽지 않기 위함).
# ---------------------------------------------------------------------------
def read_records(text: str) -> dict:
    """반환: {"records": [[str,...], ...], "continuation_lines": int,
              "large_field_cards": int}."""
    records: list[list[str]] = []
    current: list[str] | None = None
    continuation_lines = 0
    large_field_cards = 0

    for raw_line in text.splitlines():
        body = _line_body(raw_line)
        line_is_large = bool(body) and is_large_field_line(body)

        fields = split_fields_any(raw_line)
        if not fields:
            continue
        if fields[0].startswith("$"):
            continue

        if is_new_card(fields):
            current = fields[:]
            records.append(current)
            if line_is_large:
                large_field_cards += 1
            continue

        if current is None:
            continue

        continuation_lines += 1
        # ⚠ 2026-09-28 재재검토(최종 리뷰): nastran_bridge.py 원문은 `fields[0] in
        # {"", "+", "*"}` 로 **익명 마커만** 벗겨낸다. 그런데 실제 BDF 는 여러 연속행이
        # 뒤섞일 때 `*G1`(대형 필드)·`+A1`(소형 필드)처럼 **이름 붙은 마커**를 쓴다 —
        # 이 마커는 연속행의 첫 필드(fields[0])에 그대로 남아 있는데, 정확히 "+"/"*"
        # 와 같지 않아 원문 조건을 못 통과한다. 그러면 마커 문자열 자체가 데이터
        # 필드처럼 current 에 밀려 들어가(예: GRID* 의 X3 자리에 "*G1" 이 끼고, 그
        # 뒤의 진짜 X3 값이 CD 자리로 밀린다) 좌표·CD 가 틀어지고 `grid_cd_nonzero`
        # 가 거짓으로 양성이 된다(2026-09-28 최종 리뷰에서 실측). nastran_bridge 는
        # 사내 BDF 표본에서 이름 붙은 마커를 안 써서 이 결함이 드러나지 않았을
        # 뿐이다 — 그래서 원문을 그대로 옮기지 않고, 마커 판정을 "첫 글자가 +/* 인
        # 모든 토큰"으로 넓혔다(빈 문자열도 기존대로 마커로 본다).
        is_marker = fields[0] == "" or fields[0][0] in "+*"
        continuation = fields[1:] if is_marker else fields
        current.extend(continuation)

    return {
        "records": records,
        "continuation_lines": continuation_lines,
        "large_field_cards": large_field_cards,
    }


def detect_punch(text: str) -> bool:
    """펀치(=실행제어부 없음) 여부. '$' 주석은 제외하고, 실제 카드 줄 중 하나라도
    'BEGIN BULK' 로 시작하면 펀치가 아니다(주석에 'BEGIN BULK' 라는 문구가 있어도
    무시한다)."""
    for raw in text.splitlines():
        stripped = raw.lstrip()
        if not stripped or stripped.startswith("$"):
            continue
        if stripped.upper().startswith("BEGIN BULK"):
            return False
    return True


def _bulk_section_text(text: str) -> str:
    """BEGIN BULK 다음 줄부터 ENDDATA 전까지만 남긴다.

    실행제어부·케이스제어부(`SOL 101`·`CEND`·`SUBCASE`·`LABEL=`·`SPC =` 등)의 줄은
    read_records() 입장에서 "영문자로 시작하는 줄"이라 카드처럼 보여 all_cards 통계를
    오염시킨다. BEGIN BULK 가 없으면(펀치 파일) 처음부터 전부 벌크로 본다. ENDDATA 가
    없으면 끝까지 본다.
    """
    lines = text.splitlines()
    start = 0
    end = len(lines)
    for i, raw in enumerate(lines):
        stripped = raw.lstrip()
        if not stripped or stripped.startswith("$"):
            continue
        if stripped.upper().startswith("BEGIN BULK"):
            start = i + 1
            break
    for i in range(start, len(lines)):
        stripped = lines[i].lstrip()
        if not stripped or stripped.startswith("$"):
            continue
        if stripped.upper().startswith("ENDDATA"):
            end = i
            break
    return "\n".join(lines[start:end])


def find_includes(text: str) -> list[str]:
    """INCLUDE 문 경로를 **전체 텍스트**에서 찾는다 — all_cards/unknown_cards(벌크
    구간만 보는 통계)와는 별도의 전용 스캔이다. 2026-09-28 재재검토: INCLUDE 는
    BEGIN BULK 이전(케이스 제어부)에도 올 수 있는데, parse_bdf 의 벌크 전용 루프에만
    있으면 그 경우를 놓친다. read_records(전체 텍스트) 를 다시 돌리는 비용은 크지
    않고(팀 BDF 도 몇 MB 수준), INCLUDE 만 골라내므로 SOL/CEND/SUBCASE 같은 케이스
    제어부의 다른 줄이 섞여 들어와도 무해하다(이름이 'INCLUDE' 가 아니면 그냥 버려진다)."""
    rr = read_records(text)
    paths: list[str] = []
    for fields in rr["records"]:
        if fields and fields[0].upper().rstrip("*") == "INCLUDE":
            rest = "".join(fields[1:]).strip().strip("'\"")
            if rest:
                paths.append(rest)
    return paths


def parse_bdf(text: str) -> dict:
    """벌크 구간 레코드를 훑어 카드 통계·참조 정보를 모은다. read_records() 의 결과
    위에서만 동작한다(줄 단위 즉흥 루프 없음). INCLUDE 만 예외로 전체 텍스트를 따로
    스캔한다(find_includes — 위 코멘트 참고)."""
    rr = read_records(_bulk_section_text(text))
    records = rr["records"]

    node_ids: set[str] = set()
    prop_ids: set[str] = set()
    all_cards: dict[str, int] = {}
    counts: dict[str, int] = {}
    elem_pid_refs: list[tuple[str, str, str]] = []
    elem_node_refs: list[tuple[str, str, list[str]]] = []
    grid_cards = 0
    grid_cp_nonzero = 0
    grid_cd_nonzero = 0

    for fields in records:
        name = fields[0].upper().rstrip("*")  # 대형 필드 카드명(GRID* 등) 정규화
        all_cards[name] = all_cards.get(name, 0) + 1

        if name == "GRID":
            grid_cards += 1
            if len(fields) > 1 and fields[1]:
                node_ids.add(fields[1])
            cp = fields[GRID_CP_INDEX] if len(fields) > GRID_CP_INDEX else ""
            cd = fields[GRID_CD_INDEX] if len(fields) > GRID_CD_INDEX else ""
            if cp and cp not in ("0", "0.", "+0", "-0"):
                grid_cp_nonzero += 1
            if cd and cd not in ("0", "0.", "+0", "-0"):
                grid_cd_nonzero += 1
            continue

        if name in PROPERTY_TYPES:
            if len(fields) > 1 and fields[1]:
                prop_ids.add(fields[1])
            continue

        if name == "INCLUDE":
            continue  # 전체 텍스트 스캔(find_includes)이 따로 처리한다 — 여기선 건너뛴다

        if name in ELEMENT_TYPES:
            counts[name] = counts.get(name, 0) + 1
            eid = fields[1] if len(fields) > 1 else ""
            if name in PID_ELEMENT_TYPES and len(fields) > 2 and fields[2]:
                elem_pid_refs.append((name, eid, fields[2]))
            node_range = ELEMENT_NODE_FIELDS.get(name)
            if node_range:
                lo, hi = node_range
                nodes = [f for f in fields[lo:hi] if f]
                if nodes:
                    elem_node_refs.append((name, eid, nodes))
            continue

        if name in RIGID_TYPES or name in MASS_TYPES:
            counts[name] = counts.get(name, 0) + 1
            continue

    coords = {k: v for k, v in all_cards.items() if k in COORD_TYPES}
    unknown_cards = {k: v for k, v in all_cards.items() if k not in KNOWN_CARDS}

    return {
        "nodes": len(node_ids),
        "grid_cards": grid_cards,
        "counts": counts,
        "coords": coords,
        "all_cards": all_cards,
        "unknown_cards": unknown_cards,
        "continuation_lines": rr["continuation_lines"],
        "large_field_cards": rr["large_field_cards"],
        "include": find_includes(text),
        "grid_cp_nonzero": grid_cp_nonzero,
        "grid_cd_nonzero": grid_cd_nonzero,
        "prop_ids": prop_ids,
        "node_ids": node_ids,
        "elem_pid_refs": elem_pid_refs,
        "elem_node_refs": elem_node_refs,
    }


def cross_reference(parsed: dict) -> dict:
    """경량 xref: (a) 요소가 참조하는 PID 가 정의돼 있는가, (b) 요소가 참조하는 GRID
    ID 가 정의돼 있는가. 필드2 가 PID 가 아닌 카드(CONROD/CELAS2)는 (a) 에서 아예
    제외한다(parse_bdf 의 elem_pid_refs 가 이미 걸러 뒀다)."""
    prop_ids = parsed["prop_ids"]
    node_ids = parsed["node_ids"]

    pid_errors = [
        f"{card} eid={eid}: pid={pid} not found"
        for card, eid, pid in parsed["elem_pid_refs"]
        if pid not in prop_ids
    ]

    missing_grid_refs = 0
    for _card, _eid, nodes in parsed["elem_node_refs"]:
        for n in nodes:
            if n not in node_ids:
                missing_grid_refs += 1

    return {
        "xref_ok": not pid_errors,
        "xref_errors": pid_errors[:10],
        "missing_grid_refs": missing_grid_refs,
    }


def bench(path: Path) -> dict:
    """파일 하나를 측정한다. ⚠ 2026-09-28 재검토: 함수 전체를 감싸 어떤 예외든(읽기
    실패·파싱 중 예외 등) 절대 전체 실행을 죽이지 않고 행 하나로만 남긴다."""
    try:
        proc = psutil.Process()
        rss0 = proc.memory_info().rss
        t0 = time.perf_counter()

        # 시스템 기본 인코딩과 무관하게 항상 UTF-8 로 읽는다. 잘못된 바이트(cp949 로
        # 저장된 한글 주석 등)는 예외 대신 치환 문자(U+FFFD)로 넘어간다 — 카드 값은
        # 항상 ASCII 라 주석이 깨져도 파싱 결과에는 영향이 없다.
        text = path.read_text(encoding="utf-8", errors="replace")
        size = path.stat().st_size
        had_replacement = "\ufffd" in text
        punch = detect_punch(text)
        bulk_text = _bulk_section_text(text)
        tab_lines = sum(1 for ln in bulk_text.splitlines() if "\t" in ln)

        parsed = parse_bdf(text)
        parse_sec = time.perf_counter() - t0

        t1 = time.perf_counter()
        xref = cross_reference(parsed)
        xref_sec = time.perf_counter() - t1

        rss1 = proc.memory_info().rss
        return {
            "file": path.name,
            "ok": True,
            "size_mb": round(size / 1e6, 3),
            "parse_sec": round(parse_sec, 4),
            "xref_sec": round(xref_sec, 4),
            "xref_ok": xref["xref_ok"],
            "xref_errors": xref["xref_errors"],
            "missing_grid_refs": xref["missing_grid_refs"],
            "nodes": parsed["nodes"],
            "grid_cards": parsed["grid_cards"],
            "counts": parsed["counts"],
            "coords": parsed["coords"],
            "all_cards": parsed["all_cards"],
            "unknown_cards": parsed["unknown_cards"],
            "continuation_lines": parsed["continuation_lines"],
            "large_field_cards": parsed["large_field_cards"],
            "include": parsed["include"],
            "grid_cp_nonzero": parsed["grid_cp_nonzero"],
            "grid_cd_nonzero": parsed["grid_cd_nonzero"],
            "tab_lines": tab_lines,
            "punch": punch,
            "had_replacement_chars": had_replacement,
            "rss_delta_mb": round((rss1 - rss0) / 1e6, 3),
        }
    except Exception as exc:  # 실험 도구: 파일 하나의 실패는 절대 전체 실행을 죽이지 않는다
        return {"file": path.name, "ok": False, "error": f"{type(exc).__name__}: {exc}"}


def run(target: str) -> list[dict]:
    """대상이 폴더면 os.walk(onerror=...) 로 순회한다 — Path.rglob() 은 하위 폴더
    나열 자체가 실패(권한 없음 등)하면 예외가 전체 실행을 끊지만, os.walk 는 onerror
    콜백으로 계속 진행할 수 있다. 그 콜백도 행으로 남긴다."""
    p = Path(target)
    if not p.is_dir():
        return [bench(p)]

    rows: list[dict] = []

    def on_walk_error(exc: OSError) -> None:
        rows.append({
            "file": getattr(exc, "filename", None) or str(p),
            "ok": False,
            "error": f"walk {type(exc).__name__}: {exc}",
        })

    files: list[Path] = []
    for dirpath, _dirnames, filenames in os.walk(str(p), onerror=on_walk_error):
        for name in filenames:
            fp = Path(dirpath) / name
            if fp.suffix.lower() in MODEL_EXTS:
                files.append(fp)

    rows.extend(bench(f) for f in sorted(files))
    return rows


def main(argv: list[str]) -> int:
    positionals, out = parse_args(argv)
    dump(run(positionals[0]), out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
