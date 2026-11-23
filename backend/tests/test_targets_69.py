"""69 — 업무별 모음: 대상 카드 목록(건수 순, 기타 맨 뒤), 대상 화면(처음이면 여기부터, 기초 자료, 실적, 모델, 담당자, 빈 곳), 열람 권한."""
from app import models

OWNER, LV1 = "U690001", "G690001"


def _target(db, entry, value):
    t = db.query(models.Tag).filter_by(kind="target", value=value).first()
    if t is None:
        t = models.Tag(kind="target", value=value, listed=True)
        db.add(t)
        db.flush()
    db.add(models.EntryTag(entry_id=entry.id, tag_id=t.id))
    db.commit()


def test_cards_and_page(make_user, db, client, auth_headers, make_entry_file):
    make_user(OWNER, level=2)
    make_user(LV1, level=1)
    a, fa = make_entry_file(title="유닛 권상 A", hulls=("3496",), name="a.bdf", kind="model", uploaded_by=OWNER)
    make_entry_file(entry=a, name="a.pdf", kind="report")
    db.add(models.ModelSummary(file_id=fa.id, state="done", key="k" * 64, counts={"GRID": 10, "CQUAD4": 4}))
    a.conclusion = "러그 응력 여유 확인"
    b, fb = make_entry_file(title="유닛 권상 B", hulls=("3497",), name="b.bdf", kind="model", uploaded_by=OWNER)
    db.add(models.ModelSummary(file_id=fb.id, state="done", key="k" * 64, counts={"GRID": 10}))   # 같은 모델 내용
    guide, _ = make_entry_file(title="유닛 권상 지침", hulls=(), name="g.pdf", kind="report", uploaded_by=OWNER)
    guide.no_hull = True
    m, _ = make_entry_file(title="매니폴드", hulls=("3496",), name="m.pdf", kind="report", uploaded_by=OWNER)
    o, _ = make_entry_file(title="기타 자료", hulls=("3496",), name="o.pdf", kind="report", uploaded_by=OWNER)
    hidden, _ = make_entry_file(title="유닛 블록 자료", hulls=("9001",), name="h.pdf", kind="report", uploaded_by=OWNER)
    hidden.access = "blocked"
    db.add(models.Person(employee_id="N690001", name="구조가", source="wb"))
    db.commit()
    pid = db.query(models.Person).one().id
    db.add(models.EntryAssignee(entry_id=a.id, person_id=pid, sort_order=0))
    db.add(models.EntryAssignee(entry_id=b.id, person_id=pid, sort_order=0))
    for e in (a, b, guide, hidden):
        _target(db, e, "Unit")
    _target(db, m, "Manifold")
    _target(db, o, "기타")
    h = auth_headers(OWNER)
    cards = client.get("/api/targets", headers=h).json()["targets"]
    assert [c["value"] for c in cards] == ["Unit", "Manifold", "기타"]   # 건수 순, 기타는 맨 뒤
    unit = cards[0]
    assert unit["entries"] == 4 and unit["hulls"] == 3 and unit["thumb"]["file_id"] in (fa.id, fb.id)
    p = client.get("/api/targets/page", params={"value": "Unit"}, headers=h).json()
    assert p["counts"]["entries"] == 4 and p["counts"]["assignees"] == 1
    assert p["start"][0]["entry_id"] == a.entry_id   # 모델과 보고서가 다 있고 결론이 있는 자료 먼저
    assert [r["entry_id"] for r in p["base_docs"]] == [guide.entry_id]
    assert [r["entry_id"] for r in p["conclusions"]] == [a.entry_id]
    assert guide.entry_id not in [r["entry_id"] for r in p["records"]]
    assert len(p["models"]) == 1 and p["models"][0]["same"] == 1   # 같은 모델 내용은 한 칸
    assert p["people"][0]["name"] == "구조가" and p["people"][0]["count"] == 2
    assert b.entry_id in [x["entry_id"] for x in p["gaps"]["no_report"]["items"]]
    assert p["gaps"]["no_conclusion"]["count"] == 3
    # 열람 권한: LV1 은 블록 자료가 숫자에도 들지 않는다(일반 자료도 안 보인다)
    lv1 = client.get("/api/targets/page", params={"value": "Unit"}, headers=auth_headers(LV1)).json()
    assert lv1["counts"]["entries"] == 0
    assert all(c["value"] != "Unit" for c in client.get("/api/targets", headers=auth_headers(LV1)).json()["targets"])


def test_synonym_opens_canonical_page(make_user, db, client, auth_headers, make_entry_file):
    make_user(OWNER, level=2)
    e, _ = make_entry_file(title="GMU 해석", hulls=("3496",), name="a.pdf", kind="report", uploaded_by=OWNER)
    _target(db, e, "Unit")
    term = db.query(models.Tag).filter_by(kind="target", value="Unit").one()
    db.add(models.Tag(kind="target", value="GMU", alias_of_id=term.id))
    db.commit()
    p = client.get("/api/targets/page", params={"value": "GMU"}, headers=auth_headers(OWNER)).json()
    assert p["value"] == "Unit" and "GMU" in p["synonyms"] and p["counts"]["entries"] == 1
