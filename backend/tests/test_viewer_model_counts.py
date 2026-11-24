"""2026-11-25 — .inp(Abaqus)·.fem(OptiStruct) 만 있는 자료가 검색에서 '문서만'으로 보이던 것.

파일 종류(kind)는 other 그대로(BDF 전용 기능이 읽지 않게) 두고, '모델이 있는가'를 셀 때만 보기 전용 모델(model_view)로 센다.
"""
from app import models

OWNER = "U250001"


def _viewer_entry(make_entry_file, name="m.inp", title="inp 자료"):
    e, _ = make_entry_file(title=title, hulls=("3496",), name=name, kind="other", uploaded_by=OWNER)
    make_entry_file(entry=e, name="r.pdf", kind="report")
    return e


def test_search_counts_viewer_models(db, client, auth_headers, make_user, make_entry_file):
    make_user(OWNER, level=2)
    inp = _viewer_entry(make_entry_file, "a.INP", "inp 자료")
    fem = _viewer_entry(make_entry_file, "b.fem", "fem 자료")
    plain, _ = make_entry_file(title="기타만", hulls=("3496",), name="x.zip", kind="other", uploaded_by=OWNER)
    h = auth_headers(OWNER)
    items = {i["entry_id"]: i for i in client.get("/api/search", headers=h).json()["items"]}
    for e in (inp, fem):
        kc = items[e.entry_id]["kind_counts"]
        assert kc["model_view"] == 1 and kc["other"] == 0 and kc["model"] == 0 and kc["report"] == 1
        assert "model_view" in items[e.entry_id]["kinds"]
        assert items[e.entry_id]["needs_fix"] == []   # 호선 필수 규칙은 BDF 만
    assert items[plain.entry_id]["kind_counts"]["other"] == 1
    # 종류 필터: 자료 보기와 파일 보기 모두
    got = {i["entry_id"] for i in client.get("/api/search", params={"kind": "model_view"}, headers=h).json()["items"]}
    assert got == {inp.entry_id, fem.entry_id}
    files = client.get("/api/search", params={"kind": "model_view", "unit": "file"}, headers=h).json()["items"]
    assert sorted(f["name"] for f in files) == ["a.INP", "b.fem"] and {f["kind"] for f in files} == {"other"}
    others = client.get("/api/search", params={"kind": "other", "unit": "file"}, headers=h).json()["items"]
    assert [f["name"] for f in others] == ["x.zip"]
    facets = {f["value"]: f["count"] for f in client.get("/api/search", headers=h).json()["facets"]["kind"]}
    assert facets["model_view"] == 2 and facets["other"] == 1


def test_targets_and_coverage_see_viewer_models(db, client, auth_headers, make_user, make_entry_file):
    make_user(OWNER, level=2)
    e = _viewer_entry(make_entry_file)
    t = models.Tag(kind="target", value="PSD", listed=True)
    db.add(t)
    db.flush()
    db.add(models.EntryTag(entry_id=e.id, tag_id=t.id))
    db.commit()
    h = auth_headers(OWNER)
    p = client.get("/api/targets/page", params={"value": "PSD"}, headers=h).json()
    assert e.entry_id not in [x["entry_id"] for x in p["gaps"]["no_model"]["items"]]
    assert [x["entry_id"] for x in p["start"]] == [e.entry_id]
    row = next(r for r in client.get("/api/coverage", headers=h).json()["entries"] if r["id"] == e.entry_id)
    assert row["models"] == 1 and row["solve"] is None and row["needs_fix"] is False
