"""과제 엑셀 양식(2026-11-24) — 내려받은 양식을 그대로 채워 올리면 파서가 과제를 빠짐없이 읽는다."""
from io import BytesIO

from openpyxl import load_workbook

from app.entries import tasks
from app.ingest.task_sheet import parse_path, parse_rows
from app.ingest.task_template import COLUMNS, HEAD_ROW, build_template


def _rows(data: bytes, fill=None) -> tuple[list[list], object]:
    wb = load_workbook(BytesIO(data))
    ws = wb["과제 목록"]
    for r, values in (fill or {}).items():
        for c, v in values.items():
            ws.cell(r, [x[0] for x in COLUMNS].index(c) + 1, v)
    return [list(r) for r in ws.iter_rows(values_only=True)], wb


def test_template_is_recognized_and_first_row_not_lost():
    data = build_template(2026, ["Unit", "Truss"])
    rows, wb = _rows(data, {
        HEAD_ROW + 2: {"이름": "9999 Unit 권상 검토", "담당자": "홍길동 책임연구원", "과제의뢰서 NO.": "ST-2026-001",
                       "과제 완료 여부": "완료", "대상": "Unit", "Category": tasks.CATEGORIES[1]},
        HEAD_ROW + 3: {"이름": "선수부 계류 의장품 강도", "담당자": "김서연 선임, 이준호 연구원", "과제의뢰서 NO.": "X"},
    })
    assert wb.sheetnames == ["과제 목록", "작성 안내", "목록"] and wb["목록"].sheet_state == "hidden"
    out = parse_rows(rows)
    assert out["year"] == 2026 and out["header_row"] == HEAD_ROW
    assert [r["name"] for r in out["rows"]] == ["9999 Unit 권상 검토", "선수부 계류 의장품 강도"]   # 첫 과제가 빠지지 않는다
    assert out["rows"][0]["no"] == "1" and out["rows"][0]["request_no"] == "ST-2026-001"
    assert out["rows"][0]["target"] == "Unit" and out["rows"][0]["category"] == tasks.CATEGORIES[1]
    assert {"name", "assignee", "request_no", "status", "target", "category", "request_dept", "requester", "purpose",
            "key_point", "criteria", "started_on", "finished_on", "effect_note"} <= set(out["columns"])
    assert not out["unread"] and not out["skipped"]


def test_empty_template_has_no_rows_and_guide_is_not_a_task_sheet():
    rows, wb = _rows(build_template(2026, []))
    assert parse_rows(rows)["rows"] == []
    guide = [[c for c in r if c] for r in wb["작성 안내"].iter_rows(values_only=True)]
    heads = {"이름", "담당자", "과제의뢰서 NO."}
    assert not any(heads <= {str(v).split(":")[0] for v in r} for r in guide)


def test_download_needs_login(client, make_user, auth_headers):
    make_user("G710001", level=1)
    assert client.get("/api/batches/task-template").status_code == 401
    r = client.get("/api/batches/task-template", headers=auth_headers("G710001"))
    assert r.status_code == 200 and r.content[:2] == b"PK"
    assert "attachment" in r.headers["content-disposition"] and "xlsx" in r.headers["content-disposition"]
    assert load_workbook(BytesIO(r.content)).sheetnames[0] == "과제 목록"


def test_upload_path_reads_filled_template(tmp_path):
    """올리기 경로는 read_only 로 연다(task_sheet.parse_path) — 숨긴 목록 시트와 작성 안내가 있어도 과제 목록 시트를 쓴다."""
    wb = load_workbook(BytesIO(build_template(2026, ["Unit"])))
    ws = wb["과제 목록"]
    ws.cell(HEAD_ROW + 2, 2, "9998 Truss 권상")
    ws.cell(HEAD_ROW + 2, 3, "홍길동 책임연구원")
    p = tmp_path / "양식.xlsx"
    wb.save(p)
    out = parse_path(str(p))
    assert out["sheet"] == "과제 목록" and [r["name"] for r in out["rows"]] == ["9998 Truss 권상"]
