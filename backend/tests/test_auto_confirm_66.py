"""66 — '올리고 바로 확정': 폴더 올리기 창의 체크 칸. 정리가 끝나면 사람이 볼 것이 없는 초안은 곧바로 확정하고,
나머지(같은 파일이 이미 있음 등)는 올리기와 확정에 남긴다. 결과는 묶음 auto_result 로 화면의 단계 표시에 쓴다."""
from app import models
from app.entries import service as entry_service
from app.ingest.process import process_batch


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def _batch(db, key, *, auto=True, split=True):
    b = models.Batch(key=key, source="web", original_name="2025", uploader="A100001", split_top=split,
                     preset={"skip_hint": True, **({"auto_confirm": True} if auto else {})})
    db.add(b)
    db.commit()
    return b


def test_begin_stores_auto_confirm_only_for_new_drafts(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    r = client.post("/api/uploads", headers=h, json={"name": "x", "preset": {"zones": []}, "auto_confirm": True})
    db.expire_all()
    assert db.query(models.Batch).filter_by(key=r.json()["key"]).one().preset == {"skip_hint": True, "auto_confirm": True}
    # 기존 자료에 파일 추가에는 쓰지 않는다
    e, _ = make_entry_file(uploaded_by="A100001")
    r = client.post("/api/uploads", headers=h, json={"name": "y", "target_entry_id": e.entry_id, "auto_confirm": True})
    db.expire_all()
    assert db.query(models.Batch).filter_by(key=r.json()["key"]).one().preset is None


def test_clean_drafts_confirmed_others_kept(client, db, storage, make_user, auth_headers):
    make_user("A100001")
    # 먼저 확정된 자료에 보고서 한 벌(같은 파일을 다시 올리면 사람이 봐야 한다)
    first = _batch(db, "20261120-000000-aaaa", auto=False, split=False)
    _write(storage.staging / first.key / "old" / "보고서.pdf", b"%PDF same")
    process_batch(db, storage, first)
    db.expire_all()
    [old] = db.query(models.Entry).filter_by(batch_id=first.id).all()
    entry_service.confirm(db, storage, old, db.query(models.User).filter_by(employee_id="A100001").one())

    b = _batch(db, "20261120-000000-bbbb")
    root = storage.staging / b.key / "2025"
    _write(root / "clean" / "model.bdf", b"GRID 1")
    _write(root / "again" / "보고서.pdf", b"%PDF same")
    process_batch(db, storage, b)
    db.expire_all()
    b = db.get(models.Batch, b.id)
    by_title = {e.title: e for e in db.query(models.Entry).filter_by(batch_id=b.id)}
    clean = next(e for t, e in by_title.items() if "clean" in t)
    again = next(e for t, e in by_title.items() if "again" in t)
    assert clean.status == "confirmed" and again.status == "draft"
    assert b.state == "processed"   # 남은 초안이 있어 묶음은 열려 있다
    assert b.preset["auto_result"] == {"confirmed": [clean.entry_id],
                                       "kept": [{"entry_id": again.entry_id, "reason": "같은 파일이 이미 있음"}]}
    # 확정은 올린 사람 이름으로(감사 기록)
    assert db.query(models.AuditLog).filter_by(action="ENTRY_CONFIRM", target_id=clean.entry_id,
                                               employee_id="A100001").count() == 1

    [row] = [x for x in client.get("/api/batches", headers=auth_headers("A100001")).json() if x["key"] == b.key]
    assert row["auto_confirm"] is True and row["auto_result"]["confirmed"] == [clean.entry_id]


def test_all_confirmed_batch_done_but_listed(client, db, storage, make_user, auth_headers):
    make_user("A100001")
    b = _batch(db, "20261120-000000-cccc")
    _write(storage.staging / b.key / "2025" / "p1" / "a.bdf", b"GRID 9")
    process_batch(db, storage, b)
    db.expire_all()
    b = db.get(models.Batch, b.id)
    assert b.state == "done" and len(b.preset["auto_result"]["confirmed"]) == 1
    rows = client.get("/api/batches", headers=auth_headers("A100001")).json()
    assert [x["key"] for x in rows] == [b.key] and rows[0]["entries"] == []


def test_without_flag_nothing_confirmed(db, storage, make_user):
    make_user("A100001")
    b = _batch(db, "20261120-000000-dddd", auto=False)
    _write(storage.staging / b.key / "2025" / "p1" / "a.bdf", b"GRID 8")
    process_batch(db, storage, b)
    db.expire_all()
    assert {e.status for e in db.query(models.Entry).filter_by(batch_id=b.id)} == {"draft"}
    assert "auto_result" not in (db.get(models.Batch, b.id).preset or {})
