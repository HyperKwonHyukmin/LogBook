"""25 — 관계 지도 API. 호선·태그 묶음, 모델 관계(형상만 같음·똑같은 BDF), 판 수, 권한 숨김.

합성 데이터만(가상 호선 9001·9002·9003)."""
from datetime import datetime

import pytest

from app import models
from app.bdf.signature import VERSION as SIG_VERSION

G = "g" * 64


def _sig(db, f, *, geometry=G, prop="p", mat="m", load="l", version=SIG_VERSION, state="done"):
    db.add(models.ModelSummary(file_id=f.id, state=state, key=f"{f.id:04d}" + "k" * 60, format_version=2,
                               sig_version=version, sig_geometry=geometry, sig_property=prop * 64 if prop else None,
                               sig_material=mat * 64, sig_load=load * 64))


def _tag(db, e, kind, value, alias_of=None):
    t = db.query(models.Tag).filter_by(kind=kind, value=value).first()
    if t is None:
        t = models.Tag(kind=kind, value=value, alias_of_id=alias_of.id if alias_of else None)
        db.add(t)
        db.flush()
    db.add(models.EntryTag(entry_id=e.id, tag_id=t.id))
    return t


@pytest.fixture
def world(db, make_user, make_entry_file):
    make_user("M100001", name="일반", level=2)
    make_user("G100001", name="게스트", level=1)
    a, fa = make_entry_file(title="권상 A", hulls=("9001", "9002"), name="a.bdf", kind="model", uploaded_by="M100001",
                            confirmed_at=datetime(2026, 9, 1))
    b, fb = make_entry_file(title="권상 B", hulls=("9002",), name="b.bdf", kind="model", uploaded_by="M100001",
                            confirmed_at=datetime(2026, 9, 2))
    c, fc = make_entry_file(title="권상 C", hulls=("9003",), name="c.bdf", kind="model", uploaded_by="M100001",
                            confirmed_at=datetime(2026, 9, 3))
    d, fd = make_entry_file(title="블록 D", hulls=("9003",), name="d.bdf", kind="model", uploaded_by="U100001",
                            confirmed_at=datetime(2026, 9, 4))
    old, fo = make_entry_file(title="옛 변환", hulls=("9001",), name="o.bdf", kind="model", uploaded_by="M100001",
                              confirmed_at=datetime(2026, 9, 5))
    draft, fdr = make_entry_file(title="초안", status="draft", hulls=("9001",), name="x.bdf", kind="model",
                                 uploaded_by="M100001")
    d.access = "blocked"
    a.access = b.access = "shared"
    _sig(db, fa)
    _sig(db, fb, load="L")                 # a·b: 형상 같고 하중만 다름
    _sig(db, fc)                           # a·c: 똑같은 BDF
    _sig(db, fd, prop="P")                 # 블록 자료 — 일반 사용자에게 숨는다
    _sig(db, fo, version=SIG_VERSION - 1)  # 옛 규칙 서명 — 관계에서 빠지고 '서명 없음'으로 센다
    _sig(db, fdr)                          # 초안은 지도에 없다
    # 판 묶음: a 안에 같은 계열 두 판
    _, fa2 = make_entry_file(entry=a, name="a_r1.bdf", kind="model")
    db.add(models.ModelRevision(file_id=fa.id, entry_id=a.id, series_key="s1", rev_order=0, is_latest=False))
    db.add(models.ModelRevision(file_id=fa2.id, entry_id=a.id, series_key="s1", rev_order=1, is_latest=True))
    # 태그: 동의어는 대표 값으로
    deck = _tag(db, a, "zone", "상갑판")
    _tag(db, b, "zone", "Upper Deck", alias_of=deck)
    _tag(db, a, "project", "LNG 표준선")   # 29 — 예전 프로젝트 값은 싣지 않는다
    h = db.get(models.Hull, "9001") or models.Hull(hull_no="9001")
    h.ship_type = "LNG 운반선"
    db.add(h)
    db.commit()
    return {k: e.entry_id for k, e in dict(a=a, b=b, c=c, d=d, old=old, draft=draft).items()}


def _graph(client, auth_headers, emp):
    r = client.get("/api/graph", headers=auth_headers(emp))
    assert r.status_code == 200, r.text
    return r.json()


def test_entries_tags_hulls_revisions(world, client, auth_headers):
    g = _graph(client, auth_headers, "M100001")
    by = {e["id"]: e for e in g["entries"]}
    assert world["draft"] not in by                       # 초안은 빠진다
    assert world["d"] not in by                           # 블록 자료는 LV2 에게 숨는다
    a, b = by[world["a"]], by[world["b"]]
    assert a["hulls"] == ["9001", "9002"] and "projects" not in a
    assert a["zones"] == ["상갑판"] and b["zones"] == ["상갑판"]   # 동의어 → 대표 값
    assert a["revisions"] == [{"count": 2, "name": "a_r1.bdf"}]
    assert a["files"] == 2
    assert g["hulls"]["9001"] == "LNG 운반선" and g["hulls"]["9003"] is None


def test_model_pairs(world, client, auth_headers):
    g = _graph(client, auth_headers, "M100001")
    pairs = {frozenset((p["a"], p["b"])): p for p in g["pairs"]}
    ab = pairs[frozenset((world["a"], world["b"]))]
    assert ab["type"] == "geom" and ab["differs"] == ["load"]
    ac = pairs[frozenset((world["a"], world["c"]))]
    assert ac["type"] == "dup" and ac["differs"] == [] and sorted(ac["files"]) == ["a.bdf", "c.bdf"]
    assert not any(world["d"] in (p["a"], p["b"]) for p in g["pairs"])   # 숨은 자료와의 관계도 숨는다
    assert not any(world["old"] in (p["a"], p["b"]) for p in g["pairs"])
    assert g["unsigned_models"] == 1


def test_admin_sees_blocked_relation(world, client, auth_headers, make_user):
    make_user("A100009", name="관리자", level=3)
    g = _graph(client, auth_headers, "A100009")
    assert any(world["d"] in (p["a"], p["b"]) for p in g["pairs"])


def test_guest_sees_shared_only(world, client, auth_headers):
    g = _graph(client, auth_headers, "G100001")
    assert {e["id"] for e in g["entries"]} == {world["a"], world["b"]}
    assert [p["type"] for p in g["pairs"]] == ["geom"]


def test_requires_login(client):
    assert client.get("/api/graph").status_code == 401


def test_hull_kinds_from_plm_or_ship_type(world, client, auth_headers, db):
    """30 — 선종·크기급: PLM 분해 값이 있으면 그것, 없으면 선종 칸 글자를 같은 규칙으로 풀어서. 용량이 없으면 크기급 None."""
    h2 = db.get(models.Hull, "9002")
    h2.ship_type, h2.ship_kind, h2.ship_capacity = "174K LNG", "LNG", "174K"
    db.get(models.Hull, "9001").ship_type = "300K-VLCC"   # 사람이 적은 선종(PLM 조회 전)
    h3 = db.get(models.Hull, "9003") or models.Hull(hull_no="9003")
    h3.ship_type = "FPSO"                                  # 용량 없는 값 — 크기급 없음
    db.add(h3)
    db.commit()
    g = _graph(client, auth_headers, "M100001")
    assert g["hull_kinds"] == {"9001": "VLCC", "9002": "LNG", "9003": None}
    assert g["hull_sizes"] == {"9001": "300K급 VLCC", "9002": "174K급 LNG", "9003": None}
    assert g["hulls"]["9002"] == "174K LNG"


def test_entries_carry_target(world, client, auth_headers, db):
    """44 — 대상(38)도 기준으로 쓰도록 자료마다 대표 값으로 싣는다(없으면 빈 목록)."""
    a = db.query(models.Entry).filter_by(entry_id=world["a"]).one()
    _tag(db, a, "target", "Unit")
    db.commit()
    by = {e["id"]: e for e in _graph(client, auth_headers, "M100001")["entries"]}
    assert by[world["a"]]["targets"] == ["Unit"] and by[world["b"]]["targets"] == []
