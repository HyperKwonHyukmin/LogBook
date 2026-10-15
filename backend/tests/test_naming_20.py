"""20 — 자료 이름·필수 분류 정비: 제목 형식(순수 함수), 확정 필수값(BDF 유/무·공용 호선), 수신함 제목 따라가기,
비슷한 제목 경고, 자료 정비 API(목록·미리보기·적용·되돌리기·권한·감사), CLI naming-cleanup, 검색 표시·공용 묶음, entry.json."""
import io
import json

import pytest
from fastapi import HTTPException

from app import cli, models
from app.entries import naming, quality, service
from app.storage.paths import to_long


# ---- 제목 형식(순수 함수) ----

@pytest.mark.parametrize("source, hulls, phrases, expected", [
    ("3496_선수부_권상해석_M04_rev3_final", ["3496"], ["선수부", "권상 해석"], "M04 rev3"),
    ("3496-M04 rev3 (최종)", ["3496"], [], "M04 rev3"),
    ("H3496_ER_강도평가_copy", ["3496"], ["기관실", "ER", "강도 평가"], ""),
    ("3496_Engine_Room_FEM_v1.2", ["3496"], ["Engine Room", "FE 해석", "FEM"], "v1.2"),
    ("3496_3497_비교검토", ["3496", "3497"], [], "비교검토"),
    ("3496_권상_검토", ["3496"], ["권상 해석"], "검토"),          # 2글자 이상 앞부분 일치(권상 ↔ 권상 해석)
    ("2026_3496_선수", ["3496"], [], "2026 선수"),               # 고르지 않은 값은 지우지 않는다
    ("3497_검토", ["3496"], [], "3497 검토"),                    # 다른 호선 번호는 구별자로 남긴다
    ("", ["3496"], [], ""),
])
def test_distinct_part(source, hulls, phrases, expected):
    assert naming.distinct_part(source, hulls=hulls, phrases=phrases) == expected


def test_compose_title_rules():
    c = naming.compose_title
    assert c(hulls=["3496"], zones=["선수부"], analysis_type="권상 해석", distinct="M04 rev3") == "3496 · 선수부 · 권상 해석 · M04 rev3"
    assert c(hulls=["3496", "3497", "3498"], zones=["선수부", "선미부"]) == "3496 외 2 · 선수부 외 1"
    assert c(no_hull=True, zones=["기관실"], analysis_type="FE 해석") == "공용 · 기관실 · FE 해석"
    assert c(analysis_type="FE 해석", distinct="x") == "FE 해석 · x"
    assert c(distinct="x") == ""                                  # 값이 하나도 없으면 '' — 예전 방식으로
    assert naming.title_draft("3496_검토_v1.2", hulls=[]) == "3496 검토 v1.2"   # 예전 규칙 그대로
    assert naming.title_draft("3496_검토", hulls=["3496"]) == "3496 · 검토"


def test_source_from_files():
    assert naming.source_from_files(["3496_검토/model/a.bdf", "3496_검토/r.pdf"]) == "3496_검토"
    assert naming.source_from_files(["a/x.bdf", "b/y.pdf"]) == "x"
    assert naming.source_from_files(["3496_M04.bdf"]) == "3496_M04"
    assert naming.source_from_files([]) == ""


# ---- 확정 필수값 ----

def test_confirm_bdf_requires_hull_zone_type(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    _b, e = setup_entry_with_files()
    e.analysis_type = None
    service.set_zones(db, e, [])
    db.query(models.EntryHull).filter_by(entry_id=e.id).delete()
    db.commit()
    with pytest.raises(HTTPException) as ei:
        service.confirm(db, storage, e, u)
    assert ei.value.status_code == 409
    assert ei.value.detail == {"code": "required_fields", "missing": ["hull", "zone", "analysis_type"]}
    db.rollback()
    assert db.get(models.Entry, e.id).status == "draft"


def test_confirm_shared_model_without_hull(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    _b, e = setup_entry_with_files()
    service.update_entry(db, storage, e, u, {"version": e.version, "no_hull": True})
    db.expire_all()
    e = db.get(models.Entry, e.id)
    assert e.no_hull and service.hulls_of(db, e) == []
    service.confirm(db, storage, e, u)
    db.expire_all()
    assert db.get(models.Entry, e.id).status == "confirmed"


def test_confirm_without_bdf_only_needs_title(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    _b, e = setup_entry_with_files(rels=("3496_검토/r.pdf",))
    db.query(models.File).filter_by(entry_id=e.id).update({"kind": "report"})
    e.analysis_type = None
    service.set_zones(db, e, [])
    db.commit()
    service.confirm(db, storage, e, u)
    db.expire_all()
    assert db.get(models.Entry, e.id).status == "confirmed"


def test_confirm_api_required_fields_shape(client, auth_headers, db, make_user, setup_entry_with_files):
    make_user("A100001")
    _b, e = setup_entry_with_files()
    service.set_zones(db, e, [])
    db.commit()
    h = auth_headers("A100001")
    d = client.get(f"/api/entries/{e.entry_id}", headers=h).json()
    assert d["required_missing"] == ["zone"]
    r = client.post(f"/api/entries/{e.entry_id}/confirm", headers=h)
    assert r.status_code == 409
    assert r.json()["detail"] == {"code": "required_fields", "missing": ["zone"]}


def test_merge_into_existing_skips_required(db, storage, make_user, setup_entry_with_files, make_entry_file):
    """[파일 추가]·기존 자료에 합치기는 대상 자료의 분류를 따른다 — 초안의 빈 칸으로 막지 않는다."""
    u = make_user("A100001")
    target, _f = make_entry_file(title="기존", hulls=("3496",), name="old.pdf")
    _b, e = setup_entry_with_files(key="20260929-000000-cccc")
    e.analysis_type = None
    service.set_zones(db, e, [])
    e.merge_into_id = target.id
    db.commit()
    out = service.confirm(db, storage, e, u)
    assert out.id == target.id


def test_no_hull_with_hulls_rejected(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    _b, e = setup_entry_with_files()
    with pytest.raises(HTTPException) as ei:
        service.update_entry(db, storage, e, u, {"version": e.version, "no_hull": True, "hulls": ["3496"]})
    assert ei.value.detail == "no_hull_with_hulls"


def test_adding_hull_clears_no_hull(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    _b, e = setup_entry_with_files()
    e = service.update_entry(db, storage, e, u, {"version": e.version, "no_hull": True})
    e = service.update_entry(db, storage, e, u, {"version": e.version, "hulls": ["3497"]})
    db.expire_all()
    e = db.get(models.Entry, e.id)
    assert not e.no_hull and [h.hull_no for h in service.hulls_of(db, e)] == ["3497"]


# ---- 수신함 제목 따라가기 ----

def _draft(db, setup_entry_with_files, *, title="3496 · 검토", source="3496_검토"):
    _b, e = setup_entry_with_files()
    e.title, e.title_source, e.analysis_type = title, source, None
    service.set_zones(db, e, [])
    db.commit()
    return e


def test_draft_title_follows_values_until_edited(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    e = _draft(db, setup_entry_with_files)
    assert quality.TitleContext(db).is_auto(e)
    e = service.update_entry(db, storage, e, u, {"version": e.version, "zones": ["선수부"], "analysis_type": "권상 해석"})
    assert e.title == "3496 · 선수부 · 권상 해석 · 검토"
    # 사람이 제목을 고치면 그 뒤로는 따라가지 않는다
    e = service.update_entry(db, storage, e, u, {"version": e.version, "title": "내가 지은 제목"})
    e = service.update_entry(db, storage, e, u, {"version": e.version, "zones": ["선미부"]})
    assert e.title == "내가 지은 제목"
    # [형식대로 다시 만들기]
    e = service.update_entry(db, storage, e, u, {"version": e.version, "title_auto": True})
    assert e.title == "3496 · 선미부 · 권상 해석 · 검토"


def test_draft_title_and_values_in_one_save_keeps_title(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    e = _draft(db, setup_entry_with_files)
    e = service.update_entry(db, storage, e, u, {"version": e.version, "title": "직접", "zones": ["선수부"]})
    assert e.title == "직접"


def test_legacy_draft_title_counts_as_auto(db, storage, make_user, setup_entry_with_files):
    """20 이전 초안(예전 방식 제목, title_source 없음)도 사람이 고치지 않은 것으로 본다."""
    u = make_user("A100001")
    e = _draft(db, setup_entry_with_files, title="3496 검토", source=None)
    e = service.update_entry(db, storage, e, u, {"version": e.version, "zones": ["선수부"]})
    assert e.title == "3496 · 선수부 · 검토"


def test_entry_dict_title_fields(client, auth_headers, db, make_user, setup_entry_with_files):
    make_user("A100001")
    e = _draft(db, setup_entry_with_files)
    d = client.get(f"/api/entries/{e.entry_id}", headers=auth_headers("A100001")).json()
    assert d["title_draft"] == "3496 · 검토" and d["title_is_auto"] is True and d["no_hull"] is False
    r = client.patch(f"/api/entries/{e.entry_id}", headers=auth_headers("A100001"),
                     json={"version": d["version"], "analysis_type": "FE 해석"})
    assert r.status_code == 200 and r.json()["title"] == "3496 · FE 해석 · 검토"


def test_ingest_title_uses_format(db, storage):
    from app.ingest.process import process_batch

    b = models.Batch(key="20260929-000000-nm20", source="inbox", original_name="x", uploader="A100001")
    db.add(b)
    db.commit()
    p = storage.staging / b.key / "3496_M04_rev3_final" / "a.bdf"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"GRID")
    process_batch(db, storage, b)
    db.expire_all()
    [e] = db.query(models.Entry).all()
    assert e.title == "3496 · M04 rev3" and e.title_source == "3496_M04_rev3_final"
    # 원래 파일 이름은 그대로
    assert db.query(models.File).filter_by(entry_id=e.id).one().name == "a.bdf"


# ---- 비슷한 제목 경고 ----

def test_similar_entries_on_draft(client, auth_headers, db, make_user, make_entry_file, setup_entry_with_files):
    make_user("A100001")
    same, _ = make_entry_file(title="3496 · 선수부 · 강도 평가 · 검토", hulls=("3496",), name="x.pdf")
    near, _ = make_entry_file(title="3496 · 선수부 · 강도 평가 · 검토 2차", hulls=("3496",), name="y.pdf")
    make_entry_file(title="3496 · 선수부 · 강도 평가 · 검토", hulls=("3497",), name="z.pdf")   # 다른 호선
    make_entry_file(title="전혀 다른 계류", hulls=("3496",), name="w.pdf")
    _b, e = setup_entry_with_files()
    e.title = "3496 · 선수부 · 강도 평가 · 검토"
    db.commit()
    d = client.get(f"/api/entries/{e.entry_id}", headers=auth_headers("A100001")).json()
    assert [(s["entry_id"], s["match"]) for s in d["similar_entries"]] == [
        (same.entry_id, "same"), (near.entry_id, "similar")]


def test_similar_entries_hidden_when_not_visible(db, make_user, make_entry_file, setup_entry_with_files):
    viewer = make_user("A100002", level=2)
    blocked, _ = make_entry_file(title="3496 검토", hulls=("3496",), name="x.pdf")
    blocked.access = "blocked"
    _b, e = setup_entry_with_files()
    db.commit()
    assert quality.similar_entries(db, e, viewer) == []
    assert [s["entry_id"] for s in quality.similar_entries(db, e, None)] == [blocked.entry_id]


# ---- 자료 정비 API ----

def _confirmed_bdf(make_entry_file, db, *, title, hulls=("3496",), zones=(), atype=None, name="model/a.bdf",
                   uploaded_by="A100001"):
    e, f = make_entry_file(title=title, hulls=hulls, name=name, kind="model", analysis_type=atype,
                           uploaded_by=uploaded_by)
    if zones:
        service.set_zones(db, e, list(zones))
    db.commit()
    return e


def test_cleanup_missing_list_and_permissions(client, auth_headers, db, make_user, make_entry_file):
    make_user("A100001", level=2)
    make_user("C300001", level=3)
    bad = _confirmed_bdf(make_entry_file, db, title="빠짐", zones=())
    _confirmed_bdf(make_entry_file, db, title="다 있음", zones=("선수부",), atype="강도 평가")
    make_entry_file(title="보고서만", name="r.pdf", kind="report")
    assert client.get("/api/admin/cleanup/missing", headers=auth_headers("A100001")).status_code == 403
    r = client.get("/api/admin/cleanup/missing", headers=auth_headers("C300001")).json()
    assert r["total"] == 1 and r["items"][0]["entry_id"] == bad.entry_id
    assert r["items"][0]["missing"] == ["zone", "analysis_type"]
    assert r["counts"] == {"hull": 0, "zone": 1, "analysis_type": 1}
    assert client.get("/api/admin/cleanup/missing?missing=hull", headers=auth_headers("C300001")).json()["total"] == 0
    # 상태는 그대로(숨기거나 바꾸지 않는다)
    db.expire_all()
    assert db.get(models.Entry, bad.id).status == "confirmed"


def test_cleanup_title_preview_apply_and_revert(client, auth_headers, db, make_user, make_entry_file):
    make_user("C300001", level=3)
    ok = _confirmed_bdf(make_entry_file, db, title="옛 제목", zones=("선수부",), atype="강도 평가",
                        name="3496_선수부_M04_final/a.bdf")
    ok.title_source = "3496_선수부_M04_final"
    bad = _confirmed_bdf(make_entry_file, db, title="빠진 자료", zones=())
    done = _confirmed_bdf(make_entry_file, db, title="3496 · 선수부 · 강도 평가", zones=("선수부",), atype="강도 평가",
                          name="b.bdf")
    done.title_source = "3496"
    db.commit()
    h = auth_headers("C300001")
    prev = client.get("/api/admin/cleanup/titles", headers=h).json()
    by = {p["entry_id"]: p for p in prev["items"]}
    assert by[ok.entry_id]["status"] == "ready" and by[ok.entry_id]["new_title"] == "3496 · 선수부 · 강도 평가 · M04"
    assert by[bad.entry_id]["status"] == "blocked" and "구역" in by[bad.entry_id]["reason"]
    assert done.entry_id not in by                              # 이미 형식대로
    assert prev["counts"] == {"ready": 1, "blocked": 1}

    r = client.post("/api/admin/cleanup/titles/apply", headers=h, json={"items": [
        {"entry_id": ok.entry_id, "version": by[ok.entry_id]["version"], "new_title": by[ok.entry_id]["new_title"]},
        {"entry_id": bad.entry_id, "version": by[bad.entry_id]["version"]}]}).json()
    assert [a["entry_id"] for a in r["applied"]] == [ok.entry_id]
    assert r["skipped"][0]["entry_id"] == bad.entry_id and r["skipped"][0]["reason"] == "blocked"
    db.expire_all()
    e = db.get(models.Entry, ok.id)
    assert e.title == "3496 · 선수부 · 강도 평가 · M04" and e.version == by[ok.entry_id]["version"] + 1
    a = db.query(models.AuditLog).filter_by(action="ENTRY_RETITLE", target_id=ok.entry_id).one()
    assert a.before["title"] == "옛 제목" and a.after["title"] == e.title and a.employee_id == "C300001"

    applied = client.get("/api/admin/cleanup/titles/applied", headers=h).json()
    assert applied[0]["entry_id"] == ok.entry_id and applied[0]["can_revert"] is True
    r = client.post("/api/admin/cleanup/titles/revert", headers=h, json={"entry_id": ok.entry_id})
    assert r.status_code == 200 and r.json()["title"] == "옛 제목"
    assert db.query(models.AuditLog).filter_by(action="ENTRY_RETITLE_REVERT", target_id=ok.entry_id).count() == 1
    again = client.post("/api/admin/cleanup/titles/revert", headers=h, json={"entry_id": ok.entry_id})
    assert again.status_code == 409 and again.json()["detail"] == "nothing_to_revert"
    assert client.get("/api/admin/cleanup/titles/applied", headers=h).json()[0]["reverted"] is True


def test_cleanup_apply_skips_stale_preview(client, auth_headers, db, make_user, make_entry_file):
    make_user("C300001", level=3)
    e = _confirmed_bdf(make_entry_file, db, title="옛", zones=("선수부",), atype="강도 평가")
    h = auth_headers("C300001")
    r = client.post("/api/admin/cleanup/titles/apply", headers=h,
                    json={"items": [{"entry_id": e.entry_id, "version": e.version + 5}]}).json()
    assert r["applied"] == [] and r["skipped"][0]["reason"] == "version_conflict"
    r = client.post("/api/admin/cleanup/titles/apply", headers=h,
                    json={"items": [{"entry_id": e.entry_id, "version": e.version, "new_title": "다른 것"}]}).json()
    assert r["skipped"][0]["reason"] == "proposal_changed"


def test_cleanup_revert_refuses_when_title_changed_since(client, auth_headers, db, make_user, make_entry_file):
    make_user("C300001", level=3)
    e = _confirmed_bdf(make_entry_file, db, title="옛", zones=("선수부",), atype="강도 평가")
    h = auth_headers("C300001")
    client.post("/api/admin/cleanup/titles/apply", headers=h, json={"items": [{"entry_id": e.entry_id}]})
    d = client.get(f"/api/entries/{e.entry_id}", headers=h).json()
    client.patch(f"/api/entries/{e.entry_id}", headers=h, json={"version": d["version"], "title": "또 고침"})
    r = client.post("/api/admin/cleanup/titles/revert", headers=h, json={"entry_id": e.entry_id})
    assert r.status_code == 409 and r.json()["detail"] == "title_changed_since"


def test_cleanup_revert_requires_admin(client, auth_headers, make_user):
    make_user("A100001", level=2)
    r = client.post("/api/admin/cleanup/titles/revert", headers=auth_headers("A100001"), json={"entry_id": "E000001"})
    assert r.status_code == 403


# ---- CLI ----

def test_cli_naming_cleanup_dry_run_then_apply(db, storage, make_entry_file):
    e = _confirmed_bdf(make_entry_file, db, title="옛", zones=("선수부",), atype="강도 평가", name="3496_M05/a.bdf")
    bad = _confirmed_bdf(make_entry_file, db, title="빠짐", zones=())
    out = io.StringIO()
    r = cli.naming_cleanup(db, storage, apply=False, out=out)
    text = out.getvalue()
    assert r["ready"] == 1 and r["missing"] == 1 and r["applied"] == 0
    assert bad.entry_id in text and "3496 · 선수부 · 강도 평가 · M05" in text and "아무것도 바꾸지" in text
    db.expire_all()
    assert db.get(models.Entry, e.id).title == "옛"
    r = cli.naming_cleanup(db, storage, apply=True, out=io.StringIO())
    assert r["applied"] == 1
    db.expire_all()
    assert db.get(models.Entry, e.id).title == "3496 · 선수부 · 강도 평가 · M05"
    a = db.query(models.AuditLog).filter_by(action="ENTRY_RETITLE").one()
    assert a.employee_id == "system"
    # 다시 돌려도 바뀌는 것이 없다
    assert cli.naming_cleanup(db, storage, apply=True, out=io.StringIO())["applied"] == 0


def test_cli_main_naming_cleanup_parses(monkeypatch):
    called = {}
    monkeypatch.setattr(cli, "naming_cleanup", lambda db, storage, **kw: called.update(kw) or {})
    assert cli.main(["naming-cleanup", "--limit", "5"]) == 0
    assert called == {"apply": False, "limit": 5}


# ---- 검색 표시·공용 묶음·entry.json ----

def test_search_needs_fix_only_for_editor(client, auth_headers, db, make_user, make_entry_file):
    make_user("A100001", level=2)
    make_user("A100002", level=2)
    e = _confirmed_bdf(make_entry_file, db, title="빠짐", zones=())
    mine = client.get("/api/search", headers=auth_headers("A100001")).json()["items"]
    other = client.get("/api/search", headers=auth_headers("A100002")).json()["items"]
    assert [i["needs_fix"] for i in mine if i["entry_id"] == e.entry_id] == [["zone", "analysis_type"]]
    assert [i["needs_fix"] for i in other if i["entry_id"] == e.entry_id] == [[]]
    d = client.get(f"/api/entries/{e.entry_id}", headers=auth_headers("A100001")).json()
    assert d["needs_fix"] == ["zone", "analysis_type"]


def test_search_group_shared_separate_from_none(client, auth_headers, db, make_user, make_entry_file):
    make_user("A100001", level=2)
    shared, _ = make_entry_file(title="공용 모델", hulls=(), name="s.pdf")
    shared.no_hull = True
    make_entry_file(title="호선 모름", hulls=(), name="n.pdf")
    make_entry_file(title="3496 자료", hulls=("3496",), name="h.pdf")
    db.commit()
    h = auth_headers("A100001")
    res = client.get("/api/search?group=hull", headers=h).json()
    groups = [(g["value"], g["label"], g["count"]) for g in res["groups"]]
    assert groups == [("3496", None, 1), ("__shared__", "공용", 1), (None, None, 1)]
    more = client.get("/api/search?group=hull&group_value=__shared__", headers=h).json()
    assert [i["title"] for i in more["items"]] == ["공용 모델"] and more["items"][0]["no_hull"] is True


def test_entry_json_keeps_no_hull_and_title_source(db, storage, make_entry_file):
    from app.entries.files import entry_dir, write_entry_files

    e, _ = make_entry_file(title="공용", hulls=(), name="a.bdf", kind="model")
    e.no_hull, e.title_source = True, "공용_모델"
    db.commit()
    write_entry_files(db, storage, e)
    with open(to_long(entry_dir(storage, e) / "entry.json"), encoding="utf-8") as fh:
        meta = json.load(fh)
    assert meta["no_hull"] is True and meta["title_source"] == "공용_모델"
