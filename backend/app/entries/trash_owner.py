"""2026-11-25 — 휴지통은 버린 사람의 것(사용자 지시).

- 버린 사람 = 그 자료의 가장 최근 휴지통 보내기 감사 기록(ENTRY_TRASH, DRAFT_DISCARD)의 사람.
  감사 기록이 없으면(재구축으로 DB 를 새로 만든 뒤 등) 올린 사람으로 본다.
- 목록: 누구나 자기가 버린 것만 본다. LV3 은 scope='all' 로 모두 볼 수 있다(남이 버린 자료를 복원하거나 정리할 사람이 있어야 한다).
- 영구 삭제: LV3, 또는 자기가 버리고 자기가 맡은 자료(올린 사람, 74 팀 자료는 팀원 — access.can_own_entry).
"""
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import access, models

TRASH_ACTIONS = ("ENTRY_TRASH", "DRAFT_DISCARD")


def _who_subquery(db: Session):
    """자료 번호 → 가장 최근에 휴지통으로 보낸 사람."""
    A = models.AuditLog
    latest = (db.query(A.target_id.label("target_id"), func.max(A.id).label("mid"))
              .filter(A.target_type == "entry", A.action.in_(TRASH_ACTIONS)).group_by(A.target_id).subquery())
    return (db.query(latest.c.target_id.label("target_id"), A.employee_id.label("employee_id"))
            .join(A, A.id == latest.c.mid).subquery())


def trashed_query(db: Session, user, scope: str = "mine"):
    """휴지통 목록 질의 — (Entry, 버린 사람) 쌍. 볼 수 없는 자료는 빼고(13), scope='all' 은 LV3 만."""
    E = models.Entry
    who = _who_subquery(db)
    by = func.coalesce(who.c.employee_id, E.uploaded_by)
    q = (db.query(E, by.label("trashed_by")).outerjoin(who, who.c.target_id == E.entry_id)
         .filter(E.status == "trashed", access.visible_entries_filter(user)))
    if not (scope == "all" and access.is_admin(user)):
        q = q.filter(by == user.employee_id)
    return q


def trashed_by(db: Session, entry: models.Entry) -> str | None:
    A = models.AuditLog
    row = (db.query(A.employee_id).filter(A.target_type == "entry", A.target_id == entry.entry_id, A.action.in_(TRASH_ACTIONS))
           .order_by(A.id.desc()).first())
    return row[0] if row else entry.uploaded_by


def can_purge(user, entry: models.Entry, by: str | None) -> bool:
    if user is None or entry.status != "trashed":
        return False
    if access.is_admin(user):
        return True
    return bool(by) and by == user.employee_id and access.can_own_entry(user, entry)


def names(db: Session, ids) -> dict[str, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return dict(db.query(models.User.employee_id, models.User.name).filter(models.User.employee_id.in_(ids)))
