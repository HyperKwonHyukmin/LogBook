"""16 — 판 변경 3D 보기의 전후 값 API(`GET /api/files/{a}/diff/{b}/item`). 합성 모델만(가상 호선 9999·9001·9002).

두 판의 lbm 에서 한 요소·절점·강체의 앞·뒤 값을 읽고, 14 상세(.rdiff)에 그 ID 가 든 목록 이름을 함께 준다.
권한은 15 규칙 — 두 파일을 모두 볼 수 있어야 하고, 하나라도 못 보면 404."""
import os

import pytest

from app import models
from app.revisions import item as I

A = """SOL 101
CEND
SUBCASE 1
  LOAD = 10
  SPC = 1
BEGIN BULK
GRID,1,,0.,0.,0.
GRID,2,,1000.,0.,0.
GRID,3,,1000.,1000.,0.
GRID,4,,0.,1000.,0.
GRID,5,,0.,0.,500.
GRID,7,,500.,500.,500.
CQUAD4,1,5,1,2,3,4
CBAR,2,7,1,5,0.,0.,1.
CBAR,3,7,2,5,0.,0.,1.
CBAR,8,7,4,5,0.,0.,1.
RBE2,10,5,123456,4
PSHELL,5,1,12.
PSHELL,6,1,14.
PBEAML,7,1,,I
,300.,150.,150.,10.,12.,12.
MAT1,1,206000.,,0.3,7.85-9
FORCE,10,3,,1000.,0.,0.,-1.
SPC1,1,123456,1,2
CONM2,90,3,,2.5
ENDDATA
"""

# 뒤 판: 절점 2 이동(+10 X)·6 추가·7 삭제, 요소 1 PID 5→6·2 삭제·3 연결 변경·4 추가·8 방향 벡터 변경,
# RBE2 10 종속 +3, CONM2 90 질량 2.5→3.0
B = (A.replace("GRID,2,,1000.,0.,0.", "GRID,2,,1010.,0.,0.")
      .replace("GRID,7,,500.,500.,500.\n", "GRID,6,,2000.,0.,0.\n")
      .replace("CQUAD4,1,5,", "CQUAD4,1,6,")
      .replace("CBAR,2,7,1,5,0.,0.,1.\n", "")
      .replace("CBAR,3,7,2,5,", "CBAR,3,7,3,5,")
      .replace("CBAR,8,7,4,5,0.,0.,1.", "CBAR,8,7,4,5,1.,0.,0.\nCBAR,4,7,6,5,0.,0.,1.")
      .replace("RBE2,10,5,123456,4", "RBE2,10,5,123456,4,3")
      .replace("CONM2,90,3,,2.5", "CONM2,90,3,,3.0"))


def _write(db, storage, f, text):
    from app.entries.locate import file_path

    p = file_path(db, storage, f)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as fh:
        fh.write(text.encode("utf-8"))


@pytest.fixture(autouse=True)
def _fresh_cache():
    I.clear_cache()
    yield
    I.clear_cache()


@pytest.fixture
def pair(db, storage, make_entry_file):
    """가상 호선 9999 자료 하나에 판 둘(deck → deck_r1), 둘 다 변환까지."""
    from app.convert.job import run_convert

    e, fa = make_entry_file(name="deck.bdf", kind="model", hulls=("9999",), title="9999 3D 변경", sha="1" * 64,
                            uploaded_by="U100001")
    _e, fb = make_entry_file(entry=e, name="deck_r1.bdf", kind="model", sha="2" * 64)
    for f, text in ((fa, A), (fb, B)):
        _write(db, storage, f, text)
        run_convert(db, storage, f)
        assert db.get(models.ModelSummary, f.id).state == "done"
    return e, fa, fb


def _diff(db, storage, fa, fb):
    from app.revisions.job import ensure, run_revision_diff

    row = ensure(db, fa.id, fb.id)
    run_revision_diff(db, storage, row.id)
    assert db.get(models.RevisionDiff, row.id).state == "done"


def _get(client, h, fa, fb, kind, ident):
    return client.get(f"/api/files/{fa.id}/diff/{fb.id}/item", params={"kind": kind, "id": ident}, headers=h)


def test_element_values(client, db, storage, pair, make_user, auth_headers):
    _e, fa, fb = pair
    _diff(db, storage, fa, fb)
    make_user("M100001", level=2)
    h = auth_headers("M100001")

    r = _get(client, h, fa, fb, "element", 1)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "changed" and d["diff_ready"] is True and d["changes"] == ["pid", "coords"]
    assert (d["a"]["card"], d["a"]["pid"], d["b"]["pid"]) == ("CQUAD4", 5, 6)
    assert d["a"]["nodes"] == d["b"]["nodes"] == [1, 2, 3, 4]
    assert d["a"]["coords"][1] == [1000.0, 0.0, 0.0] and d["b"]["coords"][1] == [1010.0, 0.0, 0.0]
    assert d["detail"]["elements.pid"] == {"eid": 1, "a": "5", "b": "6"}

    d = _get(client, h, fa, fb, "element", 3).json()
    assert d["status"] == "changed" and "nodes" in d["changes"]
    assert (d["a"]["nodes"], d["b"]["nodes"]) == ([2, 5], [3, 5]) and d["detail"] == {"elements.conn": True}

    d = _get(client, h, fa, fb, "element", 8).json()        # 방향 벡터만 — lbm v2 orient
    assert d["status"] == "changed" and d["changes"] == ["orient"]
    assert (d["a"]["orient"], d["b"]["orient"]) == ([0.0, 0.0, 1.0], [1.0, 0.0, 0.0])
    assert "elements.other" in d["detail"]

    d = _get(client, h, fa, fb, "element", 2).json()
    assert d["status"] == "removed" and d["b"] is None and d["a"]["nodes"] == [1, 5]
    assert d["detail"] == {"elements.removed": True}
    d = _get(client, h, fa, fb, "element", 4).json()
    assert d["status"] == "added" and d["a"] is None and d["b"]["coords"][0] == [2000.0, 0.0, 0.0]

    d = _get(client, h, fa, fb, "element", 90).json()        # 질량 요소
    assert d["status"] == "changed" and d["changes"] == ["mass"]
    assert (d["a"]["card"], d["a"]["mass"], d["b"]["mass"]) == ("CONM2", 2.5, 3.0)
    assert d["detail"]["mass.changed"]["eid"] == 90

    assert _get(client, h, fa, fb, "element", 999).json()["status"] == "missing"


def test_node_and_rigid_values(client, db, storage, pair, make_user, auth_headers):
    _e, fa, fb = pair
    _diff(db, storage, fa, fb)
    make_user("M100001", level=2)
    h = auth_headers("M100001")
    d = _get(client, h, fa, fb, "node", 2).json()
    assert d["status"] == "changed" and d["changes"] == ["xyz"] and d["move"] == 10.0
    assert (d["a"]["xyz"], d["b"]["xyz"]) == ([1000.0, 0.0, 0.0], [1010.0, 0.0, 0.0])
    assert d["detail"]["nodes.moved"] is True and d["detail"]["move"] == 10.0
    assert _get(client, h, fa, fb, "node", 6).json()["status"] == "added"
    d = _get(client, h, fa, fb, "node", 7).json()
    assert d["status"] == "removed" and d["a"]["xyz"] == [500.0, 500.0, 500.0]
    assert _get(client, h, fa, fb, "node", 1).json()["status"] == "same"

    d = _get(client, h, fa, fb, "rigid", 10).json()
    assert d["status"] == "changed" and d["changes"] == ["others"]
    assert (d["a"]["card"], d["a"]["center"], d["a"]["others"], d["b"]["others"]) == ("RBE2", 5, [4], [3, 4])
    assert d["detail"]["rigids.dep"]["added_ids"] == [3]


def test_values_before_diff_and_errors(client, db, storage, pair, make_entry_file, make_user, auth_headers):
    e, fa, fb = pair
    make_user("M100001", level=2)
    h = auth_headers("M100001")
    # 비교 전에도 lbm 값은 나온다(목록 이름은 비어 있음)
    d = _get(client, h, fa, fb, "element", 1).json()
    assert d["diff_ready"] is False and d["detail"] == {} and d["status"] == "changed"
    assert _get(client, h, fa, fb, "face", 1).status_code == 422
    assert client.get(f"/api/files/{fa.id}/diff/{fb.id}/item", params={"kind": "node"}, headers=h).status_code == 422
    assert _get(client, h, fa, fa, "node", 1).status_code == 422                     # 같은 파일
    _e, rep = make_entry_file(entry=e, name="r.pdf", kind="report", sha="3" * 64)
    assert _get(client, h, fa, rep, "node", 1).status_code == 422                    # 모델 아님
    _e, raw = make_entry_file(entry=e, name="deck_r2.bdf", kind="model", sha="4" * 64)
    r = _get(client, h, fa, raw, "node", 1)                                          # 변환 전
    assert r.status_code == 409 and r.json()["detail"] == "model_not_ready"
    assert _get(client, h, fa, fb, "node", 1).status_code == 200
    # 파생물(lbm)이 지워졌으면 409
    from app.convert.job import model_paths
    s = db.get(models.ModelSummary, fb.id)
    I.clear_cache()
    os.remove(model_paths(storage, s.key, s.format_version)[0])
    assert _get(client, h, fa, fb, "node", 1).status_code == 409


def test_access_levels_blocks_grants(client, db, storage, pair, make_entry_file, make_user, auth_headers):
    """15 — LV1 공유만, LV2 일반까지, 블록은 LV3·올린 사람·허락받은 사람만. 못 보면 404."""
    e, fa, fb = pair
    make_user("G100001", level=1)
    make_user("M100001", level=2)
    make_user("A100001", level=3)
    make_user("U100001", level=2)          # 올린 사람
    hs = {k: auth_headers(v) for k, v in (("lv1", "G100001"), ("lv2", "M100001"), ("lv3", "A100001"),
                                          ("owner", "U100001"))}

    def codes():
        return {k: _get(client, h, fa, fb, "node", 2).status_code for k, h in hs.items()}

    assert codes() == {"lv1": 404, "lv2": 200, "lv3": 200, "owner": 200}           # 일반(기본)
    e.access = "shared"
    db.commit()
    assert codes() == {"lv1": 200, "lv2": 200, "lv3": 200, "owner": 200}
    e.access = "blocked"
    db.commit()
    assert codes() == {"lv1": 404, "lv2": 404, "lv3": 200, "owner": 200}
    # 개별 허락 — 블록 자료도 허락받은 LV2 는 본다, 일반 자료는 허락받은 LV1 이 본다
    db.add(models.EntryGrant(entry_id=e.id, employee_id="M100001", granted_by="A100001"))
    db.commit()
    assert codes()["lv2"] == 200
    e.access = "normal"
    db.add(models.EntryGrant(entry_id=e.id, employee_id="G100001", granted_by="U100001"))
    db.commit()
    assert codes()["lv1"] == 200

    # 두 파일 중 하나라도 못 보면 404 — 다른 자료(블록)의 모델과 짝지으면 LV2 는 404, LV3 는 200
    from app.convert.job import run_convert
    e2, fc = make_entry_file(name="deck.bdf", kind="model", hulls=("9001",), title="9001 블록", sha="5" * 64,
                             uploaded_by="U100001")
    e2.access = "blocked"
    db.commit()
    _write(db, storage, fc, B)
    run_convert(db, storage, fc)
    assert _get(client, hs["lv2"], fa, fc, "node", 2).status_code == 404
    assert _get(client, hs["lv2"], fc, fa, "node", 2).status_code == 404
    assert _get(client, hs["lv3"], fa, fc, "node", 2).status_code == 200
    # 휴지통에 든 파일은 404
    fb.location = "trash"
    db.commit()
    assert _get(client, hs["lv3"], fa, fb, "node", 2).status_code == 404
