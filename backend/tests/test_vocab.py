"""08 — 해석 종류·구역 통제 어휘(태그 동의어 확장)."""
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
    assert vocab.clean("  FE   해석 ") == "FE 해석"
    assert vocab.key("강도 평가") == vocab.key("강도평가") == vocab.key(" 강도  평가")


def test_seed_defaults_once(db, storage):
    added = vocab.seed(db, storage)
    assert added["atype"][0] == "강도 평가" and added["atype"][-1] == "기타"
    assert "기관실" in added["zone"]
    v = vocab.Vocab(db, "atype")
    assert [t.value for t in v.terms][:3] == ["강도 평가", "FE 해석", "진동 해석"]
    assert v.canon("FEM 해석") == "FE 해석"          # 기본 동의어
    assert v.canon("강도평가") == "강도 평가"          # 공백만 다른 표기
    assert v.canon("fe해석") == "FE 해석"
    assert v.canon("모르는 값") == "모르는 값"
    assert v.is_listed("기타") and not v.is_listed("모르는 값")
    assert db.query(models.AuditLog).filter_by(action="VOCAB_SEED").count() == 2
    # 이미 용어가 있으면 다시 넣지 않는다
    assert vocab.seed(db, storage) == {}
    assert db.query(models.AuditLog).filter_by(action="VOCAB_SEED").count() == 2


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
    service.update_entry(db, storage, e, u, {"version": e.version, "analysis_type": "아무거나", "zones": ["X구역"]})
    assert db.get(models.Entry, e.id).analysis_type == "아무거나"


def test_input_normalised_and_closed_for_users(db, storage, make_user, make_entry_file):
    vocab.seed(db, storage)
    u = make_user()
    e, _ = make_entry_file(status="confirmed")
    service.update_entry(db, storage, e, u, {"version": e.version, "analysis_type": "FEM 해석",
                                              "zones": ["FWD", "기관 실"]})
    e = db.get(models.Entry, e.id)
    assert e.analysis_type == "FE 해석"
    assert _zones(db, e) == ["기관실", "선수부"]
    with pytest.raises(HTTPException) as exc:
        service.update_entry(db, storage, e, u, {"version": e.version, "analysis_type": "새로운 해석"})
    assert exc.value.status_code == 422 and exc.value.detail == "vocab_not_listed"
    db.rollback()
    with pytest.raises(HTTPException):
        service.update_entry(db, storage, db.get(models.Entry, e.id), u,
                             {"version": db.get(models.Entry, e.id).version, "zones": ["선수부", "새 구역"]})


def test_existing_unlisted_value_passes(db, storage, make_user, make_entry_file):
    """이미 그 Entry 에 있던 목록 밖 값은 다른 칸을 고쳐도 막지 않는다(데이터를 잃지 않게)."""
    u = make_user()
    e, _ = make_entry_file(status="confirmed", analysis_type="옛 해석")
    service.update_entry(db, storage, e, u, {"version": e.version, "zones": ["옛 구역"]})
    vocab.seed(db, storage)
    e = db.get(models.Entry, e.id)
    service.update_entry(db, storage, e, u, {"version": e.version, "analysis_type": "옛 해석",
                                              "zones": ["옛 구역", "선수부"], "title": "새 제목"})
    e = db.get(models.Entry, e.id)
    assert e.analysis_type == "옛 해석" and _zones(db, e) == ["선수부", "옛 구역"]


def test_admin_may_enter_unlisted(db, storage, make_user, make_entry_file):
    vocab.seed(db, storage)
    admin = make_user("A900001", is_admin=True)
    e, _ = make_entry_file(status="confirmed")
    service.update_entry(db, storage, e, admin, {"version": e.version, "analysis_type": "특수 해석"})
    assert db.get(models.Entry, e.id).analysis_type == "특수 해석"


# ---- 관리 ----

def test_add_term_rename_reorder_deactivate(db, storage, make_user, make_entry_file):
    vocab.seed(db, storage)
    e, _ = make_entry_file(status="confirmed", analysis_type="계류 해석")
    t = vocab.add_term(db, storage, "A900001", "atype", "충돌 해석")
    v = vocab.Vocab(db, "atype")
    # '기타' 는 늘 끝에 둔다
    assert [x.value for x in v.terms][-2:] == ["충돌 해석", "기타"]
    with pytest.raises(HTTPException) as exc:
        vocab.add_term(db, storage, "A900001", "atype", "FEM 해석")
    assert exc.value.detail == "vocab_is_synonym"

    mooring = next(x for x in v.terms if x.value == "계류 해석")
    vocab.update_term(db, storage, "A900001", mooring, value="계류력 해석")
    db.expire_all()
    assert db.get(models.Entry, e.id).analysis_type == "계류력 해석"
    assert vocab.Vocab(db, "atype").canon("계류 해석") == "계류력 해석"   # 옛 이름은 동의어로 남는다
    assert db.query(models.AuditLog).filter_by(action="ENTRY_UPDATE", target_id=e.entry_id).count() == 1

    vocab.update_term(db, storage, "A900001", db.get(models.Tag, t.id), active=False)
    v = vocab.Vocab(db, "atype")
    assert not db.get(models.Tag, t.id).active and v.is_listed("충돌 해석")

    ids = [x.id for x in v.terms]
    vocab.reorder(db, storage, "A900001", "atype", list(reversed(ids)))
    assert [x.id for x in vocab.Vocab(db, "atype").terms] == list(reversed(ids))
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
    e1, _ = make_entry_file(status="confirmed", analysis_type="구조 강도")
    e2, _ = make_entry_file(status="draft", analysis_type="구조 강도")
    e3, _ = make_entry_file(status="confirmed", analysis_type="FEM 해석")
    service.update_entry(db, storage, e1, u, {"version": db.get(models.Entry, e1.id).version, "zones": ["Hold No.3"]})
    vocab.seed(db, storage)
    out = {r["value"]: r["count"] for r in vocab.unlisted(db, "atype")}
    assert out == {"구조 강도": 2}          # FEM 해석 은 동의어라 목록 안
    assert {r["value"] for r in vocab.unlisted(db, "zone")} == {"Hold No.3"}

    term = vocab.Vocab(db, "atype").term("강도 평가")
    r = vocab.merge_value(db, storage, "A900001", "atype", "구조 강도", term)
    assert sorted(r["entries"]) == sorted([e1.entry_id, e2.entry_id])
    db.expire_all()
    assert db.get(models.Entry, e1.id).analysis_type == "강도 평가"
    assert db.get(models.Entry, e2.id).analysis_type == "강도 평가"
    assert vocab.Vocab(db, "atype").canon("구조 강도") == "강도 평가"
    assert vocab.unlisted(db, "atype") == []
    assert db.query(models.AuditLog).filter_by(action="VOCAB_MERGE").count() == 1

    hold = vocab.Vocab(db, "zone").term("화물창")
    vocab.merge_value(db, storage, "A900001", "zone", "Hold No.3", hold)
    assert _zones(db, e1) == ["화물창"]
    assert vocab.unlisted(db, "zone") == []


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
    syn = db.query(models.Tag).filter_by(kind="atype", value="FEM 해석").one()
    vocab.remove_synonym(db, storage, "A900001", syn)
    assert vocab.Vocab(db, "atype").canon("FEM 해석") == "FEM 해석"
    assert db.query(models.AuditLog).filter_by(action="VOCAB_SYNONYM_REMOVE").count() == 1


# ---- 일괄 정규화(CLI) ----

def _messy(db, storage, make_user, make_entry_file):
    u = make_user()
    a, _ = make_entry_file(status="confirmed", analysis_type="FEM 해석")
    b, _ = make_entry_file(status="confirmed", analysis_type="강도평가")
    c, _ = make_entry_file(status="confirmed", analysis_type="이상한 해석")
    d, _ = make_entry_file(status="draft", analysis_type="FE 해석")
    service.update_entry(db, storage, a, u, {"version": db.get(models.Entry, a.id).version, "zones": ["FWD", "선미 부"]})
    service.update_entry(db, storage, c, u, {"version": db.get(models.Entry, c.id).version, "zones": ["알 수 없는 구역"]})
    return a, b, c, d


def test_normalize_report_is_dry(db, storage, make_user, make_entry_file):
    a, b, c, d = _messy(db, storage, make_user, make_entry_file)
    rep = vocab.normalize(db, storage, "system", apply=False)
    at = {r["value"]: r for r in rep["atype"]["values"]}
    assert at["FEM 해석"]["to"] == "FE 해석" and at["강도평가"]["to"] == "강도 평가"
    assert at["이상한 해석"]["to"] is None and at["FE 해석"]["to"] == "FE 해석"
    zn = {r["value"]: r for r in rep["zone"]["values"]}
    assert zn["FWD"]["to"] == "선수부" and zn["선미 부"]["to"] == "선미부" and zn["알 수 없는 구역"]["to"] is None
    assert rep["atype"]["changes"] == 2 and rep["zone"]["changes"] == 1
    # 아무것도 쓰지 않았다
    db.expire_all()
    assert db.query(models.Tag).filter_by(listed=True).count() == 0
    assert db.get(models.Entry, a.id).analysis_type == "FEM 해석"


def test_normalize_apply_idempotent(db, storage, make_user, make_entry_file):
    a, b, c, d = _messy(db, storage, make_user, make_entry_file)
    rep = vocab.normalize(db, storage, "system", apply=True)
    assert rep["atype"]["changes"] == 2 and rep["zone"]["changes"] == 1
    db.expire_all()
    assert db.get(models.Entry, a.id).analysis_type == "FE 해석"
    assert db.get(models.Entry, b.id).analysis_type == "강도 평가"
    assert db.get(models.Entry, c.id).analysis_type == "이상한 해석"      # 못 맞춘 값은 그대로
    assert _zones(db, a) == ["선미부", "선수부"] and _zones(db, c) == ["알 수 없는 구역"]
    assert vocab.Vocab(db, "atype").canon("강도평가") == "강도 평가"       # 표기 변형도 동의어로 남는다
    assert db.query(models.AuditLog).filter_by(action="VOCAB_NORMALIZE").count() == 1
    v_before = db.get(models.Entry, a.id).version
    again = vocab.normalize(db, storage, "system", apply=True)
    assert again["atype"]["changes"] == 0 and again["zone"]["changes"] == 0
    assert db.get(models.Entry, a.id).version == v_before
    assert {r["value"] for r in vocab.unlisted(db, "atype")} == {"이상한 해석"}


def test_registry_keeps_vocab(db, storage):
    from app.ops.registry import build_registry

    vocab.seed(db, storage)
    reg = build_registry(db)
    names = [t["value"] for t in reg["vocab"] if t["kind"] == "atype"]
    assert names[0] == "강도 평가" and "기타" in names
    assert any(t["kind"] == "atype" and t["value"] == "FEM 해석" and t["alias_of"] == "FE 해석" for t in reg["tags"])


def test_rebuild_restores_vocab(db, storage):
    from app.ops.rebuild import _restore_aliases, _restore_vocab
    from app.ops.registry import build_registry

    vocab.seed(db, storage)
    reg = build_registry(db)
    db.query(models.Tag).update({"alias_of_id": None})
    db.query(models.Tag).delete()
    db.commit()
    _restore_aliases(db, reg)
    _restore_vocab(db, reg)
    db.commit()
    v = vocab.Vocab(db, "atype")
    assert [t.value for t in v.terms] == vocab.DEFAULTS["atype"]
    assert v.canon("FEM 해석") == "FE 해석"
