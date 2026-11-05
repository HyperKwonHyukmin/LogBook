"""초안 쪼개기·합치기가 분류(구역·대상·자유 태그)·설명·열람 허락을 잃지 않는다(2026-11-05 전체 검토)."""
from app import models
from app.entries import service

OWNER = "U510001"


def _owner(db):
    return db.query(models.User).filter_by(employee_id=OWNER).one()


def _tags(db, e):
    return {k: sorted(service.tags_of(db, e, k)) for k in ("zone", "target", "free")}


def _grants(db, e):
    return sorted(g for (g,) in db.query(models.EntryGrant.employee_id).filter_by(entry_id=e.id))


def _draft(db, setup_entry_with_files, make_user):
    make_user(OWNER, level=2)
    _b, e = setup_entry_with_files(uploader=OWNER)
    service.set_tags(db, e, "zone", ["기관실"])
    service.set_tags(db, e, "target", ["Unit"])
    service.set_tags(db, e, "free", ["Lashing"])
    e.description = "선미 보강 검토"
    db.add(models.EntryGrant(entry_id=e.id, employee_id="G510001", granted_by=OWNER))
    db.commit()
    return e


def test_split_copies_tags_description_grants(db, make_user, setup_entry_with_files):
    e = _draft(db, setup_entry_with_files, make_user)
    fid = db.query(models.File).filter_by(entry_id=e.id).first().id
    new = service.split(db, e, _owner(db), [fid])
    assert _tags(db, new) == _tags(db, e) == {"zone": ["기관실"], "target": ["Unit"], "free": ["Lashing"]}
    assert new.description == "선미 보강 검토"
    assert _grants(db, new) == ["G510001"]


def test_merge_keeps_tags_description_grants_of_removed_draft(db, make_user, setup_entry_with_files):
    e = _draft(db, setup_entry_with_files, make_user)
    fid = db.query(models.File).filter_by(entry_id=e.id).first().id
    new = service.split(db, e, _owner(db), [fid])
    # 남는 쪽은 비우고, 지워지는 쪽(new)에만 값을 둔다
    for k in ("zone", "target", "free"):
        service.set_tags(db, e, k, [])
    service.set_tags(db, new, "free", ["Lashing", "Wire"])
    e.description = None
    db.query(models.EntryGrant).filter_by(entry_id=e.id).delete()
    db.add(models.EntryGrant(entry_id=new.id, employee_id="G510002", granted_by=OWNER))
    db.commit()
    merged = service.merge(db, e, new, _owner(db))
    assert _tags(db, merged) == {"zone": ["기관실"], "target": ["Unit"], "free": ["Lashing", "Wire"]}
    assert merged.description == "선미 보강 검토"
    assert _grants(db, merged) == ["G510001", "G510002"]


def test_merge_keeps_own_description_and_unions_tags(db, make_user, setup_entry_with_files):
    e = _draft(db, setup_entry_with_files, make_user)
    fid = db.query(models.File).filter_by(entry_id=e.id).first().id
    new = service.split(db, e, _owner(db), [fid])
    service.set_tags(db, new, "zone", ["거주구"])
    new.description = "다른 설명"
    db.commit()
    merged = service.merge(db, e, new, _owner(db))
    assert merged.description == "선미 보강 검토"
    assert _tags(db, merged)["zone"] == ["거주구", "기관실"]
