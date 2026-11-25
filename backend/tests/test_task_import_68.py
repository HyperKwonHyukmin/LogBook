"""68 3단계 — 과제 엑셀(통합과제 양식) 알아보기, 미리보기, 초안 만들기, 다시 넣기, 버리기, 파일 0개 확정 막기, 재구축."""
import json
import os
from datetime import datetime

import pytest
from openpyxl import Workbook

from app import models
from app.entries import task_import
from app.ingest.process import process_batch
from app.ingest.task_sheet import NotTaskSheet, TaskSheetError, parse_rows
from app.storage.paths import long_join

LV2, LV1, ADMIN = "M682001", "G682001", "A682001"
HEAD = [
    [None, None, "2026년 구조솔루션팀 통합과제"],
    [None, "NO.", "과  제", None, None, None, None, None, None, None, None, None, None, None, None, "과제 의뢰"],
    [None, None, "이름", "과제완료\n여부", "과제의뢰서 NO.", "담당자", "아이템 분류", None, None, "Category", "평가 기준",
     "시작 날짜", "완료 날짜\n예상 날짜", "계획 M/H", "실 소요 M/H", "의뢰 부서", "의뢰자", "직책과장", "유/무형 효과 설명",
     "년간 유/무형 효과\n[만원]", "기여도\n(0~1)", "비고"],
    [None, None, None, None, None, None, "대상", "Key point", "목적", None, None, None, None, "Total", "Total"],
]


def row(no, name, status, req, who, target="서비스타워", cat="공정공법 개선", start=datetime(2026, 1, 1), end=datetime(2026, 5, 29)):
    return [None, no, name, status, req, who, target, "구조 안전성", "신제품 개발", cat, "σy", start, end, 100, 40,
            "운항관제부", "이범석 책임", "권근욱 책임", "효과", 6400, 0.3, "메모"]


ROWS = [row(1, "3496 거치식 서비스타워 검토", "완료", "2026-[C2026027]-01", "구조가 연구원"),
        row(2, "Shaft Generator TMH 개선", "진행 중", "X", "없는이름 책임", target="모르는대상", cat="엉뚱한분류"),
        row(3, "착수 전 과제", "착수 전", "2026-[C2026027]-03", "구조가 연구원"),
        [None, None, None], [None, "대기 항목", "Category", "과제수"]]


def sheet_rows():
    return [list(r) for r in HEAD] + ROWS


def test_parse_rows_signature_columns_and_rows():
    d = parse_rows(sheet_rows())
    assert d["year"] == 2026 and len(d["rows"]) == 3
    r1 = d["rows"][0]
    assert (r1["no"], r1["name"], r1["status"], r1["assignee"], r1["target"], r1["key_point"], r1["purpose"]) == (
        "1", "3496 거치식 서비스타워 검토", "완료", "구조가 연구원", "서비스타워", "구조 안전성", "신제품 개발")
    assert r1["started_on"] == "2026-01-01" and r1["finished_on"] == "2026-05-29" and r1["request_dept"] == "운항관제부"
    assert "계획M/H" in d["skipped"] and "직책과장" in d["skipped"] and "비고" in d["unread"]
    assert not any(k in r1 for k in ("계획M/H", "기여도"))
    # 열 순서가 바뀌어도 이름으로 찾는다
    swapped = [r[:2] + [r[4], r[3], r[2]] + r[5:] if len(r) > 5 else r for r in sheet_rows()]
    assert parse_rows(swapped)["rows"][0]["request_no"] == "2026-[C2026027]-01"
    with pytest.raises(NotTaskSheet):
        parse_rows([["제목", "값"], [1, 2]])
    broken = [list(r) for r in HEAD]
    broken[2][5] = "작성자"   # 담당자 열이 없다 — 서명은 이름+과제의뢰서+담당자라 서명 자체가 없다
    with pytest.raises(NotTaskSheet):
        parse_rows(broken)


def _write_sheet(path, rows):
    wb = Workbook()
    ws = wb.active
    ws.title = "과제 현황"
    for r in rows:
        ws.append(r)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    wb.save(path)


@pytest.fixture
def world(db, storage, make_user):
    make_user(LV2, name="팀장", level=2)
    make_user(LV1, name="게스트", level=1)
    make_user(ADMIN, name="관리자", level=3)
    db.add(models.Hull(hull_no="3496"))
    db.add(models.Person(employee_id="N682001", name="구조가", position="연구원", source="wb"))
    t = models.Tag(kind="target", value="서비스타워", listed=True)
    db.add(t)
    db.commit()


def _batch(db, storage, uploader=LV2, extra=None, key="20261123-task-0001"):
    b = models.Batch(key=key, source="web", original_name="통합과제.xlsx", uploader=uploader, state="staged")
    db.add(b)
    db.commit()
    _write_sheet(long_join(storage.staging / key, "2026년 통합과제.xlsx"), sheet_rows())
    for name in extra or []:
        with open(long_join(storage.staging / key, name), "wb") as fh:
            fh.write(b"%PDF-1.4 x")
    process_batch(db, storage, b)
    db.expire_all()
    return db.get(models.Batch, b.id)


def test_task_batch_review_preview_create_and_reimport(world, db, storage, client, auth_headers):
    b = _batch(db, storage)
    assert b.state == "review" and db.query(models.File).count() == 0 and db.query(models.Entry).count() == 0
    assert os.path.isfile(long_join(storage.staging / b.key, task_import.SHEET_FILE))
    h = auth_headers(LV2)
    got = next(x for x in client.get("/api/batches", params={"lite": 1}, headers=h).json() if x["key"] == b.key)
    ts = got["task_sheet"]
    assert ts["can_create"] is True and ts["total"] == 3 and "비고" in ts["unread"]
    r1, r2, r3 = ts["rows"]
    assert r1["checked"] and r2["checked"] and not r3["checked"]   # 착수 전은 기본 해제
    pid = db.query(models.Person).filter_by(employee_id="N682001").one().id
    assert r1["hull"] == "3496" and r1["target"] == "서비스타워" and r1["assignees"][0]["ref"] == {"id": pid}
    assert r2["key"] == "2026-#2" and r2["target"] is None and r2["target_text"] == "모르는대상" and r2["category"] is None
    assert any("명부에 없음" in n for n in r2["notices"]) and any("목록 밖 Category" in n for n in r2["notices"])
    # LV1 은 미리보기만
    assert client.post(f"/api/batches/{b.key}/task-drafts", json={"rows": [0]}, headers=auth_headers(LV1)).status_code == 403
    r = client.post(f"/api/batches/{b.key}/task-drafts", json={"rows": [0, 1]}, headers=h)
    assert r.status_code == 200, r.text
    assert len(r.json()["created"]) == 2 and r.json()["batch"]["state"] == "processed"
    # 두 번 누름은 막힌다
    assert client.post(f"/api/batches/{b.key}/task-drafts", json={"rows": [2]}, headers=h).status_code == 409
    db.expire_all()
    e1 = db.query(models.Entry).filter_by(title="3496 거치식 서비스타워 검토").one()
    t1 = db.get(models.EntryTask, e1.id)
    assert e1.status == "draft" and t1.task_key == "2026-[C2026027]-01" and t1.source_batch == b.key
    assert t1.category == "공정공법 개선" and t1.requester == "이범석 책임" and str(t1.started_on) == "2026-01-01"
    assert [h.hull_no for h in db.query(models.EntryHull).filter_by(entry_id=e1.id)] == ["3496"]
    assert db.query(models.EntryAssignee).filter_by(entry_id=e1.id).count() == 1
    # 기록 파일(재구축 원천)
    with open(long_join(storage.staging / b.key, task_import.IMPORT_FILE), encoding="utf-8") as fh:
        rec = json.load(fh)
    assert rec["by"] == LV2 and [d["key"] for d in rec["drafts"]] == ["2026-[C2026027]-01", "2026-#2"]
    # 줄 목록: 파일 기다림. 파일 0개 초안은 확정되지 않는다
    rows = {x["entry_id"]: x for x in client.get("/api/inbox/drafts", headers=h).json()["rows"]}
    assert rows[e1.entry_id]["state"] == "waiting_files"
    c = client.post(f"/api/entries/{e1.entry_id}/confirm", headers=h)
    assert c.status_code == 422 and c.json()["detail"] == "no_files"
    # 같은 엑셀을 다시 넣으면 이미 있는 행은 '이미 있음'으로 체크가 풀린다
    b2 = _batch(db, storage, key="20261123-task-0002")
    ts2 = next(x for x in client.get("/api/batches", params={"lite": 1}, headers=h).json() if x["key"] == b2.key)["task_sheet"]
    e2 = db.query(models.Entry).filter_by(title="Shaft Generator TMH 개선").one()
    assert [(x["exists"] or {}).get("entry_id") for x in ts2["rows"]] == [e1.entry_id, e2.entry_id, None]
    assert not ts2["rows"][0]["checked"] and ts2["rows"][0]["notices"][0].startswith("이미 있음")
    r = client.post(f"/api/batches/{b2.key}/task-drafts", json={"rows": [0, 2]}, headers=h)
    assert r.json()["skipped"] == ["1"] and len(r.json()["created"]) == 1


def test_mixed_batch_is_normal_and_discard(world, db, storage, client, auth_headers):
    mixed = _batch(db, storage, extra=["보고서.pdf"])
    assert mixed.state == "processed" and not task_import.is_task_batch(mixed)
    b = _batch(db, storage, key="20261123-task-0003")
    assert client.post(f"/api/batches/{b.key}/task-discard", headers=auth_headers(LV1)).status_code == 403
    assert client.post(f"/api/batches/{b.key}/task-discard", headers=auth_headers(LV2)).status_code == 200
    db.expire_all()
    assert db.get(models.Batch, b.id).state == "done"
    assert os.path.isfile(long_join(storage.trash / f"task_{b.key}", task_import.SHEET_FILE))
    assert not os.path.exists(long_join(storage.staging / b.key, task_import.SHEET_FILE))


def test_unclaimed_task_batch_needs_claim_by_lv2(world, db, storage, client, auth_headers):
    b = _batch(db, storage, uploader=None, key="20261123-task-0004")
    h = auth_headers(LV2)
    got = next(x for x in client.get("/api/batches", params={"scope": "unclaimed", "lite": 1}, headers=h).json() if x["key"] == b.key)
    assert got["task_sheet"]["can_create"] is False
    assert client.post(f"/api/batches/{b.key}/claim", headers=h).status_code == 200
    got = next(x for x in client.get("/api/batches", params={"lite": 1}, headers=h).json() if x["key"] == b.key)
    assert got["task_sheet"]["can_create"] is True


def test_rebuild_restores_task_drafts_and_skips_existing_keys(world, db, storage):
    b = models.Batch(key="20261123-task-0005", source="web", original_name="x", uploader=LV2, state="processed")
    db.add(b)
    db.flush()
    data = {"by": LV2, "file": "통합과제.xlsx", "drafts": [
        {"no": "1", "key": "K-1", "entry_id": "E000901", "title": "되살릴 과제", "hulls": ["3496"], "target": "서비스타워",
         "assignees": [{"employee_id": "N682001", "name": "구조가"}], "task": {"request_no": "K-1", "category": "안전"}},
        {"no": "2", "key": "K-2", "entry_id": "E000902", "title": "이미 확정된 과제", "task": {}}]}
    done = models.Entry(id=777, entry_id="E000777", title="확정", status="confirmed", batch_id=b.id, uploaded_by=LV2)
    db.add(done)
    db.flush()
    db.add(models.EntryTask(entry_id=777, task_key="K-2"))
    db.commit()
    assert task_import.restore_import(db, b, data) == 1
    db.commit()
    e = db.get(models.Entry, 901)
    assert e.status == "draft" and db.get(models.EntryTask, 901).task_key == "K-1" and db.get(models.EntryTask, 901).category == "안전"
    assert db.get(models.Entry, 902) is None


def test_one_row_header_keeps_first_task():
    rows = [["NO.", "이름", "담당자", "과제의뢰서 NO.", "과제완료 여부"],
            [1, "첫 과제 이름", "구조가 연구원", "A-1", "완료"],
            [2, "둘째 과제 이름", "구조가 연구원", "A-2", "진행 중"]]
    d = parse_rows(rows)
    assert [r["no"] for r in d["rows"]] == ["1", "2"]


def test_roster_position_must_match_and_hidden_existing_and_changed(world, db, storage, client, auth_headers, make_entry_file):
    from app.entries.task_import import _Roster
    db.add(models.Person(employee_id="N682002", name="김철수", position="책임", source="wb"))
    db.commit()
    got = _Roster(db).find("김철수", "선임")
    assert got.get("ref") is None and "명부에 없음" in got["notice"]   # 직책이 다르면 이름만 같은 사람에게 잇지 않는다
    assert _Roster(db).find("김철수", "책임")["ref"]["id"]
    # 블록된 확정 자료와 같은 열쇠 — LV1(만들 수는 없지만 미리보기는 보는 사람)에게는 번호를 숨긴다
    e, _ = make_entry_file(title="옛 과제", name="o.pdf", uploaded_by=ADMIN)
    db.get(models.Entry, e.id).access = "blocked"
    db.add(models.EntryTask(entry_id=e.id, task_key="2026-[C2026027]-01", requester="옛 의뢰자"))
    db.commit()
    b = _batch(db, storage, key="20261123-task-0006")
    lv1 = next(x for x in client.get("/api/batches", params={"lite": 1, "scope": "all"}, headers=auth_headers(LV1)).json()
               if x["key"] == b.key)["task_sheet"]["rows"][0]
    assert lv1["exists"] == {"entry_id": None, "status": None, "hidden": True} and lv1["notices"][0] == "이미 있음(볼 수 없는 자료)"
    adm = next(x for x in client.get("/api/batches", params={"lite": 1, "scope": "all"}, headers=auth_headers(ADMIN)).json()
               if x["key"] == b.key)["task_sheet"]["rows"][0]
    assert adm["exists"]["entry_id"] == e.entry_id and "바뀐 칸:" in adm["notices"][0] and "의뢰자" in adm["notices"][0]


def test_error_sheet_can_be_discarded(world, db, storage, client, auth_headers):
    key = "20261123-task-0007"
    b = models.Batch(key=key, source="web", original_name="x.xlsx", uploader=LV2, state="staged")
    db.add(b)
    db.commit()
    rows = [list(r) for r in HEAD] + ROWS
    rows[2][4] = "과제의뢰서 NO."
    rows[2][2] = "이름"
    rows[2][5] = "담당자"
    rows[2][4] = "과제의뢰서 번호X"   # 필수 열(과제의뢰서 NO.) 이름이 어긋남 → 서명은 있으나 필수 열 없음
    _write_sheet(long_join(storage.staging / key, "a.xlsx"), rows)
    process_batch(db, storage, b)
    db.expire_all()
    ts = next(x for x in client.get("/api/batches", params={"lite": 1}, headers=auth_headers(LV2)).json() if x["key"] == key)["task_sheet"]
    assert "필수 열" in ts["error"] and ts["can_discard"] is True
    assert client.post(f"/api/batches/{key}/task-discard", headers=auth_headers(LV2)).status_code == 200


def test_discarded_task_draft_is_not_rebuilt(world, db, storage, client, auth_headers):
    b = _batch(db, storage, key="20261123-task-0008")
    h = auth_headers(LV2)
    created = client.post(f"/api/batches/{b.key}/task-drafts", json={"rows": [0]}, headers=h).json()["created"]
    assert client.delete(f"/api/entries/{created[0]}", headers=h).status_code == 200
    with open(long_join(storage.staging / b.key, task_import.IMPORT_FILE), encoding="utf-8") as fh:
        data = json.load(fh)
    assert data["gone"] == created
    # 2026-11-25 — 같은 엑셀을 다시 넣으면 버린 초안 행은 막히지 않는다: 기본 체크에서만 빠지고 고르면 새 초안을 만든다
    b2 = _batch(db, storage, key="20261123-task-0010")
    row = next(x for x in client.get("/api/batches", params={"lite": 1}, headers=h).json() if x["key"] == b2.key)["task_sheet"]["rows"][0]
    assert row["exists"] is None and row["trashed"] == {"entry_id": created[0]} and not row["checked"]
    assert row["notices"][0] == f"휴지통에 같은 과제가 있음({created[0]}), 고르면 새 초안을 만듭니다"
    again = client.post(f"/api/batches/{b2.key}/task-drafts", json={"rows": [0]}, headers=h).json()
    assert len(again["created"]) == 1 and again["created"] != created and not again["failed"] and not again["skipped"]
    db.expire_all()
    old = db.query(models.Entry).filter_by(entry_id=created[0]).one()
    new = db.query(models.Entry).filter_by(entry_id=again["created"][0]).one()
    assert old.status == "trashed" and db.get(models.EntryTask, old.id).task_key is None   # 휴지통 쪽은 열쇠만 내려놓는다
    assert new.status == "draft" and db.get(models.EntryTask, new.id).task_key == row["key"]
    with open(long_join(storage.staging / b.key, task_import.IMPORT_FILE), encoding="utf-8") as fh:
        data = json.load(fh)
    assert data["drafts"][0]["key_released"] is True and data["gone"] == created
    # 휴지통의 옛 초안을 되돌려도 열쇠는 새 초안의 것 — 다시 넣으면 '이미 있음'은 새 초안을 가리킨다
    assert client.post(f"/api/entries/{created[0]}/restore", headers=h).status_code == 200
    b3 = _batch(db, storage, key="20261123-task-0011")
    row3 = next(x for x in client.get("/api/batches", params={"lite": 1}, headers=h).json() if x["key"] == b3.key)["task_sheet"]["rows"][0]
    assert row3["exists"] == {"entry_id": again["created"][0], "status": "draft"}
    assert client.delete(f"/api/entries/{created[0]}", headers=h).status_code == 200
    with open(long_join(storage.staging / b.key, task_import.IMPORT_FILE), encoding="utf-8") as fh:
        data = json.load(fh)
    nb = models.Batch(key="20261123-task-0009", source="web", original_name="x", uploader=LV2, state="processed")
    db.add(nb)
    db.commit()
    db.query(models.EntryTask).delete()
    db.commit()
    assert task_import.restore_import(db, nb, data) == 0
