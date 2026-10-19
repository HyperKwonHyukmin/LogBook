"""21 — 보고서 화면: 목록(DB 만으로·거른 뒤 쪽 자르기·소속 파생·문서 분류/모델 유무),
보고서 정보·모델 연결 저장(권한·충돌·숨은 연결 보존·감사·entry.json), 휴지통·복원·영구 삭제 규칙, 재구축,
예전 report-catalog.json 이전 CLI. 29 — 21 의 '프로젝트'(자료 값)는 없앴다: 남은 값이 있어도 어디서도 쓰지 않는다."""
import io
import json
import os

import pytest

from app import cli, models, report_catalog
from app.entries import naming, service
from app.entries.files import entry_dir, write_entry_files
from app.storage.paths import to_long


@pytest.fixture
def world(db, storage, make_user, make_entry_file, auth_headers):
    """작성자 A100001(LV2) · 남 B200002(LV2) · 게스트 C300003(LV1).
    독립(호선 없음) 자료의 보고서 · 호선 자료(보고서+BDF) · 남의 블록 자료(BDF+보고서)."""
    make_user("A100001", name="작성자")
    make_user("B200002", name="다른 사람")
    make_user("C300003", name="게스트", level=1)
    indep, only = make_entry_file(title="독립 연구", hulls=(), name="연구.pdf", kind="report")
    bundled, report = make_entry_file(title="호선 검토", name="검토.pdf", kind="report")
    _, model = make_entry_file(entry=bundled, name="model.bdf", kind="model")
    hidden, secret = make_entry_file(title="비공개 과제", name="secret.bdf", kind="model", uploaded_by="B200002")
    make_entry_file(entry=hidden, name="secret.pdf", kind="report")
    hidden.access = "blocked"
    for e in (indep, bundled, hidden):
        os.makedirs(to_long(entry_dir(storage, e) / "files"), exist_ok=True)
    db.commit()
    return {"indep": indep, "only": only, "bundled": bundled, "report": report, "model": model,
            "hidden": hidden, "secret": secret, "h": auth_headers("A100001")}


def _put(client, h, fid, **body):
    return client.put(f"/api/reports/{fid}/catalog", headers=h, json={"version": 0, **body})


def _entry_json(storage, entry):
    with open(to_long(entry_dir(storage, entry) / "entry.json"), encoding="utf-8") as fh:
        return json.load(fh)


# ---- 목록 ----

def test_list_report_only_and_same_entry_models(client, world):
    w, h = world, world["h"]
    r = client.get("/api/reports", headers=h).json()
    assert {i["file_id"] for i in r["items"]} == {w["only"].id, w["report"].id}   # 블록 자료는 보이지 않는다
    counts = {i["file_id"]: i["model_count"] for i in r["items"]}
    assert counts == {w["only"].id: 0, w["report"].id: 1}
    r = client.get("/api/reports?model=no&limit=1", headers=h).json()
    assert r["total"] == 1 and r["items"][0]["file_id"] == w["only"].id
    cat = client.get(f"/api/reports/{w['report'].id}/catalog", headers=h).json()
    assert [(m["file_id"], m["relation"]) for m in cat["related_models"]] == [(w["model"].id, "same_entry")]


def test_scope_is_derived_from_entry_values(client, db, storage, world, make_entry_file):
    w, h = world, world["h"]
    shared, shared_r = make_entry_file(title="공통 지침", hulls=(), name="지침.pdf")
    shared.no_hull = True
    db.commit()
    rows = {i["file_id"]: i for i in client.get("/api/reports", headers=h).json()["items"]}
    assert rows[w["only"].id]["scope"] == "unclassified" and "project" not in rows[w["only"].id]
    assert rows[w["report"].id]["scope"] == "hull"
    assert rows[shared_r.id]["scope"] == "reference"
    r = client.get("/api/reports?scope=unclassified&scope=reference", headers=h).json()
    assert {i["file_id"] for i in r["items"]} == {w["only"].id, shared_r.id}
    assert r["scopes"] == {"hull": 1, "unclassified": 1, "reference": 1}   # 자기 칸만 빼고 센다
    assert "projects" not in r and "no_project" not in r
    # 29 — 예전 프로젝트 값이 DB 에 남아 있어도 '독립 프로젝트'가 되지 않는다
    service.set_tags(db, w["indep"], "project", ["크레인 연구"])
    db.commit()
    rows = {i["file_id"]: i for i in client.get("/api/reports", headers=h).json()["items"]}
    assert rows[w["only"].id]["scope"] == "unclassified"
    assert "project" not in report_catalog.SCOPES


def test_pagination_filters_before_paging(client, db, world, make_entry_file):
    w, h = world, world["h"]
    make_entry_file(title="다른 과제", hulls=(), name="다른.pdf")
    db.commit()
    first = client.get("/api/reports?limit=2", headers=h).json()
    second = client.get("/api/reports?limit=2&offset=2", headers=h).json()
    assert first["total"] == second["total"] == 3 and len(first["items"]) == 2 and len(second["items"]) == 1
    # 거르기가 쪽 자르기보다 먼저 — 모델 있는 보고서 1건만 남아도 첫 쪽에 온다
    r = client.get("/api/reports?model=yes&limit=1", headers=h).json()
    assert r["total"] == 1 and r["items"][0]["file_id"] == w["report"].id


def test_list_does_not_read_shared_folder(client, storage, world):
    """한 자료 폴더가 사라지거나 깨진 파일이 있어도 목록·상세는 DB 만으로 나온다(예전: 자료마다 sidecar 를 읽어 503)."""
    import shutil

    shutil.rmtree(to_long(entry_dir(storage, world["indep"])))
    with open(to_long(entry_dir(storage, world["bundled"]) / "report-catalog.json"), "w", encoding="utf-8") as fh:
        fh.write('{"format":1,"reports":{"검토.pdf":null}}')
    r = client.get("/api/reports", headers=world["h"])
    assert r.status_code == 200 and r.json()["total"] == 2
    assert client.get(f"/api/reports/{world['only'].id}/catalog", headers=world["h"]).status_code == 200


def test_staged_and_trashed_reports_not_listed(client, db, world, make_entry_file):
    w, h = world, world["h"]
    make_entry_file(entry=w["indep"], name="pending.pdf", kind="report", location="staging")
    draft, draft_r = make_entry_file(title="초안", status="draft", name="draft.pdf")
    r = client.get("/api/reports", headers=h).json()
    assert r["total"] == 2
    assert client.get(f"/api/reports/{draft_r.id}/catalog", headers=h).status_code == 404


# ---- 저장 ----

def test_save_meta_and_links_keeps_entry_values(client, db, storage, world):
    w, h = world, world["h"]
    before = (w["indep"].title, w["indep"].version)
    r = _put(client, h, w["only"].id, document_type="연구 보고서", model_ids=[w["model"].id])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["document_type"] == "연구 보고서" and body["version"] == 1
    assert [(m["file_id"], m["relation"]) for m in body["related_models"]] == [(w["model"].id, "explicit")]
    db.expire_all()
    e = db.get(models.Entry, w["indep"].id)
    assert (e.title, e.version) == before   # 보고서 정보는 자료 값(제목·version)을 바꾸지 않는다
    acts = {a.action: a for a in db.query(models.AuditLog).filter_by(target_id=e.entry_id)}
    assert acts["REPORT_META"].after == {"report": "연구.pdf", "document_type": "연구 보고서"}
    assert acts["REPORT_LINKS"].after["models"] == [f"{w['bundled'].entry_id}/model.bdf"]
    # 재구축 원천 — entry.json reports(파일 id 가 아니라 자료 번호+상대경로+sha256)
    data = _entry_json(storage, e)
    assert data["reports"] == [{"rel_path": "연구.pdf", "sha256": w["only"].sha256, "document_type": "연구 보고서",
                                "version": 1, "updated_by": "A100001", "updated_at": data["reports"][0]["updated_at"],
                                "models": [{"entry_id": w["bundled"].entry_id, "rel_path": "model.bdf",
                                            "sha256": w["model"].sha256}]}]
    assert not os.path.exists(to_long(entry_dir(storage, e) / "report-catalog.json"))
    r = client.get("/api/reports?document_type=연구%20보고서", headers=h).json()
    assert [i["file_id"] for i in r["items"]] == [w["only"].id] and r["items"][0]["model_count"] == 1
    assert client.get("/api/reports?document_type=__none__", headers=h).json()["total"] == 1


def test_save_conflict_validation_and_permissions(client, world, auth_headers):
    w, h = world, world["h"]
    fid = w["only"].id
    assert _put(client, h, fid, document_type="없는 분류").status_code == 422
    assert _put(client, h, fid, model_ids=[w["secret"].id]).status_code == 404     # 볼 수 없는 모델
    assert _put(client, h, fid, model_ids=[w["report"].id]).status_code == 404     # 보고서는 모델이 아니다
    assert _put(client, h, fid, document_type="지침").status_code == 200
    r = _put(client, h, fid, document_type="기타")
    assert r.status_code == 409 and r.json()["detail"] == "report_catalog_conflict"
    assert _put(client, auth_headers("B200002"), fid, document_type="기타").status_code == 403   # 남의 자료
    guest = auth_headers("C300003")
    assert client.get(f"/api/reports/{fid}/catalog", headers=guest).status_code == 404   # LV1 은 일반 자료를 못 본다
    assert client.get("/api/reports", headers=guest).json()["total"] == 0


def test_hidden_link_is_preserved(client, db, world, make_user, auth_headers):
    """편집자가 볼 수 없게 된 모델로의 기존 연결은 화면에서 숨기되 저장해도 지우지 않는다."""
    w, h = world, world["h"]
    assert _put(client, h, w["only"].id, model_ids=[w["model"].id]).status_code == 200
    bundled = db.get(models.Entry, w["bundled"].id)
    bundled.access, bundled.uploaded_by = "blocked", "B200002"
    db.commit()
    cat = client.get(f"/api/reports/{w['only'].id}/catalog", headers=h).json()
    assert cat["related_models"] == []
    assert client.put(f"/api/reports/{w['only'].id}/catalog", headers=h,
                      json={"version": 1, "document_type": "기타", "model_ids": []}).status_code == 200
    bundled.access = "normal"
    db.commit()
    cat = client.get(f"/api/reports/{w['only'].id}/catalog", headers=h).json()
    assert [m["file_id"] for m in cat["related_models"]] == [w["model"].id]


# ---- 검색어 ----

def test_query_combines_title_body_and_document_type(client, db, world):
    w, h = world, world["h"]
    db.add(models.FileText(file_id=w["only"].id, seq=0, locator="page:2", text="응력 집중 검토 결과"))
    db.commit()
    r = client.get("/api/reports?q=독립%20응력", headers=h).json()
    assert r["total"] == 1 and r["items"][0]["snippets"][0]["locator"] == "page:2"
    assert client.get("/api/reports?q=독립%20없는단어", headers=h).json()["total"] == 0
    assert _put(client, h, w["report"].id, document_type="시험 보고서").status_code == 200
    r = client.get("/api/reports?q=시험", headers=h).json()
    assert [i["file_id"] for i in r["items"]] == [w["report"].id]
    # 문서 분류는 그 파일의 값 — 같은 자료의 모델 파일은 물려받지 않는다
    r = client.get("/api/search?unit=file&q=시험", headers=h).json()
    assert [i["file_id"] for i in r["items"]] == [w["report"].id]


# ---- 29 — 프로젝트는 없앴다 ----

def test_project_is_gone_from_search_suggest_and_patch(client, db, storage, world):
    w, h = world, world["h"]
    e = w["indep"]
    # 예전에 남은 프로젝트 태그 — 검색어·필터·묶기·자동완성 어디에도 나오지 않는다
    service.set_tags(db, e, "project", ["크레인 연구"])
    db.commit()
    r = client.get("/api/search", headers=h).json()
    assert "project" not in r["facets"] and all("project" not in i for i in r["items"])
    assert client.get("/api/search?project=크레인%20연구", headers=h).json()["total"] == r["total"]   # 거르지 않는다
    assert client.get("/api/search?q=크레인", headers=h).json()["total"] == 0
    assert client.get("/api/search?group=project", headers=h).status_code == 422
    assert client.get("/api/suggest?kind=project&q=크레", headers=h).status_code == 422
    assert set(client.get("/api/suggest/all?q=크레", headers=h).json()) == {"hull", "zone", "tag"}
    assert "project" not in client.get("/api/search/browse", headers=h).json()["facets"]
    # 자료 수정 — project 를 보내도 받지 않고, 응답·entry.json·감사에도 없다
    r = client.patch(f"/api/entries/{e.entry_id}", headers=h,
                     json={"version": e.version, "project": "새 연구", "description": "설명"})
    assert r.status_code == 200, r.text
    assert "project" not in r.json()
    log = db.query(models.AuditLog).filter_by(target_id=e.entry_id).order_by(models.AuditLog.id.desc()).first()
    assert log.action == "ENTRY_UPDATE" and "project" not in log.after
    assert "project" not in _entry_json(storage, e)


def test_bdf_needs_hull_or_shared_project_does_not_count(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    _b, e = setup_entry_with_files(rels=("크레인연구_M01/model.bdf",))
    db.query(models.EntryHull).filter_by(entry_id=e.id).delete()
    service.set_tags(db, e, "project", ["크레인 연구"])   # 예전 값 — 호선 대신 인정하지 않는다
    db.commit()
    assert service.entry_to_dict(db, e)["required_missing"] == ["hull"]
    service.update_entry(db, storage, e, u, {"version": e.version, "no_hull": True})
    db.expire_all()
    assert service.entry_to_dict(db, db.get(models.Entry, e.id))["required_missing"] == []
    assert naming.compose_title(no_hull=True, zones=["Z"]) == "공용 · Z"


# ---- 휴지통·복원·영구 삭제 ----

def test_trash_restore_purge_rules(client, db, storage, world, make_user):
    from app.ops.purge import purge_entry

    w, h = world, world["h"]
    report_id, only_id = w["report"].id, w["only"].id   # 영구 삭제 뒤에는 객체를 다시 읽을 수 없다
    assert _put(client, h, w["only"].id, document_type="지침", model_ids=[w["model"].id]).status_code == 200
    u = db.query(models.User).filter_by(employee_id="A100001").one()
    write_entry_files(db, storage, db.get(models.Entry, w["bundled"].id))
    # 모델이 든 자료를 휴지통으로 — 연결은 남기고 화면에서만 숨긴다
    service.trash(db, storage, db.get(models.Entry, w["bundled"].id), u)
    cat = client.get(f"/api/reports/{w['only'].id}/catalog", headers=h).json()
    assert cat["related_models"] == [] and cat["document_type"] == "지침"
    assert db.query(models.ReportModelLink).count() == 1
    rows = {i["file_id"]: i for i in client.get("/api/reports", headers=h).json()["items"]}
    assert rows[w["only"].id]["model_count"] == 0 and w["report"].id not in rows
    # 복원하면 그대로 돌아온다
    service.restore(db, storage, db.get(models.Entry, w["bundled"].id), u)
    cat = client.get(f"/api/reports/{w['only'].id}/catalog", headers=h).json()
    assert [m["file_id"] for m in cat["related_models"]] == [w["model"].id]
    # 영구 삭제 — 연결·정보 행을 지우고, 연결했던 다른 자료의 entry.json 도 다시 쓴다
    assert _put(client, h, w["report"].id, document_type="기타").status_code == 200
    service.trash(db, storage, db.get(models.Entry, w["bundled"].id), u)
    purge_entry(db, storage, db.get(models.Entry, w["bundled"].id), "A100001")
    db.commit()
    assert db.query(models.ReportModelLink).count() == 0
    assert db.get(models.ReportMeta, report_id) is None
    assert db.get(models.ReportMeta, only_id) is not None
    assert _entry_json(storage, w["indep"])["reports"][0]["models"] == []


def test_file_id_follows_confirm_merge(db, storage, make_user, setup_entry_with_files, make_entry_file, client,
                                       auth_headers):
    """기존 자료에 파일 추가(합치기 확정)는 파일 행을 옮길 뿐 id 가 같다 — 그 모델로의 연결이 그대로 따라간다."""
    u = make_user("A100001")
    h = auth_headers("A100001")
    target, report = make_entry_file(title="대상", name="보고서.pdf", kind="report")
    os.makedirs(to_long(entry_dir(storage, target) / "files"), exist_ok=True)
    _b, draft = setup_entry_with_files(rels=("추가/new.bdf",))
    new_model = db.query(models.File).filter_by(entry_id=draft.id).one()
    draft.merge_into_id = target.id
    db.commit()
    model_id = new_model.id
    service.confirm(db, storage, draft, u)
    db.expire_all()
    moved = db.get(models.File, model_id)
    assert moved.entry_id == target.id and moved.location == "vault"
    assert _put(client, h, report.id, model_ids=[model_id]).status_code == 200
    cat = client.get(f"/api/reports/{report.id}/catalog", headers=h).json()
    assert [(m["file_id"], m["relation"]) for m in cat["related_models"]] == [(model_id, "explicit")]


# ---- 재구축 ----

def test_rebuild_restores_meta_and_links_ignores_old_project(db, storage, world, client):
    from app.ops.rebuild import rebuild

    w, h = world, world["h"]
    assert _put(client, h, w["only"].id, document_type="연구 보고서", model_ids=[w["model"].id]).status_code == 200
    for e in (w["indep"], w["bundled"]):
        write_entry_files(db, storage, db.get(models.Entry, e.id))
    # 29 — 예전 entry.json 에 남은 project 는 읽지 않는다
    data = _entry_json(storage, w["indep"])
    with open(to_long(entry_dir(storage, w["indep"]) / "entry.json"), "w", encoding="utf-8") as fh:
        json.dump({**data, "project": "크레인 연구"}, fh, ensure_ascii=False)
    codes = (w["indep"].entry_id, w["bundled"].entry_id)   # 블록 자료 폴더는 entry.json 이 없어 건너뛴다
    from app import database
    db.rollback()
    database.Base.metadata.drop_all(database.engine)
    database.Base.metadata.create_all(database.engine)
    db.expunge_all()
    r = rebuild(db, storage, force=True)
    assert r["entries"] == 2 and r["report_meta"] == 1 and r["report_links"] == 1 and r["report_unresolved"] == 0
    indep = db.query(models.Entry).filter_by(entry_id=codes[0]).one()
    assert db.query(models.Tag).filter_by(kind="project").count() == 0
    rep = db.query(models.File).filter_by(entry_id=indep.id, kind="report").one()
    assert db.get(models.ReportMeta, rep.id).document_type == "연구 보고서"
    link = db.query(models.ReportModelLink).one()
    model = db.get(models.File, link.model_file_id)
    assert link.report_file_id == rep.id and model.rel_path == "model.bdf"
    assert db.get(models.Entry, model.entry_id).entry_id == codes[1]


def test_restore_reports_skips_replaced_content(db, world):
    w = world
    pending = [(w["indep"].entry_id, [{"rel_path": "연구.pdf", "sha256": "다른내용", "document_type": "지침"},
                                      {"rel_path": "연구.pdf", "sha256": w["only"].sha256, "document_type": "지침",
                                       "models": [{"entry_id": w["bundled"].entry_id, "rel_path": "model.bdf",
                                                   "sha256": "다른모델"}]}])]
    r = report_catalog.restore_reports(db, pending)
    assert r == {"report_meta": 1, "report_links": 0, "report_unresolved": 2}


# ---- 예전 sidecar 이전 ----

def _sidecar(storage, entry, reports):
    folder = entry_dir(storage, entry)
    with open(to_long(folder / "report-catalog.json"), "w", encoding="utf-8") as fh:
        json.dump({"format": 1, "reports": reports, "history": []}, fh, ensure_ascii=False)
    with open(to_long(folder / "report-catalog.lock"), "wb") as fh:
        fh.write(b"0")
    return folder


def test_migrate_sidecar_dry_run_then_apply(db, storage, world, make_entry_file):
    """예전 'project' 소속 보고서는 공통 참고자료처럼 '호선 없음(공용)'으로 옮긴다(29 — 프로젝트 이름은 옮기지 않는다)."""
    w = world
    folder = _sidecar(storage, w["indep"], {"연구.pdf": {
        "scope": "project", "project": " 크레인  연구", "document_type": "연구 보고서", "version": 3,
        "sha256": w["only"].sha256, "updated_by": "A100001", "updated_at": "2026-10-12T10:00:00",
        "models": [{"entry_id": w["bundled"].entry_id, "rel_path": "model.bdf", "sha256": w["model"].sha256}]}})
    out = io.StringIO()
    plan = cli.report_catalog_migrate(db, storage, out=out)
    assert not plan["applied"] and plan["entries"][0]["no_hull"] is True and "project" not in plan["entries"][0]
    assert db.query(models.ReportMeta).count() == 0 and not db.get(models.Entry, w["indep"].id).no_hull
    assert os.path.exists(to_long(folder / "report-catalog.json"))
    assert "아무것도 바꾸지 않았습니다" in out.getvalue()
    plan = cli.report_catalog_migrate(db, storage, apply=True, out=io.StringIO())
    assert (plan["meta"], plan["links"], plan["no_hull"], plan["renamed"]) == (1, 1, 1, 1)
    db.expire_all()
    assert db.get(models.Entry, w["indep"].id).no_hull is True
    assert db.query(models.Tag).filter_by(kind="project").count() == 0
    meta = db.get(models.ReportMeta, w["only"].id)
    assert (meta.document_type, meta.version) == ("연구 보고서", 3)
    assert db.query(models.ReportModelLink).one().model_file_id == w["model"].id
    assert not os.path.exists(to_long(folder / "report-catalog.json"))
    assert os.path.exists(to_long(folder / "report-catalog.migrated.json"))
    assert not os.path.exists(to_long(folder / "report-catalog.lock"))
    actions = {a.action for a in db.query(models.AuditLog)}
    assert {"ENTRY_UPDATE", "REPORT_META", "REPORT_LINKS"} <= actions
    # 다시 돌려도 바뀌는 것이 없다(sidecar 이름이 바뀌어 대상이 없다)
    again = cli.report_catalog_migrate(db, storage, apply=True, out=io.StringIO())
    assert again["entries"] == [] and again["meta"] == 0


def test_migrate_skips_stale_reports(db, storage, world, make_entry_file):
    w = world
    _e, second = make_entry_file(entry=w["indep"], name="둘째.pdf", kind="report")
    _sidecar(storage, w["indep"], {
        "연구.pdf": {"scope": "project", "project": "A 연구", "document_type": "지침", "version": 1,
                    "sha256": w["only"].sha256, "models": []},
        "둘째.pdf": {"scope": "project", "project": "B 연구", "document_type": "", "version": 1,
                    "sha256": second.sha256, "models": []},
        "사라진.pdf": {"scope": "reference", "project": "", "document_type": "기타", "version": 1,
                     "sha256": "x", "models": []}})
    plan = cli.report_catalog_migrate(db, storage, apply=True, out=io.StringIO())
    assert plan["stale"] == [{"entry_id": w["indep"].entry_id, "report": "사라진.pdf"}]
    db.expire_all()
    assert db.get(models.ReportMeta, w["only"].id).document_type == "지침"


def test_migrate_reference_scope_sets_no_hull(db, storage, world):
    w = world
    _sidecar(storage, w["indep"], {"연구.pdf": {"scope": "reference", "project": "", "document_type": "",
                                               "version": 1, "sha256": w["only"].sha256, "models": []}})
    plan = cli.report_catalog_migrate(db, storage, apply=True, out=io.StringIO())
    assert plan["no_hull"] == 1
    db.expire_all()
    assert db.get(models.Entry, w["indep"].id).no_hull is True


def test_cli_parser_has_migrate_command(capsys):
    with pytest.raises(SystemExit):
        cli.main(["report-catalog-migrate", "--help"])
    assert "--apply" in capsys.readouterr().out
