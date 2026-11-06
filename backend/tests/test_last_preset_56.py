"""56 — 업로드 기본 분류: 올리는 폴더 이름과 비슷한 기존 확정 자료의 구역·대상을 기본값으로(uploads.hint)."""
from datetime import datetime, timedelta

from app import models
from app.entries import service as entry_service
from app.ingest.process import process_batch
from app.uploads import hint


def _tag(db, value, kind, alias_of=None):
    t = models.Tag(kind=kind, value=value, listed=alias_of is None, alias_of_id=alias_of.id if alias_of else None)
    db.add(t)
    db.commit()
    return t


def _confirmed(db, title, *, minutes_ago=10, zones=(), target=None, status="confirmed"):
    e = models.Entry(title=title, status=status, uploaded_by="A100009", confirmed_by="A100009",
                     confirmed_at=datetime.now() - timedelta(minutes=minutes_ago))
    db.add(e)
    db.flush()
    e.entry_id = f"E{e.id:06d}"
    if zones:
        entry_service.set_zones(db, e, list(zones))
    if target:
        entry_service.set_tags(db, e, "target", [target])
    db.commit()
    return e


def _batch(db, key):
    db.expire_all()
    return db.query(models.Batch).filter_by(key=key).one()


def _vocab(db):
    for z in ("선미부", "선수부", "Unit"):
        _tag(db, z, "zone")
    rudder = _tag(db, "Rudder", "target")
    _tag(db, "Hatch cover", "target")
    return rudder


def test_words_drop_numbers_hulls_and_generic():
    assert hint.words_of(["6_Rudder"]) == {"rudder"}
    assert hint.words_of(["Rudder 구조 해석 표준화_Rev0.pdf"]) == {"rudder"}
    assert hint.words_of(["3515_구조해석_강도평가_rev3_final", "20261106_A476854"]) == set()
    assert hint.words_of(["H3515 Hatch cover v2.bdf"]) == {"hatch", "cover"}


def test_folder_name_picks_matching_entry_not_latest(client, db, make_user, auth_headers):
    """6_Rudder → Rudder 자료의 구역·대상. 더 최근에 확정한 Hatch cover 자료는 고르지 않는다."""
    make_user("A100001")
    _vocab(db)
    rudder = _confirmed(db, "3515 · 선미부 · Rudder · 강도 평가", minutes_ago=60, zones=["선미부"], target="Rudder")
    _confirmed(db, "3454 · 선수부 · Hatch cover", minutes_ago=1, zones=["선수부"], target="Hatch cover")
    r = client.post("/api/uploads/similar-preset", headers=auth_headers("A100001"), json={"texts": ["6_Rudder"]})
    assert r.status_code == 200
    assert r.json() == {"zones": ["선미부"], "target": "Rudder", "from_entry": rudder.entry_id,
                        "from_title": rudder.title}


def _process(db, storage, *, uploader, files, preset=None, split_top=False, key="20261106-000000-bbbb"):
    """files = 스테이징 안의 상대 경로들 → 처리 뒤 {title_source: entry_to_dict}."""
    b = models.Batch(key=key, source="web", original_name=files[0].split("/")[0], uploader=uploader,
                     preset=preset, split_top=split_top)
    db.add(b)
    db.commit()
    for rel in files:
        f = storage.staging / b.key / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"%PDF-1.4 x")
    process_batch(db, storage, b)
    db.expire_all()
    return {e.title_source: entry_service.entry_to_dict(db, e) for e in db.query(models.Entry).filter_by(status="draft")}


def test_upload_without_preset_stores_nothing_and_empty_is_skip(client, db, make_user, auth_headers):
    """시작 때는 찾지 않는다(초안마다 처리 때 찾는다). 폴더 창에서 비워 보내면 자동 채움을 하지 않는다는 표시."""
    make_user("A100001")
    _vocab(db)
    _confirmed(db, "3515 · 선미부 · Rudder", zones=["선미부"], target="Rudder")
    h = auth_headers("A100001")
    r = client.post("/api/uploads", headers=h, json={"name": "6_Rudder"})
    assert r.status_code == 201, r.text
    assert _batch(db, r.json()["key"]).preset is None
    r = client.post("/api/uploads", headers=h, json={"name": "6_Rudder", "preset": {}})
    assert _batch(db, r.json()["key"]).preset == {"skip_hint": True}


def test_split_folders_each_find_own_entry(db, storage, make_user):
    """2021 을 하위 폴더마다 나눠 올리면 5_Rudder_3143 은 Rudder 자료, Manifold_support 는 Manifold 자료를 따른다."""
    make_user("A100001")
    _vocab(db)
    _tag(db, "Manifold", "target")
    rudder = _confirmed(db, "3515 · 선미부 · Rudder", zones=["선미부"], target="Rudder")
    manifold = _confirmed(db, "3454 · Unit · Manifold support", zones=["Unit"], target="Manifold")
    out = _process(db, storage, uploader="A100001", split_top=True,
                   files=["2021/5_Rudder_3143/a.pdf", "2021/Manifold_support/b.pdf", "2021/Crane/c.pdf"])
    by = {k.split("/")[-1] if k else k: v for k, v in out.items()}
    r = next(v for k, v in by.items() if "Rudder" in (k or ""))
    m = next(v for k, v in by.items() if "Manifold" in (k or ""))
    c = next(v for k, v in by.items() if "Crane" in (k or ""))
    assert (r["zones"], r["target"], r["preset_from"]) == (["선미부"], "Rudder", rudder.entry_id)
    assert (m["zones"], m["target"], m["preset_from"]) == (["Unit"], "Manifold", manifold.entry_id)
    assert (c["zones"], c["target"], c["preset_from"]) == ([], None, None)   # 비슷한 자료 없음 → 빈칸


def test_human_preset_wins_and_skip_disables_hint(db, storage, make_user):
    make_user("A100001")
    _vocab(db)
    _confirmed(db, "3515 · 선미부 · Rudder", zones=["선미부"], target="Rudder")
    out = _process(db, storage, uploader="A100001", preset={"zones": ["선수부"]}, files=["6_Rudder/a.pdf"])
    [d] = out.values()
    assert d["zones"] == ["선수부"] and d["target"] is None and d["preset_from"] is None
    out = _process(db, storage, uploader="A100001", preset={"skip_hint": True}, files=["6_Rudder/b.pdf"],
                   key="20261106-000000-cccc")
    d = [v for v in out.values() if v["zones"] != ["선수부"]][0]
    assert d["zones"] == [] and d["target"] is None and d["preset_from"] is None


def test_matches_target_tag_and_alias_even_if_title_differs(client, db, make_user, auth_headers):
    make_user("A100001")
    rudder = _vocab(db)
    _tag(db, "러더", "target", alias_of=rudder)
    e = _confirmed(db, "3515 · 선미부 · 35030", zones=["선미부"], target="Rudder")
    h = auth_headers("A100001")
    for name in ("rudder", "러더_검토"):
        res = client.post("/api/uploads/similar-preset", headers=h, json={"texts": [name]}).json()
        assert res["from_entry"] == e.entry_id, name


def test_no_useful_word_or_no_match_gives_nothing(client, db, make_user, auth_headers):
    make_user("A100001")
    _vocab(db)
    _confirmed(db, "3515 · 선미부 · Rudder · 강도 평가", zones=["선미부"], target="Rudder")
    h = auth_headers("A100001")
    empty = {"zones": [], "target": None, "from_entry": None, "from_title": None}
    # '강도 평가'·호선 번호만 겹치면 같은 자료로 보지 않는다
    assert client.post("/api/uploads/similar-preset", headers=h, json={"texts": ["3515_강도평가_rev1"]}).json() == empty
    assert client.post("/api/uploads/similar-preset", headers=h, json={"texts": ["Crane_pedestal"]}).json() == empty


def test_tie_takes_recent_and_skips_unclassified_or_unconfirmed(db, make_user):
    user = make_user("A100001")
    _vocab(db)
    _confirmed(db, "Rudder 옛 검토", minutes_ago=300, zones=["선수부"], target="Rudder")
    recent = _confirmed(db, "Rudder 새 검토", minutes_ago=30, zones=["선미부"], target="Rudder")
    _confirmed(db, "Rudder 분류 없음", minutes_ago=1)                                   # 줄 값이 없다
    _confirmed(db, "Rudder 초안", minutes_ago=1, zones=["Unit"], status="draft")        # 확정 전
    assert hint.similar_preset(db, user, ["6_Rudder"])["from_entry"] == recent.entry_id
    # 더 많이 겹치면 오래된 자료라도 그쪽
    both = _confirmed(db, "Rudder stock 검토", minutes_ago=900, zones=["선미부"], target="Rudder")
    assert hint.similar_preset(db, user, ["Rudder_stock"])["from_entry"] == both.entry_id


