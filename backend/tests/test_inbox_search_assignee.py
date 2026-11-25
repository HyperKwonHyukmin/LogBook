"""2026-11-25 — 올리기와 확정 왼쪽 찾기 칸: 담당자 이름으로도 초안을 찾는다(사용자 신고 — '장영재' 로 찾으면 0건)."""
from app import models

ME = "U750001"


def test_inbox_search_by_assignee_name(db, client, auth_headers, make_user, make_entry_file):
    make_user(ME, level=2)
    a, _ = make_entry_file(title="Type-B LNG 연료탱크 원가절감", status="draft", name="a.pdf", uploaded_by=ME)
    b, _ = make_entry_file(title="Side Shell Plate 검토", status="draft", name="b.pdf", uploaded_by=ME)
    p = models.Person(employee_id="N750001", name="장영재", source="wb")
    q = models.Person(employee_id="N750002", name="김병훈", source="wb")
    db.add_all([p, q])
    db.flush()
    db.add(models.EntryAssignee(entry_id=a.id, person_id=p.id, sort_order=0))
    db.add(models.EntryAssignee(entry_id=b.id, person_id=q.id, sort_order=0))
    db.commit()
    h = auth_headers(ME)
    got = [r["entry_id"] for r in client.get("/api/inbox/drafts", params={"scope": "all", "q": "장영재"}, headers=h).json()["rows"]]
    assert got == [a.entry_id]
    got = [r["entry_id"] for r in client.get("/api/inbox/drafts", params={"scope": "all", "q": "영재"}, headers=h).json()["rows"]]
    assert got == [a.entry_id]   # 이름 일부
    got = {r["entry_id"] for r in client.get("/api/inbox/drafts", params={"scope": "all", "q": "검토"}, headers=h).json()["rows"]}
    assert got == {b.entry_id}   # 제목 찾기는 그대로
