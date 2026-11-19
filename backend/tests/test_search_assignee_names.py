"""2026-11-19 — 검색 결과 행에 담당자 이름을 싣는다(화면 오른쪽 '담당 김미희 퇴사 외 1').

올린 사람은 기존 자료 일괄 이관 때문에 대부분 같은 사람이라 행에 싣지 않고, 과제를 실제로 한 담당자를 보인다.
주 담당자(sort_order 0)가 먼저이고, 퇴사 여부(employed)를 함께 준다. 담당자가 없으면 빈 목록."""
from app import models, people
from app.access import SYSTEM
from app.search import SearchQuery, get_search


def test_rows_carry_assignee_names_main_first(db, make_entry_file):
    e, _ = make_entry_file(title="공용 · 기타 · 의장품 · 9 함미 축전지", name="a.inp", kind="other")
    bare, _ = make_entry_file(title="담당자 없는 자료", name="b.bdf", kind="model")
    retired, other = models.Person(name="김미희", employed=False), models.Person(name="박준석")
    db.add_all([retired, other])
    db.commit()
    people.set_assignees(db, e, [retired, other])
    db.commit()

    items = {i["entry_id"]: i for i in get_search().search(db, SearchQuery(user=SYSTEM))["items"]}
    assert items[e.entry_id]["assignees"] == [{"name": "김미희", "employed": False}, {"name": "박준석", "employed": True}]
    assert items[bare.entry_id]["assignees"] == []
