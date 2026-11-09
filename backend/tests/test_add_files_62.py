"""62 — 확정 자료에 [파일 추가]: 똑같은 파일은 건너뛰고, 이름이 겹쳐 바뀐 파일은 배치에 남기고, 진행·결과를 응답에 싣는다."""
from app import models
from app.entries import service


def _add_draft(db, storage, first, key, files):
    """first 에 합칠 초안(배치 target_entry_id). files = [(rel, 내용, sha)]."""
    b = models.Batch(key=key, source="web", original_name="추가", uploader="A100001", state="processed",
                     target_entry_id=first.id)
    db.add(b)
    db.flush()
    d = models.Entry(title="추가", status="draft", batch_id=b.id, uploaded_by="A100001", merge_into_id=first.id)
    db.add(d)
    db.flush()
    d.entry_id = f"E{d.id:06d}"
    for rel, data, sha in files:
        p = storage.staging / key / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        db.add(models.File(batch_id=b.id, entry_id=d.id, rel_path=rel, name=p.name, ext=p.suffix,
                           kind="report", size=len(data), sha256=sha))
    db.commit()
    return b, d


def test_merge_skips_same_file_and_notes_renamed(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    _b1, first = setup_entry_with_files()      # a.bdf · r.pdf, 둘 다 sha 'a'*64
    service.confirm(db, storage, first, u)
    b, d = _add_draft(db, storage, first, "20261109-000000-addd", [
        ("3496_검토/r.pdf", b"data", "a" * 64),               # 이 자료에 이미 있는 똑같은 파일 → 건너뜀
        ("3496_검토/model/a.bdf", b"new!", "c" * 64),         # 이름만 같다 → 'a (2).bdf'
    ])
    service.confirm(db, storage, d, u)
    db.expire_all()
    names = sorted(f.rel_path for f in db.query(models.File).filter_by(entry_id=first.id))
    assert names == ["3496_검토/model/a (2).bdf", "3496_검토/model/a.bdf", "3496_검토/r.pdf"]
    skipped = db.query(models.File).filter_by(batch_id=b.id, location="trash").one()
    assert skipped.rel_path == "3496_검토/r.pdf" and skipped.entry_id is None
    assert (storage.trash / skipped.trash_rel / "3496_검토" / "r.pdf").is_file()
    notes = db.get(models.Batch, b.id).excluded
    assert {"name": "3496_검토/model/a.bdf", "to": "3496_검토/model/a (2).bdf", "reason": "renamed"} in notes
    assert {"name": "3496_검토/r.pdf", "of": "3496_검토/r.pdf", "reason": "duplicate_in_entry"} in notes
    assert db.get(models.Batch, b.id).state == "done"


def test_merge_all_same_adds_nothing(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    _b1, first = setup_entry_with_files()
    service.confirm(db, storage, first, u)
    before = db.get(models.Entry, first.id).version
    b, d = _add_draft(db, storage, first, "20261109-000000-alls", [("3496_검토/r.pdf", b"data", "a" * 64)])
    service.confirm(db, storage, d, u)
    db.expire_all()
    assert db.query(models.File).filter_by(entry_id=first.id).count() == 2
    assert db.get(models.Entry, first.id).version == before          # 아무것도 붙지 않았다
    assert db.get(models.Entry, d.id) is None and db.get(models.Batch, b.id).state == "done"
    assert db.query(models.AuditLog).filter_by(action="ENTRY_FILES_ADDED").count() == 0


def test_batch_reports_added_and_entry_reports_pending(client, db, storage, make_user, auth_headers, setup_entry_with_files):
    u = make_user("A100001")
    _b1, first = setup_entry_with_files()
    service.confirm(db, storage, first, u)
    b, d = _add_draft(db, storage, first, "20261109-000000-apis", [("3496_검토/new.pdf", b"x", "d" * 64)])
    h = auth_headers("A100001")
    # 합치기 전: 자료 응답에 '붙이는 중인 묶음'이 실린다(남에게는 보이지 않는다)
    e = client.get(f"/api/entries/{first.entry_id}", headers=h).json()
    assert e["pending_additions"] == [{"key": b.key, "state": "processed"}]
    service.confirm(db, storage, d, u)
    r = client.get(f"/api/batches/{b.key}", headers=h).json()
    assert r["state"] == "done"
    assert [a["rel_path"] for a in r["added"]] == ["3496_검토/new.pdf"]
    e = client.get(f"/api/entries/{first.entry_id}", headers=h).json()
    assert e["pending_additions"] == []
