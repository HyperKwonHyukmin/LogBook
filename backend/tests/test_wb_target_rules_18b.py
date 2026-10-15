"""18-b — WorkBench 앱별 보내기 제한(분류 규칙: 구역·태그).

계획: docs/plans/2026-10-08-logbook-18-workbench-link.md §8. 합성 데이터만(가상 호선 9999)."""
import dataclasses
import os

import pytest

from app import models, vocab, wb_targets
from app.ops.registry import read_registry
from app.routers import integration
from app.storage.paths import to_long

SECRET = "test-integration-secret-18b"
H = {"X-HiTESS-Integration": SECRET}
LV1, LV2, LV3 = "G181001", "M181001", "A181001"


@pytest.fixture
def secret(monkeypatch):
    monkeypatch.setattr(integration, "settings", dataclasses.replace(integration.settings, wb_integration_secret=SECRET))


def _tag(db, entry, kind, value):
    t = db.query(models.Tag).filter_by(kind=kind, value=value).first()
    if t is None:
        t = models.Tag(kind=kind, value=value)
        db.add(t)
        db.flush()
    db.add(models.EntryTag(entry_id=entry.id, tag_id=t.id))
    db.flush()
    return t


def _set(db, target, zones=(), tags=()):
    row = db.get(models.WbTargetRule, target) or models.WbTargetRule(target=target)
    row.zones, row.tags = list(zones), list(tags)
    db.add(row)
    db.commit()


def _put(storage, entry, f, data: bytes):
    vf = storage.vault / "2026" / entry.entry_id / "files"
    os.makedirs(to_long(vf), exist_ok=True)
    with open(to_long(vf / f.name), "wb") as fh:
        fh.write(data)


@pytest.fixture
def world(db, storage, make_user, make_entry_file):
    make_user(LV1, name="게스트", level=1)
    make_user(LV2, name="일반", level=2)
    make_user(LV3, name="관리자", level=3)
    vocab.seed(db, storage)   # 구역 목록(선수부 ← FWD 동의어 등)
    out = {}
    for k in ("truss", "plain", "hidden"):
        e, f = make_entry_file(title=f"모델 {k}", name=f"{k}.bdf", kind="model", hulls=("9999",))
        e.access = "blocked" if k == "hidden" else "shared"
        db.add(models.ModelSummary(file_id=f.id, state="done", key=k[0] * 64, includes=[], missing=[]))
        _put(storage, e, f, b"SOL 101\nCEND\nBEGIN BULK\nGRID,1\nENDDATA\n")
        out[k] = (e, f)
    _tag(db, out["truss"][0], "free", "Truss")
    db.commit()
    return out


# ---- 기본 규칙 ----

def test_seed_upgrades_untouched_old_default(db, storage):
    """이전 기본값(태그만)을 관리자가 손대지 않았으면 구역 'Truss' 를 더한 새 기본값으로 올린다."""
    db.add(models.WbTargetRule(target="truss", zones=[], tags=["Truss"], updated_by="system"))
    db.commit()
    assert wb_targets.seed(db, storage) == ["truss"]
    assert wb_targets.get_rule(db, "truss") == {"zones": ["Truss"], "tags": ["Truss"]}
    assert wb_targets.seed(db, storage) == []


def test_seed_keeps_admin_rule(db, storage):
    db.add(models.WbTargetRule(target="truss", zones=[], tags=["Truss"], updated_by=LV3))
    db.commit()
    assert wb_targets.seed(db, storage) == []
    assert wb_targets.get_rule(db, "truss") == {"zones": [], "tags": ["Truss"]}


def test_truss_zone_alone_is_enough(db, storage, world):
    """태그가 없어도 구역이 'Truss' 면 Truss 로 보낼 수 있다."""
    wb_targets.seed(db, storage)
    e, _f = world["plain"]
    _tag(db, e, "zone", "Truss")
    db.commit()
    ok, _ = wb_targets.Matcher(db, "truss").entries([e.id])[e.id]
    assert ok


def test_seed_once_and_not_reseeded_after_emptying(db, storage):
    assert wb_targets.seed(db, storage) == ["truss"]
    assert wb_targets.get_rule(db, "truss") == {"zones": ["Truss"], "tags": ["Truss"]}
    assert vocab.Vocab(db, "zone").target("truss").value == "Truss"   # 구역 목록 용어로 생긴다
    assert wb_targets.get_rule(db, "gmu") == {"zones": [], "tags": []}   # 행 없음 = 제한 없음
    assert db.query(models.AuditLog).filter_by(action="WB_RULE_SEED").count() == 1
    _set(db, "truss")                                  # 관리자가 비움
    assert wb_targets.seed(db, storage) == []
    assert wb_targets.get_rule(db, "truss") == {"zones": [], "tags": []}


# ---- 판정 ----

def test_matching_zone_tag_alias_and_spacing(db, world, make_entry_file):
    e_plain = world["plain"][0]
    _set(db, "truss", zones=["선수부"], tags=["Truss"])
    m = wb_targets.Matcher(db, "truss")
    assert m.entries([world["truss"][0].id])[world["truss"][0].id] == (True, None)
    ok, why = m.entries([e_plain.id])[e_plain.id]
    assert not ok and why == "구역 '선수부' 또는 태그 'Truss' 가 붙은 자료만 Truss Structural Assessment 로 보낼 수 있습니다."

    # 구역 동의어(FWD → 선수부)로도 통과
    _tag(db, e_plain, "zone", "FWD")
    db.commit()
    assert wb_targets.Matcher(db, "truss").entries([e_plain.id])[e_plain.id][0] is True

    # 태그 동의어(트러스 → Truss)·대소문자·공백 차이
    e2, _ = make_entry_file(title="동의어", name="b.bdf", kind="model")
    truss = db.query(models.Tag).filter_by(kind="free", value="Truss").one()
    syn = _tag(db, e2, "free", "트러스")
    syn.alias_of_id = truss.id
    e3, _ = make_entry_file(title="표기", name="c.bdf", kind="model")
    _tag(db, e3, "free", "T russ ")
    e4, _ = make_entry_file(title="다른 태그", name="d.bdf", kind="model")
    _tag(db, e4, "free", "Unit")
    db.commit()
    _set(db, "truss", tags=["truss"])                 # 규칙은 소문자로
    v = wb_targets.Matcher(db, "truss").entries([e2.id, e3.id, e4.id])
    assert v[e2.id][0] and v[e3.id][0] and not v[e4.id][0]
    # 규칙에 동의어를 적어도 대표값으로 맞춘다
    _set(db, "truss", tags=["트러스"])
    assert wb_targets.Matcher(db, "truss").entries([world["truss"][0].id])[world["truss"][0].id][0] is True


def test_empty_rule_allows_and_staging_file_blocked(db, world):
    m = wb_targets.Matcher(db, "gmu")
    assert m.entries([world["plain"][0].id]) == {world["plain"][0].id: (True, None)}
    loose = models.File(batch_id=world["plain"][1].batch_id, entry_id=None, rel_path="x.bdf", name="x.bdf",
                        ext=".bdf", kind="model", size=1, sha256="z" * 64, location="staging")
    assert m.file(loose) == (True, None)
    _set(db, "truss", tags=["Truss"])
    ok, why = wb_targets.Matcher(db, "truss").file(loose)
    assert not ok and "Truss Structural Assessment" in why


def test_korean_label_particle():
    assert wb_targets.reason("gmu", {"zones": [], "tags": ["Unit"]}).endswith("권상 구조 해석 으로 보낼 수 있습니다.")


# ---- 통합 API(content) ----

def test_content_target_not_allowed_body_top_level(secret, client, db, world):
    _set(db, "truss", tags=["Truss"])
    fid = world["plain"][1].id
    r = client.get(f"/api/integration/files/{fid}/content?as={LV2}&target=truss", headers=H)
    assert r.status_code == 409
    body = r.json()
    assert body["detail"] == "target_not_allowed"
    assert body["message"] == "태그 'Truss' 가 붙은 자료만 Truss Structural Assessment 로 보낼 수 있습니다."
    assert db.query(models.AuditLog).filter_by(action="WB_EXPORT").count() == 0
    # 규칙에 맞는 모델·제한 없는 대상·target 없음은 그대로 보낸다
    assert client.get(f"/api/integration/files/{world['truss'][1].id}/content?as={LV2}&target=truss",
                      headers=H).status_code == 200
    assert client.get(f"/api/integration/files/{fid}/content?as={LV2}&target=gmu", headers=H).status_code == 200
    assert client.get(f"/api/integration/files/{fid}/content?as={LV2}", headers=H).status_code == 200


def test_content_unknown_target_422(secret, client, world):
    r = client.get(f"/api/integration/files/{world['plain'][1].id}/content?as={LV2}&target=bogus", headers=H)
    assert r.status_code == 422 and r.json()["detail"] == "unknown_target"


def test_content_check_order(secret, client, db, world):
    _set(db, "truss", tags=["Truss"])
    # 볼 수 없는 파일은 규칙에 안 맞아도 404(있는지 드러내지 않는다)
    r = client.get(f"/api/integration/files/{world['hidden'][1].id}/content?as={LV2}&target=truss", headers=H)
    assert r.status_code == 404
    # INCLUDE 가 먼저(409 has_includes)
    s = db.get(models.ModelSummary, world["plain"][1].id)
    s.includes = ["sub.bdf"]
    db.commit()
    r = client.get(f"/api/integration/files/{world['plain'][1].id}/content?as={LV2}&target=truss", headers=H)
    assert r.status_code == 409 and r.json()["detail"] == "has_includes"


# ---- 화면용 API ----

def test_list_targets_and_eligible_hides_invisible(client, db, world, auth_headers):
    _set(db, "truss", tags=["Truss"])
    h = auth_headers(LV2)
    lst = client.get("/api/wb-targets", headers=h).json()
    by = {t["target"]: t for t in lst}
    assert by["gmu"]["condition"] is None and by["gmu"]["label"] == "Group & Module Unit 권상 구조 해석"
    assert by["truss"]["condition"] == "태그 'Truss' 가 붙은 자료만 보낼 수 있습니다"
    codes = [world[k][0].entry_id for k in ("truss", "plain", "hidden")] + ["E999999"]
    r = client.post("/api/wb-targets/truss/eligible", json={"entry_ids": codes + [codes[0].lower()]}, headers=h)
    assert r.status_code == 200, r.text
    d = r.json()
    assert set(d) == {codes[0], codes[1]}                       # 블록(LV2 못 봄)·없는 번호는 뺀다
    assert d[codes[0]] == {"ok": True, "reason": None}
    assert d[codes[1]]["ok"] is False and "태그 'Truss'" in d[codes[1]]["reason"]
    # LV3 은 블록도 본다
    d3 = client.post("/api/wb-targets/truss/eligible", json={"entry_ids": codes}, headers=auth_headers(LV3)).json()
    assert codes[2] in d3
    assert client.post("/api/wb-targets/bogus/eligible", json={"entry_ids": codes}, headers=h).status_code == 422
    too_many = [f"E{i:06d}" for i in range(201)]
    assert client.post("/api/wb-targets/truss/eligible", json={"entry_ids": too_many}, headers=h).status_code == 422
    assert client.get("/api/wb-targets").status_code == 401


# ---- 관리(LV3) ----

def test_admin_put_validation_permission_audit_registry(client, db, storage, world, auth_headers):
    h2, h3 = auth_headers(LV2), auth_headers(LV3)
    assert client.get("/api/admin/wb-targets", headers=h2).status_code == 403
    assert client.put("/api/admin/wb-targets/truss", json={"zones": [], "tags": ["X"]}, headers=h2).status_code == 403

    r = client.put("/api/admin/wb-targets/truss", json={"zones": ["FWD", "선수부"], "tags": [" Truss ", "truss", "트러스"]},
                   headers=h3)
    assert r.status_code == 200, r.text
    assert r.json()["zones"] == ["선수부"] and r.json()["tags"] == ["Truss", "트러스"]
    assert r.json()["updated_by"] == LV3 and r.json()["updated_at"]
    row = db.get(models.WbTargetRule, "truss")
    db.refresh(row)
    assert row.updated_by == LV3
    log = db.query(models.AuditLog).filter_by(action="WB_RULE_SET").one()
    assert log.target_type == "wb_target" and log.target_id == "truss" and log.after["tags"] == ["Truss", "트러스"]
    assert read_registry(storage)["wb_target_rules"][0]["tags"] == ["Truss", "트러스"]

    r = client.put("/api/admin/wb-targets/truss", json={"zones": ["없는구역"], "tags": []}, headers=h3)
    assert r.status_code == 422 and r.json()["detail"] == "zone_not_listed"
    r = client.put("/api/admin/wb-targets/bogus", json={"zones": [], "tags": []}, headers=h3)
    assert r.status_code == 422 and r.json()["detail"] == "unknown_target"
    r = client.put("/api/admin/wb-targets/truss", json={"zones": [], "tags": [f"t{i}" for i in range(21)]}, headers=h3)
    assert r.status_code == 422 and r.json()["detail"] == "too_many_values"

    # 비우기 — 빈 규칙도 registry 에 남는다(재구축 때 기본 규칙으로 되돌아가지 않게)
    r = client.put("/api/admin/wb-targets/truss", json={"zones": [], "tags": []}, headers=h3)
    assert r.status_code == 200 and r.json()["condition"] is None
    assert read_registry(storage)["wb_target_rules"] == [
        {**read_registry(storage)["wb_target_rules"][0], "zones": [], "tags": []}]
    lst = client.get("/api/admin/wb-targets", headers=h3).json()
    assert [t["target"] for t in lst] == ["gmu", "truss"] and lst[1]["updated_by"] == LV3


def test_rebuild_restores_rules(db, storage):
    from app.ops.rebuild import _restore_wb_rules

    wb_targets.seed(db, storage)
    n = _restore_wb_rules(db, {"wb_target_rules": [{"target": "truss", "zones": [], "tags": []},
                                                    {"target": "gmu", "zones": ["선수부"], "tags": []},
                                                    {"target": "bogus", "tags": ["x"]}]})
    db.commit()
    assert n == 2
    assert wb_targets.get_rule(db, "truss") == {"zones": [], "tags": []}
    assert wb_targets.get_rule(db, "gmu") == {"zones": ["선수부"], "tags": []}


def test_sso_resets_auto_filter_flag(secret, client, world, monkeypatch):
    """새 선택 모드(같은 창을 다른 대상으로 다시 열 때)마다 자동 검색 필터를 다시 한 번 켜게 표시를 지운다."""
    monkeypatch.setattr(integration, "redeem_code", lambda code: {"employee_id": LV2, "wb_ref": None})
    r = client.get("/sso?code=" + "c" * 43 + "&target=truss&slot=1")
    assert r.status_code == 200
    assert "sessionStorage.removeItem('logbook_wb_filter_applied')" in r.text
