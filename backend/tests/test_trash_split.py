import pytest
from fastapi import HTTPException

from app import models
from app.entries import service


def test_trash_and_restore_confirmed(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    other = make_user("B200002")
    _, e = setup_entry_with_files()
    service.confirm(db, storage, e, u)
    base = storage.vault / e.vault_rel.replace("/", "\\")
    service.trash(db, storage, e, other)  # 누구나 휴지통
    db.expire_all()
    e = db.get(models.Entry, e.id)
    assert e.status == "trashed" and not base.exists()
    assert (storage.trash / e.trash_rel / "entry.json").is_file()
    service.restore(db, storage, e, other)
    db.expire_all()
    e = db.get(models.Entry, e.id)
    assert e.status == "confirmed" and (base / "files").is_dir()
    actions = [a for (a,) in db.query(models.AuditLog.action)]
    assert "ENTRY_TRASH" in actions and "ENTRY_RESTORE" in actions


def test_restore_conflict(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    _, e = setup_entry_with_files()
    service.confirm(db, storage, e, u)
    service.trash(db, storage, e, u)
    (storage.vault / e.vault_rel.replace("/", "\\")).mkdir(parents=True)
    with pytest.raises(HTTPException) as ei:
        service.restore(db, storage, e, u)
    assert ei.value.detail == "vault_conflict"


def test_discard_draft_only_by_uploader(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    other = make_user("B200002")
    b, e = setup_entry_with_files()
    with pytest.raises(HTTPException):
        service.trash(db, storage, e, other)
    service.trash(db, storage, e, u)
    db.expire_all()
    assert db.get(models.Entry, e.id).status == "trashed"
    assert not any((storage.staging / b.key).rglob("*.bdf"))
    assert db.query(models.AuditLog).filter_by(action="DRAFT_DISCARD").count() == 1


def test_split_merge_and_move(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    b, e = setup_entry_with_files()
    f1, f2 = db.query(models.File).order_by(models.File.rel_path).all()
    new = service.split(db, e, u, [f2.id])
    assert new.batch_id == b.id and new.status == "draft"
    assert db.get(models.File, f2.id).entry_id == new.id
    assert [h.hull_no for h in service.hulls_of(db, new)] == ["3496"]
    service.move_file(db, db.get(models.File, f1.id), new, u)
    assert db.get(models.File, f1.id).entry_id == new.id
    service.merge(db, e, new, u)  # new 의 파일을 e 로 모두 옮기고 new 삭제
    assert db.get(models.Entry, new.id) is None
    assert {f.entry_id for f in db.query(models.File)} == {e.id}


def test_split_rejects_foreign_files(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    _, e = setup_entry_with_files()
    with pytest.raises(HTTPException) as ei:
        service.split(db, e, u, [999999])
    assert ei.value.detail == "file_not_in_entry"


def test_merge_deleting_draft_clears_dangling_references(db, storage, make_user, setup_entry_with_files):
    """merge() 가 지우는 초안(victim)을 다른 행이 참조하고 있으면(merge_into_id·
    suggested_entry_id·batches.target_entry_id) FK 위반 없이 그 참조가 먼저 비워져야 한다.
    정상 흐름에서는 잘 안 생기는 조합이지만(방어적 검증), FK 가 걸려 있어 실수로라도
    막힌 참조가 남으면 삭제 자체가 실패한다."""
    u = make_user("A100001")
    b, victim = setup_entry_with_files()
    survivor = models.Entry(title="survivor", status="draft", batch_id=b.id, uploaded_by="A100001")
    db.add(survivor)
    db.flush()
    survivor.entry_id = f"E{survivor.id:06d}"

    dangling_merge = models.Entry(title="d1", status="draft", batch_id=b.id, uploaded_by="A100001",
                                  merge_into_id=victim.id)
    dangling_suggest = models.Entry(title="d2", status="draft", batch_id=b.id, uploaded_by="A100001",
                                    suggested_entry_id=victim.id)
    db.add_all([dangling_merge, dangling_suggest])
    db.flush()
    dangling_merge.entry_id = f"E{dangling_merge.id:06d}"
    dangling_suggest.entry_id = f"E{dangling_suggest.id:06d}"

    dangling_batch = models.Batch(key="20260929-000000-dddd", source="inbox", original_name="y",
                                  target_entry_id=victim.id)
    db.add(dangling_batch)
    db.commit()

    service.merge(db, survivor, victim, u)  # victim(두 번째 인자) 이 삭제된다
    db.expire_all()

    assert db.get(models.Entry, victim.id) is None
    assert db.get(models.Entry, dangling_merge.id).merge_into_id is None
    assert db.get(models.Entry, dangling_suggest.id).suggested_entry_id is None
    assert db.get(models.Batch, dangling_batch.id).target_entry_id is None


def test_confirm_merge_into_existing_clears_dangling_references(db, storage, make_user, setup_entry_with_files):
    """confirm() 의 기존 Entry 에 추가(merge_into_id) 경로에서도 지워지는 초안을 가리키는
    참조가 먼저 비워져야 한다."""
    u = make_user("A100001")
    b1, target = setup_entry_with_files()
    service.confirm(db, storage, target, u)

    b2 = models.Batch(key="20260930-000000-eeee", source="inbox", original_name="추가", uploader="A100001",
                      target_entry_id=target.id)
    db.add(b2)
    db.flush()
    victim = models.Entry(title="추가", status="draft", batch_id=b2.id, uploaded_by="A100001",
                          merge_into_id=target.id)
    db.add(victim)
    db.flush()
    victim.entry_id = f"E{victim.id:06d}"
    p = storage.staging / b2.key / "extra.pdf"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"x")
    db.add(models.File(batch_id=b2.id, entry_id=victim.id, rel_path="extra.pdf", name="extra.pdf",
                       ext=".pdf", kind="report", size=1, sha256="c" * 64))

    dangling_suggest = models.Entry(title="d", status="draft", batch_id=b2.id, uploaded_by="A100001",
                                    suggested_entry_id=victim.id)
    db.add(dangling_suggest)
    db.flush()
    dangling_suggest.entry_id = f"E{dangling_suggest.id:06d}"
    db.commit()

    service.confirm(db, storage, victim, u)
    db.expire_all()

    assert db.get(models.Entry, victim.id) is None
    assert db.get(models.Entry, dangling_suggest.id).suggested_entry_id is None
