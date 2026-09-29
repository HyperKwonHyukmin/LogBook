# backend/tests/test_audit.py
import json

from app import audit, models
from app.storage.paths import StoragePaths


def test_record_writes_db_row_and_monthly_jsonl(db, tmp_path):
    sp = StoragePaths(tmp_path)
    row = audit.record(
        db, sp, actor="A476854", action="USER_APPROVE", target_type="user",
        target_id="B123456", before={"status": "pending"}, after={"status": "active"}, ip="10.0.0.1",
    )
    assert db.query(models.AuditLog).count() == 1
    path = tmp_path / "90_System" / "audit" / f"{row.at:%Y-%m}.jsonl"
    rec = json.loads(path.read_text(encoding="utf-8").splitlines()[-1])
    assert rec["action"] == "USER_APPROVE"
    assert rec["employee_id"] == "A476854"
    assert rec["target"] == {"type": "user", "id": "B123456"}
    assert rec["after"] == {"status": "active"}
    assert rec["ip"] == "10.0.0.1"


def test_record_commits_pending_changes_in_same_transaction(db, tmp_path):
    db.add(models.User(employee_id="C111111", name="대기자"))
    audit.record(db, StoragePaths(tmp_path), actor="C111111", action="USER_REGISTER",
                 target_type="user", target_id="C111111")
    db.rollback()  # record 가 이미 커밋했으므로 되돌려지지 않아야 한다
    assert db.query(models.User).filter_by(employee_id="C111111").count() == 1


def test_file_failure_does_not_lose_db_row(db, tmp_path):
    blocker = tmp_path / "not_a_folder"
    blocker.write_text("x", encoding="utf-8")
    audit.record(db, StoragePaths(blocker), actor="A476854", action="USER_UPDATE",
                 target_type="user", target_id="A476854")
    assert db.query(models.AuditLog).count() == 1
