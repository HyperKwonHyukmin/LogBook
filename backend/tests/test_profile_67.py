"""67 — 담당자 프로필 카드: 담당 기준 특성, 권한별 숫자, 사번으로 열기, 명부 없는 작성자, 호선 참여자를 담당자 기준으로."""
from datetime import datetime

import pytest

from app import models

OWNER, OTHER, LV1, LV2, LV3 = "A670001", "A670002", "G670001", "M670001", "S670001"


@pytest.fixture
def world(db, make_user, make_entry_file):
    make_user(OWNER, name="권작성", level=2)
    make_user(OTHER, name="남작성", level=2)
    make_user(LV1, name="게스트", level=1)
    make_user(LV2, name="일반", level=2)
    make_user(LV3, name="관리자", level=3)
    kim = models.Person(name="김퇴사", department="구조시스템연구실", employed=False, source="manual")
    co = models.Person(name="나공동", source="manual")
    kwon = models.Person(name="권작성", employee_id=OWNER, source="wb")
    db.add_all([kim, co, kwon])
    db.add(models.Hull(hull_no="9999", ship_kind="LNG", ship_capacity="174K"))
    zone_f = models.Tag(kind="zone", value="선수부")
    zone_a = models.Tag(kind="zone", value="선미부")
    target = models.Tag(kind="target", value="계류 의장품")
    db.add_all([zone_f, zone_a, target])
    db.flush()

    e1, _ = make_entry_file(title="선수 계류", name="a.pdf", confirmed_at=datetime(2026, 9, 2))
    e1.conclusion, e1.caveats = "계류력 여유 확인", "하중 조합 3 은 빼고 볼 것"
    e2, _ = make_entry_file(title="선미 블록", name="b.pdf", confirmed_at=datetime(2026, 8, 5))
    e2.access = "blocked"
    e3, _ = make_entry_file(title="권 담당", name="c.pdf", uploaded_by=OWNER, confirmed_at=datetime(2026, 7, 1))
    e3.reviewed_by = OWNER
    e4, _ = make_entry_file(title="권 작성만", name="d.pdf", uploaded_by=OWNER, confirmed_at=datetime(2026, 7, 3))
    e5, _ = make_entry_file(title="남 작성", name="e.pdf", uploaded_by=OTHER)
    draft, _ = make_entry_file(title="초안", name="f.pdf", status="draft")
    db.add_all([
        models.EntryAssignee(entry_id=e1.id, person_id=kim.id, sort_order=0),
        models.EntryAssignee(entry_id=e1.id, person_id=co.id, sort_order=1),
        models.EntryAssignee(entry_id=e2.id, person_id=kim.id, sort_order=0),
        models.EntryAssignee(entry_id=draft.id, person_id=kim.id, sort_order=0),
        models.EntryAssignee(entry_id=e3.id, person_id=kwon.id, sort_order=0),
        models.EntryTag(entry_id=e1.id, tag_id=zone_f.id), models.EntryTag(entry_id=e1.id, tag_id=target.id),
        models.EntryTag(entry_id=e2.id, tag_id=zone_a.id),
        models.EntryComment(entry_id=e1.id, employee_id=LV2, kind="issue", body="확인 필요",
                            resolved_by=OWNER, resolved_at=datetime(2026, 9, 3)),
    ])
    db.commit()
    return {"kim": kim, "co": co, "kwon": kwon, "e": [e1, e2, e3, e4, e5]}


def _get(client, auth_headers, viewer, path):
    return client.get(f"/api/people/{path}/profile", headers=auth_headers(viewer))


def test_retired_person_traits_and_handover(world, client, auth_headers):
    d = _get(client, auth_headers, LV2, world["kim"].id).json()
    assert d["person"]["name"] == "김퇴사" and d["person"]["employed"] is False and d["in_roster"] is True
    assert d["basis"] == "assigned"
    # 블록 자료(e2)와 초안은 LV2 숫자에 들어가지 않는다
    assert d["counts"] == {"assigned": 1, "primary": 1, "authored": 0, "same_sets": False}
    assert d["traits"]["zones"] == [{"value": "선수부", "count": 1}]
    assert d["traits"]["targets"] == [{"value": "계류 의장품", "count": 1}]
    assert d["traits"]["ship_kinds"] == [{"value": "LNG", "count": 1}]
    assert d["traits"]["ship_sizes"] == [{"value": "174K급 LNG", "count": 1}]
    assert [c["name"] for c in d["coworkers"]] == ["나공동"] and d["coworkers"][0]["count"] == 1
    assert d["knowledge"]["conclusions"] == 1 and d["knowledge"]["caveats"] == 1
    assert [h["entry_id"] for h in d["handover"]] == [world["e"][0].entry_id]
    assert d["handover"][0]["caveats"] == "하중 조합 3 은 빼고 볼 것"
    assert [m["month"] for m in d["timeline"]] == ["2026-09"]
    assert d["timeline"][0]["entries"][0]["roles"] == ["primary"]
    assert "favorite" in d["timeline"][0]["entries"][0]
    # 순위나 비교 값은 싣지 않는다
    assert not {"rank", "percentile", "score"} & set(d) and not {"rank", "score"} & set(d["counts"])


def test_admin_sees_blocked_entry_in_counts(world, client, auth_headers):
    d = _get(client, auth_headers, LV3, world["kim"].id).json()
    assert d["counts"]["assigned"] == 2
    assert {z["value"] for z in d["traits"]["zones"]} == {"선수부", "선미부"}
    assert [m["month"] for m in d["timeline"]] == ["2026-09", "2026-08"]


def test_roster_person_with_employee_id_has_authored_tab(world, client, auth_headers):
    d = _get(client, auth_headers, LV2, f"by-employee/{OWNER.lower()}").json()
    assert d["person"]["id"] == world["kwon"].id and d["in_roster"] is True
    assert d["counts"]["assigned"] == 1 and d["counts"]["authored"] == 2 and d["counts"]["same_sets"] is False
    roles = {e["title"]: e["roles"] for m in d["timeline"] for e in m["entries"]}
    assert roles == {"권 담당": ["author", "primary"], "권 작성만": ["author"]}
    assert d["knowledge"]["reviewed"] == 1 and d["knowledge"]["resolved_issues"] == 1
    # 명부 번호로 열어도 같은 카드
    assert _get(client, auth_headers, LV2, world["kwon"].id).json()["counts"] == d["counts"]


def test_author_without_roster_row(world, client, auth_headers, db):
    d = _get(client, auth_headers, LV2, f"by-employee/{OTHER}").json()
    assert d["in_roster"] is False and d["basis"] == "authored"
    assert d["person"]["id"] is None and d["person"]["name"] == "남작성" and d["person"]["source"] == "user"
    assert d["counts"]["authored"] == 1 and d["coworkers"] == []
    # 카드를 열어도 명부 행을 만들지 않는다
    assert db.query(models.Person).filter_by(employee_id=OTHER).count() == 0


def test_unknown_person_404(world, client, auth_headers):
    assert _get(client, auth_headers, LV2, 999999).status_code == 404
    assert _get(client, auth_headers, LV2, "by-employee/Z999999").status_code == 404


def test_hull_participants_count_assignees_first(world, client, auth_headers):
    """2026-11-23 사용성 검토 4번 — 참여자는 담당자, 담당자 없는 자료만 작성자."""
    people = client.get("/api/hulls/9999", headers=auth_headers(LV3)).json()["stats"]["people"]
    got = [(p["name"], p["role"], p["count"]) for p in people]
    assert got == [("김퇴사", "assignee", 2), ("권작성", "assignee", 1), ("나공동", "assignee", 1),
                   ("권작성", "author", 1), ("남작성", "author", 1)]
    assert people[0]["person_id"] == world["kim"].id and people[0]["employed"] is False
