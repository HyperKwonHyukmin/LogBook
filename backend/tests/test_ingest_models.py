import pytest
from sqlalchemy.exc import IntegrityError, OperationalError

from app import models


def test_entry_defaults_and_entry_id_assignment(db):
    e = models.Entry(title="검토")
    db.add(e)
    db.flush()
    e.entry_id = f"E{e.id:06d}"
    db.commit()
    db.refresh(e)
    assert e.status == "draft"
    assert e.version == 1
    assert e.entry_id == f"E{e.id:06d}"


def test_entry_status_is_constrained(db):
    db.add(models.Entry(title="x", status="bogus"))
    with pytest.raises((IntegrityError, OperationalError)):
        db.commit()


def test_batch_file_and_job_rows(db):
    b = models.Batch(key="20260929-083015-a1b2", source="inbox", original_name="3496_검토")
    db.add(b)
    db.flush()
    db.add(models.File(batch_id=b.id, rel_path="3496_검토/a.bdf", name="a.bdf", ext=".bdf",
                       kind="model", size=10, sha256="0" * 64))
    db.add(models.Job(type="process_batch", target_id=b.id))
    db.commit()
    assert db.query(models.File).one().location == "staging"
    assert db.query(models.Job).one().state == "queued"


def test_tag_kind_value_unique(db):
    db.add(models.Tag(kind="zone", value="Fore Deck"))
    db.commit()
    db.add(models.Tag(kind="zone", value="Fore Deck"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_staging_path(storage):
    assert storage.staging == storage.vault / "_staging"
