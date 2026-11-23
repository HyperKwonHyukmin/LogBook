"""68 3단계 — 과제 엑셀(구조솔루션팀 '통합과제' 양식) 알아보기와 행 읽기. DB 를 모르는 순수 파서(자식 프로세스에서 돈다).

- 새 틀을 만들지 않고 팀 양식을 그대로 받는다. 머리 행에서 `이름`, `담당자`, `과제의뢰서 NO.` 세 열이 모두 있으면 과제 엑셀(머리 서명).
- 머리는 여러 행에 병합되어 있다(예: '아이템 분류' 아래 '대상', 'Key point', '목적', 'NO.' 는 한 행 위). 열 이름은 이름으로 찾는다(순서 무관).
- 행은 NO. 가 숫자이고 이름이 있는 줄만. 자료 행이 시작된 뒤 NO. 와 이름이 모두 빈 줄을 만나면 끝(하단 집계표, 다른 시트는 읽지 않는다).
- 금액, 기여도, M/H, 직책과장은 읽지 않는다(엑셀이 원본, 원가가 사번 로그인 화면에 퍼지지 않게 — 계획 68 결정).
"""
import re
from datetime import date, datetime

# 정규화한 열 이름(공백, 줄바꿈 제거) → 칸
FIELDS = {
    "NO.": "no", "NO": "no", "이름": "name", "과제명": "name", "과제완료여부": "status", "과제의뢰서NO.": "request_no",
    "과제의뢰서NO": "request_no", "담당자": "assignee", "대상": "target", "Keypoint": "key_point", "목적": "purpose",
    "Category": "category", "평가기준": "criteria", "시작날짜": "started_on", "의뢰부서": "request_dept", "의뢰자": "requester",
    "유/무형효과설명": "effect_note",
}
PREFIX_FIELDS = {"완료날짜": "finished_on"}   # '완료 날짜\n예상 날짜'
# 일부러 읽지 않는 열(미리보기에 '넣지 않는 열'로 보인다)
SKIPPED = ("계획M/H", "실소요M/H", "직책과장", "년간유/무형효과", "기여도", "년간유형효과")
GROUP_HEADERS = {"아이템분류", "과제", "과제의뢰"}   # 아래 행에 실제 열 이름이 있는 병합 머리
REQUIRED = ("name", "assignee", "request_no")
REQUIRED_LABELS = {"name": "이름", "assignee": "담당자", "request_no": "과제의뢰서 NO."}
HEADER_SCAN_ROWS = 15
YEAR_RE = re.compile(r"(20\d{2})\s*년")


class NotTaskSheet(Exception):
    """머리 서명이 없다 — 일반 자료로 처리한다."""


class TaskSheetError(Exception):
    """과제 엑셀로 보이지만 필수 열이 빠졌다 등 — 사유를 미리보기에 보인다."""


def norm(v) -> str:
    return re.sub(r"\s+", "", str(v or ""))


def _field(label: str) -> str | None:
    if label in FIELDS:
        return FIELDS[label]
    for p, f in PREFIX_FIELDS.items():
        if label.startswith(p):
            return f
    return None


def _skipped(label: str) -> bool:
    return any(label.startswith(s) for s in SKIPPED)


def _cell(v):
    """칸 값 → 글자 또는 날짜(iso). 숫자는 정수면 정수 글자로."""
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def _is_no(v) -> bool:
    if isinstance(v, bool):
        return False
    if isinstance(v, (int, float)):
        return True
    return bool(re.fullmatch(r"\d{1,4}", str(v or "").strip()))


def parse_rows(rows: list[list]) -> dict:
    """시트의 앞쪽 행들(값 목록) → {header_row, columns, skipped, unread, rows, year}. 서명이 없으면 NotTaskSheet."""
    head = None
    for i, row in enumerate(rows[:HEADER_SCAN_ROWS]):
        labels = {norm(v) for v in row}
        if "이름" in labels and "담당자" in labels and any(l.startswith("과제의뢰서") for l in labels):
            head = i
            break
    if head is None:
        raise NotTaskSheet()
    width = max(len(r) for r in rows[max(0, head - 1):head + 2])

    def at(r, c):
        return norm(rows[r][c]) if 0 <= r < len(rows) and c < len(rows[r]) else ""

    def data_row(r) -> bool:   # NO. 칸 자리를 아직 모르니 '숫자 칸 + 글자 칸이 있는 줄'로 본다
        vals = rows[r] if 0 <= r < len(rows) else []
        return any(_is_no(v) for v in vals[:4]) and any(isinstance(v, str) and len(v.strip()) > 3 for v in vals)

    # 머리 아래 줄이 자료면 한 줄 머리 양식이다(Codex 검토 — 그 줄을 머리로 읽으면 첫 과제가 빠진다)
    sub = 0 <= head + 1 < len(rows) and not data_row(head + 1)
    columns: dict[str, int] = {}
    skipped, unread = [], []
    for c in range(width):
        label = at(head, c)
        if not label or label in GROUP_HEADERS:
            label = (at(head + 1, c) if sub else "") or (at(head - 1, c) if not label else "")
        if not label or label == "Total":
            continue
        f = _field(label)
        if f and f not in columns:
            columns[f] = c
        elif _skipped(label):
            skipped.append(label)
        elif not f:
            unread.append(label)
    missing = [REQUIRED_LABELS[f] for f in REQUIRED if f not in columns]
    if missing:
        raise TaskSheetError("필수 열이 없습니다: " + ", ".join(missing))
    start = head + 2 if sub else head + 1
    out, seen = [], False
    for r in range(start, len(rows)):
        row = rows[r]
        get = (lambda f: row[columns[f]] if f in columns and columns[f] < len(row) else None)  # noqa: E731
        no, name = get("no"), _cell(get("name"))
        if not _is_no(no) or not name:
            if seen and not _cell(no) and not name:
                break
            continue
        seen = True
        item = {"row": r + 1, "no": _cell(no)}
        for f in columns:
            if f != "no":
                item[f] = _cell(get(f))
        out.append(item)
    year = None
    for row in rows[:head]:
        for v in row:
            m = YEAR_RE.search(str(v or ""))
            if m:
                year = int(m.group(1))
                break
        if year:
            break
    if year is None:
        dates = [x.get("started_on") for x in out if re.fullmatch(r"\d{4}-\d{2}-\d{2}", x.get("started_on") or "")]
        year = int(max(dates)[:4]) if dates else date.today().year
    return {"header_row": head + 1, "columns": sorted(columns), "skipped": skipped, "unread": unread,
            "rows": out, "year": year}


def parse_path(path: str) -> dict:
    """xlsx 파일 → parse_rows 결과 + sheet. 시트마다 서명을 찾고 첫 번째 맞는 시트를 쓴다. 없으면 NotTaskSheet.
    (isolated.run 으로 자식 프로세스에서 부른다 — 모듈 최상위 함수)"""
    from openpyxl import load_workbook

    wb = load_workbook(path, read_only=True, data_only=True)
    try:
        last_error = None
        for ws in wb.worksheets:
            rows = [list(r) for r in ws.iter_rows(values_only=True, max_row=2000)]
            try:
                return {**parse_rows(rows), "sheet": ws.title}
            except NotTaskSheet:
                continue
            except TaskSheetError as exc:
                last_error = exc
        if last_error:
            raise last_error
        raise NotTaskSheet()
    finally:
        wb.close()


def probe(path: str) -> dict:
    """자식 프로세스용 — 예외 대신 결과 상자로 돌려준다(pickle 안전). {kind: 'task'|'not'|'error', data|message}."""
    try:
        return {"kind": "task", "data": parse_path(path)}
    except NotTaskSheet:
        return {"kind": "not"}
    except TaskSheetError as exc:
        return {"kind": "error", "message": str(exc)}
    except Exception as exc:  # noqa: BLE001 — 깨진 xlsx 등은 일반 자료로 처리
        return {"kind": "not", "message": f"{type(exc).__name__}: {exc}"}
