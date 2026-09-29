from app import models
from app.ingest.process import process_batch


def _batch(db, storage, key="20260929-000000-aaaa", uploader="A476854", target=None):
    b = models.Batch(key=key, source="inbox", original_name="x", uploader=uploader, target_entry_id=target)
    db.add(b)
    db.commit()
    (storage.staging / key).mkdir(parents=True)
    return b


def _write(path, data=b"GRID"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def test_process_creates_files_and_draft(db, storage):
    b = _batch(db, storage)
    root = storage.staging / b.key / "3496_Mooring_검토"
    _write(root / "model" / "3496_FWD.bdf")
    _write(root / "report" / "검토.pptx", b"PK\x03\x04")
    _write(root / "~$검토.pptx", b"lock")
    process_batch(db, storage, b)
    db.expire_all()
    [e] = db.query(models.Entry).all()
    assert (e.status, e.title, e.uploaded_by, e.batch_id) == ("draft", "3496 Mooring 검토", "A476854", b.id)
    assert e.entry_id == f"E{e.id:06d}"
    assert db.query(models.EntryHull).filter_by(entry_id=e.id, hull_no="3496", is_primary=True).count() == 1
    files = db.query(models.File).order_by(models.File.rel_path).all()
    assert [(f.rel_path, f.kind) for f in files] == [
        ("3496_Mooring_검토/model/3496_FWD.bdf", "model"),
        ("3496_Mooring_검토/report/검토.pptx", "report"),
    ]
    assert all(f.entry_id == e.id and len(f.sha256) == 64 for f in files)
    assert not (root / "~$검토.pptx").exists()
    assert db.get(models.Batch, b.id).excluded == [{"name": "3496_Mooring_검토/~$검토.pptx", "size": 4}]
    assert db.get(models.Batch, b.id).state == "processed"


def test_drm_and_duplicate_flags(db, storage):
    old = _batch(db, storage, key="20260101-000000-old0")
    db.add(models.File(batch_id=old.id, rel_path="r.pdf", name="r.pdf", ext=".pdf", kind="report",
                       size=4, sha256=__import__("hashlib").sha256(b"%PDF").hexdigest(), location="vault"))
    db.commit()
    b = _batch(db, storage)
    _write(storage.staging / b.key / "r.pdf", b"%PDF")
    _write(storage.staging / b.key / "enc.pptx", b"HHIDRMC\x00\x00")
    process_batch(db, storage, b)
    db.expire_all()
    by_name = {f.name: f for f in db.query(models.File).filter_by(batch_id=b.id)}
    assert by_name["r.pdf"].duplicate_of_id is not None
    assert by_name["enc.pptx"].drm_encrypted is True


def test_target_entry_sets_merge_into(db, storage):
    target = models.Entry(title="기존", status="confirmed")
    db.add(target)
    db.commit()
    b = _batch(db, storage, target=target.id)
    _write(storage.staging / b.key / "추가보고서.pdf", b"%PDF")
    process_batch(db, storage, b)
    db.expire_all()
    draft = db.query(models.Entry).filter_by(status="draft").one()
    assert draft.merge_into_id == target.id


def test_suggests_similar_confirmed_entry(db, storage):
    existing = models.Entry(title="3496 Mooring 검토", status="confirmed")
    db.add(existing)
    db.flush()
    db.add(models.EntryHull(entry_id=existing.id, hull_no="3496", is_primary=True))
    db.commit()
    b = _batch(db, storage)
    _write(storage.staging / b.key / "3496_Mooring_보고서" / "r.pdf", b"%PDF")
    process_batch(db, storage, b)
    db.expire_all()
    draft = db.query(models.Entry).filter_by(status="draft").one()
    assert draft.suggested_entry_id == existing.id


def test_unreadable_subfolder_does_not_fail_whole_batch(db, storage, monkeypatch):
    """os.walk 이 어느 하위 폴더 하나를 못 읽어도(onerror) 배치 전체가 실패하지 않고
    나머지 파일은 정상 처리된다."""
    b = _batch(db, storage)
    root = storage.staging / b.key
    _write(root / "ok" / "a.bdf")
    _write(root / "bad" / "b.bdf")

    import app.ingest.process as mod

    real_walk = mod.os.walk

    def flaky_walk(top, *a, **k):
        k["onerror"] = k.get("onerror")
        for dirpath, dirs, files in real_walk(top, *a, **k):
            if dirpath.endswith("bad"):
                if k.get("onerror"):
                    k["onerror"](OSError("읽기 실패(시뮬레이션)"))
                continue
            yield dirpath, dirs, files

    monkeypatch.setattr(mod.os, "walk", flaky_walk)
    process_batch(db, storage, b)
    db.expire_all()
    files = db.query(models.File).filter_by(batch_id=b.id).all()
    assert [f.name for f in files] == ["a.bdf"]
    assert db.get(models.Batch, b.id).state == "processed"


def test_process_batch_is_idempotent_on_retry(db, storage):
    """process_batch 가 재시도로 두 번 불려도(job 재시도 등) File 행이 중복 생성되지
    않는다 — 이미 처리된(staged 아님) 배치는 그냥 건너뛴다(I4)."""
    b = _batch(db, storage)
    root = storage.staging / b.key
    _write(root / "a.bdf")
    process_batch(db, storage, b)
    db.expire_all()
    b = db.get(models.Batch, b.id)
    assert b.state == "processed"
    first_count = db.query(models.File).filter_by(batch_id=b.id).count()

    process_batch(db, storage, b)  # 재시도
    db.expire_all()
    assert db.query(models.File).filter_by(batch_id=b.id).count() == first_count
    assert db.query(models.Entry).filter_by(batch_id=b.id).count() == 1


def test_too_long_rel_path_excluded_with_reason(db, storage):
    import os

    from app.storage.paths import to_long

    # NTFS 는 이름 조각 하나가 255자를 넘는 것 자체를 거부하므로(name>255 는 파일시스템이
    # 막아 실측 불가), 여기서는 실제로 만들 수 있는 rel_path>1024 경로(깊이 중첩)로 검증한다.
    # 전체 길이가 260자 넘는 경로라 작성도 to_long() 을 거쳐야 한다(일반 API 는 실패).
    b = _batch(db, storage)
    deep_dir = storage.staging / b.key
    for i in range(30):
        deep_dir = deep_dir / f"segment_{i:03d}_012345678901234567890123456789"
    os.makedirs(to_long(deep_dir), exist_ok=True)
    with open(to_long(deep_dir / "a.bdf"), "wb") as fh:
        fh.write(b"GRID")
    _write(storage.staging / b.key / "ok.bdf")
    process_batch(db, storage, b)
    db.expire_all()
    files = db.query(models.File).filter_by(batch_id=b.id).all()
    assert [f.name for f in files] == ["ok.bdf"]
    excluded = db.get(models.Batch, b.id).excluded
    assert any(x["reason"] == "path_too_long" for x in excluded)


def test_batch_with_zero_drafts_after_processing_is_done(db, storage):
    """전부 제외 규칙에 걸려 초안이 하나도 안 생기면 곧장 done 으로 두고 staging 을
    정리한다(M4) — 'processed' 로 남으면 확정할 것 없는 배치가 목록에 영원히 남는다."""
    b = _batch(db, storage)
    _write(storage.staging / b.key / "Thumbs.db", b"junk")
    process_batch(db, storage, b)
    db.expire_all()
    b = db.get(models.Batch, b.id)
    assert b.state == "done"
    assert db.query(models.Entry).filter_by(batch_id=b.id).count() == 0
    assert not (storage.staging / b.key).exists()


def test_unreadable_file_is_recorded_as_excluded_with_reason(db, storage, monkeypatch):
    """개별 파일 하나가 (권한 등으로) 읽기 실패하면 그 파일만 batch.excluded 에 사유와
    함께 남고, 배치 전체는 실패하지 않는다."""
    b = _batch(db, storage)
    root = storage.staging / b.key
    _write(root / "a.bdf")
    _write(root / "bad.bdf")

    import app.ingest.process as mod

    real_sha = mod.sha256_of

    def flaky_sha(path):
        if str(path).endswith("bad.bdf"):
            raise OSError("권한 없음(시뮬레이션)")
        return real_sha(path)

    monkeypatch.setattr(mod, "sha256_of", flaky_sha)
    process_batch(db, storage, b)
    db.expire_all()
    files = db.query(models.File).filter_by(batch_id=b.id).all()
    assert [f.name for f in files] == ["a.bdf"]
    excluded = db.get(models.Batch, b.id).excluded
    assert any(x["name"] == "bad.bdf" and "reason" in x for x in excluded)
    assert db.get(models.Batch, b.id).state == "processed"
