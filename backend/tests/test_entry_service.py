import pytest
from fastapi import HTTPException

from app import models
from app.entries import service


def _draft(db, uploaded_by="A100001", title="초안"):
    e = models.Entry(title=title, status="draft", uploaded_by=uploaded_by)
    db.add(e)
    db.flush()
    e.entry_id = f"E{e.id:06d}"
    db.commit()
    return e


def test_entry_to_dict_shape(db):
    e = _draft(db)
    db.add(models.EntryHull(entry_id=e.id, hull_no="3496", is_primary=True))
    db.add(models.Hull(hull_no="3496", ship_type="LNGC"))
    db.commit()
    d = service.entry_to_dict(db, e)
    assert d["entry_id"] == e.entry_id
    assert d["hulls"] == [{"hull_no": "3496", "ship_type": "LNGC", "is_primary": True}]
    assert d["zones"] == [] and d["files"] == [] and d["version"] == 1


def test_update_draft_by_uploader(db, storage, make_user):
    u = make_user("A100001")
    e = _draft(db)
    service.update_entry(db, storage, e, u, {"version": 1, "title": "3496 Mooring", "hulls": ["3370", "3496"],
                                             "zones": ["Fore Deck", "Bow"], "analysis_type": "Mooring"})
    d = service.entry_to_dict(db, e)
    assert d["title"] == "3496 Mooring" and d["version"] == 2
    assert [h["hull_no"] for h in d["hulls"]] == ["3370", "3496"] and d["hulls"][0]["is_primary"] is True
    assert d["zones"] == ["Bow", "Fore Deck"]
    assert db.query(models.AuditLog).count() == 0  # 초안 편집은 기록하지 않음


def test_update_draft_forbidden_for_others(db, storage, make_user):
    other = make_user("B200002")
    e = _draft(db)
    with pytest.raises(HTTPException) as ei:
        service.update_entry(db, storage, e, other, {"version": 1, "title": "x"})
    assert ei.value.status_code == 403


def test_version_conflict(db, storage, make_user):
    u = make_user("A100001")
    e = _draft(db)
    with pytest.raises(HTTPException) as ei:
        service.update_entry(db, storage, e, u, {"version": 5, "title": "x"})
    assert (ei.value.status_code, ei.value.detail) == (409, "version_conflict")


def test_invalid_hull_rejected(db, storage, make_user):
    u = make_user("A100001")
    e = _draft(db)
    with pytest.raises(HTTPException) as ei:
        service.update_entry(db, storage, e, u, {"version": 1, "hulls": ["34a6"]})
    assert ei.value.detail == "invalid_hull"


def test_patch_can_clear_merge_into_id_to_unblock_confirm(db, storage, make_user, setup_entry_with_files):
    """I9: 대상이 이미 휴지통이거나 없어지면 confirm() 은 여전히 409 target_not_confirmed
    로 막지만, 이제 PATCH 로 merge_into_id 를 비워 일반 확정으로 되돌릴 수 있다."""
    u = make_user("A100001")
    target = models.Entry(title="대상", status="trashed")
    db.add(target)
    db.flush()
    target.entry_id = f"E{target.id:06d}"
    b, e = setup_entry_with_files()
    e.merge_into_id = target.id
    db.commit()

    with pytest.raises(HTTPException) as ei:
        service.confirm(db, storage, e, u)
    assert ei.value.detail == "target_not_confirmed"

    service.update_entry(db, storage, e, u, {"version": e.version, "merge_into_id": None})
    db.expire_all()
    e = db.get(models.Entry, e.id)
    assert e.merge_into_id is None

    confirmed = service.confirm(db, storage, e, u)
    assert confirmed.status == "confirmed"


def test_patch_merge_into_id_rejects_unknown_target(db, storage, make_user):
    u = make_user("A100001")
    e = _draft(db)
    with pytest.raises(HTTPException) as ei:
        service.update_entry(db, storage, e, u, {"version": 1, "merge_into_id": "E999999"})
    assert ei.value.detail == "merge_target_not_found"


def test_patch_merge_into_id_rejected_for_confirmed_entry(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    _, e = setup_entry_with_files()
    service.confirm(db, storage, e, u)
    db.expire_all()
    e = db.get(models.Entry, e.id)
    with pytest.raises(HTTPException) as ei:
        service.update_entry(db, storage, e, u, {"version": e.version, "merge_into_id": None})
    assert ei.value.detail == "merge_into_id_only_for_draft"


def test_confirmed_patch_with_blank_title_requires_title(db, storage, make_user, setup_entry_with_files):
    """M6: 확정된 Entry 를 빈 제목으로 PATCH 하면 422 title_required."""
    u = make_user("A100001")
    _, e = setup_entry_with_files()
    service.confirm(db, storage, e, u)
    db.expire_all()
    e = db.get(models.Entry, e.id)
    with pytest.raises(HTTPException) as ei:
        service.update_entry(db, storage, e, u, {"version": e.version, "title": "   "})
    assert ei.value.detail == "title_required"


def test_lock_refreshes_identity_map_from_concurrent_commit(db):
    """_lock() 이 행 잠금만 걸고 파이썬 객체를 다시 읽지 않으면(identity map 캐시),
    세션 A 가 먼저 읽어 둔 오래된 status/version 을 계속 들고 있게 된다 — 잠근 뒤의
    상태를 검사하는 의미가 없어진다. 두 세션(A=db, B=별도)으로 재현한다."""
    from app import database

    e = models.Entry(title="x", status="draft")
    db.add(e)
    db.commit()
    db.refresh(e)  # A(=db) 의 identity map 에 status="draft", version=1 로 박힘

    session_b = database.SessionLocal(
        bind=database.engine.execution_options(isolation_level="READ COMMITTED")
    )
    try:
        eb = session_b.get(models.Entry, e.id)
        eb.status = "confirmed"
        eb.version = 5
        session_b.commit()
    finally:
        session_b.close()

    locked = service._lock(db, e)
    assert (locked.status, locked.version) == ("confirmed", 5)


def test_confirm_with_no_batch_is_conflict(db, storage, make_user):
    """M7: 배치가 없는(고아) 초안은 확정할 수 없다."""
    u = make_user("A100001")
    e = models.Entry(title="배치 없음", status="draft", uploaded_by="A100001", batch_id=None)
    db.add(e)
    db.flush()
    e.entry_id = f"E{e.id:06d}"
    db.commit()
    with pytest.raises(HTTPException) as ei:
        service.confirm(db, storage, e, u)
    assert ei.value.detail == "no_batch"


def test_entry_to_dict_resolves_duplicate_and_suggestion_numbers(db):
    from app import models
    from app.entries.service import entry_to_dict

    batch = models.Batch(key="k1", source="web", original_name="x", state="processed")
    db.add(batch)
    db.flush()
    old = models.Entry(title="기존", status="confirmed", entry_id="E000045")
    db.add(old)
    db.flush()
    old_file = models.File(batch_id=batch.id, entry_id=old.id, rel_path="a.bdf", name="a.bdf", ext=".bdf",
                           kind="model", size=1, sha256="0" * 64, location="vault")
    db.add(old_file)
    db.flush()
    draft = models.Entry(title="새", status="draft", entry_id="E000046", batch_id=batch.id,
                         suggested_entry_id=old.id, merge_into_id=old.id)
    db.add(draft)
    db.flush()
    db.add(models.File(batch_id=batch.id, entry_id=draft.id, rel_path="a.bdf", name="a.bdf", ext=".bdf",
                       kind="model", size=1, sha256="0" * 64, location="staging", duplicate_of_id=old_file.id))
    db.commit()
    d = entry_to_dict(db, draft)
    assert d["files"][0]["duplicate_of_entry"] == "E000045"
    assert d["suggested_entry"] == {"entry_id": "E000045", "title": "기존"}
    assert d["merge_into"] == {"entry_id": "E000045", "title": "기존"}
