"""24 — 여러 문서의 문서 분류 한꺼번에 바꾸기(POST /api/reports/meta/bulk).

건마다 단건 저장(PUT catalog)과 같은 길 — 권한·감사 로그(건별)·entry.json 반영이 같고, 부분 성공·unchanged·상한·
잘못된 분류·자동(추정)→명시 전환을 확인한다. 목록 응답의 can_edit(체크박스 활성)도 함께 본다."""
import json
import os

import pytest

from app import models, report_catalog
from app.entries.files import entry_dir
from app.storage.paths import to_long

URL = "/api/reports/meta/bulk"


@pytest.fixture
def world(db, storage, make_user, make_entry_file, auth_headers):
    """작성자 A100001(LV2) 자료 2개(PDF 2 · .pptx 1) · 남 B200002 의 공개 자료(PDF) · 관리자 Z900009(LV3) ·
    게스트 C300003(LV1) · 휴지통 보고서 · 초안 보고서."""
    make_user("A100001", name="작성자")
    make_user("B200002", name="다른 사람")
    make_user("C300003", name="게스트", level=1)
    make_user("Z900009", name="관리자", is_admin=True)
    e1, pdf1 = make_entry_file(title="크레인 검토", name="검토.pdf")
    _, pptx = make_entry_file(entry=e1, name="중간발표.pptx")
    e2, pdf2 = make_entry_file(title="데크 검토", name="데크.pdf")
    other_e, other = make_entry_file(title="남의 검토", name="남의.pdf", uploaded_by="B200002")
    _, trashed = make_entry_file(entry=e2, name="버린.pdf", location="trash")
    _, draft = make_entry_file(title="초안", status="draft", name="초안.pdf")
    for e in (e1, e2, other_e):
        os.makedirs(to_long(entry_dir(storage, e) / "files"), exist_ok=True)
    return {"e1": e1, "e2": e2, "other_e": other_e, "pdf1": pdf1, "pptx": pptx, "pdf2": pdf2, "other": other,
            "trashed": trashed, "draft": draft, "h": auth_headers("A100001")}


def _bulk(client, h, ids, document_type):
    return client.post(URL, headers=h, json={"file_ids": ids, "document_type": document_type})


def _metas(db):
    db.expire_all()
    return {m.file_id: m for m in db.query(models.ReportMeta)}


def _meta_audits(db):
    return db.query(models.AuditLog).filter_by(action="REPORT_META").all()


def _entry_json(storage, entry):
    with open(to_long(entry_dir(storage, entry) / "entry.json"), encoding="utf-8") as fh:
        return json.load(fh)


def test_bulk_updates_each_with_audit_and_entry_json(client, db, storage, world):
    w, h = world, world["h"]
    r = _bulk(client, h, [w["pdf1"].id, w["pdf2"].id], "해석 보고서")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["skipped"] == []
    assert [(u["file_id"], u["before"], u["document_type"], u["version"]) for u in body["updated"]] == [
        (w["pdf1"].id, "", "해석 보고서", 1), (w["pdf2"].id, "", "해석 보고서", 1)]
    metas = _metas(db)
    assert {fid: m.document_type for fid, m in metas.items()} == {w["pdf1"].id: "해석 보고서", w["pdf2"].id: "해석 보고서"}
    assert all(m.updated_by == "A100001" for m in metas.values())
    # 감사 로그 — 건마다 하나, target = 문서가 든 자료(단건 저장과 같은 모양)
    acts = sorted(((a.target_id, a.before, a.after) for a in _meta_audits(db)), key=lambda x: x[0])
    assert acts == sorted([
        (w["e1"].entry_id, {"report": "검토.pdf", "document_type": None}, {"report": "검토.pdf", "document_type": "해석 보고서"}),
        (w["e2"].entry_id, {"report": "데크.pdf", "document_type": None}, {"report": "데크.pdf", "document_type": "해석 보고서"}),
    ], key=lambda x: x[0])
    # entry.json `reports`(재구축 원천)에도 들어간다
    assert [(x["rel_path"], x["document_type"]) for x in _entry_json(storage, w["e1"])["reports"]] == [("검토.pdf", "해석 보고서")]
    assert [(x["rel_path"], x["document_type"]) for x in _entry_json(storage, w["e2"])["reports"]] == [("데크.pdf", "해석 보고서")]
    # 목록에도 바로 보인다
    rows = {i["file_id"]: i for i in client.get("/api/reports", headers=h).json()["items"]}
    assert rows[w["pdf1"].id]["document_type"] == "해석 보고서"


def test_partial_success_collects_reasons(client, db, world, auth_headers):
    w, h = world, world["h"]
    ids = [w["pdf1"].id, w["other"].id, w["trashed"].id, w["draft"].id, 987654]
    r = _bulk(client, h, ids, "연구 보고서")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [u["file_id"] for u in body["updated"]] == [w["pdf1"].id]
    assert body["skipped"] == [
        {"file_id": w["other"].id, "reason": "not_uploader"},       # 남의 자료(보이지만 고칠 수 없다)
        {"file_id": w["trashed"].id, "reason": "report_not_found"},  # 휴지통
        {"file_id": w["draft"].id, "reason": "report_not_found"},    # 초안
        {"file_id": 987654, "reason": "report_not_found"},           # 없는 파일
    ]
    assert set(_metas(db)) == {w["pdf1"].id}
    assert len(_meta_audits(db)) == 1
    # 게스트(LV1)는 일반 자료를 보지 못한다 → 존재를 숨긴다
    r = _bulk(client, auth_headers("C300003"), [w["pdf1"].id], "기타")
    assert r.status_code == 200 and r.json() == {"updated": [], "skipped": [{"file_id": w["pdf1"].id, "reason": "report_not_found"}]}


def test_admin_can_change_others(client, db, world, auth_headers):
    w = world
    r = _bulk(client, auth_headers("Z900009"), [w["other"].id, w["pdf1"].id], "기술 검토")
    assert r.status_code == 200 and [u["file_id"] for u in r.json()["updated"]] == [w["other"].id, w["pdf1"].id]
    assert _metas(db)[w["other"].id].updated_by == "Z900009"


def test_unchanged_skipped_without_audit_and_keeps_other_fields(client, db, world):
    w, h = world, world["h"]
    # 단건 저장으로 분류를 먼저 정한다
    assert client.put(f"/api/reports/{w['pdf1'].id}/catalog", headers=h,
                      json={"version": 0, "document_type": "지침", "model_ids": []}).status_code == 200
    audits = len(_meta_audits(db))
    r = _bulk(client, h, [w["pdf1"].id, w["pdf2"].id], "지침")
    assert r.status_code == 200
    body = r.json()
    assert [u["file_id"] for u in body["updated"]] == [w["pdf2"].id]
    assert body["skipped"] == [{"file_id": w["pdf1"].id, "reason": "unchanged"}]
    assert len(_meta_audits(db)) == audits + 1   # 바뀐 pdf2 만
    assert _metas(db)[w["pdf1"].id].version == 1   # unchanged 는 판을 올리지 않는다


def test_bulk_keeps_model_links(client, db, world, make_entry_file):
    w, h = world, world["h"]
    _, model = make_entry_file(entry=w["e2"], name="m.bdf", kind="model")
    assert client.put(f"/api/reports/{w['pdf1'].id}/catalog", headers=h,
                      json={"version": 0, "document_type": "", "model_ids": [model.id]}).status_code == 200
    r = _bulk(client, h, [w["pdf1"].id], "계산서")
    assert r.status_code == 200 and r.json()["updated"][0]["version"] == 2
    db.expire_all()
    assert report_catalog.linked_ids(db, [w["pdf1"].id])[w["pdf1"].id] == {model.id}
    assert db.query(models.AuditLog).filter_by(action="REPORT_LINKS").count() == 1   # 연결 감사는 처음 저장 1건뿐


def test_auto_presentation_becomes_explicit(client, db, storage, world):
    w, h = world, world["h"]
    rows = {i["file_id"]: i for i in client.get("/api/reports", headers=h).json()["items"]}
    assert (rows[w["pptx"].id]["document_type"], rows[w["pptx"].id]["document_type_auto"]) == ("발표자료", True)
    r = _bulk(client, h, [w["pptx"].id], "발표자료")
    assert r.status_code == 200 and [u["file_id"] for u in r.json()["updated"]] == [w["pptx"].id]
    assert r.json()["updated"][0]["before"] == "발표자료"
    rows = {i["file_id"]: i for i in client.get("/api/reports", headers=h).json()["items"]}
    assert (rows[w["pptx"].id]["document_type"], rows[w["pptx"].id]["document_type_auto"]) == ("발표자료", False)
    [act] = _meta_audits(db)
    assert act.before == {"report": "중간발표.pptx", "document_type": None, "document_type_auto": "발표자료"}
    assert [(x["rel_path"], x["document_type"]) for x in _entry_json(storage, w["e1"])["reports"]] == [("중간발표.pptx", "발표자료")]
    # 한 번 더 보내면 이제는 저장값이 같아 unchanged
    assert _bulk(client, h, [w["pptx"].id], "발표자료").json()["skipped"] == [{"file_id": w["pptx"].id, "reason": "unchanged"}]


def test_validation_limits_and_dedupe(client, db, world):
    w, h = world, world["h"]
    r = _bulk(client, h, [w["pdf1"].id], "없는 분류")
    assert r.status_code == 422 and r.json()["detail"] == "invalid_document_type"
    assert _bulk(client, h, [], "기타").status_code == 422
    r = _bulk(client, h, list(range(1, 202)), "기타")
    assert r.status_code == 422 and r.json()["detail"] == "too_many_reports"
    assert not _metas(db) and not _meta_audits(db)   # 422 면 아무것도 바꾸지 않는다
    # 중복 id 는 하나로 — 상한도 중복을 지운 뒤 센다
    r = _bulk(client, h, [w["pdf1"].id] * 250, "기타")
    assert r.status_code == 200, r.text
    assert [u["file_id"] for u in r.json()["updated"]] == [w["pdf1"].id] and r.json()["skipped"] == []
    assert len(_meta_audits(db)) == 1
    # 빈 값('')은 미분류로 저장된다(단건 저장과 같다)
    r = _bulk(client, h, [w["pdf1"].id], "")
    assert r.status_code == 200 and r.json()["updated"][0]["document_type"] == ""
    assert _metas(db)[w["pdf1"].id].document_type is None


def test_requires_login(client, world):
    assert client.post(URL, json={"file_ids": [world["pdf1"].id], "document_type": "기타"}).status_code == 401


def test_list_items_carry_can_edit(client, world, auth_headers):
    w = world
    rows = {i["file_id"]: i["can_edit"] for i in client.get("/api/reports", headers=w["h"]).json()["items"]}
    assert rows == {w["pdf1"].id: True, w["pptx"].id: True, w["pdf2"].id: True, w["other"].id: False}
    rows = {i["file_id"]: i["can_edit"] for i in client.get("/api/reports", headers=auth_headers("Z900009")).json()["items"]}
    assert all(rows.values()) and len(rows) == 4
