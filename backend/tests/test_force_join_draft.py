"""2026-11-20 — LV3 '그래도 올리기'는 처음 묶음의 초안에 붙는다(사용자 신고: 폴더 하나를 올렸는데 초안 2건).

처음 올리기에서 동일 BDF 가 막히고 나머지(보고서 등)만 초안이 된 뒤, 막힌 BDF 를 force 로 다시 보내면
시작 요청의 join_batch 로 처음 묶음을 알려 주고, 정리 때 그 묶음의 초안에 파일이 합쳐진다. 확정 재검사도 다시 막지 않는다.
"""
from app import models
from app.entries.service import auto_merge_batch
from app.ingest.process import process_batch

from tests.test_duplicate_block_17 import OCTET, deck, existing  # noqa: F401 — fixture 재사용


def _upload(client, h, files, *, force=False, join=None):
    body = {"name": "3252_SKID", "target_entry_id": None}
    if join:
        body["join_batch"] = join
    r = client.post("/api/uploads", json=body, headers=h)
    assert r.status_code == 201, r.text
    key = r.json()["key"]
    for rel, data in files.items():
        r = client.put(f"/api/uploads/{key}/chunk", params={"path": rel, "offset": 0}, content=data,
                       headers={**h, **OCTET})
        assert r.status_code == 200, r.text
    r = client.post(f"/api/uploads/{key}/finish", headers=h, json={
        "files": [{"rel_path": rel, "size": len(d)} for rel, d in files.items()], "rejected": [], "force": force})
    assert r.status_code == 200, r.text
    return key


def _process(db, storage, key):
    batch = db.query(models.Batch).filter_by(key=key).one()
    process_batch(db, storage, batch)
    auto_merge_batch(db, storage, batch)   # 워커와 같은 순서
    db.expire_all()
    return db.query(models.Batch).filter_by(key=key).one()


def test_force_upload_joins_first_draft_and_confirms(client, db, storage, make_user, auth_headers, existing):
    make_user("C300001", level=3)
    existing(deck())
    h = auth_headers("C300001")
    first = _upload(client, h, {"3252_SKID/model/dup.bdf": deck(), "3252_SKID/보고서/r.txt": b"report"})
    b1 = _process(db, storage, first)
    [draft] = db.query(models.Entry).filter_by(batch_id=b1.id, status="draft").all()
    assert sorted(f.name for f in db.query(models.File).filter_by(entry_id=draft.id)) == ["r.txt"]

    second = _upload(client, h, {"3252_SKID/model/dup.bdf": deck()}, force=True, join=first)
    b2 = _process(db, storage, second)
    assert b2.state == "done"   # 붙이고 끝남 — 올리기와 확정에 두 번째 초안이 없다
    assert db.query(models.Entry).filter_by(batch_id=b2.id).count() == 0
    files = db.query(models.File).filter_by(entry_id=draft.id).all()
    assert sorted(f.rel_path for f in files) == ["3252_SKID/model/dup.bdf", "3252_SKID/보고서/r.txt"]
    db.refresh(b1)
    assert b1.allow_duplicates is True
    # 확정 재검사(동일 BDF)가 다시 막지 않는다
    r = client.post(f"/api/entries/{draft.entry_id}/confirm", headers=h)
    assert r.status_code == 200, r.text


def test_join_ignored_for_other_uploader_batch(client, db, storage, make_user, auth_headers, existing):
    make_user("C300001", level=3)
    make_user("A100001")
    existing(deck())
    other = _upload(client, auth_headers("A100001"), {"9999_새/r.txt": b"report"})
    _process(db, storage, other)
    mine = _upload(client, auth_headers("C300001"), {"9999_새/dup.bdf": deck()}, force=True, join=other)
    b = _process(db, storage, mine)
    assert b.target_entry_id is None and b.state == "processed"   # 남의 묶음에는 붙지 않고 따로 초안
    assert db.query(models.Entry).filter_by(batch_id=b.id, status="draft").count() == 1
