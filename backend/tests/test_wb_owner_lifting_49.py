"""49 — WorkBench 해석자를 담당자로 · WB 해석 1건 = 자료 1건 · Module Unit 권상 Wire 모델 판별. 합성 데이터만(가상 호선 9999)."""
import pytest

from app import cli, lifting, models, wb_origin
from app.entries import service
from app.ingest.process import process_batch
from app.ingest.proposal import FileInfo, propose

ADMIN, ANALYST = "A490001", "N490001"
ORIGIN = {"analysis_id": 4901, "owner": ANALYST.lower(), "program": "GroupModuleUnit", "project": "9999 MU"}


def _staged(db, storage, files, origin=None, key="20261104-000000-mu49"):
    b = models.Batch(key=key, source="web", original_name="WB #4901", uploader=ADMIN)
    db.add(b)
    db.flush()
    if origin:
        wb_origin.stamp(b, origin)
    db.commit()
    for rel, data in files.items():
        p = storage.staging / key / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
    return b


WB_FILES = {"20261013_164220_N490001_GroupModuleUnit/9999_unit.bdf": b"GRID 1",
            "20261013_164220_N490001_GroupModuleUnit/9999_unit_posture.json": b"{}",
            "20261013_170000_N490001_UnitStructuralAnalysis/9999_unit_lifting.bdf": b"GRID 2",
            "20261013_170000_N490001_UnitStructuralAnalysis/9999_unit_lifting_meta.json": b"{}"}


def test_propose_single_keeps_folders_together():
    files = [FileInfo(key=i, rel_path=r) for i, r in enumerate(WB_FILES)]
    assert len(propose(files, set())) == 2   # 지금 규칙 — 최상위 폴더마다 초안
    [one] = propose(files, set(), single=True)
    assert sorted(one.file_keys) == [0, 1, 2, 3]


def test_wb_batch_is_one_entry_with_analyst_assignee(db, storage, wb):
    wb(ANALYST, name="해석가", department="구조설계부")
    b = _staged(db, storage, WB_FILES, ORIGIN)
    process_batch(db, storage, b)
    db.expire_all()
    [e] = db.query(models.Entry).filter_by(batch_id=b.id).all()
    assert db.query(models.File).filter_by(entry_id=e.id).count() == 4
    assert e.uploaded_by == ADMIN   # 작성자는 보낸 관리자 그대로
    [p] = service.entry_to_dict(db, e)["assignees"]
    assert (p["employee_id"], p["name"]) == (ANALYST, "해석가")


def test_wb_owner_unknown_leaves_assignee_empty(db, storage, wb):
    b = _staged(db, storage, WB_FILES, ORIGIN)   # WorkBench 에 없는 사번
    process_batch(db, storage, b)
    [e] = db.query(models.Entry).filter_by(batch_id=b.id).all()
    assert service.entry_to_dict(db, e)["assignees"] == []


def test_plain_upload_still_splits_without_assignee(db, storage):
    b = _staged(db, storage, WB_FILES)
    process_batch(db, storage, b)
    entries = db.query(models.Entry).filter_by(batch_id=b.id).all()
    assert len(entries) == 2
    assert db.query(models.EntryAssignee).filter(models.EntryAssignee.entry_id.in_([e.id for e in entries])).count() == 0


def test_assign_wb_owners_cli_previews_then_fills(db, storage, wb, make_user, make_entry_file):
    wb(ANALYST, name="해석가")
    e, f = make_entry_file(title="WB 옛 자료", name="m.bdf", kind="model", uploaded_by=ADMIN)
    wb_origin.stamp(db.get(models.Batch, f.batch_id), ORIGIN)
    plain, _f = make_entry_file(title="손으로 올린 자료", name="x.pdf", uploaded_by=ADMIN)
    db.commit()

    rep = cli.assign_wb_owners(db, storage)
    assert [(i["entry_id"], i["owner"]) for i in rep["items"]] == [(e.entry_id, ANALYST)]
    assert db.query(models.EntryAssignee).count() == 0   # 미리보기는 바꾸지 않는다

    rep = cli.assign_wb_owners(db, storage, apply=True)
    assert rep["filled"] == 1
    db.expire_all()
    assert [p["employee_id"] for p in service.entry_to_dict(db, db.get(models.Entry, e.id))["assignees"]] == [ANALYST]
    assert service.entry_to_dict(db, db.get(models.Entry, plain.id))["assignees"] == []
    assert cli.assign_wb_owners(db, storage)["items"] == []   # 다시 돌려도 같다


def test_search_filter_assignee_none(client, auth_headers, make_user, make_entry_file, db, wb):
    make_user(ADMIN, level=2)
    wb(ANALYST, name="해석가")
    e, _f = make_entry_file(title="담당자 있음", name="a.pdf", uploaded_by=ADMIN)
    lone, _f = make_entry_file(title="담당자 없음 자료", name="b.pdf", uploaded_by=ADMIN)
    from app import people
    people.set_assignees(db, e, [people.from_owner(db, ANALYST)])
    db.commit()
    h = auth_headers(ADMIN)
    r = client.get("/api/search", params={"assignee": "__none__"}, headers=h).json()
    assert [i["entry_id"] for i in r["items"]] == [lone.entry_id]
    facet = {f["value"]: f for f in client.get("/api/search", headers=h).json()["facets"]["assignee"]}
    assert facet["__none__"]["label"] == "담당자 없음" and facet["__none__"]["count"] == 1


def test_control_and_name_mark_wire_model():
    assert lifting.control_is_lifting(["SOL 101", "TITLE = HiTessWorkBench Lifting Analysis", "SPC = 990001"])
    assert not lifting.control_is_lifting(["SOL 101", "TITLE = Module unit"])
    assert lifting.name_is_lifting("3496_unit_lifting.bdf") and not lifting.name_is_lifting("3496_unit.bdf")


def test_entry_lifting_brief(db, storage, make_user, make_entry_file):
    u = make_user(ADMIN, level=2)
    e, f = make_entry_file(title="MU 자료", name="unit.bdf", kind="model", uploaded_by=ADMIN)
    service.set_tags(db, e, "target", ["Unit"])
    db.commit()
    d = service.entry_to_dict(db, e, viewer=u)
    assert d["lifting"] == {"needed": True, "has_wire": False}

    make_entry_file(entry=e, name="unit_renamed.bdf", kind="model")
    w = db.query(models.File).filter_by(entry_id=e.id, name="unit_renamed.bdf").one()
    db.add(models.ModelSummary(file_id=w.id, state="done", lifting=True))   # 이름을 바꿔도 본문 표시로 안다
    db.commit()
    d = service.entry_to_dict(db, e, viewer=u)
    assert d["lifting"] == {"needed": True, "has_wire": True}
    assert {x["name"]: x["lifting"] for x in d["files"]} == {"unit.bdf": False, "unit_renamed.bdf": True}

    other, _f = make_entry_file(title="일반 자료", name="o.bdf", kind="model", uploaded_by=ADMIN)
    assert service.entry_to_dict(db, other, viewer=u)["lifting"]["needed"] is False


def test_wb_program_marks_mu(db, make_entry_file, make_user):
    u = make_user(ADMIN, level=2)
    e, f = make_entry_file(title="WB MU", name="9999_unit_lifting.bdf", kind="model", uploaded_by=ADMIN)
    wb_origin.stamp(db.get(models.Batch, f.batch_id), ORIGIN)
    db.commit()
    assert service.entry_to_dict(db, e, viewer=u)["lifting"] == {"needed": True, "has_wire": True}


def test_mu_target_unit_and_synonym(db):
    """145 의 대상 'Unit'(40 에서 옮김, 동의어 GMU)과 'Module Unit' 을 MU 로 본다."""
    from app import vocab
    term = vocab._new_tag(db, "target", "Unit")
    term.listed, term.active = True, True
    vocab._new_tag(db, "target", "GMU", alias_of=term)
    db.flush()
    assert lifting.is_mu(db, "GMU", []) and lifting.is_mu(db, "unit", []) and lifting.is_mu(db, "Module Unit", [])
    assert not lifting.is_mu(db, "블록", [])
