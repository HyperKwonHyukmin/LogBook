"""68 2단계 — 과제 정보(entry_tasks): 고치기, 검사, 응답, entry.json, 재구축, 검색, 나누기와 합치기."""
import json

from app import models
from app.entries.files import entry_dir

OWNER = "U681001"
TASK = {"request_no": " 2026-[C2026027]-01 ", "category": "공정공법 개선", "request_dept": "운항관제부",
        "requester": "이범석 책임", "key_point": "구조 안전성 검토", "purpose": "신제품 개발", "criteria": "자체 평가",
        "effect_note": "공수 절감", "started_on": "2026-01-01", "finished_on": "2026-05-29"}


def _patch(client, h, eid, body):
    cur = client.get(f"/api/entries/{eid}", headers=h).json()
    return client.patch(f"/api/entries/{eid}", json={"version": cur["version"], **body}, headers=h)


def test_task_patch_response_audit_and_entry_json(make_user, make_entry_file, client, auth_headers, db, storage):
    make_user(OWNER, level=2)
    e, _ = make_entry_file(title="서비스타워 검토", name="r.pdf", uploaded_by=OWNER)
    h = auth_headers(OWNER)
    r = _patch(client, h, e.entry_id, {"task": TASK})
    assert r.status_code == 200, r.text
    t = r.json()["task"]
    assert t["request_no"] == "2026-[C2026027]-01" and t["started_on"] == "2026-01-01" and "task_key" not in t
    db.expire_all()
    row = db.query(models.AuditLog).filter_by(action="ENTRY_UPDATE", target_id=e.entry_id).one()
    assert row.after["task"]["category"] == "공정공법 개선" and "task" not in (row.before or {})
    meta = json.loads((entry_dir(storage, db.get(models.Entry, e.id)) / "entry.json").read_text(encoding="utf-8"))
    assert meta["task"]["request_dept"] == "운항관제부"
    info = (entry_dir(storage, db.get(models.Entry, e.id)) / "_INFO.txt").read_text(encoding="utf-8")
    assert "과제: 2026-[C2026027]-01, 공정공법 개선, 운항관제부" in info
    # 검사 — 목록 밖 Category, 거꾸로 된 날짜
    assert _patch(client, h, e.entry_id, {"task": {"category": "없는 분류"}}).json()["detail"] == "task_invalid_category"
    assert _patch(client, h, e.entry_id, {"task": {"started_on": "2026-05-01", "finished_on": "2026-01-01"}}).json()[
        "detail"] == "task_dates_reversed"
    # 모두 비우면 행이 없어진다
    r = _patch(client, h, e.entry_id, {"task": {}})
    assert r.status_code == 200 and r.json()["task"] is None
    assert db.query(models.EntryTask).count() == 0


def test_task_options_and_search(make_user, make_entry_file, client, auth_headers, db):
    make_user(OWNER, level=2)
    e, _ = make_entry_file(title="골리앗 크레인", name="r.pdf", uploaded_by=OWNER)
    h = auth_headers(OWNER)
    assert _patch(client, h, e.entry_id, {"task": {**TASK, "request_dept": "새로운부서"}}).status_code == 200
    opt = client.get("/api/tasks/options", headers=h).json()
    assert len(opt["categories"]) == 6 and "새로운부서" in opt["departments"] and "운항관제부" in opt["departments"]
    items = client.get("/api/search", params={"q": "신제품 개발"}, headers=h).json()["items"]
    assert [i["entry_id"] for i in items] == [e.entry_id]


def test_task_merge_moves_or_keeps_and_split_keeps(make_user, client, auth_headers, db, setup_entry_with_files):
    make_user(OWNER, level=2)
    b, a = setup_entry_with_files(uploader=OWNER, rels=("p/a.bdf", "q/b.pdf"))
    b.state = "processed"
    db.commit()
    h = auth_headers(OWNER)
    assert _patch(client, h, a.entry_id, {"task": TASK}).status_code == 200
    # 나누기: 과제 정보는 원래 초안에 남는다
    f = db.query(models.File).filter_by(entry_id=a.id, rel_path="q/b.pdf").one()
    new = client.post(f"/api/entries/{a.entry_id}/split", json={"file_ids": [f.id]}, headers=h).json()
    assert new["task"] is None
    # 합치기(a 를 new 로): new 에 없으니 옮긴다
    r = client.post(f"/api/entries/{new['entry_id']}/merge", json={"from_entry_id": a.entry_id}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["task"]["request_no"] == "2026-[C2026027]-01"
    db.expire_all()
    assert db.query(models.EntryTask).count() == 1
    assert db.query(models.AuditLog).filter_by(action="ENTRY_TASK", target_id=new["entry_id"]).one().after["moved"] is True


def test_rebuild_restores_task(make_user, make_entry_file, client, auth_headers, db, storage):
    from app.ops.rebuild import _restore_entry

    make_user(OWNER, level=2)
    e, _ = make_entry_file(title="재구축 시험", name="r.pdf", uploaded_by=OWNER)
    h = auth_headers(OWNER)
    assert _patch(client, h, e.entry_id, {"task": TASK}).status_code == 200
    db.expire_all()
    meta = json.loads((entry_dir(storage, db.get(models.Entry, e.id)) / "entry.json").read_text(encoding="utf-8"))
    meta["task"]["task_key"] = "2026-[C2026027]-01"
    db.query(models.EntryTask).delete()
    db.query(models.AuditLog).delete()
    for m in (models.EntryTag, models.EntryHull, models.File):
        db.query(m).delete()
    db.query(models.Entry).delete()
    db.commit()
    b = db.query(models.Batch).first()
    _restore_entry(db, storage, meta, status="confirmed", vault_rel=meta.get("vault_rel") or "2026/" + e.entry_id,
                   trash_rel=None, location="vault", batch=b, files_root="")
    db.commit()
    row = db.get(models.EntryTask, int(e.entry_id[1:]))
    assert row is not None and row.category == "공정공법 개선" and row.task_key == "2026-[C2026027]-01"


def test_options_hide_departments_of_unseen_entries(make_user, make_entry_file, client, auth_headers, db):
    """Codex 검토 — 볼 수 없는 자료에만 쓴 부서 이름은 자동완성에 나오지 않는다."""
    make_user(OWNER, level=2)
    make_user("G681001", level=1)
    e, _ = make_entry_file(title="블록 자료", name="r.pdf", uploaded_by=OWNER)
    assert _patch(client, auth_headers(OWNER), e.entry_id, {"task": {"request_dept": "비밀부서"}}).status_code == 200
    e2 = db.get(models.Entry, e.id)
    e2.access = "normal"
    db.commit()
    assert "비밀부서" in client.get("/api/tasks/options", headers=auth_headers(OWNER)).json()["departments"]
    assert "비밀부서" not in client.get("/api/tasks/options", headers=auth_headers("G681001")).json()["departments"]


def test_merge_both_tasks_keeps_target_and_audits_dropped(make_user, client, auth_headers, db, setup_entry_with_files):
    make_user(OWNER, level=2)
    b, a = setup_entry_with_files(uploader=OWNER, rels=("p/a.bdf", "q/b.pdf"))
    b.state = "processed"
    db.commit()
    h = auth_headers(OWNER)
    f = db.query(models.File).filter_by(entry_id=a.id, rel_path="q/b.pdf").one()
    new = client.post(f"/api/entries/{a.entry_id}/split", json={"file_ids": [f.id]}, headers=h).json()
    assert _patch(client, h, a.entry_id, {"task": {"request_no": "KEEP"}}).status_code == 200
    assert _patch(client, h, new["entry_id"], {"task": {"request_no": "DROP"}}).status_code == 200
    r = client.post(f"/api/entries/{a.entry_id}/merge", json={"from_entry_id": new["entry_id"]}, headers=h)
    assert r.status_code == 200 and r.json()["task"]["request_no"] == "KEEP"
    db.expire_all()
    row = db.query(models.AuditLog).filter_by(action="ENTRY_TASK", target_id=a.entry_id).one()
    assert row.after["dropped"]["request_no"] == "DROP" and row.after["moved"] is False
    assert db.query(models.EntryTask).count() == 1


def test_restore_key_only_row_and_duplicate_key_skips_task_only(make_user, make_entry_file, db, storage):
    from app.entries import tasks

    make_user(OWNER, level=2)
    a, _ = make_entry_file(title="열쇠만", name="a.pdf", uploaded_by=OWNER)
    tasks.restore(db, a, {"task_key": "2026-#18"})
    db.commit()
    assert db.get(models.EntryTask, a.id).task_key == "2026-#18"
    b, _ = make_entry_file(title="겹친 열쇠", name="b.pdf", uploaded_by=OWNER)
    sp = db.begin_nested()
    try:
        tasks.restore(db, b, {"task_key": "2026-#18", "request_no": "X"})
        sp.commit()
        raise AssertionError("고유 제약이 막아야 한다")
    except AssertionError:
        raise
    except Exception:   # noqa: BLE001
        sp.rollback()
    db.commit()
    assert db.get(models.EntryTask, b.id) is None and db.get(models.Entry, b.id) is not None
