"""과제 엑셀 양식 내려받기(2026-11-24) — 팀 통합과제 엑셀이 없는 사람도 과제 엑셀로 초안 만들기(68)를 해 볼 수 있게.

파서(ingest/task_sheet.py)가 알아보는 머리 서명(이름, 담당자, 과제의뢰서 NO.)과 읽는 열만 둔다. 금액, M/H 같은 열은 두지 않는다.
머리 바로 아래에 칸마다 쓰는 법을 적은 회색 안내 줄을 고정으로 둔다. 파서는 머리 아래 줄이 자료 줄이 아니면 둘째 머리로
보고 건너뛰므로(task_sheet.parse_rows 의 sub) 안내 줄이 그 자리를 맡아, 사용자가 첫 과제를 바로 아래 줄에 써도 빠지지 않는다.
Category, 의뢰 부서, 대상, 과제 완료 여부는 고르는 목록(숨긴 '목록' 시트)을 달되 목록 밖 값도 쓸 수 있게 둔다.
"""
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

from ..entries import tasks

# (머리 이름, 안내 줄, 열 너비) — 머리 이름은 task_sheet.FIELDS 가 알아보는 이름 그대로
COLUMNS = (
    ("NO.", "번호", 6),
    ("이름", "필수: 과제 이름(초안 제목). 호선 번호를 넣으면 호선을 찾습니다", 40),
    ("담당자", "필수: 이름 직책. 여러 명은 쉼표로", 22),
    ("과제의뢰서 NO.", "의뢰서 번호. 없으면 X", 16),
    ("과제 완료 여부", "완료, 진행 중, 자체수행이면 처음부터 골라 둡니다", 14),
    ("대상", "LogBook 분류 목록의 대상", 14),
    ("Category", "목록에서 고르기", 22),
    ("의뢰 부서", "목록에서 고르거나 직접", 16),
    ("의뢰자", "이름 직책", 14),
    ("목적", "", 30),
    ("Key point", "", 30),
    ("평가 기준", "", 24),
    ("시작 날짜", "2026-01-15 처럼", 12),
    ("완료 날짜", "끝났거나 끝날 날짜", 12),
    ("유/무형 효과 설명", "", 30),
)
STATUSES = ("완료", "진행 중", "자체수행", "보류")
DATA_ROWS = 200          # 번호를 미리 채우고 고르는 목록을 다는 줄 수
TITLE_ROW, HEAD_ROW = 1, 4

GUIDE = (
    ("과제 엑셀로 초안 만들기", True),
    ("'과제 목록' 시트에 한 줄에 과제 하나씩 적고, LogBook 올리기와 확정 화면에 이 파일 하나만 올립니다.", False),
    ("미리보기에서 담당자와 호선을 확인한 뒤 [초안 n건 만들기]를 누르면 과제마다 파일 없는 초안이 생깁니다(일반 등급 LV2 이상).", False),
    ("담당자가 각 초안에 해석 파일을 넣고 확정합니다. 파일이 없는 초안은 확정되지 않습니다.", False),
    ("", False),
    ("지켜 주세요", True),
    ("'과제 목록' 시트의 머리 줄(4행)의 이름은 바꾸지 마세요. 이름, 담당자, 과제의뢰서 NO. 세 열은 꼭 있어야 합니다.", False),
    ("회색 안내 줄(5행)은 지우지 마세요. 과제는 6행부터 적습니다.", False),
    ("NO. 칸에 번호가 있고 이름이 적힌 줄만 과제로 읽습니다. 번호는 미리 채워 두었습니다.", False),
    ("같은 파일을 다시 올리면 이미 만든 과제(같은 과제의뢰서 NO.)는 건너뜁니다.", False),
    ("열 순서는 바꿔도 됩니다. 다른 열을 더해도 읽지 않고 넘어갑니다.", False),
    ("", False),
    ("팀 통합과제 엑셀이 이미 있으면", True),
    ("그 엑셀을 그대로 올려도 됩니다. 금액, 기여도, M/H, 직책과장 열은 읽지 않습니다.", False),
)

HEAD_FILL = PatternFill("solid", fgColor="E6EBF2")
HINT_FILL = PatternFill("solid", fgColor="F5F8FD")
HINT_FONT = Font(color="686D74", size=9)
WRAP_TOP = Alignment(wrap_text=True, vertical="top")


def build_template(year: int, targets: list[str]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "과제 목록"
    ws.cell(TITLE_ROW, 1, f"{year}년 통합과제").font = Font(bold=True, size=14)   # 파서가 연도를 여기서 읽는다
    ws.cell(TITLE_ROW + 1, 1, "한 줄에 과제 하나. 6행부터 적고, 머리 줄과 회색 안내 줄은 그대로 두세요. 자세한 것은 '작성 안내' 시트.").font = HINT_FONT
    for c, (head, hint, width) in enumerate(COLUMNS, start=1):
        h = ws.cell(HEAD_ROW, c, head)
        h.font, h.fill, h.alignment = Font(bold=True), HEAD_FILL, Alignment(vertical="center", wrap_text=True)
        t = ws.cell(HEAD_ROW + 1, c, hint)
        t.font, t.fill, t.alignment = HINT_FONT, HINT_FILL, WRAP_TOP
        ws.column_dimensions[get_column_letter(c)].width = width
    ws.row_dimensions[HEAD_ROW + 1].height = 42
    first, last = HEAD_ROW + 2, HEAD_ROW + 1 + DATA_ROWS
    for i, r in enumerate(range(first, last + 1), start=1):
        ws.cell(r, 1, i)
        for c in (13, 14):
            ws.cell(r, c).number_format = "yyyy-mm-dd"
    ws.freeze_panes = ws.cell(first, 3)

    # 고르는 목록 — 숨긴 시트의 열을 가리킨다(목록이 길면 수식 글자 수 한도를 넘는다)
    lists = wb.create_sheet("목록")
    choices = {"과제 완료 여부": STATUSES, "대상": tuple(targets), "Category": tasks.CATEGORIES, "의뢰 부서": tasks.DEPARTMENTS}
    for j, (head, values) in enumerate(choices.items(), start=1):
        lists.cell(1, j, head)
        for k, v in enumerate(values, start=2):
            lists.cell(k, j, v)
        if not values:
            continue
        col = get_column_letter([x[0] for x in COLUMNS].index(head) + 1)
        ref = get_column_letter(j)
        dv = DataValidation(type="list", formula1=f"'목록'!${ref}$2:${ref}${len(values) + 1}", allow_blank=True,
                            showErrorMessage=False)   # 목록 밖 값도 쓸 수 있게
        dv.add(f"{col}{first}:{col}{last}")
        ws.add_data_validation(dv)
    lists.sheet_state = "hidden"

    guide = wb.create_sheet("작성 안내", 1)
    guide.column_dimensions["A"].width = 110
    for i, (text, bold) in enumerate(GUIDE, start=1):
        cell = guide.cell(i, 1, text)
        cell.font = Font(bold=True, size=12) if bold else Font(size=11)
        cell.alignment = Alignment(wrap_text=True, vertical="top")
    row = len(GUIDE) + 2
    guide.cell(row, 1, "열마다 쓰는 법").font = Font(bold=True, size=12)
    for head, hint, _w in COLUMNS:   # 열 이름을 한 줄에 하나씩(세 서명 열이 한 행에 모여 과제 시트로 오인되지 않게)
        if hint:
            row += 1
            guide.cell(row, 1, f"{head}: {hint}")

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
