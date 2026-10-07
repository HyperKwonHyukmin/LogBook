import os

import pytest
from fastapi import HTTPException

from app import models
from app.storage.paths import to_long
from app.uploads import service


@pytest.mark.parametrize("rel,expected", [
    ("a.bdf", "a.bdf"),
    ("9999_시험/model/a.bdf", "9999_시험/model/a.bdf"),
    ("9999_시험\\r.pdf", "9999_시험/r.pdf"),       # 역슬래시는 / 로
    ("  9999_시험/a.bdf", "9999_시험/a.bdf"),       # 앞 공백 제거
])
def test_clean_rel_accepts(rel, expected):
    assert service.clean_rel(rel) == expected


@pytest.mark.parametrize("rel", [
    "", "/", "/abs.bdf", "../x.bdf", "a/../../x", "a/./b", "a//b", "C:/x.bdf", "a/b:c",
    "a/b?.bdf", "a/<b>", "a\x00b", "a/" + "x" * 256, "a/" * 600 + "b",
])
def test_clean_rel_rejects(rel):
    with pytest.raises(HTTPException) as e:
        service.clean_rel(rel)
    assert e.value.status_code == 422
    assert e.value.detail == "invalid_path"


def test_begin_creates_uploading_batch_and_folder(db, storage, make_user):
    user = make_user("A100001")
    batch = service.begin(db, storage, user, name="9999_시험", target_entry_id=None)
    assert batch.source == "web" and batch.state == "uploading"
    assert batch.uploader == "A100001" and batch.uploader_guess == "A100001"
    assert batch.original_name == "9999_시험"
    assert os.path.isdir(to_long(storage.web_inbox / batch.key))


def test_begin_rejects_unreachable_storage(db, storage, make_user, monkeypatch):
    user = make_user("A100001")
    monkeypatch.setattr(type(storage), "check_reachable", lambda self, timeout=2.0: False)
    with pytest.raises(HTTPException) as e:
        service.begin(db, storage, user, name="x", target_entry_id=None)
    assert e.value.status_code == 503 and e.value.detail == "storage_unreachable"


def test_begin_target_must_be_confirmed_entry(db, storage, make_user):
    user = make_user("A100001")
    draft = models.Entry(title="t", status="draft", entry_id="E000900")
    db.add(draft)
    db.commit()
    with pytest.raises(HTTPException) as e:
        service.begin(db, storage, user, name="x", target_entry_id="E000900")
    assert e.value.status_code == 422 and e.value.detail == "target_not_confirmed"
    draft.status = "confirmed"
    db.commit()
    batch = service.begin(db, storage, user, name="x", target_entry_id="e000900")
    assert batch.target_entry_id == draft.id


from app import jobs  # noqa: E402
from app.ingest.process import process_batch  # noqa: E402


def _begin(db, storage, make_user):
    user = make_user("A100001")
    return user, service.begin(db, storage, user, name="9999_시험", target_entry_id=None)


def _read(path):
    with open(to_long(path), "rb") as fh:
        return fh.read()


def test_write_chunk_appends_in_order(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    assert service.write_chunk(db, storage, user, b.key, "9999_시험/a.bdf", 0, b"GRID") == 4
    assert service.write_chunk(db, storage, user, b.key, "9999_시험/a.bdf", 4, b",1") == 6
    assert _read(storage.web_inbox / b.key / "9999_시험" / "a.bdf") == b"GRID,1"


def test_write_chunk_offset_zero_restarts_file(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"OLD-CONTENT")
    assert service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"NEW") == 3
    assert _read(storage.web_inbox / b.key / "a.bdf") == b"NEW"


def test_write_chunk_offset_mismatch_409_reports_size(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"1234")
    with pytest.raises(HTTPException) as e:
        service.write_chunk(db, storage, user, b.key, "a.bdf", 9, b"x")
    assert e.value.status_code == 409
    assert e.value.detail == {"code": "offset_mismatch", "size": 4}


def test_write_chunk_rejects_drm_header(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    with pytest.raises(HTTPException) as e:
        service.write_chunk(db, storage, user, b.key, "enc.pdf", 0, b"HHIDRMC" + b"\x00" * 20)
    assert e.value.status_code == 422 and e.value.detail == "drm_encrypted"
    assert not os.path.exists(to_long(storage.web_inbox / b.key / "enc.pdf"))


def test_write_chunk_too_large_413(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    with pytest.raises(HTTPException) as e:
        service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"x" * (service.MAX_CHUNK + 1))
    assert e.value.status_code == 413


def test_write_chunk_only_uploader_and_uploading_state(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    other = make_user("A100002")
    with pytest.raises(HTTPException) as e:
        service.write_chunk(db, storage, other, b.key, "a.bdf", 0, b"x")
    assert e.value.status_code == 403
    b.state = "staged"
    db.commit()
    with pytest.raises(HTTPException) as e:
        service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"x")
    assert e.value.status_code == 409 and e.value.detail == "not_uploading"


def test_finish_moves_to_staging_and_queues_processing(db, storage, make_user, skip_if_local_drm):
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "9999_시험/a.bdf", 0, b"GRID")
    service.write_chunk(db, storage, user, b.key, "9999_시험/r.pdf", 0, b"%PDF-1.4")
    done = service.finish(db, storage, user, b.key,
                          files=[{"rel_path": "9999_시험/a.bdf", "size": 4},
                                 {"rel_path": "9999_시험/r.pdf", "size": 8}],
                          rejected=[{"rel_path": "9999_시험/enc.pdf", "reason": "drm"}])
    assert done.state == "staged"
    assert not os.path.exists(to_long(storage.web_inbox / b.key))
    assert _read(storage.staging / b.key / "9999_시험" / "a.bdf") == b"GRID"
    assert db.query(models.Job).filter_by(type="process_batch", target_id=b.id).count() == 1
    assert done.excluded == [{"name": "9999_시험/enc.pdf", "size": 0, "reason": "drm"}]
    audit = db.query(models.AuditLog).filter_by(action="BATCH_RECEIVED", target_id=b.key).one()
    assert audit.employee_id == "A100001" and audit.after["source"] == "web"


def test_finish_keeps_drm_rejections_after_processing(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"GRID")
    service.finish(db, storage, user, b.key, files=[{"rel_path": "a.bdf", "size": 4}],
                   rejected=[{"rel_path": "enc.pdf", "reason": "drm"}])
    batch = db.query(models.Batch).filter_by(key=b.key).one()
    process_batch(db, storage, batch)
    db.refresh(batch)
    assert {"name": "enc.pdf", "size": 0, "reason": "drm"} in batch.excluded


def test_finish_size_mismatch_422(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"GRID")
    with pytest.raises(HTTPException) as e:
        service.finish(db, storage, user, b.key, files=[{"rel_path": "a.bdf", "size": 99}], rejected=[])
    assert e.value.status_code == 422 and e.value.detail == {"code": "incomplete", "rel_path": "a.bdf"}
    assert db.query(models.Batch).filter_by(key=b.key).one().state == "uploading"


def test_finish_without_files_422(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    with pytest.raises(HTTPException) as e:
        service.finish(db, storage, user, b.key, files=[], rejected=[])
    assert e.value.status_code == 422 and e.value.detail == "no_files"


def test_finish_removes_undeclared_leftovers(db, storage, make_user):
    """중간에 버린 파일(재시도 전 조각 등)은 배치에 넣지 않는다."""
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"GRID")
    service.write_chunk(db, storage, user, b.key, "stray.tmp2", 0, b"zz")
    service.finish(db, storage, user, b.key, files=[{"rel_path": "a.bdf", "size": 4}], rejected=[])
    assert not os.path.exists(to_long(storage.staging / b.key / "stray.tmp2"))
    assert os.path.exists(to_long(storage.staging / b.key / "a.bdf"))


def test_cancel_removes_folder_and_batch(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"GRID")
    service.cancel(db, storage, user, b.key)
    assert not os.path.exists(to_long(storage.web_inbox / b.key))
    assert db.query(models.Batch).filter_by(key=b.key).count() == 0


# ── 리뷰 반영: 경로 검증 보강 ─────────────────────────────────────────────
@pytest.mark.parametrize("rel", [
    "a/b.", "a/b ", "a /b", "a./b",                      # 끝 점·공백(윈도우가 잘라 먹는다)
    "CON", "a/nul.txt", "com1", "a/LPT9.log", "aux", "Prn.bdf", "a/COM9/b.bdf",  # 예약 장치 이름
])
def test_clean_rel_rejects_trailing_dot_space_and_reserved_names(rel):
    with pytest.raises(HTTPException) as e:
        service.clean_rel(rel)
    assert e.value.status_code == 422 and e.value.detail == "invalid_path"


@pytest.mark.parametrize("rel", ["CONSOLE.bdf", "a/nullable.txt", "com10.bdf", "a/.hidden"])
def test_clean_rel_accepts_names_similar_to_reserved(rel):
    assert service.clean_rel(rel) == rel


# ── 리뷰 반영: finish ────────────────────────────────────────────────────
def test_finish_rejects_case_insensitive_duplicate_paths(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"GRID")
    with pytest.raises(HTTPException) as e:
        service.finish(db, storage, user, b.key, files=[{"rel_path": "a.bdf", "size": 4},
                                                        {"rel_path": "A.BDF", "size": 4}], rejected=[])
    assert e.value.status_code == 422 and e.value.detail == {"code": "duplicate_path", "rel_path": "A.BDF"}


def test_finish_keeps_file_whose_disk_name_differs_in_case(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "A.bdf", 0, b"GRID")
    service.finish(db, storage, user, b.key, files=[{"rel_path": "a.bdf", "size": 4}], rejected=[])
    assert _read(storage.staging / b.key / "a.bdf") == b"GRID"


def test_finish_removes_empty_dirs_left_by_undeclared_files(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"GRID")
    service.write_chunk(db, storage, user, b.key, "junk/deep/x.tmp", 0, b"zz")
    service.finish(db, storage, user, b.key, files=[{"rel_path": "a.bdf", "size": 4}], rejected=[])
    assert not os.path.exists(to_long(storage.staging / b.key / "junk"))


def test_finish_invalid_rejected_path_fails_before_move(db, storage, make_user, monkeypatch):
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"GRID")
    renames = []
    real_rename = os.rename
    monkeypatch.setattr(service.os, "rename", lambda s, d: (renames.append((s, d)), real_rename(s, d)))
    with pytest.raises(HTTPException) as e:
        service.finish(db, storage, user, b.key, files=[{"rel_path": "a.bdf", "size": 4}],
                       rejected=[{"rel_path": "../x.pdf", "reason": "drm"}])
    assert e.value.status_code == 422 and e.value.detail == "invalid_path"
    assert renames == []
    assert os.path.exists(to_long(storage.web_inbox / b.key / "a.bdf"))


def test_finish_audit_failure_keeps_upload(db, storage, make_user, monkeypatch):
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"GRID")

    def boom(*a, **k):
        raise RuntimeError("audit down")

    monkeypatch.setattr(service.audit, "record", boom)
    done = service.finish(db, storage, user, b.key, files=[{"rel_path": "a.bdf", "size": 4}], rejected=[])
    assert done.state == "staged"
    assert os.path.exists(to_long(storage.staging / b.key / "a.bdf"))
    assert not os.path.exists(to_long(storage.web_inbox / b.key))
    db.expire_all()
    assert db.query(models.Batch).filter_by(key=b.key).one().state == "staged"
    assert db.query(models.Job).filter_by(type="process_batch", target_id=b.id).count() == 1


def test_finish_db_failure_moves_folder_back(db, storage, make_user, monkeypatch):
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"GRID")

    def boom(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(service.jobs, "enqueue", boom)
    with pytest.raises(RuntimeError, match="db down"):
        service.finish(db, storage, user, b.key, files=[{"rel_path": "a.bdf", "size": 4}], rejected=[])
    assert os.path.exists(to_long(storage.web_inbox / b.key / "a.bdf"))
    assert not os.path.exists(to_long(storage.staging / b.key))
    db.expire_all()
    assert db.query(models.Batch).filter_by(key=b.key).one().state == "uploading"


def test_finish_rename_back_failure_reraises_original(db, storage, make_user, monkeypatch):
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"GRID")

    def boom(*a, **k):
        raise RuntimeError("db down")

    real_rename = os.rename
    calls = []

    def flaky_rename(s, d):
        calls.append(1)
        if len(calls) > 1:  # 되돌리기(두 번째 rename)만 실패
            raise OSError("share down")
        return real_rename(s, d)

    monkeypatch.setattr(service.jobs, "enqueue", boom)
    monkeypatch.setattr(service.os, "rename", flaky_rename)
    with pytest.raises(RuntimeError, match="db down"):
        service.finish(db, storage, user, b.key, files=[{"rel_path": "a.bdf", "size": 4}], rejected=[])


def test_finish_retries_rename_on_permission_error(db, storage, make_user, monkeypatch):
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"GRID")
    real_rename = os.rename
    attempts, sleeps = [], []

    def locked_twice(s, d):
        attempts.append(1)
        if len(attempts) <= 2:
            raise PermissionError("백신이 잡고 있음")
        return real_rename(s, d)

    monkeypatch.setattr(service.os, "rename", locked_twice)
    monkeypatch.setattr(service.time, "sleep", lambda s: sleeps.append(s))
    done = service.finish(db, storage, user, b.key, files=[{"rel_path": "a.bdf", "size": 4}], rejected=[])
    assert done.state == "staged" and len(attempts) == 3 and len(sleeps) == 2
    assert os.path.exists(to_long(storage.staging / b.key / "a.bdf"))


def test_finish_rename_gives_up_after_three_permission_errors(db, storage, make_user, monkeypatch):
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"GRID")
    attempts = []

    def always_locked(s, d):
        attempts.append(1)
        raise PermissionError("백신이 잡고 있음")

    monkeypatch.setattr(service.os, "rename", always_locked)
    monkeypatch.setattr(service.time, "sleep", lambda s: None)
    with pytest.raises(PermissionError):
        service.finish(db, storage, user, b.key, files=[{"rel_path": "a.bdf", "size": 4}], rejected=[])
    assert len(attempts) == 3
    db.expire_all()
    assert db.query(models.Batch).filter_by(key=b.key).one().state == "uploading"


# ── 리뷰 반영: 폴더를 못 지우면 행도 지우지 않는다 ─────────────────────────
def _raise_oserror(*a, **k):
    raise OSError("share down")


def test_cancel_unreachable_storage_503_keeps_row(db, storage, make_user, monkeypatch):
    """업로드가 실패하면 브라우저가 곧바로 DELETE 를 보낸다 — 공유가 끊긴 순간이면 행을 남겨야 한다."""
    user, b = _begin(db, storage, make_user)
    monkeypatch.setattr(type(storage), "check_reachable", lambda self, timeout=2.0: False)
    with pytest.raises(HTTPException) as e:
        service.cancel(db, storage, user, b.key)
    assert e.value.status_code == 503 and e.value.detail == "storage_unreachable"
    db.expire_all()
    assert db.query(models.Batch).filter_by(key=b.key).count() == 1
    assert os.path.isdir(to_long(storage.web_inbox / b.key))


def test_cancel_file_not_found_with_missing_parent_is_not_success(db, storage, make_user):
    """끊긴 UNC 경로의 rmtree 는 FileNotFoundError(WinError 53/67)를 낸다 — `_web` 자체가 안 보이면
    '이미 지워짐'으로 보지 않는다(루트는 보이지만 그 아래가 안 보이는 상황을 흉내 낸다)."""
    user, b = _begin(db, storage, make_user)
    os.rename(to_long(storage.web_inbox), to_long(storage.inbox / "_web_hidden"))
    with pytest.raises(HTTPException) as e:
        service.cancel(db, storage, user, b.key)
    assert e.value.status_code == 503 and e.value.detail == "storage_unreachable"
    db.expire_all()
    assert db.query(models.Batch).filter_by(key=b.key).count() == 1


def test_cancel_already_removed_folder_is_success(db, storage, make_user):
    """`_web` 은 있는데 <key> 폴더만 이미 없으면 정상 취소다."""
    import shutil

    user, b = _begin(db, storage, make_user)
    shutil.rmtree(to_long(storage.web_inbox / b.key))
    service.cancel(db, storage, user, b.key)
    assert db.query(models.Batch).filter_by(key=b.key).count() == 0


def test_cancel_keeps_row_when_folder_removal_fails(db, storage, make_user, monkeypatch):
    user, b = _begin(db, storage, make_user)
    monkeypatch.setattr(service.shutil, "rmtree", _raise_oserror)
    with pytest.raises(HTTPException) as e:
        service.cancel(db, storage, user, b.key)
    assert e.value.status_code == 503 and e.value.detail == "storage_unreachable"
    db.expire_all()
    assert db.query(models.Batch).filter_by(key=b.key).count() == 1


def test_cleanup_stale_keeps_row_when_folder_removal_fails(db, storage, make_user, monkeypatch):
    from datetime import datetime, timedelta

    user, b = _begin(db, storage, make_user)
    b.received_at = datetime.now() - timedelta(hours=25)
    db.commit()
    monkeypatch.setattr(service.shutil, "rmtree", _raise_oserror)
    assert service.cleanup_stale(db, storage) == 0
    db.expire_all()
    assert db.query(models.Batch).filter_by(key=b.key).count() == 1


def test_cleanup_stale_skips_when_storage_unreachable(db, storage, make_user, monkeypatch):
    from datetime import datetime, timedelta

    user, b = _begin(db, storage, make_user)
    b.received_at = datetime.now() - timedelta(hours=25)
    db.commit()
    monkeypatch.setattr(type(storage), "check_reachable", lambda self, timeout=2.0: False)
    assert service.cleanup_stale(db, storage) == 0
    db.expire_all()
    assert db.query(models.Batch).filter_by(key=b.key).count() == 1
    assert os.path.isdir(to_long(storage.web_inbox / b.key))
