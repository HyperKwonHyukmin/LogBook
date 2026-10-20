"""15 — LogBook 등급(LV1~LV3) + 자료 공개 단계(공유·일반·블록) + 개별 허락. 유출 방지 매트릭스.

13 의 매트릭스(test_access_13)를 새 체계로 옮겼다. 등급 4종(LV1·LV2·LV3·WorkBench 관리자) + 올린 사람 × 자료 6종으로,
볼 수 없는 자료가 상세·파일·검색·건수·묶음·요약·분류·호선·즐겨찾기·최근 비교·같은 BDF·판 묶음/비교·감사 로그
어디에도 드러나지 않는지(404·목록 제외) 확인한다. 합성 데이터만(가상 호선 9999·9001·9002)."""
import gzip
import json
import os
from datetime import datetime

import pytest

from app import access, models
from app.bdf.signature import VERSION as SIG_VERSION
from app.convert.job import model_paths
from app.solve.job import f06_path
from app.storage.paths import to_long

USERS = {"lv1": "G100001", "lv2": "M100001", "lv3": "A100001", "wbadmin": "W100001", "owner": "U100001"}
ROLES = tuple(USERS)
OWNER = USERS["owner"]       # 대부분의 자료를 올린 사람(LV2)
# sh 공유 / no 일반 / bl 블록 / ng 일반 + LV1 허락 / bg 블록 + LV2 허락 / own1 LV1 이 올린 자료(블록됨)
KINDS = ("sh", "no", "bl", "ng", "bg", "own1")
ACCESS = {"sh": "shared", "no": "normal", "bl": "blocked", "ng": "normal", "bg": "blocked", "own1": "blocked"}
EXPECT = {
    "lv1": {"sh", "ng", "own1"},                 # 공유 + 허락 + 자기 자료(블록돼도)
    "lv2": {"sh", "no", "ng", "bg"},             # 공유 + 일반 + 블록은 허락 있을 때
    "lv3": set(KINDS),
    "wbadmin": set(KINDS),                       # WorkBench 관리자 = 자동 LV3(저장값 1)
    "owner": {"sh", "no", "bl", "ng", "bg"},     # LV2 + 자기가 올린 블록 자료
}
HULLS = {"sh": ("9999",), "no": ("9999",), "bl": ("9001", "9002"), "ng": ("9999",), "bg": ("9001",),
         "own1": ("9001",)}
SIG = {"sig_geometry": "g" * 64, "sig_property": "p" * 64, "sig_material": "m" * 64, "sig_load": "l" * 64}


@pytest.fixture
def world(db, storage, make_user, make_entry_file):
    """사용자 5명 + 자료 6건(각각 BDF 1개 + 보고서 1개, 같은 내용 서명) + 파생물·f06·추출 본문."""
    make_user(USERS["lv1"], name="게스트 사용자", level=1)
    make_user(USERS["lv2"], name="일반 사용자", level=2)
    make_user(USERS["lv3"], name="관리자 사용자", level=3)
    make_user(USERS["wbadmin"], name="WB관리자 사용자", level=1, wb_admin=True)
    make_user(OWNER, name="올린 사람", level=2)
    entries, files = {}, {}
    for i, k in enumerate(KINDS):
        e, f = make_entry_file(title=f"계류 검토 {k}", hulls=HULLS[k], name=f"m{k}.bdf", kind="model",
                               uploaded_by=USERS["lv1"] if k == "own1" else OWNER, analysis_type=f"종류{k}",
                               confirmed_at=datetime(2026, 9, 1 + i, 9, 0, 0))
        make_entry_file(entry=e, name=f"r{k}.xlsx", kind="report")
        e.access = ACCESS[k]
        key = f"{i:02d}" + "k" * 62
        db.add(models.ModelSummary(file_id=f.id, state="done", key=key, counts={"GRID": 10 + i, "CBAR": 5},
                                   format_version=2, sig_version=SIG_VERSION, **SIG))
        db.add(models.SolveCheck(file_id=f.id, state="pass", model_key=key, has_f06=True))
        db.add(models.FileExtract(file_id=f.id, state="done", summary={"title": k}))
        db.add(models.FileText(file_id=f.id, seq=0, locator="body", text=f"본문 계류력 {k}"))
        # 자유 태그 — 볼 수 없는 자료에만 쓰인 태그 이름은 숨는다
        tag = models.Tag(kind="free", value=f"태그{k}")
        db.add(tag)
        db.flush()
        db.add(models.EntryTag(entry_id=e.id, tag_id=tag.id))
        lbm, png = model_paths(storage, key, 2)
        for p, data in ((lbm, gzip.compress(b"LBM")), (png, b"PNG")):   # lbm 은 gzip 으로 내려간다
            os.makedirs(to_long(p.parent), exist_ok=True)
            with open(to_long(p), "wb") as fh:
                fh.write(data)
        p06 = f06_path(storage, key)
        os.makedirs(to_long(p06.parent), exist_ok=True)
        with open(to_long(p06), "wb") as fh:
            fh.write(b"F06")
        vf = storage.vault / "2026" / e.entry_id / "files"
        os.makedirs(to_long(vf), exist_ok=True)
        with open(to_long(vf / f.name), "wb") as fh:
            fh.write(b"GRID")
        entries[k], files[k] = e, f
    db.add(models.EntryGrant(entry_id=entries["ng"].id, employee_id=USERS["lv1"], granted_by=OWNER))
    db.add(models.EntryGrant(entry_id=entries["bg"].id, employee_id=USERS["lv2"], granted_by=USERS["lv3"]))
    # 모든 사용자가 모든 자료를 즐겨찾기에 넣어 둔 상태(권한이 바뀌기 전에 넣었다고 가정)
    for eid in USERS.values():
        for e in entries.values():
            db.add(models.Favorite(employee_id=eid, entry_id=e.id, created_at=datetime(2026, 10, 1)))
        # 최근 비교: (공유, 각 자료) 묶음
        for k in KINDS[1:]:
            ids = [files["sh"].id, files[k].id]
            db.add(models.CompareHistory(employee_id=eid, file_ids=ids, ids_key=",".join(map(str, sorted(ids)))))
    db.add(models.AuditLog(employee_id=OWNER, action="ENTRY_UPDATE", target_type="entry",
                           target_id=entries["bl"].entry_id, after={"title": "비밀 제목"}))
    db.add(models.AuditLog(employee_id=OWNER, action="SOLVE_CHECK", target_type="file",
                           target_id=str(files["bl"].id), after={"name": files["bl"].name}))
    db.commit()
    return {"e": {k: e.entry_id for k, e in entries.items()}, "f": {k: f.id for k, f in files.items()},
            "pk": {k: e.id for k, e in entries.items()}}


def _ids(items, key="entry_id"):
    return {i[key] for i in items}


def _kinds(world, eids):
    rev = {v: k for k, v in world["e"].items()}
    return {rev[e] for e in eids if e in rev}


@pytest.mark.parametrize("role", ROLES)
def test_detail_and_files_matrix(role, world, client, auth_headers):
    h = auth_headers(USERS[role])
    for k in KINDS:
        ok = k in EXPECT[role]
        eid, fid = world["e"][k], world["f"][k]
        want = 200 if ok else 404
        r = client.get(f"/api/entries/{eid}", headers=h)
        assert r.status_code == want, (role, k, r.text)
        if not ok:
            assert r.json()["detail"] == "entry_not_found"   # 없는 번호와 같은 응답
        else:
            assert r.json()["access"] == ACCESS[k]
            assert "analysis_period" not in r.json()        # 15 — 해석 시기는 응답에 없다
        assert client.get(f"/api/entries/{eid}/history", headers=h).status_code == want
        assert client.get(f"/api/entries/{eid}/revisions", headers=h).status_code == want   # 14 판 묶음
        for path in ("", "/text", "/model", "/model.lbm", "/thumb.png", "/solve-check", "/solve-check.f06"):
            r = client.get(f"/api/files/{fid}{path}", headers=h)
            assert r.status_code == want, (role, k, path, r.status_code, r.text[:100])
            if not ok:
                assert r.json()["detail"] == "file_not_found"
        if k != "sh":   # 14 판 비교 — 두 파일 중 하나라도 볼 수 없으면 404
            assert client.get(f"/api/files/{world['f']['sh']}/diff/{fid}", headers=h).status_code == want
        r = client.post(f"/api/files/{fid}/link", headers=h)
        assert r.status_code == want
        if ok:
            assert client.get(r.json()["url"]).content == b"GRID"
        # 즐겨찾기 넣기도 존재를 숨긴다
        assert client.put(f"/api/favorites/{eid}", headers=h).status_code == want


@pytest.mark.parametrize("role", ROLES)
def test_search_lists_and_counts_matrix(role, world, client, auth_headers):
    h = auth_headers(USERS[role])
    seen = EXPECT[role]
    res = client.get("/api/search", headers=h).json()
    assert _kinds(world, _ids(res["items"])) == seen
    assert res["total"] == len(seen) == res["summary"]["total"]
    assert res["sort"] == "recent" and "year" not in res["facets"] and "years" not in res["summary"]
    hull_counts = {f["value"]: f["count"] for f in res["facets"]["hull"]}
    want_hulls = {}
    for k in seen:
        for hn in HULLS[k]:
            want_hulls[hn] = want_hulls.get(hn, 0) + 1
    assert hull_counts == want_hulls
    assert "analysis_type" not in res["facets"]   # 42 — 해석 종류는 없앴다
    # 배지 — 공유·블록은 단계 이름, 일반은 표시 없음(볼 수 있는 사람에게만 실린다)
    labels = {i["entry_id"]: i["label"] for i in res["items"]}
    for k in seen:
        assert labels[world["e"][k]] == {"shared": "공유", "normal": None, "blocked": "블록"}[ACCESS[k]]
    # 검색어 — 제목·본문·속성 적중 모두 거른다
    for q in ("계류", "계류력", "태그bl"):   # 42 — 속성 적중은 태그로(해석 종류는 없앴다)
        r = client.get("/api/search", params={"q": q}, headers=h).json()
        assert _kinds(world, _ids(r["items"])) <= seen, (role, q)
    assert client.get("/api/search", params={"q": "태그bl"}, headers=h).json()["total"] == (1 if "bl" in seen else 0)
    # 파일 보기
    r = client.get("/api/search", params={"unit": "file"}, headers=h).json()
    assert _kinds(world, _ids(r["items"])) == seen and r["total"] == 2 * len(seen)
    # 묶어 보기 — 묶음 건수도 보이는 것만
    g = client.get("/api/search", params={"group": "hull"}, headers=h).json()
    assert {x["value"]: x["count"] for x in g["groups"]} == want_hulls
    # 정렬을 바꿔도 같은 집합(옛 주소 sort=period 도 받는다)
    for sort in ("recent", "period", "relevance"):
        r = client.get("/api/search", params={"sort": sort}, headers=h).json()
        assert _kinds(world, _ids(r["items"])) == seen
    # 분류 둘러보기
    b = client.get("/api/search/browse", headers=h).json()
    assert b["total"] == len(seen) and "year" not in b["facets"]
    assert {f["value"]: f["count"] for f in b["facets"]["hull"]} == want_hulls
    # 호선 목록·호선 화면
    hl = {x["hull_no"]: x["entries"] for x in client.get("/api/hulls", headers=h).json()}
    assert hl == want_hulls
    d = client.get("/api/hulls/9999", headers=h).json()
    assert d["stats"]["entries"] == want_hulls.get("9999", 0)
    tl = {e["entry_id"] for m in d["timeline"] for e in m["entries"]}
    assert _kinds(world, tl) == {k for k in seen if "9999" in HULLS[k]}
    # 9002 는 bl(블록)에만 있는 호선 — 볼 수 없으면 호선 자체가 없는 것과 같다
    want_9002 = 200 if "bl" in seen else 404
    assert client.get("/api/hulls/9002", headers=h).status_code == want_9002
    assert client.get("/api/search", params={"q": "9002"}, headers=h).json()["hull_suggestion"]["known"] is (
        "bl" in seen)


@pytest.mark.parametrize("role", ROLES)
def test_personal_lists_matrix(role, world, client, auth_headers, db):
    h = auth_headers(USERS[role])
    seen = EXPECT[role]
    fav = client.get("/api/favorites", headers=h).json()
    assert _kinds(world, _ids(fav["items"])) == seen and fav["total"] == len(seen)
    r = client.get("/api/search", params={"fav": 1}, headers=h).json()
    assert r["total"] == len(seen)
    # 최근 비교 — 숨은 파일이 낀 묶음(남는 모델이 2개 미만)은 목록에서 빠진다. 행은 지우지 않는다
    items = client.get("/api/me/compares", headers=h).json()["items"]
    rev = {v: k for k, v in world["f"].items()}
    shown = {rev[i] for it in items for i in it["file_ids"]}
    assert shown <= seen
    assert len(items) == len(seen - {"sh"})
    assert all(it["dropped"] == 0 for it in items)
    assert db.query(models.CompareHistory).filter_by(employee_id=USERS[role]).count() == 5
    hidden = [k for k in KINDS if k not in seen]
    if hidden:
        r = client.post("/api/me/compares", json={"file_ids": [world["f"]["sh"], world["f"][hidden[0]]]}, headers=h)
        assert r.status_code == 422 and r.json()["detail"] == "too_few_models"


@pytest.mark.parametrize("role", ROLES)
def test_same_model_and_side_lists_matrix(role, world, client, auth_headers, db):
    h = auth_headers(USERS[role])
    seen = EXPECT[role]
    d = client.get(f"/api/entries/{world['e']['sh']}", headers=h).json()
    m = next(f for f in d["files"] if f["kind"] == "model")["model"]
    others = {r["entry_id"] for r in m["same_model"]}
    assert _kinds(world, others) == seen - {"sh"}
    assert m["same_model_total"] == len(seen - {"sh"})
    tags = {t["value"]: t["count"] for t in client.get("/api/tags", params={"kind": "free"}, headers=h).json()}
    assert tags == {f"태그{k}": 1 for k in seen}
    sug = client.get("/api/suggest", params={"kind": "tag", "q": "태그"}, headers=h).json()
    assert set(sug) == {f"태그{k}" for k in seen}
    assert client.get("/api/suggest", params={"kind": "analysis_type", "q": "종류"}, headers=h).status_code == 422
    sug = client.get("/api/suggest", params={"kind": "hull", "q": "9"}, headers=h).json()
    assert set(sug) == {hn for k in seen for hn in HULLS[k]}
    # 19 — 상단 검색창 자동완성(여러 종류 한 번에)도 같은 규칙
    allsug = client.get("/api/suggest/all", params={"q": "9", "limit": 20}, headers=h).json()
    assert set(allsug["hull"]) == {hn for k in seen for hn in HULLS[k]}
    allsug = client.get("/api/suggest/all", params={"q": "태그", "limit": 20}, headers=h).json()
    assert set(allsug["tag"]) == {f"태그{k}" for k in seen}
    # 감사 로그 — 볼 수 없는 Entry·파일에 대한 기록은 빠진다
    log = client.get("/api/audit", headers=h).json()
    targets = {(x["target"]["type"], x["target"]["id"]) for x in log}
    assert (("entry", world["e"]["bl"]) in targets) is ("bl" in seen)
    assert (("file", str(world["f"]["bl"])) in targets) is ("bl" in seen)


def test_trash_list_hides(world, client, auth_headers, db):
    for k in ("sh", "bl"):
        e = db.query(models.Entry).filter_by(entry_id=world["e"][k]).one()
        e.status = "trashed"
        e.trash_rel = f"{e.entry_id}_20261007-000000"
    db.commit()
    got = {x["entry_id"] for x in client.get("/api/trash", headers=auth_headers(USERS["lv2"])).json()}
    assert got == {world["e"]["sh"]}
    got = {x["entry_id"] for x in client.get("/api/trash", headers=auth_headers(USERS["lv3"])).json()}
    assert got == {world["e"]["sh"], world["e"]["bl"]}


def test_filter_and_function_agree(world, db):
    """SQL 거르개(visible_entries_filter)와 한 건 판정(can_view_entry)이 같은 규칙인지."""
    for role, eid in USERS.items():
        u = db.query(models.User).filter_by(employee_id=eid).one()
        sql = {pk for (pk,) in db.query(models.Entry.id).filter(access.visible_entries_filter(u))}
        one = {e.id for e in db.query(models.Entry) if access.can_view_entry(u, e, db=db)}
        assert sql == one == {world["pk"][k] for k in EXPECT[role]}, role


def test_legacy_access_values_are_normal(world, db):
    """옮기기 전 13 값(public/private)이 남은 행은 '일반'으로 다룬다 — LV1 에게 새지 않는다."""
    e = db.query(models.Entry).filter_by(entry_id=world["e"]["no"]).one()
    for legacy in ("public", "private"):
        e.access = legacy
        db.commit()
        for role, eid in USERS.items():
            u = db.query(models.User).filter_by(employee_id=eid).one()
            assert access.can_view_entry(u, e, db=db) is (role != "lv1"), (legacy, role)
            sql = {pk for (pk,) in db.query(models.Entry.id).filter(access.visible_entries_filter(u))}
            assert (e.id in sql) is (role != "lv1")
        assert access.access_brief(e) == {"access": "normal", "label": None}


def test_unowned_blocked_draft_hidden_and_not_claimable(world, client, auth_headers, db, make_entry_file):
    """주인 없는 배치(uploaded_by NULL)의 블록 초안 — '숨은 것' 조건(~거르개)이 NULL 때문에 놓치지 않고,
    볼 수 없는 사람은 그 배치를 가져가(claim) 올린 사람이 될 수 없다."""
    d, _ = make_entry_file(status="draft", title="주인 없는 블록", uploaded_by=None, name="u.bdf", kind="model")
    d.access = "blocked"
    db.get(models.Batch, d.batch_id).state = "processed"
    db.add(models.AuditLog(employee_id="A100001", action="ENTRY_UPDATE", target_type="entry",
                           target_id=d.entry_id, after={"title": "주인 없는 블록"}))
    db.commit()
    key = db.get(models.Batch, d.batch_id).key
    for role in ("lv1", "lv2"):
        u = db.query(models.User).filter_by(employee_id=USERS[role]).one()
        hidden = {pk for (pk,) in db.query(models.Entry.id).filter(~access.visible_entries_filter(u))}
        assert d.id in hidden, role
        h = auth_headers(USERS[role])
        assert d.entry_id not in {r["target"]["id"] for r in client.get("/api/audit", headers=h).json()}
        assert client.get(f"/api/batches/{key}", headers=h).status_code == 404
        r = client.post(f"/api/batches/{key}/claim", headers=h)
        assert r.status_code == 404 and r.json()["detail"] == "batch_not_found", role
    db.expire_all()
    assert db.get(models.Batch, d.batch_id).uploader is None
    assert client.post(f"/api/batches/{key}/claim", headers=auth_headers(USERS["lv3"])).status_code == 200


# ---- 쓰기 권한 ----

def test_level1_can_upload_but_not_write_shared_data(world, client, auth_headers, db):
    """LV1 — 올리기·자기 자료는 되고, 공용 데이터(태그 동의어·호선 메모)·남의 자료 해석 검증은 403 level2_required."""
    h = auth_headers(USERS["lv1"])
    assert client.post("/api/uploads", json={"name": "x"}, headers=h).status_code == 201
    r = client.patch("/api/hulls/9999", json={"memo": "x"}, headers=h)
    assert r.status_code == 403 and r.json()["detail"] == "level2_required"
    tag = db.query(models.Tag).filter_by(kind="free", value="태그sh").one()
    other = db.query(models.Tag).filter_by(kind="free", value="태그ng").one()
    r = client.post(f"/api/tags/{tag.id}/alias", json={"target_id": other.id}, headers=h)
    assert r.status_code == 403 and r.json()["detail"] == "level2_required"
    r = client.post(f"/api/files/{world['f']['sh']}/solve-check", headers=h)
    assert r.status_code == 403 and r.json()["detail"] == "level2_required"
    assert client.post(f"/api/files/{world['f']['own1']}/solve-check", headers=h).status_code == 200   # 자기 자료
    # 남의 자료 수정은 403, 사용자 찾기·개인 기능은 된다
    r = client.patch(f"/api/entries/{world['e']['sh']}", json={"version": 1, "title": "x"}, headers=h)
    assert r.status_code == 403 and r.json()["detail"] == "not_uploader"
    assert client.get("/api/users/lookup", params={"q": "M"}, headers=h).status_code == 200
    assert client.put(f"/api/favorites/{world['e']['sh']}", headers=h).status_code == 200
    assert client.put("/api/me/prefs", json={"search.previewWidth": 400}, headers=h).status_code == 200
    # LV2 는 공용 데이터를 쓴다
    h2 = auth_headers(USERS["lv2"])
    assert client.patch("/api/hulls/9999", json={"memo": "메모"}, headers=h2).status_code == 200
    assert client.post(f"/api/files/{world['f']['sh']}/solve-check", headers=h2).status_code == 200


def test_level1_edits_own_blocked_entry_but_not_its_access(world, client, auth_headers):
    """LV1 이 올린 자료가 블록되면 — 볼 수 있고 내용은 고치지만, 단계·허락은 LV3 만."""
    h = auth_headers(USERS["lv1"])
    own = world["e"]["own1"]
    d = client.get(f"/api/entries/{own}", headers=h).json()
    assert d["can_edit"] is True and d["can_manage_access"] is False and d["can_block"] is False
    assert "grants" not in d
    r = client.patch(f"/api/entries/{own}", json={"version": d["version"], "title": "내 자료"}, headers=h)
    assert r.status_code == 200
    r = client.put(f"/api/entries/{own}/access", json={"access": "shared"}, headers=h)
    assert r.status_code == 403 and r.json()["detail"] == "level3_required"
    r = client.put(f"/api/entries/{own}/grants", json={"employee_id": USERS["lv2"]}, headers=h)
    assert r.status_code == 403 and r.json()["detail"] == "level3_required"


def test_edit_rights_uploader_or_level3(world, client, auth_headers):
    """확정 자료 수정은 올린 사람 또는 LV3 — 볼 수 있어도 남의 자료는 403."""
    no = world["e"]["no"]
    r = client.patch(f"/api/entries/{no}", json={"version": 1, "title": "고침"}, headers=auth_headers(USERS["lv2"]))
    assert r.status_code == 403 and r.json()["detail"] == "not_uploader"
    r = client.patch(f"/api/entries/{no}", json={"version": 1, "title": "고침"}, headers=auth_headers(OWNER))
    assert r.status_code == 200 and r.json()["can_edit"] is True
    r = client.patch(f"/api/entries/{no}", json={"version": 2, "title": "관리자"}, headers=auth_headers(USERS["lv3"]))
    assert r.status_code == 200
    r = client.patch(f"/api/entries/{no}", json={"version": 3, "title": "WB관리자"},
                     headers=auth_headers(USERS["wbadmin"]))
    assert r.status_code == 200
    d = client.get(f"/api/entries/{no}", headers=auth_headers(USERS["lv2"])).json()
    assert d["can_edit"] is False and d["can_manage_access"] is False and "grants" not in d


def test_access_change_rules_audit_and_registry(world, client, auth_headers, db, storage):
    no = world["e"]["no"]
    h1, ho, h3 = auth_headers(USERS["lv1"]), auth_headers(OWNER), auth_headers(USERS["lv3"])
    assert client.get(f"/api/entries/{no}", headers=h1).status_code == 404
    # 올린 사람이 공유로 — LV1 도 본다
    r = client.put(f"/api/entries/{no}/access", json={"access": "shared"}, headers=ho)
    assert r.status_code == 200 and r.json()["access"] == "shared" and r.json()["label"] == "공유"
    assert client.get(f"/api/entries/{no}", headers=h1).status_code == 200
    db.expire_all()
    row = db.query(models.AuditLog).filter_by(action="ENTRY_ACCESS", target_id=no).one()
    assert (row.before, row.after) == ({"access": "normal"}, {"access": "shared"})
    from app.ops.registry import read_registry
    assert {"entry_id": no, "access": "shared"} in read_registry(storage)["entry_access"]
    # 블록은 LV3 만
    r = client.put(f"/api/entries/{no}/access", json={"access": "blocked"}, headers=ho)
    assert r.status_code == 403 and r.json()["detail"] == "level3_required"
    r = client.put(f"/api/entries/{no}/access", json={"access": "blocked"}, headers=h3)
    assert r.status_code == 200 and r.json()["label"] == "블록"
    assert client.get(f"/api/entries/{no}", headers=auth_headers(USERS["lv2"])).status_code == 404
    # 블록되면 올린 사람도 단계를 못 바꾼다(보이기는 한다)
    d = client.get(f"/api/entries/{no}", headers=ho).json()
    assert d["can_manage_access"] is False and d["can_block"] is False
    r = client.put(f"/api/entries/{no}/access", json={"access": "normal"}, headers=ho)
    assert r.status_code == 403 and r.json()["detail"] == "level3_required"
    # LV3 가 풀면 다시 일반
    assert client.put(f"/api/entries/{no}/access", json={"access": "normal"}, headers=h3).json()["access"] == "normal"
    assert {"entry_id": no, "access": "shared"} not in read_registry(storage)["entry_access"]
    # 남은 바꾸지 못한다 — 볼 수 없으면 404, 보이지만 남의 것이면 403
    assert client.put(f"/api/entries/{no}/access", json={"access": "shared"}, headers=h1).status_code == 404
    r = client.put(f"/api/entries/{no}/access", json={"access": "shared"}, headers=auth_headers(USERS["lv2"]))
    assert r.status_code == 403
    assert client.put(f"/api/entries/{no}/access", json={"access": "public"}, headers=h3).status_code == 422


def test_grants_rules(world, client, auth_headers, db, wb):
    no, bl = world["e"]["no"], world["e"]["bl"]
    ho, h1, h3 = auth_headers(OWNER), auth_headers(USERS["lv1"]), auth_headers(USERS["lv3"])
    # 올린 사람이 일반 자료를 LV1 에게 허락 → LV1 이 본다
    assert client.get(f"/api/entries/{no}", headers=h1).status_code == 404
    r = client.put(f"/api/entries/{no}/grants", json={"employee_id": USERS["lv1"]}, headers=ho)
    assert r.status_code == 200
    g = next(x for x in r.json()["grants"] if x["employee_id"] == USERS["lv1"])
    assert (g["name"], g["level"], g["effective"]) == ("게스트 사용자", 1, True)
    assert client.get(f"/api/entries/{no}", headers=h1).status_code == 200
    # 허락받은 사람은 허락을 주지 못한다
    r = client.put(f"/api/entries/{no}/grants", json={"employee_id": USERS["lv2"]}, headers=h1)
    assert r.status_code == 403 and r.json()["detail"] == "not_uploader"
    # 블록 자료의 허락은 LV3 만 — 올린 사람도 403
    r = client.put(f"/api/entries/{bl}/grants", json={"employee_id": USERS["lv2"]}, headers=ho)
    assert r.status_code == 403 and r.json()["detail"] == "level3_required"
    hm = auth_headers(USERS["lv2"])
    assert client.get(f"/api/entries/{bl}", headers=hm).status_code == 404
    assert client.put(f"/api/entries/{bl}/grants", json={"employee_id": USERS["lv2"]}, headers=h3).status_code == 200
    assert client.get(f"/api/entries/{bl}", headers=hm).status_code == 200
    # 대상 — WorkBench 활성 사용자(LogBook 에 들어온 적 없어도 된다). 비활성 422, 없는 사번 404
    wb("N100001", name="처음사람")
    r = client.put(f"/api/entries/{no}/grants", json={"employee_id": "n100001"}, headers=ho)
    assert r.status_code == 200 and {"employee_id": "N100001", "name": "처음사람"}.items() <= next(
        x for x in r.json()["grants"] if x["employee_id"] == "N100001").items()
    wb("N100002", name="떠난사람", active=False)
    r = client.put(f"/api/entries/{no}/grants", json={"employee_id": "N100002"}, headers=ho)
    assert r.status_code == 422 and r.json()["detail"] == "grant_user_inactive"
    r = client.put(f"/api/entries/{no}/grants", json={"employee_id": "Z999999"}, headers=ho)
    assert r.status_code == 404 and r.json()["detail"] == "user_not_found"
    # WorkBench 에서 비활성되면 허락이 효력 없음으로 보인다(행은 남는다)
    wb("N100001", name="처음사람", active=False)
    d = client.get(f"/api/entries/{no}", headers=ho).json()
    assert next(x for x in d["grants"] if x["employee_id"] == "N100001")["effective"] is False
    # 회수
    assert client.delete(f"/api/entries/{no}/grants/{USERS['lv1']}", headers=ho).status_code == 200
    assert client.get(f"/api/entries/{no}", headers=h1).status_code == 404
    assert client.delete(f"/api/entries/{no}/grants/{USERS['lv1']}", headers=ho).status_code == 404
    # 허락·회수는 감사 기록을 남기지 않는다(2026-10-20) — 변경 이력에도 없다
    db.expire_all()
    actions = [a for (a,) in db.query(models.AuditLog.action).filter_by(target_id=no)]
    assert "ENTRY_GRANT" not in actions and "ENTRY_REVOKE" not in actions
    hist = client.get(f"/api/entries/{no}/history", headers=ho).json()
    assert not [h for h in hist if h["action"] in ("ENTRY_GRANT", "ENTRY_REVOKE")]


def test_user_lookup_for_grants(world, client, auth_headers, wb):
    wb("N100001", name="찾을사람")
    wb("N100002", name="찾을비활성", active=False)
    h1 = auth_headers(USERS["lv1"])
    r = client.get("/api/users/lookup", params={"q": "찾을"}, headers=h1).json()
    assert [u["employee_id"] for u in r] == ["N100001"] and r[0]["level"] == 1
    r = client.get("/api/users/lookup", params={"q": "W1"}, headers=h1).json()
    assert [(u["employee_id"], u["level"]) for u in r] == [(USERS["wbadmin"], 3)]
    # 31 — 검색어가 없으면 활성 가입자 전체(비활성 제외)
    allr = {u["employee_id"] for u in client.get("/api/users/lookup", params={"q": ""}, headers=h1).json()}
    assert "N100001" in allr and "N100002" not in allr and USERS["wbadmin"] in allr


def test_entry_meta_has_access_but_not_grants(world, db, storage):
    from app.entries.files import write_entry_files

    e = db.query(models.Entry).filter_by(entry_id=world["e"]["bg"]).one()
    write_entry_files(db, storage, e)
    with open(to_long(storage.vault / "2026" / e.entry_id / "entry.json"), encoding="utf-8") as fh:
        meta = json.load(fh)
    assert meta["access"] == "blocked" and "private_min_role" not in meta and "analysis_period" not in meta
    assert "grants" not in meta and USERS["lv2"] not in json.dumps(meta)
    with open(to_long(storage.vault / "2026" / e.entry_id / "_INFO.txt"), encoding="utf-8") as fh:
        info = fh.read()
    assert "공개 범위: 블록" in info and "Hi-TESS LogBook" in info


def test_draft_access_and_merge_suggestion_hidden(world, client, auth_headers, db, make_entry_file):
    """정리 대기 — 초안의 공개 단계를 확정 전에 고르고(블록은 LV3 만), 볼 수 없는 기존 Entry 는 합치기 제안에서 숨는다."""
    d, _ = make_entry_file(status="draft", title="새 초안", uploaded_by=USERS["lv1"], name="n.bdf", kind="model")
    d.suggested_entry_id = world["pk"]["bl"]
    db.commit()
    h1 = auth_headers(USERS["lv1"])
    got = client.get(f"/api/entries/{d.entry_id}", headers=h1).json()
    assert got["access"] == "normal"                    # 기본 '일반'(자기 자료라 LV1 도 본다)
    assert got["suggested_entry"] is None and got["suggested_entry_id"] is None
    assert client.get(f"/api/entries/{d.entry_id}", headers=auth_headers(USERS["lv3"])).json()[
        "suggested_entry"]["entry_id"] == world["e"]["bl"]
    r = client.patch(f"/api/entries/{d.entry_id}", json={"version": d.version, "merge_into_id": world["e"]["bl"]},
                     headers=h1)
    assert r.status_code == 422 and r.json()["detail"] == "merge_target_not_found"
    r = client.patch(f"/api/entries/{d.entry_id}", json={"version": d.version, "access": "blocked"}, headers=h1)
    assert r.status_code == 403 and r.json()["detail"] == "level3_required"
    r = client.patch(f"/api/entries/{d.entry_id}", json={"version": d.version, "access": "shared"}, headers=h1)
    assert r.status_code == 200 and r.json()["access"] == "shared"
    # 정리 대기(전체) — 남의 블록 초안은 LV2 에게 보이지 않는다
    r = client.patch(f"/api/entries/{d.entry_id}", json={"version": r.json()["version"], "access": "blocked"},
                     headers=auth_headers(USERS["lv3"]))
    assert r.status_code == 200
    batches = client.get("/api/batches", params={"scope": "all"}, headers=auth_headers(USERS["lv2"])).json()
    assert d.entry_id not in {e["entry_id"] for b in batches for e in b["entries"]}
    batches = client.get("/api/batches", params={"scope": "all"}, headers=h1).json()
    assert d.entry_id in {e["entry_id"] for b in batches for e in b["entries"]}


def test_rebuild_restores_levels_access_grants(world, db, storage):
    """registry.json·entry.json 으로 재구축해도 등급·공개 단계·허락이 사라지지 않는다."""
    from app import database
    from app.entries.files import write_entry_files
    from app.ops.rebuild import rebuild
    from app.ops.registry import write_registry

    for e in db.query(models.Entry).all():
        write_entry_files(db, storage, e)
    write_registry(db, storage)
    db.rollback()
    database.Base.metadata.drop_all(database.engine)
    database.Base.metadata.create_all(database.engine)
    db.expire_all()
    rebuild(db, storage, force=True)
    levels = dict(db.query(models.User.employee_id, models.User.level))
    assert levels == {USERS["lv1"]: 1, USERS["lv2"]: 2, USERS["lv3"]: 3, USERS["wbadmin"]: 1, OWNER: 2}
    assert db.query(models.User).filter_by(employee_id=USERS["wbadmin"]).one().wb_admin is True
    acc = {e.entry_id: e.access for e in db.query(models.Entry)}
    assert acc == {world["e"][k]: ACCESS[k] for k in KINDS}
    grants = {(eid, g) for g, eid in db.query(models.EntryGrant.employee_id, models.Entry.entry_id)
              .join(models.Entry, models.Entry.id == models.EntryGrant.entry_id)}
    assert grants == {(world["e"]["ng"], USERS["lv1"]), (world["e"]["bg"], USERS["lv2"])}
