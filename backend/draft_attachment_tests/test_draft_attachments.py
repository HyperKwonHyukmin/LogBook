"""Temporary SQLite and filesystem only; never reset the shared MySQL test DB."""
import hashlib
import os
import shutil
import tempfile
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.database import Base
from app.config import settings
from app.entries import service as entries
from app.entries.draft_attachments import attach_processed_batch, pending_batches, release_batch
from app.ingest.process import process_batch
from app.storage.paths import StoragePaths, to_long
from app.uploads import service as uploads


@pytest.fixture
def world(tmp_path, monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    # The development PC applies DRM to local PDF writes. Use a newly created,
    # isolated test root under _poc on the user-confirmed DRM-free share, never
    # the real 00_Inbox / 10_Vault directories or application database.
    parent = Path(os.getenv('LOGBOOK_ATTACH_TEST_ROOT', str(Path(settings.storage_root) / '_poc')))
    parent.mkdir(parents=True, exist_ok=True)
    test_root = Path(tempfile.mkdtemp(prefix='draft-attach-test-', dir=parent))
    storage = StoragePaths(test_root)
    storage.ensure_layout()
    monkeypatch.setattr(StoragePaths, 'check_reachable', lambda self: True)
    user = models.User(employee_id="owner", name="작성자", status="active", level=2)
    db.add(user)
    batch = models.Batch(key="original", source="web", original_name="BDF 검토", state="processed", uploader=user.employee_id)
    db.add(batch); db.flush()
    entry = models.Entry(entry_id="E000001", title="사용자가 검토한 제목", title_source="model",
                         status="draft", batch_id=batch.id, uploaded_by=user.employee_id,
                         analysis_type="강도 평가", access="normal")
    db.add(entry); db.flush()
    db.add(models.EntryHull(entry_id=entry.id, hull_no="3496"))
    zone = models.Tag(kind="zone", value="선수부", active=True)
    db.add(zone); db.flush(); db.add(models.EntryTag(entry_id=entry.id, tag_id=zone.id))
    content = b"$ original BDF\nGRID,1,,0.,0.,0.\n"
    folder = storage.staging / batch.key
    folder.mkdir(parents=True)
    (folder / "model.bdf").write_bytes(content)
    file = models.File(batch_id=batch.id, entry_id=entry.id, name="model.bdf", ext=".bdf",
                       rel_path="model.bdf", kind="model", size=len(content), sha256=hashlib.sha256(content).hexdigest(), location="staging")
    db.add(file); db.commit()
    yield db, storage, user, entry, file
    db.close(); engine.dispose()
    if test_root.resolve().parent != parent.resolve() or not test_root.name.startswith('draft-attach-test-'):
        raise RuntimeError('Refusing cleanup outside the isolated attachment test root')
    shutil.rmtree(test_root)


def upload_report(world, name="report.pdf"):
    db, storage, user, entry, _ = world
    batch = uploads.begin(db, storage, user, name="첨부 보고서", target_entry_id=entry.entry_id)
    data = b"%PDF-1.4\nattachment report"
    uploads.write_chunk(db, storage, user, batch.key, name, 0, data)
    uploads.finish(db, storage, user, batch.key, files=[{"rel_path": name, "size": len(data)}], rejected=[])
    process_batch(db, storage, batch)
    return batch, data


def test_report_joins_one_draft_and_approves_together(world):
    db, storage, user, entry, model = world
    original = (entry.title, entry.analysis_type, entry.no_hull, entry.status)
    batch, report_bytes = upload_report(world)
    child = db.query(models.Entry).filter_by(batch_id=batch.id, status="draft").one()
    assert child.access == 'blocked'
    assert entries.auto_merge_batch(db, storage, batch) == 1
    db.refresh(entry)
    assert (entry.title, entry.analysis_type, entry.no_hull, entry.status) == original
    files = db.query(models.File).filter_by(entry_id=entry.id).all()
    assert {f.kind for f in files} == {"model", "report"}
    assert all(f.batch_id == entry.batch_id and f.location == "staging" for f in files)
    assert db.query(models.Entry).filter_by(status="draft").count() == 1
    assert batch.state == "done" and pending_batches(db, entry.id) == []
    assert (storage.staging / "original" / "report.pdf").read_bytes() == report_bytes
    assert (storage.staging / "original" / "model.bdf").read_bytes().startswith(b"$ original BDF")
    assert entries.auto_merge_batch(db, storage, batch) == 0
    entries.confirm(db, storage, entry, user)
    assert entry.status == "confirmed"
    assert all(f.location == "vault" for f in db.query(models.File).filter_by(entry_id=entry.id))
    root = storage.vault / entry.vault_rel / "files"
    assert (root / "report.pdf").read_bytes() == report_bytes
    assert (root / model.rel_path).is_file()


def test_confirm_is_blocked_from_upload_begin_to_attachment_complete(world):
    db, storage, user, entry, _ = world
    batch = uploads.begin(db, storage, user, name="report", target_entry_id=entry.entry_id)
    for state in ("uploading", "staged", "processed", "failed"):
        batch.state = state; db.commit()
        with pytest.raises(HTTPException) as error:
            entries.confirm(db, storage, entry, user)
        assert error.value.detail == "draft_attachments_pending"
        db.rollback()
        assert entry.status == "draft"


def test_same_named_report_is_preserved_without_overwrite(world):
    db, storage, user, entry, _ = world
    batch, data = upload_report(world)
    destination = storage.staging / "original" / "report.pdf"
    destination.write_bytes(b"old report")
    assert entries.auto_merge_batch(db, storage, batch) == 1
    assert destination.read_bytes() == b"old report"
    report = db.query(models.File).filter_by(entry_id=entry.id, kind="report").one()
    assert report.rel_path == "report (2).pdf" and report.name == "report (2).pdf"
    assert (destination.parent / report.rel_path).read_bytes() == data


def test_failed_move_rolls_back_and_keeps_both_originals(world, monkeypatch):
    from app.entries import draft_attachments
    db, storage, user, entry, _ = world
    batch, data = upload_report(world)
    version = entry.version
    def fail(*args):
        raise OSError("test move failure")
    monkeypatch.setattr(draft_attachments, 'move_all', fail)
    with pytest.raises(OSError):
        entries.auto_merge_batch(db, storage, batch)
    db.rollback()
    assert entry.version == version and entry.status == "draft"
    assert (storage.staging / batch.key / "report.pdf").read_bytes() == data
    assert not (storage.staging / "original" / "report.pdf").exists()


def test_other_user_cannot_attach_to_draft(world):
    db, storage, _, entry, _ = world
    other = models.User(employee_id="other", name="다른 사람", status="active", level=2)
    db.add(other); db.commit()
    with pytest.raises(HTTPException) as error:
        uploads.begin(db, storage, other, name="report", target_entry_id=entry.entry_id)
    assert error.value.status_code == 403


def test_release_failed_attachment_keeps_report_in_separate_batch(world):
    db, storage, user, entry, _ = world
    batch, data = upload_report(world)
    batch.state = "failed"; db.commit()
    release_batch(db, user, entry.entry_id, batch.key)
    assert pending_batches(db, entry.id) == []
    assert batch.target_entry_id is None and batch.state == "processed"
    child = db.query(models.Entry).filter_by(batch_id=batch.id, status="draft").one()
    assert child.merge_into_id is None
    assert child.access == entry.access
    assert (storage.staging / batch.key / "report.pdf").read_bytes() == data


def test_cancel_incomplete_upload_unblocks_original(world):
    db, storage, user, entry, _ = world
    batch = uploads.begin(db, storage, user, name="report", target_entry_id=entry.entry_id)
    uploads.cancel(db, storage, user, batch.key)
    assert pending_batches(db, entry.id) == []


def test_pending_attachment_blocks_split_and_discard_from_other_tabs(world):
    db, storage, user, entry, model = world
    uploads.begin(db, storage, user, name="report", target_entry_id=entry.entry_id)
    for operation in (lambda: entries.split(db, entry, user, [model.id]),
                      lambda: entries.trash(db, storage, entry, user)):
        with pytest.raises(HTTPException) as error:
            operation()
        assert error.value.detail == "draft_attachments_pending"
        db.rollback()
        assert (storage.staging / "original" / "model.bdf").is_file()


def test_db_failure_after_move_restores_attachment_files(world, monkeypatch):
    from app.entries import draft_attachments
    db, storage, user, entry, _ = world
    batch, data = upload_report(world)
    def fail(*args, **kwargs):
        raise RuntimeError('test audit/database failure')
    monkeypatch.setattr(draft_attachments.audit, 'record', fail)
    with pytest.raises(RuntimeError):
        entries.auto_merge_batch(db, storage, batch)
    assert (storage.staging / batch.key / "report.pdf").read_bytes() == data
    assert not (storage.staging / "original" / "report.pdf").exists()
    assert db.query(models.Entry).filter_by(batch_id=batch.id, status='draft').count() == 1


def test_confirmation_target_still_uses_existing_auto_merge(world, monkeypatch):
    db, storage, user, entry, _ = world
    entry.status = "confirmed"; entry.vault_rel = "2026/E000001"; db.commit()
    batch, _ = upload_report(world)
    calls = []
    def confirm(db, storage, child, actor):
        calls.append(child.merge_into_id)
    monkeypatch.setattr(entries, 'confirm', confirm)
    assert entries.auto_merge_batch(db, storage, batch) == 1
    assert calls == [entry.id]


def test_draft_upload_does_not_silently_attach_after_other_tab_approval(world):
    db, storage, user, entry, _ = world
    entry.status = "confirmed"; entry.vault_rel = "2026/E000001"; db.commit()
    with pytest.raises(HTTPException) as error:
        uploads.begin(db, storage, user, name='report', target_entry_id=entry.entry_id, target_status='draft')
    assert error.value.detail == 'attachment_target_changed'
    assert db.query(models.Batch).count() == 1


def test_temporary_proposals_do_not_create_second_review_card(world):
    from app.routers.batches import batch_to_dict
    db, _, user, entry, _ = world
    batch, _ = upload_report(world)
    result = batch_to_dict(db, batch, ctx={'running': [], 'worker': {'alive': True, 'at': None}}, viewer=user)
    assert result['attachment_target'] == entry.entry_id
    assert result['entries'] == []
