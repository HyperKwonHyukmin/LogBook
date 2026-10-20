"""38 — 대상 구조물(target): 통제 어휘·자료 값·제목 초안·entry.json·검색."""
import json
from datetime import datetime

import pytest
from fastapi import HTTPException

from app import models, vocab
from app.entries import naming, service


def test_compose_title_puts_target_before_distinct():
    t = naming.compose_title(hulls=["3496"], zones=["선수부"], target="계류 의장품", distinct="M04 rev3")
    assert t == "3496 · 선수부 · 계류 의장품 · M04 rev3"
    # 대상만으로는 형식 제목을 만들지 않는다(머리 칸이 없으면 예전 방식)
    assert naming.compose_title(target="계류 의장품") == ""


def test_target_synonym_removed_from_distinct():
    d = naming.distinct_part("3496_Mooring_Fitting_rev3", hulls=["3496"], phrases=["계류 의장품", "Mooring Fitting"])
    assert d == "rev3"


def test_patch_target_normalizes_and_retitles_draft(db, storage, make_user, setup_entry_with_files):
    vocab.seed(db, storage)
    u = make_user("A100001")
    _, e = setup_entry_with_files()
    e.title_source = "3496_Mooring_Fitting_rev3"
    e.title = service.quality.TitleContext(db).draft(e)
    db.commit()
    assert e.title == "3496 · 선수부 · Mooring Fitting rev3"
    e = service.update_entry(db, storage, e, u, {"version": e.version, "target": "Mooring Fitting"})
    d = service.entry_to_dict(db, e, viewer=u)
    assert d["target"] == "계류 의장품"                     # 동의어 → 용어
    assert d["title"] == "3496 · 선수부 · 계류 의장품 · rev3"   # 사람이 안 고친 초안 제목은 따라간다
    e = service.update_entry(db, storage, e, u, {"version": e.version, "target": None})
    assert service.target_of(db, e) is None


def test_target_not_listed_needs_admin(db, storage, make_user, setup_entry_with_files):
    vocab.seed(db, storage)
    u = make_user("A100001")
    _, e = setup_entry_with_files()
    with pytest.raises(HTTPException) as ei:
        service.update_entry(db, storage, e, u, {"version": e.version, "target": "처음 보는 구조물"})
    assert ei.value.detail == "vocab_not_listed"


def test_confirmed_target_written_to_entry_json_and_audit(db, storage, make_user, setup_entry_with_files):
    vocab.seed(db, storage)
    u = make_user("A100001")
    _, e = setup_entry_with_files()
    service.confirm(db, storage, e, u)
    db.expire_all()
    e = db.get(models.Entry, e.id)
    service.update_entry(db, storage, e, u, {"version": e.version, "target": "해치 커버"})
    base = storage.vault / str(datetime.now().year) / e.entry_id
    meta = json.loads((base / "entry.json").read_text(encoding="utf-8"))
    assert meta["target"] == "해치 커버"
    assert "대상: 해치 커버" in (base / "_INFO.txt").read_text(encoding="utf-8")
    log = db.query(models.AuditLog).filter_by(action="ENTRY_UPDATE").order_by(models.AuditLog.id.desc()).first()
    assert "target" not in (log.before or {}) and log.after["target"] == "해치 커버"


def test_search_filters_and_groups_by_target(client, db, storage, make_user, auth_headers, setup_entry_with_files):
    vocab.seed(db, storage)
    u = make_user("A100001")
    _, a = setup_entry_with_files()
    _, b = setup_entry_with_files(key="20260929-000000-cccc")
    for e in (a, b):
        service.confirm(db, storage, e, u)
    db.expire_all()
    a = db.get(models.Entry, a.id)
    service.update_entry(db, storage, a, u, {"version": a.version, "target": "Lashing Bridge"})
    h = auth_headers("A100001")
    res = client.get("/api/search", params={"target": "래싱 브리지"}, headers=h).json()
    assert [r["entry_id"] for r in res["items"]] == [a.entry_id]
    assert res["items"][0]["target"] == "래싱 브리지"
    facets = client.get("/api/search/browse", headers=h).json()["facets"]["target"]
    hit = next(f for f in facets if f["value"] == "래싱 브리지")
    assert hit["count"] == 1 and "Lashing Bridge" in hit["aliases"]
    groups = client.get("/api/search", params={"group": "target"}, headers=h).json()["groups"]
    assert [g["value"] for g in groups] == ["래싱 브리지", None]
