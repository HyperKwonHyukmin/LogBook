"""23 — 문서 분류 확장(발표자료·회의자료·계산서) · 발표 파일 추정값(.ppt/.pptx → 발표자료, 저장하지 않음) ·
빠른 구분 묶음(보고서/발표자료/기타) · 기존 자료 정비 CLI(document-type-fill)."""
import io
import json

import pytest

from app import cli, models, report_catalog
from app.entries.files import entry_dir, write_entry_files
from app.storage.paths import to_long


@pytest.fixture
def world(db, storage, make_user, make_entry_file, auth_headers):
    """작성자 A100001 의 자료 하나에 PDF 보고서·발표 파일(.pptx)·구형 발표 파일(.ppt)."""
    make_user("A100001", name="작성자")
    entry, pdf = make_entry_file(title="크레인 검토", name="검토.pdf")
    _, pptx = make_entry_file(entry=entry, name="중간발표.pptx")
    _, ppt = make_entry_file(entry=entry, name="옛발표.PPT")
    import os
    os.makedirs(to_long(entry_dir(storage, entry) / "files"), exist_ok=True)
    return {"entry": entry, "pdf": pdf, "pptx": pptx, "ppt": ppt, "h": auth_headers("A100001")}


def _rows(client, h, query=""):
    r = client.get(f"/api/reports{query}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _entry_json(storage, entry):
    with open(to_long(entry_dir(storage, entry) / "entry.json"), encoding="utf-8") as fh:
        return json.load(fh)


def test_document_type_list_and_groups_cover_every_value():
    """목록은 서버 한 곳(models) — 빠른 구분 묶음은 모든 값과 미분류를 정확히 한 번씩 덮는다."""
    assert models.REPORT_DOCUMENT_TYPES == ("해석 보고서", "연구 보고서", "시험 보고서", "기술 검토", "발표자료",
                                           "회의자료", "계산서", "지침", "기타")
    values = [v for g in report_catalog.DOCUMENT_TYPE_GROUPS for v in g["values"]]
    assert sorted(values) == sorted([*models.REPORT_DOCUMENT_TYPES, report_catalog.NONE])
    assert len(values) == len(set(values))
    assert [g["key"] for g in report_catalog.DOCUMENT_TYPE_GROUPS] == ["report", "presentation", "other"]
    # 추정값도 목록 안의 값이어야 한다(저장할 때 422 가 나지 않게)
    assert set(report_catalog.AUTO_DOCUMENT_TYPES.values()) <= set(models.REPORT_DOCUMENT_TYPES)


def test_list_serves_options_and_groups(client, world):
    r = _rows(client, world["h"])
    assert r["document_type_options"] == list(models.REPORT_DOCUMENT_TYPES)
    assert r["document_type_groups"][1] == {"key": "presentation", "label": "발표자료", "values": ["발표자료", "회의자료"]}


def test_pptx_is_presentation_by_inference_not_stored(client, db, world):
    w, h = world, world["h"]
    rows = {i["file_id"]: i for i in _rows(client, h)["items"]}
    assert (rows[w["pptx"].id]["document_type"], rows[w["pptx"].id]["document_type_auto"]) == ("발표자료", True)
    assert (rows[w["ppt"].id]["document_type"], rows[w["ppt"].id]["document_type_auto"]) == ("발표자료", True)
    assert (rows[w["pdf"].id]["document_type"], rows[w["pdf"].id]["document_type_auto"]) == ("", False)   # PDF 는 추정 안 함
    assert db.query(models.ReportMeta).count() == 0   # 읽기만으로는 저장하지 않는다
    cat = client.get(f"/api/reports/{w['pptx'].id}/catalog", headers=h).json()
    assert (cat["document_type"], cat["document_type_auto"], cat["version"]) == ("발표자료", True, 0)
    # 거르기·건수가 추정값을 따른다
    r = _rows(client, h, "?document_type=발표자료&document_type=회의자료")
    assert {i["file_id"] for i in r["items"]} == {w["pptx"].id, w["ppt"].id}
    assert r["document_types"] == {"발표자료": 2, "": 1}   # 자기 칸만 빼고 센다
    assert [i["file_id"] for i in _rows(client, h, "?document_type=__none__")["items"]] == [w["pdf"].id]
    # 검색어 — 보고서 화면과 메인 검색 모두 추정값에 맞는다(그 파일만)
    assert {i["file_id"] for i in _rows(client, h, "?q=발표자료")["items"]} == {w["pptx"].id, w["ppt"].id}
    r = client.get("/api/search?unit=file&q=발표자료", headers=h).json()
    assert {i["file_id"] for i in r["items"]} == {w["pptx"].id, w["ppt"].id}


def test_saving_confirms_or_overrides_inference(client, db, storage, world):
    w, h = world, world["h"]
    # 사용자가 다른 값으로 바꾼다 → 저장값이 이긴다
    r = client.put(f"/api/reports/{w['pptx'].id}/catalog", headers=h,
                   json={"version": 0, "document_type": "회의자료", "model_ids": []})
    assert r.status_code == 200, r.text
    assert (r.json()["document_type"], r.json()["document_type_auto"], r.json()["version"]) == ("회의자료", False, 1)
    # '미분류'로 저장하면 NULL 행이 생기고 다시 추정하지 않는다(같은 값 → 같은 값이어도 저장된다)
    r = client.put(f"/api/reports/{w['ppt'].id}/catalog", headers=h,
                   json={"version": 0, "document_type": "", "model_ids": []})
    assert r.status_code == 200 and (r.json()["document_type"], r.json()["document_type_auto"]) == ("", False)
    meta = db.get(models.ReportMeta, w["ppt"].id)
    assert meta is not None and meta.document_type is None and meta.version == 1
    [act] = [a for a in db.query(models.AuditLog).filter_by(action="REPORT_META") if a.after["report"] == "옛발표.PPT"]
    assert act.before == {"report": "옛발표.PPT", "document_type": None, "document_type_auto": "발표자료"}
    rows = {i["file_id"]: i for i in _rows(client, h)["items"]}
    assert rows[w["ppt"].id]["document_type"] == "" and rows[w["pptx"].id]["document_type"] == "회의자료"
    # 재구축 원천 — 미분류로 저장한 발표 파일도 entry.json 에 남아 재구축 뒤 다시 추정되지 않는다
    data = _entry_json(storage, w["entry"])
    assert {r["rel_path"]: r["document_type"] for r in data["reports"]} == {"옛발표.PPT": None, "중간발표.pptx": "회의자료"}
    # 새 값(계산서)도 저장할 수 있다
    r = client.put(f"/api/reports/{w['pdf'].id}/catalog", headers=h,
                   json={"version": 0, "document_type": "계산서", "model_ids": []})
    assert r.status_code == 200 and r.json()["document_type"] == "계산서"


def test_inference_survives_rebuild_without_rows(db, storage, world, client):
    """추정값은 저장하지 않으므로 재구축(entry.json → DB) 뒤에도 같은 규칙으로 다시 나온다."""
    from app import database
    from app.ops.rebuild import rebuild

    write_entry_files(db, storage, db.get(models.Entry, world["entry"].id))
    code = world["entry"].entry_id
    db.rollback()
    database.Base.metadata.drop_all(database.engine)
    database.Base.metadata.create_all(database.engine)
    db.expunge_all()
    r = rebuild(db, storage, force=True)
    assert r["entries"] == 1 and r["report_meta"] == 0
    entry = db.query(models.Entry).filter_by(entry_id=code).one()
    pptx = db.query(models.File).filter_by(entry_id=entry.id, name="중간발표.pptx").one()
    assert report_catalog.effective_document_type(db.get(models.ReportMeta, pptx.id), pptx.name) == ("발표자료", True)


def test_fill_cli_dry_run_then_apply(db, storage, world, make_entry_file):
    w = world
    # 사용자가 '미분류'로 저장한 발표 파일은 건너뛴다 · 초안 자료의 발표 파일은 대상이 아니다
    db.add(models.ReportMeta(file_id=w["ppt"].id, document_type=None, version=1, updated_by="A100001"))
    make_entry_file(title="초안", status="draft", name="초안발표.pptx")
    db.commit()
    out = io.StringIO()
    plan = cli.document_type_fill(db, storage, out=out)
    assert not plan["applied"]
    assert plan["items"] == [{"entry_id": w["entry"].entry_id, "report": "중간발표.pptx", "document_type": "발표자료"}]
    assert plan["kept"] == [{"entry_id": w["entry"].entry_id, "report": "옛발표.PPT"}]
    assert db.get(models.ReportMeta, w["pptx"].id) is None
    assert "아무것도 바꾸지 않았습니다" in out.getvalue()

    plan = cli.document_type_fill(db, storage, apply=True, out=io.StringIO())
    assert plan["filled"] == 1
    db.expire_all()
    meta = db.get(models.ReportMeta, w["pptx"].id)
    assert (meta.document_type, meta.version, meta.updated_by) == ("발표자료", 1, "system")
    act = db.query(models.AuditLog).filter_by(action="REPORT_META").one()
    assert (act.employee_id, act.target_id) == ("system", w["entry"].entry_id)
    assert act.before == {"report": "중간발표.pptx", "document_type": None, "document_type_auto": "발표자료"}
    assert act.after == {"report": "중간발표.pptx", "document_type": "발표자료", "source": "document-type-fill"}
    data = _entry_json(storage, w["entry"])
    assert {r["rel_path"]: r["document_type"] for r in data["reports"]} == {"옛발표.PPT": None, "중간발표.pptx": "발표자료"}
    assert db.get(models.ReportMeta, w["ppt"].id).document_type is None   # 미분류로 저장한 것은 그대로
    # 다시 돌려도 바뀌는 것이 없다
    again = cli.document_type_fill(db, storage, apply=True, out=io.StringIO())
    assert again["items"] == [] and again["filled"] == 0


def test_cli_parser_has_fill_command(capsys):
    with pytest.raises(SystemExit):
        cli.main(["document-type-fill", "--help"])
    assert "--apply" in capsys.readouterr().out
