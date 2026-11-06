"""50 — 다른 Unit 의 권상 Wire 배치 찾기(서버 간 API). 합성 데이터만(가상 호선 9999)."""
import dataclasses
import os

import pytest

from app import models
from app.routers import integration
from app.storage.paths import to_long

from test_lifting_wires_50 import LIFTING

SECRET = "test-integration-secret-50"
H = {"X-HiTESS-Integration": SECRET}
LV2, OTHER = "M500001", "M500002"


@pytest.fixture
def secret(monkeypatch):
    monkeypatch.setattr(integration, "settings", dataclasses.replace(integration.settings, wb_integration_secret=SECRET))


@pytest.fixture
def no_secret(monkeypatch):
    monkeypatch.setattr(integration, "settings", dataclasses.replace(integration.settings, wb_integration_secret=""))


def _put(storage, entry, f, data: bytes):
    vf = storage.vault / "2026" / entry.entry_id / "files"
    os.makedirs(to_long(vf), exist_ok=True)
    with open(to_long(vf / f.name), "wb") as fh:
        fh.write(data)


@pytest.fixture
def world(db, storage, make_user, make_entry_file):
    make_user(LV2, name="일반", level=2)
    make_user(OTHER, name="남", level=2)
    out = {}
    # 변환 때 요약이 이미 들어간 Wire 모델
    e, f = make_entry_file(title="9999 M04 권상", name="9999_m04_lifting.bdf", kind="model", uploaded_by=LV2)
    db.add(models.ModelSummary(file_id=f.id, state="done", key="a" * 64, includes=[], missing=[], lifting=True))
    _put(storage, e, f, LIFTING.encode())
    out["converted"] = (e, f)
    # 50 이전 변환(요약 없음) — 요청 때 읽어 채운다
    e, f = make_entry_file(title="9999 M05 권상", name="9999_m05_lifting.bdf", kind="model", uploaded_by=LV2)
    _put(storage, e, f, LIFTING.encode())
    out["lazy"] = (e, f)
    # 이름만 _lifting — apex 없음 → 목록에서 빠진다
    e, f = make_entry_file(title="가짜", name="9999_x_lifting.bdf", kind="model", uploaded_by=LV2)
    _put(storage, e, f, b"SOL 101\nCEND\nBEGIN BULK\nGRID,1\nCBAR,1,1,1,2\nGRID,2,,1.\nENDDATA\n")
    out["fake"] = (e, f)
    # 남의 일반(비공유) 자료 — LV2 도 볼 수는 있다(access normal). 숨김 자료로 권한 확인
    e, f = make_entry_file(title="숨김", name="9999_h_lifting.bdf", kind="model", uploaded_by=OTHER)
    e.access = "blocked"
    _put(storage, e, f, LIFTING.encode())
    out["hidden"] = (e, f)
    # 일반 모델(Wire 아님)
    e, f = make_entry_file(title="일반 모델", name="9999_plain.bdf", kind="model", uploaded_by=LV2)
    out["plain"] = (e, f)
    db.commit()
    return out


def test_list_lazy_fill_and_filters(secret, client, db, world):
    r = client.get(f"/api/integration/lifting-refs?as={LV2}", headers=H)
    assert r.status_code == 200, r.text
    body = r.json()
    names = sorted(i["name"] for i in body["items"])
    assert names == ["9999_m04_lifting.bdf", "9999_m05_lifting.bdf"]   # 가짜·숨김·일반 모델은 빠진다
    item = body["items"][0]
    assert item["summaryState"] == "done" and item["summary"]["groupCount"] == 2
    assert "planSegments" not in item["summary"] and item["hullNos"] == ["9999"]
    # 요청 때 읽은 요약은 저장된다 — 가짜는 none 으로
    db.expire_all()
    assert db.get(models.ModelSummary, world["lazy"][1].id).wires["wireCount"] == 4
    assert db.get(models.ModelSummary, world["fake"][1].id).wires["none"] is True


def test_list_query_and_hull(secret, client, world):
    r = client.get(f"/api/integration/lifting-refs?as={LV2}&q=m05", headers=H)
    assert [i["name"] for i in r.json()["items"]] == ["9999_m05_lifting.bdf"]
    r = client.get(f"/api/integration/lifting-refs?as={LV2}&hull=1234", headers=H)
    assert r.json() == {"total": 0, "items": []}


def test_detail_has_plan_segments(secret, client, world):
    fid = world["converted"][1].id
    r = client.get(f"/api/integration/lifting-refs/{fid}?as={LV2}", headers=H)
    assert r.status_code == 200
    s = r.json()["summary"]
    assert len(s["planSegments"]) == 4 and s["groups"][0]["wires"][0]["slingAngleDeg"] > 70


def test_detail_rejects(secret, client, world):
    assert client.get(f"/api/integration/lifting-refs/{world['plain'][1].id}?as={LV2}", headers=H).status_code == 415
    assert client.get(f"/api/integration/lifting-refs/{world['fake'][1].id}?as={LV2}", headers=H).status_code == 415
    assert client.get(f"/api/integration/lifting-refs/{world['hidden'][1].id}?as={LV2}", headers=H).status_code == 404


def test_requires_secret_and_user(secret, client, world):
    assert client.get(f"/api/integration/lifting-refs?as={LV2}").status_code == 401
    assert client.get("/api/integration/lifting-refs?as=Z999999", headers=H).status_code == 404


def test_disabled_without_secret(no_secret, client, world):
    assert client.get(f"/api/integration/lifting-refs?as={LV2}", headers=H).status_code == 404


def test_old_summary_is_rebuilt_and_list_hides_segments(secret, client, db, world):
    # 3D 선분 이전(schemaVersion 1) 요약이 남아 있으면 상세 요청 때 다시 읽는다
    fid = world["converted"][1].id
    row = db.get(models.ModelSummary, fid)
    row.wires = {"schemaVersion": 1, "groupCount": 2, "wireCount": 4, "groups": [], "planSegments": [], "bboxMm": None}
    db.commit()
    r = client.get(f"/api/integration/lifting-refs/{fid}?as={LV2}", headers=H)
    s = r.json()["summary"]
    assert s["schemaVersion"] == 2 and len(s["segments3d"]) == 4
    db.expire_all()
    assert db.get(models.ModelSummary, fid).wires["schemaVersion"] == 2
    items = client.get(f"/api/integration/lifting-refs?as={LV2}", headers=H).json()["items"]
    assert all("segments3d" not in i["summary"] and "planSegments" not in i["summary"] for i in items)


def test_query_treats_like_wildcards_literally(secret, client, world):
    """검색어의 _·% 는 글자 그대로(2026-11-05 검토) — 'm0_' 가 m04·m05 를 잡지 않는다."""
    r = client.get(f"/api/integration/lifting-refs?as={LV2}&q=m0_", headers=H)
    assert r.json()["items"] == []
    r = client.get(f"/api/integration/lifting-refs?as={LV2}&q=9999_m04", headers=H)
    assert [i["name"] for i in r.json()["items"]] == ["9999_m04_lifting.bdf"]


# ---- 59 — Wire 모델과 함께 온 구조 해석 결과 세트 ----

def _sibling(db, storage, make_entry_file, entry, rel, data: bytes, kind="other"):
    _e, f = make_entry_file(entry=entry, name=rel, kind=kind)
    vf = storage.vault / "2026" / entry.entry_id / "files"
    os.makedirs(to_long(os.path.dirname(str(vf / rel))), exist_ok=True)
    with open(to_long(vf / rel), "wb") as fh:
        fh.write(data)
    return f


def test_result_bundle_returns_result_and_model(secret, client, db, storage, make_entry_file, world):
    e, f = world["converted"]
    _sibling(db, storage, make_entry_file, e, "9999_M04_lifting_nastranResult.json", b'{"members": [{"elementId": 1}]}')
    _sibling(db, storage, make_entry_file, e, "9999_M04.json", b'{"nodes": [], "which": "original"}')
    _sibling(db, storage, make_entry_file, e, "9999_M04_edited.json", b'\xef\xbb\xbf{"nodes": [], "which": "edited"}')
    _sibling(db, storage, make_entry_file, e, "9999_m04_lifting.f06", b"F06", kind="result")
    r = client.get(f"/api/integration/lifting-refs/{f.id}/result?as={LV2}", headers=H)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["result"]["members"][0]["elementId"] == 1
    assert body["model"]["which"] == "edited"          # 편집본이 있으면 그것(해석에 쓴 모델)
    assert body["files"]["f06"]["name"] == "9999_m04_lifting.f06"
    # 목록에도 결과 있음이 보인다
    items = client.get(f"/api/integration/lifting-refs?as={LV2}", headers=H).json()["items"]
    assert {i["fileId"]: i["hasResult"] for i in items}[f.id] is True


def test_result_bundle_missing_and_rejects(secret, client, db, storage, make_entry_file, world):
    e, f = world["lazy"]
    r = client.get(f"/api/integration/lifting-refs/{f.id}/result?as={LV2}", headers=H)
    assert r.status_code == 404 and r.json()["detail"] == "no_result"
    # 모델 JSON 없이 결과만 — 결과 화면을 못 그리므로 결과 없음
    _sibling(db, storage, make_entry_file, e, "9999_m05_lifting_nastranResult.json", b"{}")
    assert client.get(f"/api/integration/lifting-refs/{f.id}/result?as={LV2}", headers=H).status_code == 404
    # 깨진 JSON → 422
    _sibling(db, storage, make_entry_file, e, "9999_m05.json", b"{not json")
    r = client.get(f"/api/integration/lifting-refs/{f.id}/result?as={LV2}", headers=H)
    assert r.status_code == 422 and r.json()["detail"] == "bad_json"
    assert client.get(f"/api/integration/lifting-refs/{world['plain'][1].id}/result?as={LV2}", headers=H).status_code == 415
    assert client.get(f"/api/integration/lifting-refs/{world['hidden'][1].id}/result?as={LV2}", headers=H).status_code == 404


def test_result_bundle_pairs_only_same_folder(secret, client, db, storage, make_entry_file):
    e, f = make_entry_file(title="폴더", name="A/9999_m06_lifting.bdf", kind="model", uploaded_by=LV2)
    db.add(models.ModelSummary(file_id=f.id, state="done", key="b" * 64, includes=[], missing=[], lifting=True))
    db.commit()
    _sibling(db, storage, make_entry_file, e, "B/9999_m06_lifting_nastranResult.json", b"{}")
    _sibling(db, storage, make_entry_file, e, "B/9999_m06.json", b"{}")
    assert client.get(f"/api/integration/lifting-refs/{f.id}/result?as={LV2}", headers=H).status_code == 404


# ---- 2026-11-06 — 권상 참조는 레벨과 무관(LV1 포함), 차단 자료만 뺀다 ----
LV1 = "M500003"


def test_lv1_sees_every_unblocked_wire_model(secret, client, db, make_user, world):
    make_user(LV1, name="손님", level=1)
    db.commit()
    r = client.get(f"/api/integration/lifting-refs?as={LV1}", headers=H)
    assert r.status_code == 200, r.text
    # 남(LV2)이 올린 일반 자료도 보인다 — 차단 자료(hidden)는 빠진다
    assert sorted(i["name"] for i in r.json()["items"]) == ["9999_m04_lifting.bdf", "9999_m05_lifting.bdf"]
    fid = world["converted"][1].id
    assert client.get(f"/api/integration/lifting-refs/{fid}?as={LV1}", headers=H).status_code == 200
    hid = world["hidden"][1].id
    assert client.get(f"/api/integration/lifting-refs/{hid}?as={LV1}", headers=H).status_code == 404
    assert client.get(f"/api/integration/lifting-refs/{hid}/result?as={LV1}", headers=H).status_code == 404


def test_lv1_reference_does_not_open_file_download(secret, client, db, make_user, world):
    """참조 범위는 권상 요약에만 — BDF 원본 받기는 원래 권한(LV1 은 남의 일반 자료 못 봄) 그대로."""
    make_user(LV1, name="손님", level=1)
    db.commit()
    fid = world["converted"][1].id
    assert client.get(f"/api/integration/files/{fid}/content?as={LV1}", headers=H).status_code == 404


def test_blocked_owner_still_sees_own(secret, client, world):
    r = client.get(f"/api/integration/lifting-refs?as={OTHER}", headers=H)
    assert "9999_h_lifting.bdf" in [i["name"] for i in r.json()["items"]]


def test_query_matches_hull_and_entry_code(secret, client, db, storage, make_entry_file, world):
    e, f = make_entry_file(title="M07 권상", name="m07_lifting.bdf", kind="model", uploaded_by=LV2, hulls=("8888",))
    db.add(models.ModelSummary(file_id=f.id, state="done", key="b" * 64, includes=[], missing=[], lifting=True))
    _put(storage, e, f, LIFTING.encode())
    db.commit()
    # 이름·제목에 없는 호선으로 찾는다
    r = client.get(f"/api/integration/lifting-refs?as={LV2}&q=8888", headers=H)
    assert [i["name"] for i in r.json()["items"]] == ["m07_lifting.bdf"]
    r = client.get(f"/api/integration/lifting-refs?as={LV2}&q={e.entry_id.lower()}", headers=H)
    assert [i["name"] for i in r.json()["items"]] == ["m07_lifting.bdf"]


# ---- 2026-11-06 — '내 모델'(All Projects 로 보낸 것 중 실행자·올린 사람·담당자) · 실적 카드 결과 요약 ----
ANALYST = "M500004"


def _wb_wire(db, storage, make_entry_file, *, title, name, uploaded_by, owner, analysis_id):
    from app import wb_origin
    e, f = make_entry_file(title=title, name=name, kind="model", uploaded_by=uploaded_by)
    db.add(models.ModelSummary(file_id=f.id, state="done", key=str(analysis_id) * 8, includes=[], missing=[], lifting=True))
    wb_origin.stamp(db.get(models.Batch, f.batch_id), {"analysis_id": analysis_id, "owner": owner.lower()})
    _put(storage, e, f, LIFTING.encode())
    db.commit()
    return e, f


def test_mine_lists_only_my_all_projects_models(secret, client, db, storage, make_user, make_entry_file, world):
    from app import people
    make_user(ANALYST, name="해석가", level=1)
    _wb_wire(db, storage, make_entry_file, title="내가 실행", name="9999_r1_lifting.bdf", uploaded_by=LV2, owner=ANALYST, analysis_id=11)
    _wb_wire(db, storage, make_entry_file, title="남이 실행", name="9999_r2_lifting.bdf", uploaded_by=LV2, owner=OTHER, analysis_id=12)
    e3, _f3 = _wb_wire(db, storage, make_entry_file, title="담당", name="9999_r3_lifting.bdf", uploaded_by=LV2, owner=OTHER,
                       analysis_id=13)
    db.add(models.Person(employee_id=ANALYST, name="해석가", source="wb"))
    db.flush()
    people.set_assignees(db, e3, people.resolve_refs(db, [{"employee_id": ANALYST}]))
    db.commit()

    url = f"/api/integration/lifting-refs?as={ANALYST}"
    every = {i["name"] for i in client.get(url, headers=H).json()["items"]}
    assert {"9999_r1_lifting.bdf", "9999_r2_lifting.bdf", "9999_m04_lifting.bdf"} <= every
    mine = client.get(url + "&mine=true", headers=H).json()
    assert sorted(i["name"] for i in mine["items"]) == ["9999_r1_lifting.bdf", "9999_r3_lifting.bdf"]
    assert mine["total"] == 2 and mine["mine"] is True
    assert "mine" not in client.get(url, headers=H).json()   # 전체 목록에는 표시 없음
    # 보낸 관리자(LV2) = 올린 사람 → All Projects 로 보낸 3건이 모두 '내 모델'. 직접 올린 자료(m04·m05)는 빠진다
    sender = client.get(f"/api/integration/lifting-refs?as={LV2}&mine=true", headers=H).json()
    assert sorted(i["name"] for i in sender["items"]) == ["9999_r1_lifting.bdf", "9999_r2_lifting.bdf", "9999_r3_lifting.bdf"]


def test_detail_carries_result_brief(secret, client, db, storage, make_entry_file, world):
    e, f = world["converted"]
    result = (b'{"summary": {"memberExceedCount": 3, "memberElementCount": 40, "memberMaxStressMPa": 301.5},'
              b' "warnings": ["w1"], "meta": {"hasFatal": false}, "evaluation": {"structuralAllowableMPa": 220},'
              b' "members": [{"elementId": 1}]}')
    _sibling(db, storage, make_entry_file, e, "9999_M04_lifting_nastranResult.json", result)
    _sibling(db, storage, make_entry_file, e, "9999_M04.json", b'{"nodes": []}')
    brief = client.get(f"/api/integration/lifting-refs/{f.id}?as={LV2}", headers=H).json()["resultBrief"]
    assert brief["summary"]["memberExceedCount"] == 3 and brief["warnings"] == ["w1"]
    assert brief["evaluation"]["structuralAllowableMPa"] == 220 and brief["meta"]["hasFatal"] is False
    assert "members" not in brief
    # 결과 세트 없는 실적 = None
    assert client.get(f"/api/integration/lifting-refs/{world['lazy'][1].id}?as={LV2}", headers=H).json()["resultBrief"] is None


def test_detail_result_brief_unreadable(secret, client, db, storage, make_entry_file, world):
    e, f = world["converted"]
    _sibling(db, storage, make_entry_file, e, "9999_M04_lifting_nastranResult.json", b"{broken")
    _sibling(db, storage, make_entry_file, e, "9999_M04.json", b'{"nodes": []}')
    r = client.get(f"/api/integration/lifting-refs/{f.id}?as={LV2}", headers=H)
    assert r.status_code == 200 and r.json()["resultBrief"] == {"unavailable": "bad_json"}
