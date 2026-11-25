"""72 — 새 자료 표시(New). 규칙은 docs/plans/2026-11-25-logbook-72-new-entries.md.

새 자료 = 확정 시각이 내 기준 시각(설정 news.seenAt, 없으면 7일 전)보다 뒤인 확정 자료 중
내가 올리지 않았고, 볼 수 있고, 아직 열어 보지 않은(entry_views 없음) 것. 관심 대상(묶음이면 하위 포함)과
관심 선종이 있으면 그 안에서만. 꺼 두면(news.enabled false) 새 자료가 없다.
"""
from datetime import datetime, timedelta

from sqlalchemy import and_, exists, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import access, models, prefs

FIRST_DAYS = 7
KEY_ON, KEY_TARGETS, KEY_SHIPS, KEY_SEEN = "news.enabled", "news.targets", "news.shipTypes", "news.seenAt"
V = models.EntryView


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def _parse(v) -> datetime | None:
    try:
        return datetime.fromisoformat(v) if isinstance(v, str) else None
    except ValueError:
        return None


def settings(db: Session, employee_id: str) -> dict:
    p = prefs.get_all(db, employee_id)
    return {"enabled": p.get(KEY_ON) is not False,
            "since": _parse(p.get(KEY_SEEN)) or (_now() - timedelta(days=FIRST_DAYS)),
            "targets": list(p.get(KEY_TARGETS) or []), "ship_types": list(p.get(KEY_SHIPS) or [])}


def condition(db: Session, user, s: dict | None = None):
    """Entry 에 거는 SQL 조건. 꺼 두었거나 사용자가 없으면 None(새 자료 없음)."""
    if user is None:
        return None
    s = s or settings(db, user.employee_id)
    if not s["enabled"]:
        return None
    E = models.Entry
    me = (user.employee_id or "").upper()
    conds = [E.status == "confirmed", E.confirmed_at > s["since"],
             or_(E.uploaded_by.is_(None), func.upper(E.uploaded_by) != me),
             ~exists().where(and_(V.entry_id == E.id, V.employee_id == user.employee_id))]
    vis = access.visible_entries_filter(user)
    if vis is not None:
        conds.append(vis)
    if s["targets"]:
        from .vocab import Vocab

        voc = Vocab(db, "target")
        fam = set().union(*(voc.family(t) for t in s["targets"]))
        tag_ids = [x.id for x in voc.by_id.values() if voc.canon(x.value) in fam]
        conds.append(exists().where(and_(models.EntryTag.entry_id == E.id, models.EntryTag.tag_id.in_(tag_ids or [0]))))
    if s["ship_types"]:
        H, EH = models.Hull, models.EntryHull
        conds.append(exists().where(and_(EH.entry_id == E.id, EH.hull_no == H.hull_no, H.ship_type.in_(s["ship_types"]))))
    return and_(*conds)


def count(db: Session, user) -> int:
    cond = condition(db, user)
    if cond is None:
        return 0
    return db.query(func.count(models.Entry.id)).filter(cond).scalar() or 0


def new_pks(db: Session, user, pks=None) -> set[int]:
    """새 자료 Entry id. pks 를 주면 그 안에서만(검색 한 쪽의 'New' 배지)."""
    cond = condition(db, user)
    if cond is None:
        return set()
    q = db.query(models.Entry.id).filter(cond)
    if pks is not None:
        pks = list(pks)
        if not pks:
            return set()
        q = q.filter(models.Entry.id.in_(pks))
    return {i for (i,) in q}


def summary(db: Session, user) -> dict:
    s = settings(db, user.employee_id)
    cond = condition(db, user, s)
    n = (db.query(func.count(models.Entry.id)).filter(cond).scalar() or 0) if cond is not None else 0
    return {"enabled": s["enabled"], "count": n, "since": s["since"].isoformat(),
            "targets": s["targets"], "ship_types": s["ship_types"]}


def mark_seen(db: Session, user, entry: models.Entry) -> None:
    """그 자료를 본 것으로(이미 있으면 그대로)."""
    if db.get(V, (user.employee_id, entry.id)) is not None:
        return
    db.add(V(employee_id=user.employee_id, entry_id=entry.id, seen_at=_now()))
    try:
        db.commit()
    except IntegrityError:   # 두 탭에서 동시에 — 이미 들어갔다
        db.rollback()


def seen_all(db: Session, user) -> None:
    """[모두 확인] — 기준 시각을 지금으로, 내 열어 본 기록은 더 필요 없어 지운다."""
    db.query(V).filter(V.employee_id == user.employee_id).delete(synchronize_session=False)
    prefs.put(db, user.employee_id, {KEY_SEEN: _now().isoformat()})
