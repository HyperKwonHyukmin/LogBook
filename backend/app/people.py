"""46 — 담당자 명부(people)와 자료 담당자(entry_assignees).

올린 사람(entries.uploaded_by, 작성자)과 과제를 한 사람(담당자)은 다를 수 있다. 담당자는 WorkBench 사용자에서
고르거나(사번으로 명부 행을 만든다), 없으면 이름·부서·직책을 손으로 넣어 만든다. 재직·퇴사는 명부 한 행에 둔다.

- 찾기: 명부 + WorkBench 활성 사용자(명부에 없는 사람만 덧붙임).
- 만들기: 로그인한 누구나(자기 자료에 붙이려면 필요). 같은 이름·부서·직책의 손 입력 행이 있으면 그 행을 돌려준다.
- 고치기(이름·부서·직책·재직): LV2 이상(공용 데이터 규칙, access.can_write_shared). 감사 PERSON_UPDATE,
  그 사람의 확정 자료 entry.json 을 다시 쓴다(재구축 원천에 새 값이 남게).
- 재구축: entry.json 의 assignees 사본으로 명부를 되살린다(restore_assignees)."""
from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from . import access, audit, jobs, models, wb_users
from .storage.paths import StoragePaths

MAX_ASSIGNEES = 20
SEARCH_LIMIT = 50
PERSON_FIELDS = ("name", "department", "position", "employed")


def _clean(value, size: int) -> str | None:
    text = (value or "").strip() if isinstance(value, str) else ""
    return text[:size] or None


def person_to_dict(p: models.Person) -> dict:
    return {"id": p.id, "employee_id": p.employee_id, "name": p.name, "department": p.department,
            "position": p.position, "employed": bool(p.employed), "source": p.source}


def assignees_of(db: Session, entry: models.Entry) -> list[dict]:
    rows = (db.query(models.Person).join(models.EntryAssignee, models.EntryAssignee.person_id == models.Person.id)
            .filter(models.EntryAssignee.entry_id == entry.id)
            .order_by(models.EntryAssignee.sort_order, models.Person.id))
    return [person_to_dict(p) for p in rows]


def search(db: Session, q: str = "") -> dict:
    """명부(이름·사번·부서) + WorkBench 활성 사용자. WorkBench 를 읽을 수 없으면 명부만(wb_unavailable 표시)."""
    q = (q or "").strip()
    stmt = db.query(models.Person)
    if q:
        like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        stmt = stmt.filter(or_(models.Person.name.like(like, escape="\\"),
                               models.Person.employee_id.like(like.upper(), escape="\\"),
                               models.Person.department.like(like, escape="\\")))
    people = [person_to_dict(p) for p in stmt.order_by(models.Person.name, models.Person.id).limit(SEARCH_LIMIT)]
    known = {e for (e,) in db.query(models.Person.employee_id).filter(models.Person.employee_id.isnot(None))}
    wb_failed = False
    try:
        wb = [u for u in wb_users.list_active(db, q, limit=SEARCH_LIMIT) if u.employee_id not in known]
    except wb_users.WbUnavailable:
        wb, wb_failed = [], True
    out = people + [{"id": None, "employee_id": u.employee_id, "name": u.name or u.employee_id,
                     "department": u.department, "position": u.position, "employed": True, "source": "wb"}
                    for u in wb]
    return {"rows": out, "wb_unavailable": wb_failed}


def create(db: Session, user: models.User, data: dict) -> models.Person:
    """손 입력 담당자 만들기 — 같은 이름·부서·직책의 손 입력 행이 있으면 그 행(두 번 눌러도 하나)."""
    access.require_writer(user)
    name = _clean(data.get("name"), 50)
    if not name:
        raise HTTPException(status_code=422, detail="name_required")
    dept, pos = _clean(data.get("department"), 100), _clean(data.get("position"), 50)
    same = (db.query(models.Person)
            .filter_by(source="manual", employee_id=None, name=name, department=dept, position=pos).first())
    if same is not None:
        return same
    p = models.Person(name=name, department=dept, position=pos, employed=bool(data.get("employed", True)),
                      source="manual", created_by=user.employee_id)
    db.add(p)
    db.commit()
    return p


def update(db: Session, storage: StoragePaths, person: models.Person, user: models.User, data: dict,
           ip: str | None = None) -> models.Person:
    """명부 고치기(LV2 이상) — 이름·부서·직책·재직. 바뀐 칸만 감사에 남기고 그 사람의 확정 자료 entry.json 을 다시 쓴다."""
    if not access.can_write_shared(user):
        raise HTTPException(status_code=403, detail="level2_required")
    before, after = {}, {}
    for key in PERSON_FIELDS:
        if key not in data:
            continue
        if key == "employed":
            value = bool(data[key])
        else:
            value = _clean(data[key], 50 if key in ("name", "position") else 100)
            if key == "name" and not value:
                raise HTTPException(status_code=422, detail="name_required")
        old = bool(person.employed) if key == "employed" else getattr(person, key)
        if value != old:
            before[key], after[key] = old, value
            setattr(person, key, value)
    if not after:
        return person
    db.flush()
    audit.record(db, storage, actor=user.employee_id, action="PERSON_UPDATE", target_type="person",
                 target_id=str(person.id), before={"name": person.name} | before, after=after, ip=ip)
    _queue_meta(db, person.id)
    db.commit()
    return person


def _queue_meta(db: Session, person_id: int) -> None:
    """이 사람이 담당자인 확정 자료의 entry.json 다시 쓰기(워커 write_meta)."""
    pks = [pk for (pk,) in db.query(models.EntryAssignee.entry_id)
           .join(models.Entry, models.Entry.id == models.EntryAssignee.entry_id)
           .filter(models.EntryAssignee.person_id == person_id, models.Entry.status == "confirmed")]
    for pk in pks:
        if not jobs.has_queued(db, "write_meta", pk):
            jobs.enqueue(db, "write_meta", pk)


def _from_wb(db: Session, employee_id: str) -> models.Person:
    """사번으로 명부 행 — 없으면 WorkBench 에서 읽어 만든다(이름·부서·직책 사본)."""
    eid = employee_id.strip().upper()
    p = db.query(models.Person).filter_by(employee_id=eid).first()
    if p is not None:
        return p
    try:
        u = wb_users.fetch(db, eid)
    except wb_users.WbUnavailable:
        raise HTTPException(status_code=503, detail="wb_unavailable")
    if u is None:
        raise HTTPException(status_code=422, detail="person_not_found")
    p = models.Person(employee_id=eid, name=(u.name or eid)[:50], department=_clean(u.department, 100),
                      position=_clean(u.position, 50), employed=True, source="wb")
    db.add(p)
    db.flush()
    return p


def resolve_refs(db: Session, refs: list) -> list[models.Person]:
    """화면이 보낸 담당자 목록({id} 또는 {employee_id}) → 명부 행(순서 유지, 같은 사람 한 번)."""
    if len(refs) > MAX_ASSIGNEES:
        raise HTTPException(status_code=422, detail="too_many_assignees")
    out: list[models.Person] = []
    for ref in refs:
        ref = ref if isinstance(ref, dict) else {}
        if ref.get("id"):
            p = db.get(models.Person, int(ref["id"]))
            if p is None:
                raise HTTPException(status_code=422, detail="person_not_found")
        elif isinstance(ref.get("employee_id"), str) and ref["employee_id"].strip():
            p = _from_wb(db, ref["employee_id"])
        else:
            raise HTTPException(status_code=422, detail="person_not_found")
        if all(p.id != x.id for x in out):
            out.append(p)
    return out


def set_assignees(db: Session, entry: models.Entry, people: list[models.Person]) -> None:
    db.query(models.EntryAssignee).filter_by(entry_id=entry.id).delete(synchronize_session=False)
    for i, p in enumerate(people):
        db.add(models.EntryAssignee(entry_id=entry.id, person_id=p.id, sort_order=i))


def copy_assignees(db: Session, src: models.Entry, dst: models.Entry) -> None:
    """쪼개기·합치기 — src 의 담당자 중 dst 에 없는 사람을 dst 끝에 덧붙인다."""
    have = [pid for (pid,) in db.query(models.EntryAssignee.person_id).filter_by(entry_id=dst.id)
            .order_by(models.EntryAssignee.sort_order)]
    for (pid,) in (db.query(models.EntryAssignee.person_id).filter_by(entry_id=src.id)
                   .order_by(models.EntryAssignee.sort_order)):
        if pid not in have:
            db.add(models.EntryAssignee(entry_id=dst.id, person_id=pid, sort_order=len(have)))
            have.append(pid)


def label(p: dict) -> str:
    """감사 스냅숏·_INFO.txt 용 한 줄 — '홍길동(구조설계부, 책임, 퇴사)'."""
    extra = [x for x in (p.get("department"), p.get("position")) if x] + ([] if p.get("employed") else ["퇴사"])
    return p["name"] + (f"({', '.join(extra)})" if extra else "")


# ---- entry.json(재구축 원천) ----

def export(people: list[dict]) -> list[dict]:
    return [{k: p[k] for k in ("employee_id", "name", "department", "position", "employed") if p[k] is not None}
            for p in people]


def restore_assignees(db: Session, entry: models.Entry, data) -> int:
    """재구축 — entry.json assignees 사본으로 명부 행을 찾거나 만들고 자료에 붙인다. 붙인 수."""
    found: list[models.Person] = []
    for item in data if isinstance(data, list) else []:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not item["name"].strip():
            continue
        eid = item.get("employee_id").strip().upper() if isinstance(item.get("employee_id"), str) else None
        name, dept, pos = _clean(item["name"], 50), _clean(item.get("department"), 100), _clean(item.get("position"), 50)
        if eid:
            p = db.query(models.Person).filter_by(employee_id=eid).first()
        else:
            p = (db.query(models.Person)
                 .filter_by(source="manual", employee_id=None, name=name, department=dept, position=pos).first())
        if p is None:
            p = models.Person(employee_id=eid or None, name=name, department=dept, position=pos,
                              employed=bool(item.get("employed", True)), source="wb" if eid else "manual")
            db.add(p)
            db.flush()
        if all(p.id != x.id for x in found):
            found.append(p)
    set_assignees(db, entry, found)
    return len(found)
