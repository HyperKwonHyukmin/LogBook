"""리뷰 7 — `cli verify`: DB 파일 위치와 공유 폴더 대조(기본 보기만, --fix 는 안전한 경우만)."""
import hashlib
import io
import os
from datetime import datetime

import pytest
from fastapi import HTTPException

from app import cli, models
from app.entries import service
from app.entries.files import entry_dir
from app.ops.verify import has_problems, verify


def _real(db, storage, batch, entry, content=b"data"):
    sha = hashlib.sha256(content).hexdigest()
    for f in db.query(models.File).filter_by(entry_id=entry.id):
        (storage.staging / batch.key / f.rel_path).write_bytes(content)
        f.size, f.sha256 = len(content), sha
    db.commit()


def _half_confirm(db, storage, make_user, monkeypatch, setup_entry_with_files):
    """확정이 파일 하나만 옮기고 끊긴(되돌리기도 실패한) 상태를 만든다."""
    import app.entries.files as files_mod

    u = make_user("A100001")
    b, e = setup_entry_with_files()
    _real(db, storage, b, e)
    real = files_mod.os.rename
    n = {"i": 0}

    def flaky(src, dst):
        n["i"] += 1
        if n["i"] == 1:
            return real(src, dst)
        raise OSError("끊김")

    monkeypatch.setattr(files_mod.os, "rename", flaky)
    with pytest.raises(HTTPException):
        service.confirm(db, storage, e, u)
    monkeypatch.setattr(files_mod.os, "rename", real)
    db.expire_all()
    return u, b, db.get(models.Entry, e.id)


def test_clean_state_has_no_problems(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    _b, e = setup_entry_with_files()
    service.confirm(db, storage, e, u)
    r = verify(db, storage)
    assert r["files"] == 2 and r["ok"] == 2 and not has_problems(r)


def test_reports_half_moved_and_orphan_without_changing(db, storage, make_user, monkeypatch, setup_entry_with_files):
    _u, b, e = _half_confirm(db, storage, make_user, monkeypatch, setup_entry_with_files)
    out = io.StringIO()
    r = verify(db, storage, out=out)
    assert len(r["misplaced"]) == 1 and r["misplaced"][0]["db_location"] == "staging"
    assert r["misplaced"][0]["found_in"] == "vault"
    assert r["orphan_vault"] == [{"folder": f"{datetime.now().year}/{e.entry_id}", "note": "DB 에는 draft"}]
    assert has_problems(r) and "반쯤 옮겨짐" in out.getvalue()
    # 보기만 — 아무것도 옮기지 않았다
    assert r["fixed"] == []
    assert len([p for p in (storage.staging / b.key).rglob("*") if p.is_file()]) == 1


def test_fix_moves_file_back_to_db_location(db, storage, make_user, monkeypatch, setup_entry_with_files):
    u, b, e = _half_confirm(db, storage, make_user, monkeypatch, setup_entry_with_files)
    r = verify(db, storage, fix=True)
    assert len(r["fixed"]) == 1
    assert len([p for p in (storage.staging / b.key).rglob("*") if p.is_file()]) == 2   # 온전한 초안으로
    again = verify(db, storage)
    assert again["misplaced"] == [] and again["missing"] == []
    service.confirm(db, storage, e, u)   # 그 뒤 확정은 그대로 된다
    db.expire_all()
    assert db.get(models.Entry, e.id).status == "confirmed"


def test_reports_missing_and_trash_cases_not_fixed(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    b, e = setup_entry_with_files()
    _real(db, storage, b, e)
    service.confirm(db, storage, e, u)
    db.expire_all()
    e = db.get(models.Entry, e.id)
    (entry_dir(storage, e) / "files" / "3496_검토" / "r.pdf").unlink()
    # 폴더째 휴지통으로 갔는데 DB 는 확정 — 휴지통이 걸린 경우는 고치지 않는다
    os.rename(entry_dir(storage, e), storage.trash / f"{e.entry_id}_20260101-000000")
    r = verify(db, storage, fix=True)
    assert len(r["missing"]) == 1 and len(r["misplaced"]) == 1 and r["misplaced"][0]["found_in"] == "trash"
    assert r["fixed"] == [] and r["orphan_trash"][0]["note"] == "DB 에는 confirmed"


def test_orphan_staging_folder(db, storage):
    (storage.staging / "20260101-000000-zzzz").mkdir(parents=True)
    r = verify(db, storage)
    assert r["orphan_staging"] == [{"folder": "20260101-000000-zzzz"}]


def test_cli_verify_exit_codes(db, storage, make_user, setup_entry_with_files, capsys):
    u = make_user("A100001")
    _b, e = setup_entry_with_files()
    service.confirm(db, storage, e, u)
    assert cli.main(["verify"]) == 0
    assert "정상 2" in capsys.readouterr().out
    (storage.staging / "20260101-000000-zzzz").mkdir(parents=True)
    assert cli.main(["verify"]) == 1
