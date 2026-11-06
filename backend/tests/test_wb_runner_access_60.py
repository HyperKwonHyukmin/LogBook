"""60 — WorkBench 해석 실행자(origin.owner)는 등급과 무관하게 그 해석에서 온 확정 자료를 LogBook·WB 가져오기에서 본다.
합성 데이터만(가상 호선 9999)."""
import dataclasses
import os

import pytest

from app import access, models, wb_origin
from app.routers import integration
from app.storage.paths import to_long

SECRET = "test-integration-secret-60"
H = {"X-HiTESS-Integration": SECRET}
ADMIN, RUNNER, OTHER = "A600001", "G600001", "G600002"
BDF = b"SOL 101\nCEND\nBEGIN BULK\nGRID,1\nENDDATA\n"


@pytest.fixture
def secret(monkeypatch):
    monkeypatch.setattr(integration, "settings", dataclasses.replace(integration.settings, wb_integration_secret=SECRET))


def _wb_entry(db, storage, make_entry_file, *, analysis_id, owner, status="confirmed", access_="normal", name="m.bdf"):
    e, f = make_entry_file(title=f"WB #{analysis_id}", name=name, kind="model", uploaded_by=ADMIN, status=status)
    e.access = access_
    wb_origin.stamp(db.get(models.Batch, f.batch_id), {"analysis_id": analysis_id, "owner": owner.lower(),
                                                        "program": "GroupModuleUnit"})
    db.add(models.ModelSummary(file_id=f.id, state="done", key=str(analysis_id) * 8, includes=[], missing=[]))
    if status == "confirmed":
        vf = storage.vault / e.vault_rel / "files"   # Vault 파일 자리 = <자료>/files/<이름>
        os.makedirs(to_long(vf), exist_ok=True)
        with open(to_long(vf / f.name), "wb") as fh:
            fh.write(BDF)
    db.commit()
    return e, f


@pytest.fixture
def world(db, storage, wb, make_user, make_entry_file):
    for eid, lv in ((ADMIN, 3), (RUNNER, 1), (OTHER, 1)):
        wb(eid, name=eid)
        make_user(eid, name=eid, level=lv)
    return {
        "mine": _wb_entry(db, storage, make_entry_file, analysis_id=6001, owner=RUNNER),
        "mine_blocked": _wb_entry(db, storage, make_entry_file, analysis_id=6002, owner=RUNNER, access_="blocked",
                                  name="b.bdf"),
        "mine_draft": _wb_entry(db, storage, make_entry_file, analysis_id=6003, owner=RUNNER, status="draft",
                                name="d.bdf"),
        "others": _wb_entry(db, storage, make_entry_file, analysis_id=6004, owner=OTHER, name="o.bdf"),
    }


def _user(db, eid):
    return db.query(models.User).filter_by(employee_id=eid).one()


def test_runner_sees_own_confirmed_regardless_of_level(world, db):
    runner = _user(db, RUNNER)
    assert access.can_view_entry(runner, world["mine"][0], db=db)
    assert access.can_view_entry(runner, world["mine_blocked"][0], db=db)   # 올린 사람처럼 블록돼도 본인은 본다
    assert not access.can_view_entry(runner, world["mine_draft"][0], db=db)  # 관리자가 정리 중인 초안은 아니다
    assert not access.can_view_entry(runner, world["others"][0], db=db)


def test_filter_and_function_agree(world, db):
    """visible_entries_filter 와 can_view_entry 가 같은 답(목록·건수와 상세가 어긋나지 않게)."""
    for eid in (RUNNER, OTHER, ADMIN):
        u = _user(db, eid)
        by_sql = {i for (i,) in db.query(models.Entry.id).filter(access.visible_entries_filter(u))}
        by_py = {e.id for e in db.query(models.Entry).all() if access.can_view_entry(u, e, db=db)}
        assert by_sql == by_py, eid


def test_runner_finds_it_in_logbook(world, client, auth_headers):
    h = auth_headers(RUNNER)
    assert client.get(f"/api/entries/{world['mine'][0].entry_id}", headers=h).status_code == 200
    assert client.get(f"/api/entries/{world['others'][0].entry_id}", headers=h).status_code == 404
    r = client.get("/api/search?limit=50", headers=h)
    assert r.status_code == 200
    ids = {it["entry_id"] for it in r.json()["items"]}
    assert world["mine"][0].entry_id in ids and world["others"][0].entry_id not in ids


def test_runner_imports_into_workbench(secret, world, client):
    r = client.get(f"/api/integration/files/{world['mine'][1].id}/content?as={RUNNER}", headers=H)
    assert r.status_code == 200 and r.content == BDF, r.text
    r = client.get(f"/api/integration/files/{world['others'][1].id}/content?as={RUNNER}", headers=H)
    assert r.status_code == 404


def test_removed_file_does_not_keep_access(world, db):
    """자료에서 뺀 파일(휴지통)의 출처로는 열리지 않는다."""
    e, f = world["mine"]
    f.location = "trash"
    db.commit()
    assert not access.can_view_entry(_user(db, RUNNER), e, db=db)
