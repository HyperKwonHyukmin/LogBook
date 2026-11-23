"""67 — 담당자 프로필 카드(`/p/{명부 번호}`, 사번으로도 연다).

카드 기준은 담당자 명부(people). 명부 사번이 users 와 같으면 '작성한 자료'(entries.uploaded_by)도 같은 카드에 싣는다.
명부에 없는 작성자는 users 정보만으로 카드를 만든다(명부 행을 저절로 만들지 않는다).

특성은 따로 저장하지 않고 화면을 열 때 이미 있는 값으로 계산한다(관계 지도 25, 갖춤 현황 26 과 같은 방식).
기준 자료 = 담당한 확정 자료(명부 행이 없으면 작성한 확정 자료). 모든 숫자는 보는 사람이 볼 수 있는 자료로만 센다(13, 15) —
분포에도 블록 자료가 섞이지 않아야 그런 자료가 있다는 사실이 드러나지 않는다.

순위, 점수, 사람 사이 비교는 싣지 않는다(사용자 결정 2026-11-23). 이 사람 한 명의 분포만 준다."""
from collections import Counter, defaultdict

from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import access, models
from .hull_info import _month
from .people import person_to_dict
from .plm_ship import ship_facets
from .vocab import Vocab

TAG_KINDS = ("zone", "target")
MAX_COWORKERS = 8
MAX_HANDOVER = 200


def resolve(db: Session, *, person_id: int | None = None, employee_id: str | None = None):
    """(명부 행, 사용자 행). 둘 다 없으면 404. 명부 번호로 열면 그 사람의 사번으로 사용자 행을 찾는다."""
    person = user_row = None
    if person_id is not None:
        person = db.get(models.Person, person_id)
        if person is None:
            raise HTTPException(status_code=404, detail="person_not_found")
        employee_id = person.employee_id
    elif employee_id:
        employee_id = employee_id.strip().upper()
        person = db.query(models.Person).filter(models.Person.employee_id == employee_id).first()
    if employee_id:
        user_row = db.query(models.User).filter(models.User.employee_id == employee_id).first()
    if person is None and user_row is None:
        raise HTTPException(status_code=404, detail="person_not_found")
    return person, user_row


def _ranked(c: Counter) -> list[dict]:
    return [{"value": v, "count": n} for v, n in sorted(c.items(), key=lambda x: (-x[1], str(x[0])))]


def person_profile(db: Session, person: models.Person | None, user_row: models.User | None, viewer) -> dict:
    E = models.Entry
    visible = access.visible_entries_filter(viewer)
    emp = (person.employee_id if person is not None else None) or (user_row.employee_id if user_row else None)

    # 담당한 자료(역할 = 주 담당 | 공동 담당)와 작성한 자료
    roles: dict[int, set] = defaultdict(set)
    entries: dict[int, models.Entry] = {}
    assigned: list[int] = []
    if person is not None:
        for e, order in (db.query(E, models.EntryAssignee.sort_order)
                         .join(models.EntryAssignee, models.EntryAssignee.entry_id == E.id)
                         .filter(models.EntryAssignee.person_id == person.id, E.status == "confirmed", visible)):
            entries[e.id] = e
            roles[e.id].add("primary" if order == 0 else "co")
            assigned.append(e.id)
    authored: list[int] = []
    if emp:
        for e in db.query(E).filter(E.uploaded_by == emp, E.status == "confirmed", visible):
            entries[e.id] = e
            roles[e.id].add("author")
            authored.append(e.id)
    basis = assigned if person is not None else authored
    pks = list(entries)

    # 분류(대표 값), 호선, 파일 — 자료마다 묻지 않고 한 번에 읽는다(N+1 방지)
    tags: dict[int, dict[str, list[str]]] = defaultdict(lambda: {k: [] for k in TAG_KINDS})
    hulls: dict[int, list[str]] = defaultdict(list)
    kinds_by_entry: dict[int, set] = defaultdict(set)
    sols: dict[int, set] = defaultdict(set)
    lifting: set[int] = set()
    programs: dict[int, set] = defaultdict(set)
    if pks:
        vocabs = {k: Vocab(db, k) for k in TAG_KINDS}
        for eid, tag in (db.query(models.EntryTag.entry_id, models.Tag)
                         .join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
                         .filter(models.EntryTag.entry_id.in_(pks), models.Tag.kind.in_(TAG_KINDS))):
            v = vocabs[tag.kind].root(tag).value
            if v not in tags[eid][tag.kind]:
                tags[eid][tag.kind].append(v)
        for eid, hull_no in (db.query(models.EntryHull.entry_id, models.EntryHull.hull_no)
                             .filter(models.EntryHull.entry_id.in_(pks))
                             .order_by(models.EntryHull.is_primary.desc(), models.EntryHull.hull_no)):
            hulls[eid].append(hull_no)
        F, S = models.File, models.ModelSummary
        for eid, kind, sol, lift, origin in (db.query(F.entry_id, F.kind, S.sol, S.lifting, models.Batch.origin)
                                             .outerjoin(S, S.file_id == F.id)
                                             .outerjoin(models.Batch, models.Batch.id == F.batch_id)
                                             .filter(F.entry_id.in_(pks), F.location != "trash")):
            kinds_by_entry[eid].add(kind)
            if kind == "model" and sol:
                sols[eid].add(str(sol))
            if lift:
                lifting.add(eid)
            if isinstance(origin, dict) and origin.get("program"):
                programs[eid].add(str(origin["program"]))
    _ships, ship_kinds, ship_sizes = ship_facets(db, {h for hs in hulls.values() for h in hs})

    # 특성 분포 — 기준 자료마다 값 하나는 한 번만 센다
    zones, targets, kinds_c, sizes_c, sol_c, prog_c = (Counter() for _ in range(6))
    for eid in basis:
        zones.update(tags[eid]["zone"])
        targets.update(tags[eid]["target"][:1])
        kinds_c.update({ship_kinds.get(h) for h in hulls[eid]} - {None})
        sizes_c.update({ship_sizes.get(h) for h in hulls[eid]} - {None})
        sol_c.update(sols[eid])
        prog_c.update(programs[eid])

    # 함께 일한 사람 — 기준 자료의 다른 담당자
    coworkers = []
    if person is not None and basis:
        co = Counter(pid for (pid,) in db.query(models.EntryAssignee.person_id)
                     .filter(models.EntryAssignee.entry_id.in_(basis), models.EntryAssignee.person_id != person.id))
        if co:
            rows = {p.id: p for p in db.query(models.Person).filter(models.Person.id.in_(list(co)))}
            coworkers = [{**person_to_dict(rows[pid]), "count": n}
                         for pid, n in sorted(co.items(), key=lambda x: (-x[1], rows[x[0]].name))[:MAX_COWORKERS]]

    # 남긴 지식 — 결론과 주의점은 기준 자료에서, 검토 서명과 해결한 이슈는 사번이 있을 때 볼 수 있는 자료 전체에서
    with_conclusion = sum(1 for eid in basis if (entries[eid].conclusion or "").strip())
    with_caveats = sum(1 for eid in basis if (entries[eid].caveats or "").strip())
    reviewed = resolved = 0
    if emp:
        reviewed = db.query(E.id).filter(E.reviewed_by == emp, E.status == "confirmed", visible).count()
        C = models.EntryComment
        resolved = (db.query(C.id).join(E, E.id == C.entry_id)
                    .filter(C.resolved_by == emp, C.kind == "issue", E.status == "confirmed", visible).count())

    def brief(e: models.Entry) -> dict:
        return {"entry_id": e.entry_id, "title": e.title, "roles": sorted(roles[e.id]),
                "zones": tags[e.id]["zone"], "target": (tags[e.id]["target"] or [None])[0],
                "hulls": hulls[e.id], "kinds": sorted(kinds_by_entry[e.id]),
                "confirmed_at": e.confirmed_at.isoformat() if e.confirmed_at else None, **access.access_brief(e)}

    ordered = sorted(entries.values(), key=lambda e: (e.confirmed_at or e.created_at, e.id), reverse=True)
    months: dict[str, list] = defaultdict(list)
    for e in ordered:
        months[_month(e)].append(brief(e))
    # 인수인계 묶음 — 기준 자료 중 결론이나 주의점을 남긴 것(최근 순)
    basis_set = set(basis)
    handover = [{**brief(e), "conclusion": e.conclusion, "caveats": e.caveats}
                for e in ordered if e.id in basis_set and ((e.conclusion or "").strip() or (e.caveats or "").strip())]

    if person is not None:
        who = person_to_dict(person)
    else:
        who = {"id": None, "employee_id": user_row.employee_id, "name": user_row.name or user_row.employee_id,
               "department": user_row.department, "position": user_row.position, "employed": True, "source": "user"}
    return {
        "person": who,
        "in_roster": person is not None,
        "basis": "assigned" if person is not None else "authored",
        "counts": {"assigned": len(assigned), "primary": sum(1 for eid in assigned if "primary" in roles[eid]),
                   "authored": len(authored),
                   # 담당한 자료와 작성한 자료가 완전히 같으면 화면은 탭 대신 한 줄 안내로 줄인다
                   "same_sets": bool(assigned) and set(assigned) == set(authored)},
        "traits": {"zones": _ranked(zones), "targets": _ranked(targets), "ship_kinds": _ranked(kinds_c),
                   "ship_sizes": _ranked(sizes_c), "sols": _ranked(sol_c), "programs": _ranked(prog_c),
                   "lifting": sum(1 for eid in basis if eid in lifting)},
        "coworkers": coworkers,
        "knowledge": {"conclusions": with_conclusion, "caveats": with_caveats, "reviewed": reviewed,
                      "resolved_issues": resolved},
        "handover": handover[:MAX_HANDOVER],
        "timeline": [{"month": m, "entries": months[m]} for m in sorted(months, reverse=True)],
    }
