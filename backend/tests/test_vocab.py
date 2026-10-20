"""08 — 구역·대상 통제 어휘(태그 동의어 확장). 42 — 해석 종류(atype)는 없앴다."""
import pytest
from fastapi import HTTPException

from app import models, vocab
from app.entries import service


def _tag(db, value, kind="zone", alias_of=None, listed=False):
    t = models.Tag(kind=kind, value=value, alias_of_id=alias_of.id if alias_of else None, listed=listed)
    db.add(t)
    db.commit()
    return t


def _zones(db, e):
    return service.entry_to_dict(db, db.get(models.Entry, e.id))["zones"]


# ---- 정규화 ----

def test_clean_and_key():
    assert vocab.clean("  기관   실 ") == "기관 실"
    assert vocab.key("기관 실") == vocab.key("기관실") == vocab.key(" 기관  실")


def test_seed_defaults_once(db, storage):
    added = vocab.seed(db, storage)
    assert set(added) == {"zone", "target"}          # 42 — 해석 종류 목록은 넣지 않는다
    assert added["zone"][0] == "선수부" and added["zone"][-1] == "기타"
    v = vocab.Vocab(db, "zone")
    assert [t.value for t in v.terms][:3] == ["선수부", "선미부", "화물창"]
    assert v.canon("FWD") == "선수부"                 # 기본 동의어
    assert v.canon("기관 실") == "기관실"              # 공백만 다른 표기
    assert v.canon("engine room") == "기관실"
    assert v.canon("모르는 값") == "모르는 값"
    assert v.is_listed("기타") and not v.is_listed("모르는 값")
    assert "계류 의장품" in added["target"]          # 38 — 대상 구조물
    assert db.query(models.Tag).filter_by(kind="atype").count() == 0
    assert db.query(models.AuditLog).filter_by(action="VOCAB_SEED").count() == 2
    # 이미 용어가 있으면 다시 넣지 않는다
    assert vocab.seed(db, storage) == {}
    assert db.query(models.AuditLog).filter_by(action="VOCAB_SEED").count() == 2


def test_atype_kind_is_gone(db, storage):
    """42 — 해석 종류는 어휘 종류가 아니다(남은 atype 행이 있어도 읽지 않는다)."""
    vocab.seed(db, storage)
    _tag(db, "강도 평가", kind="atype", listed=True)
    assert "atype" not in vocab.KINDS
    with pytest.raises(HTTPException) as exc:
        vocab.add_term(db, storage, "A900001", "atype", "강도 평가")
    assert exc.value.detail == "invalid_kind"
    rep = vocab.normalize(db, storage, "system", apply=False)
    assert "atype" not in rep


def test_seed_keeps_existing_groups_together(db, storage):
    """이미 쓰던 구역 태그 묶음(Engine Room ← ER)은 기본 용어(기관실) 아래로 통째로 옮긴다."""
    er_root = _tag(db, "Engine Room")
    er = _tag(db, "ER", alias_of=er_root)
    vocab.seed(db, storage)
    db.expire_all()
    v = vocab.Vocab(db, "zone")
    assert v.canon("ER") == "기관실" and v.canon("Engine Room") == "기관실"
    assert db.get(models.Tag, er.id).alias_of_id == db.get(models.Tag, er_root.id).alias_of_id


def test_seed_promotes_child_term(db, storage):
    """기본 용어 값이 이미 다른 태그의 동의어면, 그 묶음의 대표로 올린다(값을 잃지 않는다)."""
    bow = _tag(db, "Bow")
    fwd = _tag(db, "선수부", alias_of=bow)
    vocab.seed(db, storage)
    db.expire_all()
    assert db.get(models.Tag, fwd.id).alias_of_id is None and db.get(models.Tag, fwd.id).listed
    assert db.get(models.Tag, bow.id).alias_of_id == fwd.id


def test_no_enforcement_without_list(db, storage, make_user, make_entry_file):
    """목록이 비어 있으면(시드 전) 예전처럼 자유 입력."""
    u = make_user()
    e, _ = make_entry_file(status="confirmed")
    service.update_entry(db, storage, e, u, {"version": e.version, "zones": ["X구역"], "target": "아무거나"})
    assert _zones(db, e) == ["X구역"] and service.target_of(db, db.get(models.Entry, e.id)) == "아무거나"


def test_input_normalised_and_closed_for_users(db, storage, make_user, make_entry_file):
    vocab.seed(db, storage)
    u = make_user()
    e, _ = make_entry_file(status="confirmed")
    service.update_entry(db, storage, e, u, {"version": e.version, "zones": ["FWD", "기관 실"],
                                              "analysis_type": "아무거나"})   # 42 — 해석 종류는 무시
    e = db.get(models.Entry, e.id)
    assert _zones(db, e) == ["기관실", "선수부"] and e.analysis_type is None
    with pytest.raises(HTTPException) as exc:
        service.update_entry(db, storage, e, u, {"version": e.version, "target": "새로운 구조물"})
    assert exc.value.status_code == 422 and exc.value.detail == "vocab_not_listed"
    db.rollback()
    with pytest.raises(HTTPException):
        service.update_entry(db, storage, db.get(models.Entry, e.id), u,
                             {"version": db.get(models.Entry, e.id).version, "zones": ["선수부", "새 구역"]})


def test_existing_unlisted_value_passes(db, storage, make_user, make_entry_file):
    """이미 그 Entry 에 있던 목록 밖 값은 다른 칸을 고쳐도 막지 않는다(데이터를 잃지 않게)."""
    u = make_user()
    e, _ = make_entry_file(status="confirmed")
    service.update_entry(db, storage, e, u, {"version": e.version, "zones": ["옛 구역"]})
    vocab.seed(db, storage)
    e = db.get(models.Entry, e.id)
    service.update_entry(db, storage, e, u, {"version": e.version, "zones": ["옛 구역", "선수부"], "title": "새 제목"})
    assert _zones(db, e) == ["선수부", "옛 구역"]


def test_admin_may_enter_unlisted(db, storage, make_user, make_entry_file):
    vocab.seed(db, storage)
    admin = make_user("A900001", is_admin=True)
    e, _ = make_entry_file(status="confirmed")
    service.update_entry(db, storage, e, admin, {"version": e.version, "zones": ["특수 구역"]})
    assert _zones(db, e) == ["특수 구역"]


# ---- 관리 ----

def test_add_term_rename_reorder_deactivate(db, storage, make_user, make_entry_file):
    vocab.seed(db, storage)
    u = make_user()
    e, _ = make_entry_file(status="confirmed")
    service.update_entry(db, storage, e, u, {"version": e.version, "zones": ["거주구"]})
    t = vocab.add_term(db, storage, "A900001", "zone", "펌프실")
    v = vocab.Vocab(db, "zone")
    # '기타' 는 늘 끝에 둔다
    assert [x.value for x in v.terms][-2:] == ["펌프실", "기타"]
    with pytest.raises(HTTPException) as exc:
        vocab.add_term(db, storage, "A900001", "zone", "FWD")
    assert exc.value.detail == "vocab_is_synonym"

    house = next(x for x in v.terms if x.value == "거주구")
    before = db.query(models.AuditLog).filter_by(action="ENTRY_UPDATE", target_id=e.entry_id).count()
    vocab.update_term(db, storage, "A900001", house, value="거주 구역부")
    db.expire_all()
    assert _zones(db, e) == ["거주 구역부"]                                   # 이름 바꾸기는 자료 전부에
    assert vocab.Vocab(db, "zone").canon("거주구") == "거주 구역부"           # 옛 이름은 동의어로 남는다
    assert db.query(models.AuditLog).filter_by(action="ENTRY_UPDATE", target_id=e.entry_id).count() == before + 1

    vocab.update_term(db, storage, "A900001", db.get(models.Tag, t.id), active=False)
    v = vocab.Vocab(db, "zone")
    assert not db.get(models.Tag, t.id).active and v.is_listed("펌프실")

    ids = [x.id for x in v.terms]
    vocab.reorder(db, storage, "A900001", "zone", list(reversed(ids)))
    assert [x.id for x in vocab.Vocab(db, "zone").terms] == list(reversed(ids))
    actions = {r.action for r in db.query(models.AuditLog)}
    assert {"VOCAB_TERM_ADD", "VOCAB_TERM_UPDATE", "VOCAB_REORDER"} <= actions


def test_rename_zone_rewrites_meta(db, storage, make_user, make_entry_file):
    vocab.seed(db, storage)
    u = make_user()
    e, _ = make_entry_file(status="confirmed")
    service.update_entry(db, storage, e, u, {"version": e.version, "zones": ["화물창"]})
    term = vocab.Vocab(db, "zone").term("화물창")
    vocab.update_term(db, storage, "A900001", term, value="카고 홀드")
    assert _zones(db, e) == ["카고 홀드"]
    assert vocab.Vocab(db, "zone").canon("화물창") == "카고 홀드"


def test_unlisted_and_merge(db, storage, make_user, make_entry_file):
    u = make_user()
    e1, _ = make_entry_file(status="confirmed")
    e2, _ = make_entry_file(status="draft")
    service.update_entry(db, storage, e1, u, {"version": db.get(models.Entry, e1.id).version, "zones": ["Hold No.3"]})
    service.update_entry(db, storage, e2, u, {"version": db.get(models.Entry, e2.id).version, "zones": ["Hold No.3"]})
    vocab.seed(db, storage)
    assert {r["value"]: r["count"] for r in vocab.unlisted(db, "zone")} == {"Hold No.3": 2}

    hold = vocab.Vocab(db, "zone").term("화물창")
    r = vocab.merge_value(db, storage, "A900001", "zone", "Hold No.3", hold)
    assert sorted(r["entries"]) == sorted([e1.entry_id, e2.entry_id])
    assert _zones(db, e1) == ["화물창"] and _zones(db, e2) == ["화물창"]
    assert vocab.Vocab(db, "zone").canon("Hold No.3") == "화물창"
    assert vocab.unlisted(db, "zone") == []
    assert db.query(models.AuditLog).filter_by(action="VOCAB_MERGE").count() == 1


def test_merge_rejects_term_and_missing(db, storage):
    vocab.seed(db, storage)
    v = vocab.Vocab(db, "zone")
    with pytest.raises(HTTPException) as exc:
        vocab.merge_value(db, storage, "A900001", "zone", "선미부", v.term("선수부"))
    assert exc.value.detail == "vocab_is_term"
    with pytest.raises(HTTPException) as exc:
        vocab.merge_value(db, storage, "A900001", "zone", "없는 구역", v.term("선수부"))
    assert exc.value.detail == "value_not_found"


def test_remove_synonym(db, storage):
    vocab.seed(db, storage)
    syn = db.query(models.Tag).filter_by(kind="zone", value="FWD").one()
    vocab.remove_synonym(db, storage, "A900001", syn)
    assert vocab.Vocab(db, "zone").canon("FWD") == "FWD"
    assert db.query(models.AuditLog).filter_by(action="VOCAB_SYNONYM_REMOVE").count() == 1


# ---- 일괄 정규화(CLI) ----

def _messy(db, storage, make_user, make_entry_file):
    u = make_user()
    a, _ = make_entry_file(status="confirmed")
    c, _ = make_entry_file(status="confirmed")
    service.update_entry(db, storage, a, u, {"version": db.get(models.Entry, a.id).version, "zones": ["FWD", "선미 부"]})
    service.update_entry(db, storage, c, u, {"version": db.get(models.Entry, c.id).version, "zones": ["알 수 없는 구역"]})
    return a, c


def test_normalize_report_is_dry(db, storage, make_user, make_entry_file):
    a, c = _messy(db, storage, make_user, make_entry_file)
    rep = vocab.normalize(db, storage, "system", apply=False)
    zn = {r["value"]: r for r in rep["zone"]["values"]}
    assert zn["FWD"]["to"] == "선수부" and zn["선미 부"]["to"] == "선미부" and zn["알 수 없는 구역"]["to"] is None
    assert rep["zone"]["changes"] == 1 and set(rep) >= {"zone", "target"} and "atype" not in rep
    # 아무것도 쓰지 않았다
    db.expire_all()
    assert db.query(models.Tag).filter_by(listed=True).count() == 0
    assert _zones(db, a) == ["FWD", "선미 부"]


def test_normalize_apply_idempotent(db, storage, make_user, make_entry_file):
    a, c = _messy(db, storage, make_user, make_entry_file)
    rep = vocab.normalize(db, storage, "system", apply=True)
    assert rep["zone"]["changes"] == 1
    db.expire_all()
    assert _zones(db, a) == ["선미부", "선수부"] and _zones(db, c) == ["알 수 없는 구역"]   # 못 맞춘 값은 그대로
    assert db.query(models.AuditLog).filter_by(action="VOCAB_NORMALIZE").count() == 1
    v_before = db.get(models.Entry, a.id).version
    again = vocab.normalize(db, storage, "system", apply=True)
    assert again["zone"]["changes"] == 0
    assert db.get(models.Entry, a.id).version == v_before
    assert {r["value"] for r in vocab.unlisted(db, "zone")} == {"알 수 없는 구역"}


def test_registry_keeps_vocab(db, storage):
    from app.ops.registry import build_registry

    vocab.seed(db, storage)
    _tag(db, "강도 평가", kind="atype", listed=True)        # 42 — 남은 atype 행은 registry 에 쓰지 않는다
    reg = build_registry(db)
    names = [t["value"] for t in reg["vocab"] if t["kind"] == "zone"]
    assert names[0] == "선수부" and "기타" in names
    assert any(t["kind"] == "zone" and t["value"] == "FWD" and t["alias_of"] == "선수부" for t in reg["tags"])
    assert not [t for t in reg["vocab"] + reg["tags"] if t["kind"] == "atype"]


def test_rebuild_restores_vocab(db, storage):
    from app.ops.rebuild import _restore_aliases, _restore_vocab
    from app.ops.registry import build_registry

    vocab.seed(db, storage)
    reg = build_registry(db)
    reg["vocab"].append({"kind": "atype", "value": "강도 평가", "sort_order": 0, "active": True})   # 옛 registry
    db.query(models.Tag).update({"alias_of_id": None})
    db.query(models.Tag).delete()
    db.commit()
    _restore_aliases(db, reg)
    _restore_vocab(db, reg)
    db.commit()
    v = vocab.Vocab(db, "zone")
    assert [t.value for t in v.terms] == vocab.DEFAULTS["zone"]
    assert v.canon("FWD") == "선수부"
    assert db.query(models.Tag).filter_by(kind="atype").count() == 0


# ---- 42 — 구역·대상 지우기(자료에서도 함께 뺀다) ----

def test_delete_term_removes_value_from_entries(db, storage, make_user, make_entry_file):
    import json

    from app.storage.paths import to_long

    vocab.seed(db, storage)
    u = make_user()
    conf, _ = make_entry_file(status="confirmed")
    draft, _ = make_entry_file(status="draft")
    trashed, _ = make_entry_file(status="confirmed")
    other, _ = make_entry_file(status="confirmed")
    service.set_zones(db, conf, ["FWD", "기관실"])   # 동의어 행을 그대로 단 자료(옛 데이터)
    service.update_entry(db, storage, draft, u, {"version": draft.version, "zones": ["선수부"]})
    service.update_entry(db, storage, trashed, u, {"version": trashed.version, "zones": ["선수부"]})
    service.update_entry(db, storage, other, u, {"version": other.version, "zones": ["기관실"]})
    trashed = db.get(models.Entry, trashed.id)
    trashed.status = "trashed"
    db.commit()
    v0 = db.get(models.Entry, conf.id).version

    term = vocab.Vocab(db, "zone").term("선수부")
    r = vocab.delete_term(db, storage, "A900001", term)
    assert r["value"] == "선수부"
    assert sorted(r["entries"]) == sorted([conf.entry_id, draft.entry_id, trashed.entry_id])
    db.expire_all()
    assert _zones(db, conf) == ["기관실"] and _zones(db, draft) == [] and _zones(db, other) == ["기관실"]
    assert service.tags_of(db, db.get(models.Entry, trashed.id), "zone") == []
    assert db.get(models.Entry, conf.id).version == v0 + 1
    # 목록에서 동의어째 사라진다
    v = vocab.Vocab(db, "zone")
    assert v.target("선수부") is None and v.target("FWD") is None and v.terms[-1].value == vocab.OTHER
    assert db.query(models.Tag).filter(models.Tag.kind == "zone", models.Tag.value.in_(("선수부", "FWD"))).count() == 0
    # 감사 — 확정 자료만 ENTRY_UPDATE, 목록 VOCAB_TERM_DELETE
    acts = db.query(models.AuditLog).filter_by(action="ENTRY_UPDATE", employee_id="A900001").all()
    assert [a.target_id for a in acts] == [conf.entry_id]
    assert acts[0].before == {"zones": ["FWD", "기관실"]} and acts[0].after == {"zones": ["기관실"]}
    d = db.query(models.AuditLog).filter_by(action="VOCAB_TERM_DELETE").one()
    assert d.before["value"] == "선수부" and "FWD" in d.before["synonyms"] and d.target_id == "zone:선수부"
    meta = json.loads(open(to_long(storage.vault / "2026" / conf.entry_id / "entry.json"), encoding="utf-8").read())
    assert meta["zones"] == ["기관실"] and "analysis_type" not in meta


def test_delete_target_term_and_unknown(db, storage, make_user, make_entry_file):
    vocab.seed(db, storage)
    u = make_user()
    e, _ = make_entry_file(status="confirmed")
    service.update_entry(db, storage, e, u, {"version": e.version, "target": "블록"})
    term = vocab.Vocab(db, "target").term("블록")
    vocab.delete_term(db, storage, "A900001", term)
    db.expire_all()
    assert service.target_of(db, db.get(models.Entry, e.id)) is None
    a = db.query(models.AuditLog).filter_by(action="ENTRY_UPDATE", employee_id="A900001").one()
    assert a.before == {"target": "블록"} and a.after == {"target": None}
    # 동의어 행·없는 행은 용어가 아니다
    syn = db.query(models.Tag).filter_by(kind="zone", value="FWD").one()
    with pytest.raises(HTTPException) as exc:
        vocab.delete_term(db, storage, "A900001", syn)
    assert exc.value.status_code == 404
