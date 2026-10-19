"""37 — 확정 자료에서 파일 하나씩 빼기·되돌리기."""
import json
from datetime import datetime

import pytest
from fastapi import HTTPException

from app import models
from app.entries import service
from app.ops.verify import verify


def _confirmed(db, storage, make_user, setup_entry_with_files, rels=None):
    u = make_user("A100001")
    _, e = setup_entry_with_files(**({"rels": rels} if rels else {}))
    service.confirm(db, storage, e, u)
    db.expire_all()
    return u, db.get(models.Entry, e.id)


def _base(storage, e):
    return storage.vault / str(datetime.now().year) / e.entry_id


def test_remove_moves_to_trash_and_detaches(db, storage, make_user, setup_entry_with_files):
    u, e = _confirmed(db, storage, make_user, setup_entry_with_files)
    pdf = db.query(models.File).filter_by(entry_id=e.id, name="r.pdf").one()
    v = e.version
    service.remove_files(db, storage, e, u, [pdf.id], v)
    db.expire_all()
    f = db.get(models.File, pdf.id)
    assert (f.entry_id, f.location, f.removed_from_id) == (None, "trash", e.id)
    assert (storage.trash / f.trash_rel / "3496_검토" / "r.pdf").is_file()
    assert not (_base(storage, e) / "files" / "3496_검토" / "r.pdf").exists()
    e = db.get(models.Entry, e.id)
    assert e.version == v + 1
    d = service.entry_to_dict(db, e, viewer=u)
    assert [x["name"] for x in d["files"]] == ["a.bdf"]
    assert [x["id"] for x in d["removed_files"]] == [pdf.id]
    meta = json.loads((_base(storage, e) / "entry.json").read_text(encoding="utf-8"))
    assert [x["rel_path"] for x in meta["files"]] == ["3496_검토/model/a.bdf"]
    log = db.query(models.AuditLog).filter_by(action="ENTRY_FILES_REMOVED").one()
    assert log.target_id == e.entry_id
    # 운영 점검 — 뺀 파일의 자리를 알고, 그 휴지통 폴더를 '주인 없는 폴더'로 보지 않는다
    r = verify(db, storage)
    assert not r["missing"] and not r["orphan_trash"]


def test_restore_puts_file_back(db, storage, make_user, setup_entry_with_files):
    u, e = _confirmed(db, storage, make_user, setup_entry_with_files)
    pdf = db.query(models.File).filter_by(entry_id=e.id, name="r.pdf").one()
    service.remove_files(db, storage, e, u, [pdf.id], e.version)
    service.restore_files(db, storage, db.get(models.Entry, e.id), u, [pdf.id])
    db.expire_all()
    f = db.get(models.File, pdf.id)
    assert (f.entry_id, f.location, f.removed_from_id, f.trash_rel) == (e.id, "vault", None, None)
    assert (_base(storage, e) / "files" / "3496_검토" / "r.pdf").is_file()
    assert db.query(models.AuditLog).filter_by(action="ENTRY_FILES_RESTORED").count() == 1


def test_restore_renames_when_name_taken(db, storage, make_user, setup_entry_with_files):
    u, e = _confirmed(db, storage, make_user, setup_entry_with_files)
    pdf = db.query(models.File).filter_by(entry_id=e.id, name="r.pdf").one()
    service.remove_files(db, storage, e, u, [pdf.id], e.version)
    # 그 사이 같은 이름의 파일이 새로 들어왔다
    (_base(storage, e) / "files" / "3496_검토" / "r.pdf").write_bytes(b"new")
    service.restore_files(db, storage, db.get(models.Entry, e.id), u, [pdf.id])
    db.expire_all()
    assert db.get(models.File, pdf.id).rel_path == "3496_검토/r (2).pdf"


def test_rules(db, storage, make_user, setup_entry_with_files):
    u, e = _confirmed(db, storage, make_user, setup_entry_with_files)
    ids = [f.id for f in db.query(models.File).filter_by(entry_id=e.id)]
    with pytest.raises(HTTPException) as ei:      # 마지막 파일까지 뺄 수는 없다(자료를 휴지통으로)
        service.remove_files(db, storage, e, u, ids, e.version)
    assert ei.value.detail == "last_file"
    with pytest.raises(HTTPException) as ei:
        service.remove_files(db, storage, db.get(models.Entry, e.id), u, ids[:1], e.version - 1)
    assert ei.value.detail == "version_conflict"
    with pytest.raises(HTTPException) as ei:
        service.remove_files(db, storage, db.get(models.Entry, e.id), u, [999999], None)
    assert ei.value.status_code == 404
    other = make_user("B200002")
    with pytest.raises(HTTPException) as ei:
        service.remove_files(db, storage, db.get(models.Entry, e.id), other, ids[:1], None)
    assert ei.value.status_code == 403


def test_api_remove_and_restore(client, db, storage, make_user, auth_headers, setup_entry_with_files):
    _u, e = _confirmed(db, storage, make_user, setup_entry_with_files)
    h = auth_headers("A100001")
    got = client.get(f"/api/entries/{e.entry_id}", headers=h).json()
    pdf = next(f for f in got["files"] if f["name"] == "r.pdf")
    res = client.post(f"/api/entries/{e.entry_id}/files/remove", headers=h,
                      json={"file_ids": [pdf["id"]], "version": got["version"]})
    assert res.status_code == 200
    body = res.json()
    assert [f["id"] for f in body["files"]] != [pdf["id"]] and len(body["files"]) == 1
    assert [f["id"] for f in body["removed_files"]] == [pdf["id"]]
    hist = client.get(f"/api/entries/{e.entry_id}/history", headers=h).json()
    assert hist[0]["action"] == "ENTRY_FILES_REMOVED"
    res = client.post(f"/api/entries/{e.entry_id}/files/restore", headers=h, json={"file_ids": [pdf["id"]]})
    assert res.status_code == 200 and len(res.json()["files"]) == 2 and res.json()["removed_files"] == []


def _removed(db, storage, make_user, setup_entry_with_files):
    u, e = _confirmed(db, storage, make_user, setup_entry_with_files)
    pdf = db.query(models.File).filter_by(entry_id=e.id, name="r.pdf").one()
    service.remove_files(db, storage, e, u, [pdf.id], e.version)
    db.expire_all()
    return u, db.get(models.Entry, e.id), db.get(models.File, pdf.id)


def test_purge_removed_files_after_days(db, storage, make_user, setup_entry_with_files):
    from datetime import timedelta

    from app.ops.purge import purge_removed_files

    u, e, f = _removed(db, storage, make_user, setup_entry_with_files)
    fid, rel = f.id, f.trash_rel
    # 아직 기간 안 — 그대로
    assert purge_removed_files(db, storage, 90) == 0
    assert (storage.trash / rel).is_dir()
    # 91일 뒤 — 폴더·행이 지워지고 자료는 그대로
    assert purge_removed_files(db, storage, 90, datetime.now() + timedelta(days=91)) == 1
    db.expire_all()
    assert db.get(models.File, fid) is None
    assert not (storage.trash / rel).exists()
    e = db.get(models.Entry, e.id)
    assert e.status == "confirmed" and [x["name"] for x in service.entry_to_dict(db, e, viewer=u)["files"]] == ["a.bdf"]
    assert service.entry_to_dict(db, e, viewer=u)["removed_files"] == []
    log = db.query(models.AuditLog).filter_by(action="FILES_PURGE").one()
    assert log.target_id == e.entry_id
    r = verify(db, storage)
    assert not r["missing"] and not r["orphan_trash"]


def test_purge_entry_takes_removed_files(db, storage, make_user, setup_entry_with_files):
    from app.ops.purge import purge_entry

    u, e, f = _removed(db, storage, make_user, setup_entry_with_files)
    fid, rel, pk = f.id, f.trash_rel, e.id
    service.trash(db, storage, e, u)
    db.expire_all()
    purge_entry(db, storage, db.get(models.Entry, pk), "A100001")
    db.expire_all()
    assert db.get(models.Entry, pk) is None and db.get(models.File, fid) is None
    assert not (storage.trash / rel).exists()
    log = db.query(models.AuditLog).filter_by(action="TRASH_PURGE").one()
    assert log.before["removed_files"] == 1
