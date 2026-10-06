import json
import os
from datetime import datetime

import pytest

from app import models
from app.entries.files import write_entry_files
from app.ops.rebuild import RebuildError, rebuild
from app.ops.registry import write_registry
from app.storage.paths import to_long


def _make_world(db, storage, make_entry_file, make_user):
    make_user("A100001", name="홍길동", is_admin=True)
    e1, f1 = make_entry_file(title="계류 검토", name="model/main.bdf", kind="model", sha="a" * 64)
    make_entry_file(entry=e1, name="r.pdf", sha="b" * 64)
    if db.get(models.Hull, "9999") is None:
        db.add(models.Hull(hull_no="9999"))
        db.flush()
    db.get(models.Hull, "9999").memo = "174K"
    bow = models.Tag(kind="zone", value="선수부")
    db.add(bow)
    db.flush()
    fwd = models.Tag(kind="zone", value="FWD", alias_of_id=bow.id)
    db.add(fwd)
    db.flush()
    db.add(models.EntryTag(entry_id=e1.id, tag_id=fwd.id))
    db.commit()
    for f in db.query(models.File).filter_by(entry_id=e1.id):
        p = storage.vault / "2026" / e1.entry_id / "files" / f.rel_path
        os.makedirs(to_long(p.parent), exist_ok=True)
        with open(to_long(p), "wb") as fh:
            fh.write(b"x")
    write_entry_files(db, storage, e1)
    # 휴지통 Entry 하나
    e2, f2 = make_entry_file(title="버린 것", name="t.pdf", sha="c" * 64)
    write_entry_files(db, storage, e2)
    # 휴지통 파일도 디스크에 둔다(missing_files == 0 을 기대하므로)
    p2 = storage.vault / "2026" / e2.entry_id / "files" / f2.rel_path
    os.makedirs(to_long(p2.parent), exist_ok=True)
    with open(to_long(p2), "wb") as fh:
        fh.write(b"x")
    os.makedirs(to_long(storage.trash), exist_ok=True)
    os.rename(to_long(storage.vault / "2026" / e2.entry_id), to_long(storage.trash / f"{e2.entry_id}_20261001-120000"))
    # staging 폴더 하나(초안은 되살리지 않고 배치로 다시 처리)
    os.makedirs(to_long(storage.staging / "20261002-000000-zzzz" / "a"), exist_ok=True)
    with open(to_long(storage.staging / "20261002-000000-zzzz" / "a" / "x.pdf"), "wb") as fh:
        fh.write(b"x")
    # 감사 JSONL
    from app import audit
    audit.record(db, storage, actor="A100001", action="ENTRY_CONFIRM", target_type="entry", target_id=e1.entry_id)
    write_registry(db, storage)
    return e1, e2


def _wipe(db):
    from app import database
    db.rollback()  # 열린 트랜잭션의 메타데이터 잠금이 DROP TABLE 을 막지 않게
    database.Base.metadata.drop_all(database.engine)
    database.Base.metadata.create_all(database.engine)
    db.expunge_all()  # 지운 표의 옛 객체가 identity map 에 남아 새 행과 부딪히지 않게


def test_rebuild_round_trip(db, storage, make_entry_file, make_user):
    e1, e2 = _make_world(db, storage, make_entry_file, make_user)
    e1_id, e2_id = e1.entry_id, e2.entry_id
    _wipe(db)
    r = rebuild(db, storage)
    assert r["entries"] == 1 and r["trashed"] == 1 and r["files"] == 3 and r["missing_files"] == 0
    assert r["users"] == 1 and r["alias_tags"] == 1 and r["audit"] >= 1 and r["staging_batches"] == 1
    a = db.query(models.Entry).filter_by(entry_id=e1_id).one()
    assert a.id == int(e1_id[1:]) and a.status == "confirmed" and a.vault_rel == f"2026/{e1_id}"
    assert a.title == "계류 검토"
    assert [h.hull_no for h in db.query(models.EntryHull).filter_by(entry_id=a.id)] == ["9999"]
    assert db.get(models.Hull, "9999").memo == "174K"
    fwd = db.query(models.Tag).filter_by(kind="zone", value="FWD").one()
    assert db.get(models.Tag, fwd.alias_of_id).value == "선수부"
    t = db.query(models.Entry).filter_by(entry_id=e2_id).one()
    assert t.status == "trashed" and t.trash_rel == f"{e2_id}_20261001-120000"
    # 리뷰 I10: 휴지통 보관 기간은 버린 시각(폴더 이름)부터 센다
    assert t.updated_at == datetime(2026, 10, 1, 12, 0, 0)
    assert r["admins"] == ["A100001"]
    assert db.query(models.User).filter_by(employee_id="A100001").one().is_admin is True
    types = {j.type for j in db.query(models.Job)}
    assert {"process_batch", "extract_file", "convert_model"} <= types
    # 새 Entry 번호가 겹치지 않는다
    nb = models.Batch(key="k-new", source="inbox", original_name="n")
    db.add(nb)
    db.flush()
    ne = models.Entry(title="새것", status="draft", batch_id=nb.id)
    db.add(ne)
    db.flush()
    assert ne.id > max(int(e1_id[1:]), int(e2_id[1:]))


def test_rebuild_refuses_non_empty(db, storage, make_entry_file):
    make_entry_file()
    with pytest.raises(RebuildError, match="db_not_empty"):
        rebuild(db, storage)


def test_rebuild_counts_missing_and_drafts(db, storage, make_entry_file):
    """디스크에 없는 파일은 행을 만들고 세며, draft_ 폴더는 건너뛰고 센다."""
    e, f = make_entry_file(title="빠진 파일", name="gone.pdf")
    write_entry_files(db, storage, e)
    os.makedirs(to_long(storage.trash / "draft_E000099_20261001-000000"), exist_ok=True)
    eid = e.entry_id
    _wipe(db)
    r = rebuild(db, storage)
    assert r["entries"] == 1 and r["files"] == 1 and r["missing_files"] == 1 and r["skipped_drafts"] == 1
    assert db.query(models.Entry).filter_by(entry_id=eid).one().status == "confirmed"


def test_rebuild_bad_audit_lines_counted(db, storage):
    os.makedirs(to_long(storage.audit_dir), exist_ok=True)
    with open(to_long(storage.audit_dir / "2026-10.jsonl"), "w", encoding="utf-8") as fh:
        fh.write(json.dumps({"at": "2026-10-02T01:00:00", "employee_id": "A100001", "action": "X",
                             "target": {"type": "entry", "id": "E000001"}, "before": None, "after": None,
                             "ip": None}) + "\n")
        fh.write("{깨진 줄\n")
    r = rebuild(db, storage)
    assert r["audit"] == 1 and r["audit_bad"] == 1
    row = db.query(models.AuditLog).filter_by(action="X").one()
    assert row.at == datetime(2026, 10, 2, 1, 0, 0) and row.target_id == "E000001"


def test_cli_rebuild_requires_yes(capsys):
    from app import cli

    assert cli.main(["rebuild"]) == 1
    assert "--yes" in capsys.readouterr().out


def test_cli_rebuild_refuses_non_empty(make_entry_file, capsys):
    from app import cli

    make_entry_file()
    assert cli.main(["rebuild", "--yes"]) == 2
    assert "DB 가 비어 있지 않아" in capsys.readouterr().err


def _confirmed_world(db, storage, make_entry_file, n=2):
    ids = []
    for i in range(n):
        e, _ = make_entry_file(title=f"건 {i}", name=f"f{i}.pdf")
        write_entry_files(db, storage, e)
        ids.append(e.entry_id)
    return ids


def test_rebuild_skips_corrupt_entry_with_savepoint(db, storage, make_entry_file):
    """entry.json 하나가 깨져 있어도(값 형식 오류) 그 Entry 만 건너뛰고 나머지는 들어간다(리뷰 I7)."""
    good, bad = _confirmed_world(db, storage, make_entry_file)
    path = storage.vault / "2026" / bad / "entry.json"
    with open(to_long(path), encoding="utf-8") as fh:
        data = json.load(fh)
    data["version"] = "깨짐"
    with open(to_long(path), "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)
    _wipe(db)
    r = rebuild(db, storage)
    assert r["entries"] == 1 and r["skipped_bad"] == 1
    assert [e for (e,) in db.query(models.Entry.entry_id)] == [good]
    assert r["missing_in_db"] == [bad]


def test_rebuild_raises_autoinc_past_audit_and_trash_numbers(db, storage, make_entry_file):
    """감사 로그·폐기 초안 폴더에만 남은 더 큰 번호 다음부터 새 Entry 번호가 이어진다(리뷰 I6)."""
    from app import audit

    _confirmed_world(db, storage, make_entry_file, n=1)
    audit.record(db, storage, actor="A100001", action="ENTRY_TRASH", target_type="entry", target_id="E000777")
    os.makedirs(to_long(storage.trash / "draft_E000801_20261001-000000"), exist_ok=True)
    _wipe(db)
    r = rebuild(db, storage)
    assert r["next_entry_id"] == 802
    nb = models.Batch(key="k-auto", source="inbox", original_name="n")
    db.add(nb)
    db.flush()
    ne = models.Entry(title="새것", status="draft", batch_id=nb.id)
    db.add(ne)
    db.flush()
    assert ne.id >= 802


def test_rebuild_refuses_while_worker_alive(db, storage):
    from app.ops.state import set_state

    set_state(db, "worker_heartbeat", {"at": datetime.now().replace(microsecond=0).isoformat(), "stats": {}})
    db.commit()
    with pytest.raises(RebuildError, match="worker_running"):
        rebuild(db, storage)
    assert rebuild(db, storage, force=True)["entries"] == 0


def test_cli_fix_autoinc_warns_vault_only_entries(db, storage, make_entry_file, capsys):
    """덤프 복원 뒤: Vault 에만 있는 Entry 를 경고하고, 그 번호 다음으로 자동 증가 값을 올린다."""
    from app import cli

    _confirmed_world(db, storage, make_entry_file, n=1)
    os.makedirs(to_long(storage.vault / "2026" / "E000500"), exist_ok=True)
    db.commit()  # 이 세션의 열린 트랜잭션이 CLI 의 ALTER TABLE(메타데이터 잠금)을 막지 않게
    assert cli.main(["fix-autoinc"]) == 0
    out = capsys.readouterr().out
    assert "E000501" in out and "E000500" in out and "경고" in out
    nb = models.Batch(key="k-fix", source="inbox", original_name="n")
    db.add(nb)
    db.flush()
    ne = models.Entry(title="새것", status="draft", batch_id=nb.id)
    db.add(ne)
    db.flush()
    assert ne.id >= 501
