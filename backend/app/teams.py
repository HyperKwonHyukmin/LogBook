"""74 — 팀 공간: 팀과 팀원 관리(LV3 만). 팀 자료의 열람과 쓰기 규칙은 access.py 한 곳.

팀원은 한 사람 한 팀(team_members.employee_id 고유). 팀원 명단, 팀 이름과 설명이 바뀌면 registry.json 을 다시 쓴다(재구축 원천).
팀 지우기는 그 팀 자료(휴지통 포함)가 0건일 때만(409 team_has_entries). 바꾼 일은 활동 로그에 남긴다."""
from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import audit, models, wb_users
from .storage.paths import StoragePaths

NAME_MAX = 50
DESC_MAX = 200
ADD_LIMIT = 200


def _after(db: Session, storage: StoragePaths) -> None:
    from .ops.registry import write_registry  # 순환 import 방지

    write_registry(db, storage)


def _clean_name(name) -> str:
    v = " ".join(str(name or "").split())
    if not v:
        raise HTTPException(status_code=422, detail="team_name_required")
    if len(v) > NAME_MAX:
        raise HTTPException(status_code=422, detail="team_name_too_long")
    return v


def _clean_desc(desc) -> str | None:
    v = " ".join(str(desc or "").split())
    return v[:DESC_MAX] or None


def get_team(db: Session, team_id: int) -> models.Team:
    t = db.get(models.Team, team_id)
    if t is None:
        raise HTTPException(status_code=404, detail="team_not_found")
    return t


def entry_counts(db: Session) -> dict[int, int]:
    """팀마다 팀 자료 수(휴지통 포함 — 지우기 판단과 같은 기준)."""
    E = models.Entry
    return {tid: n for tid, n in db.query(E.team_id, func.count(E.id))
            .filter(E.access == "team", E.team_id.isnot(None)).group_by(E.team_id)}


def team_to_dict(db: Session, t: models.Team, counts: dict[int, int] | None = None, people: dict | None = None) -> dict:
    counts = entry_counts(db) if counts is None else counts
    members = (db.query(models.TeamMember).filter_by(team_id=t.id)
               .order_by(models.TeamMember.employee_id).all())
    if people is None:
        try:
            people = wb_users.fetch_many(db, [m.employee_id for m in members])
        except wb_users.WbUnavailable:
            people = {}
    local = {u.employee_id: u for u in db.query(models.User)
             .filter(models.User.employee_id.in_([m.employee_id for m in members] or [""]))}

    def who(m):
        wb, lu = people.get(m.employee_id), local.get(m.employee_id)
        return {"employee_id": m.employee_id,
                "name": (wb.name if wb else None) or (lu.name if lu else None),
                "department": (wb.department if wb else None) or (lu.department if lu else None),
                "wb_active": bool(wb and wb.is_active),
                "added_by": m.added_by, "added_at": m.added_at.isoformat() if m.added_at else None}

    return {"id": t.id, "name": t.name, "description": t.description, "created_by": t.created_by,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "entries": counts.get(t.id, 0), "members": [who(m) for m in members]}


def list_teams(db: Session) -> list[dict]:
    counts = entry_counts(db)
    teams = db.query(models.Team).order_by(models.Team.name).all()
    ids = [m.employee_id for m in db.query(models.TeamMember)]
    try:
        people = wb_users.fetch_many(db, ids)
    except wb_users.WbUnavailable:
        people = {}
    return [team_to_dict(db, t, counts, people) for t in teams]


def create(db: Session, storage: StoragePaths, admin: models.User, name, description=None, ip=None) -> models.Team:
    t = models.Team(name=_clean_name(name), description=_clean_desc(description), created_by=admin.employee_id)
    db.add(t)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="team_name_taken")
    audit.record(db, storage, actor=admin.employee_id, action="TEAM_CREATE", target_type="team", target_id=str(t.id),
                 after={"name": t.name, "description": t.description}, ip=ip)
    _after(db, storage)
    return t


def update(db: Session, storage: StoragePaths, admin: models.User, team_id: int, patch: dict, ip=None) -> models.Team:
    t = get_team(db, team_id)
    before = {"name": t.name, "description": t.description}
    if "name" in patch:
        t.name = _clean_name(patch["name"])
    if "description" in patch:
        t.description = _clean_desc(patch["description"])
    after = {"name": t.name, "description": t.description}
    if after == before:
        return t
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="team_name_taken")
    audit.record(db, storage, actor=admin.employee_id, action="TEAM_UPDATE", target_type="team", target_id=str(t.id),
                 before=before, after=after, ip=ip)
    _after(db, storage)
    return t


def delete(db: Session, storage: StoragePaths, admin: models.User, team_id: int, ip=None) -> None:
    t = get_team(db, team_id)
    if entry_counts(db).get(t.id):
        raise HTTPException(status_code=409, detail="team_has_entries")
    before = {"name": t.name, "members": [m.employee_id for m in db.query(models.TeamMember).filter_by(team_id=t.id)]}
    db.query(models.TeamMember).filter_by(team_id=t.id).delete(synchronize_session=False)
    db.delete(t)
    db.flush()
    audit.record(db, storage, actor=admin.employee_id, action="TEAM_DELETE", target_type="team", target_id=str(team_id),
                 before=before, ip=ip)
    _after(db, storage)


def add_members(db: Session, storage: StoragePaths, admin: models.User, team_id: int, employee_ids, ip=None) -> list[str]:
    """팀원 넣기 — WorkBench 활성 사용자만(없으면 404 user_not_found, 비활성 422 member_user_inactive).
    이미 다른 팀에 있는 사람은 409 member_in_other_team(한 사람 한 팀 — 먼저 그 팀에서 뺀다). 이미 이 팀이면 건너뛴다.
    새로 넣은 사번 목록."""
    t = get_team(db, team_id)
    eids = list(dict.fromkeys(e for e in ((x or "").strip().upper() for x in employee_ids or []) if e))
    if not eids:
        raise HTTPException(status_code=422, detail="member_empty")
    if len(eids) > ADD_LIMIT:
        raise HTTPException(status_code=422, detail="member_too_many")
    try:
        found = wb_users.fetch_many(db, eids)
    except wb_users.WbUnavailable:
        raise HTTPException(status_code=503, detail="wb_unavailable")
    if any(e not in found for e in eids):
        raise HTTPException(status_code=404, detail="user_not_found")
    if any(not found[e].is_active for e in eids):
        raise HTTPException(status_code=422, detail="member_user_inactive")
    have = {m.employee_id: m.team_id for m in db.query(models.TeamMember).filter(models.TeamMember.employee_id.in_(eids))}
    if any(tid != t.id for tid in have.values()):
        raise HTTPException(status_code=409, detail="member_in_other_team")
    added = [e for e in eids if e not in have]
    if not added:
        return []
    for e in added:
        db.add(models.TeamMember(team_id=t.id, employee_id=e, added_by=admin.employee_id))
    try:
        db.flush()
    except IntegrityError:   # 같은 때 다른 팀에 넣었다
        db.rollback()
        raise HTTPException(status_code=409, detail="member_in_other_team")
    audit.record(db, storage, actor=admin.employee_id, action="TEAM_MEMBER_ADD", target_type="team", target_id=str(t.id),
                 after={"team": t.name, "members": added}, ip=ip)
    _after(db, storage)
    return added


def remove_member(db: Session, storage: StoragePaths, admin: models.User, team_id: int, employee_id: str, ip=None) -> None:
    """팀원 빼기 — 그 사람이 올린 팀 자료는 계속 본다(올린 사람 규칙), 다른 팀원 자료는 더 이상 못 본다."""
    t = get_team(db, team_id)
    eid = (employee_id or "").strip().upper()
    n = db.query(models.TeamMember).filter_by(team_id=t.id, employee_id=eid).delete(synchronize_session=False)
    if not n:
        db.rollback()
        raise HTTPException(status_code=404, detail="member_not_found")
    db.flush()
    audit.record(db, storage, actor=admin.employee_id, action="TEAM_MEMBER_REMOVE", target_type="team",
                 target_id=str(t.id), before={"team": t.name, "members": [eid]}, ip=ip)
    _after(db, storage)


def _space_counts(db: Session, user, team_ids) -> tuple[dict, dict]:
    """팀마다 (보이는 확정 팀 자료 수, 확정 전 팀 초안 수)."""
    from . import access

    E = models.Entry
    base = db.query(E.team_id, func.count(E.id)).filter(E.access == "team", E.team_id.in_(list(team_ids) or [0]),
                                                        access.visible_entries_filter(user))
    confirmed = dict(base.filter(E.status == "confirmed").group_by(E.team_id).all())
    drafts = dict(base.filter(E.status == "draft").group_by(E.team_id).all())
    return confirmed, drafts


def spaces_for(db: Session, user) -> list[dict]:
    """업무별 모음 맨 위 팀 줄 — 팀원은 자기 팀, LV3 는 모든 팀. 그 밖에는 빈 목록(팀이 있다는 것도 보이지 않는다)."""
    from . import access

    if access.is_admin(user):
        teams = db.query(models.Team).order_by(models.Team.name).all()
    else:
        tid = access.team_id_of(db, user)
        teams = [t for t in [db.get(models.Team, tid) if tid is not None else None] if t is not None]
    if not teams:
        return []
    confirmed, drafts = _space_counts(db, user, [t.id for t in teams])
    members = dict(db.query(models.TeamMember.team_id, func.count(models.TeamMember.id))
                   .filter(models.TeamMember.team_id.in_([t.id for t in teams])).group_by(models.TeamMember.team_id).all())
    return [{"id": t.id, "name": t.name, "description": t.description, "entries": confirmed.get(t.id, 0),
             "drafts": drafts.get(t.id, 0), "members": members.get(t.id, 0)} for t in teams]


def space(db: Session, user, team_id: int) -> dict:
    """팀 공간 화면 머리 — 팀 정보, 팀원 명단, 건수. 그 팀원과 LV3 만(아니면 없는 팀과 같은 404)."""
    from . import access

    t = db.get(models.Team, team_id)
    if t is None or not (access.is_admin(user) or access.team_id_of(db, user) == t.id):
        raise HTTPException(status_code=404, detail="team_not_found")
    d = team_to_dict(db, t)
    confirmed, drafts = _space_counts(db, user, [t.id])
    return {"id": t.id, "name": t.name, "description": t.description,
            "entries": confirmed.get(t.id, 0), "drafts": drafts.get(t.id, 0),
            "members": [{k: m[k] for k in ("employee_id", "name", "department", "wb_active")} for m in d["members"]],
            "is_member": access.team_id_of(db, user) == t.id}


def team_brief_of(db: Session, user) -> dict | None:
    """로그인 정보에 싣는 내 팀 {id, name}(없으면 None)."""
    from . import access

    tid = access.team_id_of(db, user)
    t = db.get(models.Team, tid) if tid is not None else None
    return {"id": t.id, "name": t.name} if t is not None else None
