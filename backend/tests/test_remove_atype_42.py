"""42 — 해석 종류 걷어 내기: 옛 entries.analysis_type 값·tags.kind='atype' 행이 남아 있어도 어디서도 읽지 않는다."""
import json

from app import models, vocab
from app.entries import naming, quality, service
from app.storage.paths import to_long


def _world(db, storage, make_user, make_entry_file):
    make_user("A100001", level=3)
    vocab.seed(db, storage)
    db.add(models.Tag(kind="atype", value="강도 평가", listed=True))   # 옛 해석 종류 목록 행
    e, _ = make_entry_file(title="옛 자료", hulls=("3496",), name="m.bdf", kind="model", analysis_type="강도 평가")
    service.set_zones(db, e, ["선수부"])
    db.commit()
    return e


def test_api_no_longer_speaks_analysis_type(client, auth_headers, db, storage, make_user, make_entry_file):
    e = _world(db, storage, make_user, make_entry_file)
    h = auth_headers("A100001")
    # 자료 응답·검색 행·거르기 칸·요약
    d = client.get(f"/api/entries/{e.entry_id}", headers=h).json()
    assert "analysis_type" not in d and d["required_missing"] == [] and d["needs_fix"] == []
    res = client.get("/api/search", headers=h).json()
    assert "analysis_type" not in res["facets"] and "analysis_type" not in res["summary"]
    assert all("analysis_type" not in i for i in res["items"])
    # 옛 주소의 analysis_type= 필터는 무시, 묶기는 422
    assert client.get("/api/search", params={"analysis_type": "없는 값"}, headers=h).json()["total"] == 1
    assert client.get("/api/search", params={"group": "analysis_type"}, headers=h).status_code == 422
    # 검색어로 옛 값을 찾지 않는다
    assert client.get("/api/search", params={"q": "강도"}, headers=h).json()["total"] == 0
    # 자동완성·분류 목록·분류 화면
    assert client.get("/api/suggest", params={"kind": "analysis_type"}, headers=h).status_code == 422
    assert client.get("/api/vocab", params={"kind": "atype"}, headers=h).status_code == 422
    assert "analysis_type" not in client.get("/api/search/browse", headers=h).json()["facets"]
    # 호선·갖춤 현황·관계 지도
    assert "analysis_types" not in client.get("/api/hulls/3496", headers=h).json()["stats"]
    cov = client.get("/api/coverage", headers=h).json()
    assert all("analysis_type" not in x for x in cov["entries"])
    graph = client.get("/api/graph", headers=h).json()
    assert all("analysis_type" not in x for x in graph["entries"])


def test_patch_ignores_analysis_type_and_entry_json_drops_it(client, auth_headers, db, storage, make_user,
                                                              make_entry_file):
    e = _world(db, storage, make_user, make_entry_file)
    h = auth_headers("A100001")
    v = client.get(f"/api/entries/{e.entry_id}", headers=h).json()["version"]
    r = client.patch(f"/api/entries/{e.entry_id}", json={"version": v, "analysis_type": "FE 해석", "title": "새"},
                     headers=h)
    assert r.status_code == 200 and r.json()["title"] == "새"
    db.expire_all()
    assert db.get(models.Entry, e.id).analysis_type == "강도 평가"      # 열은 건드리지 않는다
    a = db.query(models.AuditLog).filter_by(action="ENTRY_UPDATE", target_id=e.entry_id).one()
    assert "analysis_type" not in a.before and "analysis_type" not in a.after
    meta = json.loads(open(to_long(storage.vault / "2026" / e.entry_id / "entry.json"), encoding="utf-8").read())
    assert "analysis_type" not in meta


def test_required_and_title_without_analysis_type(db, storage, make_user, make_entry_file):
    e = _world(db, storage, make_user, make_entry_file)
    assert quality.REQUIRED == ("hull", "zone_or_target")
    assert quality.missing_required(db, e) == []
    assert quality.TitleContext(db).draft(e, source="3496_선수부_강도평가_M04") == "3496 · 선수부 · 강도평가 M04"
    assert naming.compose_title(hulls=["3496"], zones=["선수부"], target="블록") == "3496 · 선수부 · 블록"


def test_registry_and_rebuild_skip_old_values(db, storage, make_user, make_entry_file):
    from app.ops.registry import build_registry

    _world(db, storage, make_user, make_entry_file)
    reg = build_registry(db)
    assert not [t for t in reg["vocab"] + reg["tags"] if t["kind"] == "atype"]
