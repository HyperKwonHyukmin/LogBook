"""2026-11-06 — WorkBench Unit 해석(GroupModuleUnit)을 받으면 초안의 대상이 'Unit' 으로 미리 골라진다. 합성 데이터만(가상 호선 9999)."""
from app import models, vocab, wb_origin
from app.ingest.process import process_batch

ADMIN = "A490001"
FILES = {"20261106_090000_N490001_GroupModuleUnit/9999_unit.bdf": b"GRID 1"}


def _staged(db, storage, program, key):
    b = models.Batch(key=key, source="web", original_name="WB #4911", uploader=ADMIN)
    db.add(b)
    db.flush()
    wb_origin.stamp(b, {"analysis_id": 4911, "owner": "n490001", "program": program})
    db.commit()
    for rel, data in FILES.items():
        p = storage.staging / key / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
    return b


def _targets(db, e):
    return [t.value for t in db.query(models.Tag).join(models.EntryTag, models.EntryTag.tag_id == models.Tag.id)
            .filter(models.EntryTag.entry_id == e.id, models.Tag.kind == "target")]


def test_wb_unit_program_presets_target_unit(db, storage):
    term = vocab._new_tag(db, "target", "Unit")   # 145 목록 용어(동의어 GMU)
    term.listed, term.active = True, True
    db.commit()
    b = _staged(db, storage, "GroupModuleUnit", "20261106-000000-unit")
    process_batch(db, storage, b)
    [e] = db.query(models.Entry).filter_by(batch_id=b.id).all()
    assert _targets(db, e) == ["Unit"]


def test_other_wb_program_leaves_target_empty(db, storage):
    b = _staged(db, storage, "TrussAssessment", "20261106-000000-truss")
    process_batch(db, storage, b)
    [e] = db.query(models.Entry).filter_by(batch_id=b.id).all()
    assert _targets(db, e) == []
