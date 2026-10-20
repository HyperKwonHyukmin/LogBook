"""40 — 구역·대상 뜻 나누기: 구역에 들어간 구조물 값(Unit·Truss)을 대상으로 옮기기(vocab.move_term).

계획: docs/plans/2026-10-19-logbook-40-zone-target-split.md. 합성 데이터만."""
import json

import pytest
from fastapi import HTTPException

from app import cli, models, vocab, wb_targets
from app.entries import quality, service
from app.ops.registry import read_registry
from app.storage.paths import to_long


def _zone_term(db, value, synonyms=()):
    t = vocab._new_tag(db, "zone", value)
    t.listed, t.sort_order = True, 900
    for s in synonyms:
        vocab._new_tag(db, "zone", s, alias_of=t)
    db.commit()
    return t


def _set(db, e, zones=None, target=None):
    if zones is not None:
        service.set_tags(db, e, "zone", zones)
    if target is not None:
        service.set_tags(db, e, "target", [target])
    db.commit()


def _vals(db, e, kind):
    return service.tags_of(db, db.get(models.Entry, e.id), kind)


@pytest.fixture
def world(db, storage, make_entry_file):
    vocab.seed(db, storage)
    _zone_term(db, "Unit", synonyms=("GMU",))
    out = {}
    out["only"], _ = make_entry_file(status="confirmed", title="Unit 만")          # 구역 Unit → 대상 Unit
    out["mixed"], _ = make_entry_file(status="confirmed", title="위치도 있음")      # 구역 선수부+GMU(동의어)
    out["busy"], _ = make_entry_file(status="confirmed", title="대상이 이미 있음")  # 다른 대상 → 옮기지 않음
    out["draft"], _ = make_entry_file(status="draft", title="초안")
    _set(db, out["only"], zones=["Unit"])
    _set(db, out["mixed"], zones=["선수부", "GMU"])
    _set(db, out["busy"], zones=["Unit"], target="블록")
    _set(db, out["draft"], zones=["선수부", "Unit"])   # 제목이 '선수부 외 1' → '선수부 · Unit' 으로 바뀐다
    out["draft"].title = quality.TitleContext(db).draft(out["draft"])   # 사람이 고치지 않은 초안 제목
    db.commit()
    return out


def test_report_is_dry(db, storage, world):
    rep = vocab.move_term(db, storage, "system", "zone", "unit", "target")
    assert rep["value"] == "Unit" and rep["synonyms"] == ["GMU"] and rep["dest"] == "Unit"
    assert rep["dest_exists"] is False and rep["applied"] is False
    assert set(rep["moved"]) == {world[k].entry_id for k in ("only", "mixed", "draft")}
    assert [s["entry_id"] for s in rep["skipped"]] == [world["busy"].entry_id]
    assert rep["skipped"][0]["target"] == "블록"
    db.expire_all()
    assert _vals(db, world["only"], "zone") == ["Unit"] and _vals(db, world["only"], "target") == []
    assert vocab.Vocab(db, "target").target("Unit") is None
    assert db.query(models.AuditLog).filter_by(action="VOCAB_MOVE").count() == 0


def test_apply_moves_entries_and_vocab(db, storage, world):
    old_title = world["draft"].title
    rep = vocab.move_term(db, storage, "A900001", "zone", "Unit", "target", apply=True)
    assert rep["applied"]
    db.expire_all()
    only, mixed, busy, draft = (world[k] for k in ("only", "mixed", "busy", "draft"))
    assert _vals(db, only, "zone") == [] and _vals(db, only, "target") == ["Unit"]
    assert _vals(db, mixed, "zone") == ["선수부"] and _vals(db, mixed, "target") == ["Unit"]
    assert _vals(db, draft, "target") == ["Unit"]
    d = db.get(models.Entry, draft.id)
    assert d.title == quality.TitleContext(db).draft(d) and d.title != old_title   # 초안 자동 제목은 새 값으로
    # 대상이 이미 있는 자료는 그대로 — 구역 Unit 은 목록 밖 값으로 남는다
    assert _vals(db, busy, "zone") == ["Unit"] and _vals(db, busy, "target") == ["블록"]

    zv, tv = vocab.Vocab(db, "zone"), vocab.Vocab(db, "target")
    assert zv.target("Unit") is None and "Unit" not in [t.value for t in zv.terms]
    assert {u["value"] for u in vocab.unlisted(db, "zone")} == {"Unit"}
    assert tv.target("Unit").value == "Unit" and tv.canon("GMU") == "Unit"   # 동의어 묶음째 옮겼다
    assert tv.terms[-1].value == vocab.OTHER                                   # '기타' 는 늘 끝
    assert db.query(models.Tag).filter_by(kind="zone", value="GMU").first() is None

    # 감사·entry.json·registry
    acts = db.query(models.AuditLog).filter_by(action="ENTRY_UPDATE").all()
    assert {a.target_id for a in acts} == {only.entry_id, mixed.entry_id}      # 확정 자료만 이력
    a = next(a for a in acts if a.target_id == mixed.entry_id)
    assert a.before == {"zones": ["GMU", "선수부"], "target": None} and a.after == {"zones": ["선수부"], "target": "Unit"}
    mv = db.query(models.AuditLog).filter_by(action="VOCAB_MOVE").one()
    assert mv.after["term"] == "Unit" and mv.after["skipped"] == [busy.entry_id]
    meta = json.loads(open(to_long(storage.vault / "2026" / only.entry_id / "entry.json"), encoding="utf-8").read())
    assert meta["target"] == "Unit" and meta["zones"] == []
    reg = read_registry(storage)
    assert any(t["kind"] == "target" and t["value"] == "Unit" for t in reg["vocab"])


def test_merges_into_existing_target_term(db, storage, make_entry_file):
    """옮길 곳에 같은 값(또는 동의어)의 용어가 있으면 그 용어로 합친다 — 같은 대상을 단 자료도 옮긴다."""
    vocab.seed(db, storage)
    _zone_term(db, "Global Model")            # 대상 '전선 모델' 의 기본 동의어
    e1, _ = make_entry_file(status="confirmed")
    e2, _ = make_entry_file(status="confirmed")
    _set(db, e1, zones=["Global Model"])
    _set(db, e2, zones=["Global Model"], target="전선 모델")
    rep = vocab.move_term(db, storage, "system", "zone", "Global Model", "target", apply=True)
    assert rep["dest"] == "전선 모델" and rep["dest_exists"] and rep["skipped"] == []
    db.expire_all()
    assert _vals(db, e1, "target") == ["전선 모델"] and _vals(db, e2, "target") == ["전선 모델"]
    assert _vals(db, e1, "zone") == [] and _vals(db, e2, "zone") == []
    assert db.query(models.Tag).filter_by(kind="zone", value="Global Model").first() is None
    assert vocab.Vocab(db, "target").canon("Global Model") == "전선 모델"


def test_moves_wb_rule_value(db, storage, make_entry_file):
    """예전 기본 규칙(구역 'Truss')의 값도 대상으로 옮긴다 — 손대지 않은 기본 규칙은 계속 system 것."""
    vocab.seed(db, storage)
    _zone_term(db, "Truss")
    db.add(models.WbTargetRule(target="truss", zones=["Truss"], tags=["Truss"], updated_by="system"))
    db.commit()
    wb_targets.seed(db, storage)   # 대상 'Truss' 를 더한다(구역은 남김)
    e, _ = make_entry_file(status="confirmed")
    _set(db, e, zones=["Truss"])
    assert wb_targets.Matcher(db, "truss").entries([e.id])[e.id][0] is True

    rep = vocab.move_term(db, storage, "system", "zone", "Truss", "target")
    assert rep["rules"] == [{"target": "truss",
                             "before": {"zones": ["Truss"], "targets": ["Truss"], "tags": ["Truss"]},
                             "after": {"zones": [], "targets": ["Truss"], "tags": ["Truss"]}}]
    vocab.move_term(db, storage, "system", "zone", "Truss", "target", apply=True)
    db.expire_all()
    assert wb_targets.get_rule(db, "truss") == {"zones": [], "targets": ["Truss"], "tags": ["Truss"]}
    assert db.get(models.WbTargetRule, "truss").updated_by == "system"
    assert wb_targets.Matcher(db, "truss").entries([e.id])[e.id][0] is True
    assert read_registry(storage)["wb_target_rules"][0]["targets"] == ["Truss"]
    assert wb_targets.seed(db, storage) == []


def test_errors(db, storage):
    vocab.seed(db, storage)
    with pytest.raises(HTTPException) as ei:
        vocab.move_term(db, storage, "system", "zone", "없는 값", "target")
    assert ei.value.status_code == 404
    with pytest.raises(HTTPException) as ei:
        vocab.move_term(db, storage, "system", "atype", "FE 해석", "target")
    assert ei.value.status_code == 422


def test_cli_vocab_move(db, storage, world, capsys, monkeypatch):
    monkeypatch.setattr(cli, "get_storage", lambda: storage)
    assert cli.main(["vocab-move", "zone", "Unit", "target"]) == 0
    out = capsys.readouterr().out
    assert "[구역 → 대상] 'Unit' (동의어 GMU) → 대상 'Unit' (새 용어)" in out
    assert "옮길 자료 3건" in out and "옮기지 않는 자료 1건" in out and "--apply" in out
    assert cli.main(["vocab-move", "zone", "Unit", "target", "--apply"]) == 0
    db.expire_all()
    assert _vals(db, world["only"], "target") == ["Unit"]
    assert cli.main(["vocab-move", "zone", "없음", "target"]) == 1


@pytest.mark.fresh_schema   # 스키마를 바꾼다(conftest 'DB 초기화')
def test_ensure_columns_adds_rule_targets():
    """40 이전 DB(wb_target_rules.targets 없음)에 시작 때 열을 더한다."""
    from sqlalchemy import text

    from app import database

    with database.engine.begin() as conn:
        conn.execute(text("ALTER TABLE wb_target_rules DROP COLUMN targets"))
    assert database.init_schema() == ["wb_target_rules.targets"]
    assert database.init_schema() == []
