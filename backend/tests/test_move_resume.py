"""리뷰 7 — 파일 이동의 멱등성: 중단된 확정·휴지통·복원·합치기를 다시 하면 이어서 끝난다.
그리고 리뷰 M3 — 감사 기록이 커밋된 뒤의 예외가 파일 이동을 되돌리지 않는다."""
import hashlib
import os
from datetime import datetime

import pytest
from fastapi import HTTPException

from app import models
from app.entries import service
from app.entries.files import entry_dir, find_moved_rel, move_all


def _real_hashes(db, storage, batch, entry, content=b"data"):
    """fixture 의 가짜 sha256 을 실제 내용 값으로 바꾼다(멱등 판정이 내용을 확인한다)."""
    sha = hashlib.sha256(content).hexdigest()
    for f in db.query(models.File).filter_by(entry_id=entry.id):
        (storage.staging / batch.key / f.rel_path).write_bytes(content)
        f.size, f.sha256 = len(content), sha
    db.commit()


def _fail_after(monkeypatch, n_ok):
    """os.rename 이 n_ok 번 성공한 뒤로는(되돌리기 포함) 전부 실패한다 — SMB 가 중간에 끊긴 상황."""
    import app.entries.files as files_mod

    real = files_mod.os.rename
    state = {"n": 0}

    def flaky(src, dst):
        state["n"] += 1
        if state["n"] <= n_ok:
            return real(src, dst)
        raise OSError("네트워크 이름을 더 이상 사용할 수 없습니다(시뮬레이션)")

    monkeypatch.setattr(files_mod.os, "rename", flaky)
    return lambda: monkeypatch.setattr(files_mod.os, "rename", real)


def test_confirm_retry_finishes_after_partial_move(db, storage, make_user, monkeypatch, setup_entry_with_files):
    u = make_user("A100001")
    b, e = setup_entry_with_files()
    _real_hashes(db, storage, b, e)
    heal = _fail_after(monkeypatch, 1)
    with pytest.raises(HTTPException) as ei:
        service.confirm(db, storage, e, u)
    assert (ei.value.status_code, ei.value.detail) == (503, "storage_error_partial")
    # 파일이 갈라져 있다 — 하나는 vault, 하나는 staging, DB 는 초안
    db.expire_all()
    e = db.get(models.Entry, e.id)
    assert e.status == "draft"
    vault_files = storage.vault / str(datetime.now().year) / e.entry_id / "files"
    assert len(list(vault_files.rglob("*.*"))) == 1
    assert len([p for p in (storage.staging / b.key).rglob("*") if p.is_file()]) == 1

    heal()   # 공유 폴더가 돌아왔다 — 다시 확정하면 이어서 끝나야 한다(예전에는 매번 503)
    service.confirm(db, storage, e, u)
    db.expire_all()
    e = db.get(models.Entry, e.id)
    assert e.status == "confirmed"
    assert all(f.location == "vault" for f in db.query(models.File).filter_by(entry_id=e.id))
    assert (vault_files / "3496_검토" / "model" / "a.bdf").read_bytes() == b"data"
    assert (vault_files / "3496_검토" / "r.pdf").is_file()
    assert not (storage.staging / b.key).exists()


def test_both_copies_identical_removes_source(db, storage, make_user, setup_entry_with_files):
    """앞선 시도가 남긴 같은 사본이 목적지에 있으면 원본(검증된 사본)을 지우고 진행한다."""
    u = make_user("A100001")
    b, e = setup_entry_with_files()
    _real_hashes(db, storage, b, e)
    dst = storage.vault / str(datetime.now().year) / e.entry_id / "files" / "3496_검토" / "r.pdf"
    dst.parent.mkdir(parents=True)
    dst.write_bytes(b"data")
    service.confirm(db, storage, e, u)
    assert dst.read_bytes() == b"data"
    assert not (storage.staging / b.key / "3496_검토" / "r.pdf").exists()


def test_different_file_at_destination_is_not_overwritten(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    b, e = setup_entry_with_files()
    _real_hashes(db, storage, b, e)
    dst = storage.vault / str(datetime.now().year) / e.entry_id / "files" / "3496_검토" / "r.pdf"
    dst.parent.mkdir(parents=True)
    dst.write_bytes(b"other")
    with pytest.raises(HTTPException) as ei:
        service.confirm(db, storage, e, u)
    assert ei.value.status_code == 503
    assert dst.read_bytes() == b"other"
    assert (storage.staging / b.key / "3496_검토" / "r.pdf").read_bytes() == b"data"
    db.expire_all()
    assert db.get(models.Entry, e.id).status == "draft"


def test_missing_source_with_wrong_size_is_not_taken(tmp_path):
    """원본이 없어도 목적지 파일 크기가 DB 와 다르면 '이미 옮김'으로 보지 않는다."""
    dst = tmp_path / "d" / "a.bin"
    dst.parent.mkdir()
    dst.write_bytes(b"xx")
    with pytest.raises(HTTPException):
        move_all([(tmp_path / "s" / "a.bin", dst, 4, hashlib.sha256(b"data").hexdigest())])


def test_merge_retry_finds_renamed_copy(db, storage, make_user, monkeypatch, setup_entry_with_files):
    """기존 자료에 합치기가 중단되면 이름이 'a (2).bdf' 로 바뀐 사본이 남는다 — 다시 하면 그 이름을 이어받는다."""
    u = make_user("A100001")
    b1, target = setup_entry_with_files()
    _real_hashes(db, storage, b1, target)
    service.confirm(db, storage, target, u)
    b2, draft = setup_entry_with_files(key="20260929-000001-cccc")
    _real_hashes(db, storage, b2, draft, content=b"data-2")
    draft.merge_into_id = target.id
    db.commit()

    heal = _fail_after(monkeypatch, 1)
    with pytest.raises(HTTPException):
        service.confirm(db, storage, draft, u)
    heal()
    db.expire_all()
    service.confirm(db, storage, db.get(models.Entry, draft.id), u)
    db.expire_all()
    rels = sorted(f.rel_path for f in db.query(models.File).filter_by(entry_id=target.id))
    assert rels == ["3496_검토/model/a (2).bdf", "3496_검토/model/a.bdf", "3496_검토/r (2).pdf", "3496_검토/r.pdf"]
    root = entry_dir(storage, db.get(models.Entry, target.id)) / "files"
    assert (root / "3496_검토" / "model" / "a (2).bdf").read_bytes() == b"data-2"
    assert (root / "3496_검토" / "model" / "a.bdf").read_bytes() == b"data"
    # 남의 파일(대상의 a.bdf)을 내 것으로 집지 않는다
    assert find_moved_rel(root, "3496_검토/model/a.bdf", {"3496_검토/model/a.bdf"}, 4,
                          hashlib.sha256(b"data").hexdigest()) is None


def test_trash_retry_reuses_moved_folder(db, storage, make_user, setup_entry_with_files):
    """폴더는 휴지통으로 갔는데 DB 반영 전에 멈췄다 — 다시 보내면 그 폴더로 끝낸다."""
    u = make_user("A100001")
    b, e = setup_entry_with_files()
    _real_hashes(db, storage, b, e)
    service.confirm(db, storage, e, u)
    db.expire_all()
    e = db.get(models.Entry, e.id)
    moved = f"{e.entry_id}_20260101-000000"
    os.rename(entry_dir(storage, e), storage.trash / moved)
    service.trash(db, storage, e, u)
    db.expire_all()
    e = db.get(models.Entry, e.id)
    assert (e.status, e.trash_rel) == ("trashed", moved)
    assert (storage.trash / moved / "files" / "3496_검토" / "r.pdf").is_file()


def test_restore_retry_when_folder_already_back(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    b, e = setup_entry_with_files()
    _real_hashes(db, storage, b, e)
    service.confirm(db, storage, e, u)
    service.trash(db, storage, db.get(models.Entry, e.id), u)
    db.expire_all()
    e = db.get(models.Entry, e.id)
    os.rename(storage.trash / e.trash_rel, entry_dir(storage, e))   # 앞선 복원이 옮기고 멈췄다
    service.restore(db, storage, e, u)
    db.expire_all()
    e = db.get(models.Entry, e.id)
    assert (e.status, e.trash_rel) == ("confirmed", None)
    assert all(f.location == "vault" for f in db.query(models.File).filter_by(entry_id=e.id))


def test_restore_still_conflicts_when_both_exist(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    b, e = setup_entry_with_files()
    _real_hashes(db, storage, b, e)
    service.confirm(db, storage, e, u)
    service.trash(db, storage, db.get(models.Entry, e.id), u)
    db.expire_all()
    e = db.get(models.Entry, e.id)
    os.makedirs(entry_dir(storage, e))
    with pytest.raises(HTTPException) as ei:
        service.restore(db, storage, e, u)
    assert ei.value.detail == "vault_conflict"


def test_draft_discard_retry_reuses_partial_trash_folder(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    b, e = setup_entry_with_files()
    _real_hashes(db, storage, b, e)
    moved = f"draft_{e.entry_id}_20260101-000000"
    dst = storage.trash / moved / "3496_검토" / "r.pdf"
    dst.parent.mkdir(parents=True)
    os.rename(storage.staging / b.key / "3496_검토" / "r.pdf", dst)
    service.trash(db, storage, e, u)
    db.expire_all()
    e = db.get(models.Entry, e.id)
    assert (e.status, e.trash_rel) == ("trashed", moved)
    assert (storage.trash / moved / "3496_검토" / "model" / "a.bdf").is_file()


def test_audit_failure_after_commit_does_not_undo_move(db, storage, make_user, monkeypatch, setup_entry_with_files):
    """리뷰 M3 — 감사 행이 커밋된 뒤(감사 파일 기록 등)의 예외는 확정을 되돌리지 않는다."""
    import app.audit as audit_mod

    u = make_user("A100001")
    b, e = setup_entry_with_files()

    def boom(*a, **k):
        raise RuntimeError("감사 파일 기록 중 예기치 않은 오류(시뮬레이션)")

    monkeypatch.setattr(audit_mod, "_append_jsonl", boom)
    service.confirm(db, storage, e, u)
    db.expire_all()
    e = db.get(models.Entry, e.id)
    assert e.status == "confirmed"
    assert (entry_dir(storage, e) / "files" / "3496_검토" / "r.pdf").is_file()
    assert db.query(models.AuditLog).filter_by(action="ENTRY_CONFIRM").count() == 1
