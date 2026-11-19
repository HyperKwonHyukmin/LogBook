"""64 — 나의 메모(개인 지식 노트). 사용자마다 자료 하나에 메모 하나(마크다운 본문), 쓴 사람만 본다.

- 쓰기: 볼 수 있는 자료에만(확정, 초안 모두). 빈 본문으로 쓰면 지운다. 휴지통 자료에는 새로 쓰지 않는다(409).
- 목록: 내 메모 전체, 고친 시각 최근 순. 휴지통 자료와 지금 볼 수 없게 된 자료는 뺀다(행은 남아 복원하면 돌아온다).
  q 는 메모 본문, 자료 제목, 자료 번호에서 찾는다(대소문자 무시, 낱말 모두 들어 있어야).
- 감사 기록은 남기지 않는다(개인 편의 정보, 즐겨찾기와 같다)."""
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import access, models

MAX_BODY = 20000
PREVIEW_CHARS = 240
N = models.EntryNote


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def _iso(dt):
    return dt.isoformat() if dt else None


def _entry(db: Session, entry_id: str, user) -> models.Entry:
    e = db.query(models.Entry).filter_by(entry_id=(entry_id or "").upper()).first()
    if e is None or not access.can_view_entry(user, e, db=db):
        raise HTTPException(status_code=404, detail="entry_not_found")
    return e


def _out(note: models.EntryNote | None) -> dict:
    if note is None:
        return {"body": "", "updated_at": None}
    return {"body": note.body, "updated_at": _iso(note.updated_at)}


def get(db: Session, user, entry_id: str) -> dict:
    e = _entry(db, entry_id, user)
    return _out(db.query(N).filter_by(employee_id=user.employee_id, entry_id=e.id).first())


def put(db: Session, user, entry_id: str, body: str) -> dict:
    """메모를 저장한다(없으면 만든다). 앞뒤 공백만 있는 본문은 지운다. 같은 본문이면 고친 시각을 바꾸지 않는다."""
    e = _entry(db, entry_id, user)
    text = (body or "").replace("\r\n", "\n").strip()
    if len(text) > MAX_BODY:
        raise HTTPException(status_code=422, detail="note_too_long")
    note = db.query(N).filter_by(employee_id=user.employee_id, entry_id=e.id).first()
    if not text:
        if note is not None:
            db.delete(note)
            db.commit()
        return _out(None)
    if e.status == "trashed":
        raise HTTPException(status_code=409, detail="entry_trashed")
    if note is None:
        note = N(employee_id=user.employee_id, entry_id=e.id, body=text, created_at=_now(), updated_at=_now())
        db.add(note)
    elif note.body != text:
        note.body, note.updated_at = text, _now()
    try:
        db.commit()
    except IntegrityError:   # 두 탭에서 동시에 처음 저장 — 이미 생긴 행에 다시 쓴다
        db.rollback()
        note = db.query(N).filter_by(employee_id=user.employee_id, entry_id=e.id).one()
        note.body, note.updated_at = text, _now()
        db.commit()
    db.refresh(note)
    return _out(note)


def listing(db: Session, user, q: str = "", limit: int = 200) -> dict:
    """내 메모 목록 — 화면 '나의 메모'. 자료 번호, 제목, 호선, 상태와 메모 앞부분(전체 본문도 싣는다)."""
    E = models.Entry
    query = (db.query(N, E).join(E, E.id == N.entry_id)
             .filter(N.employee_id == user.employee_id, E.status.in_(("confirmed", "draft")),
                     access.visible_entries_filter(user)))
    total = query.with_entities(func.count(N.id)).scalar() or 0
    for word in (q or "").split():
        like = "%" + word.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        query = query.filter(or_(func.lower(N.body).like(like, escape="\\"), func.lower(E.title).like(like, escape="\\"),
                                 func.lower(E.entry_id).like(like, escape="\\")))
    rows = query.order_by(N.updated_at.desc(), N.id.desc()).limit(limit).all()
    hulls: dict[int, list[str]] = {}
    ids = [e.id for _n, e in rows]
    if ids:
        for eid, hull in (db.query(models.EntryHull.entry_id, models.EntryHull.hull_no)
                          .filter(models.EntryHull.entry_id.in_(ids))
                          .order_by(models.EntryHull.entry_id, models.EntryHull.hull_no)):
            hulls.setdefault(eid, []).append(hull)
    items = [{
        "entry": {"entry_id": e.entry_id, "title": e.title, "status": e.status, "hulls": hulls.get(e.id, []),
                  "no_hull": bool(getattr(e, "no_hull", False))},
        "body": n.body,
        "preview": n.body if len(n.body) <= PREVIEW_CHARS else n.body[:PREVIEW_CHARS] + "…",
        "updated_at": _iso(n.updated_at), "created_at": _iso(n.created_at),
    } for n, e in rows]
    return {"items": items, "total": total, "matched": len(items) if q.strip() else total}
