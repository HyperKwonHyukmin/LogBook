"""63 — 자료 의견과 이슈(댓글).

확정 자료 화면 아래에 다른 사람이 의견을 남기고, 고쳐야 할 것은 이슈로 올려 해결 여부를 따라간다.
결론과 주의점(53)은 올린 사람이 정리한 글이고, 여기는 다른 사람의 목소리다.

규칙(계획 63)
    보기     자료를 볼 수 있는 사람(access.can_view_entry). 못 보면 404 — 자료의 존재를 숨기는 규칙과 같다
    쓰기     LV1 이상, 확정 자료에만(초안 409 entry_not_confirmed, 휴지통 409 entry_trashed)
    답글     최상위 글에만 한 단계. 답글의 종류는 늘 '의견'
    고치기   작성자만. 지우기 = 작성자 또는 LV3(남의 글이면 감사 COMMENT_DELETE)
    해결     이슈만 — 이슈를 쓴 사람, 자료를 올린 사람, LV3
    지우기   답글이 달린 최상위 글은 삭제 표시(deleted_at, 본문 비움), 아니면 행을 지운다.
             남은 것이 삭제 표시뿐인 최상위 글은 마지막 답글이 지워질 때 함께 지운다

새 의견(알림) — 내가 올린 확정 자료에 남이 쓴 글 + 내 글에 남이 단 답글. 읽은 시각은 user_prefs 'comments.seenAt'
(서버만 쓴다, prefs.PREF_KEYS 밖이라 설정 API 에는 보이지 않는다). 처음이면 최근 UNREAD_DAYS 일만 센다.

registry.json(comments)에 남겨 재구축 뒤에도 되살린다 — 쓰기마다 registry 를 다시 쓴다(실패해도 요청은 성공, DB 가 먼저).
"""
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, aliased

from . import access, audit, models
from .storage.paths import StoragePaths

MAX_BODY = 2000
UNREAD_DAYS = 30
SEEN_KEY = "comments.seenAt"
PREVIEW_CHARS = 300

C = models.EntryComment


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _names(db: Session, ids) -> dict[str, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return dict(db.query(models.User.employee_id, models.User.name).filter(models.User.employee_id.in_(ids)))


def _write_registry(db: Session, storage: StoragePaths) -> None:
    from .ops.registry import write_registry   # 순환 import 방지

    write_registry(db, storage)


# ---- 자료와 글 찾기 ----

def entry_for(db: Session, entry_id: str, user) -> models.Entry:
    """번호로 Entry — 없거나 볼 수 없으면 404."""
    e = db.query(models.Entry).filter_by(entry_id=(entry_id or "").upper()).first()
    if e is None or not access.can_view_entry(user, e, db=db):
        raise HTTPException(status_code=404, detail="entry_not_found")
    return e


def _comment(db: Session, comment_id: int, user) -> tuple[models.EntryComment, models.Entry]:
    c = db.get(C, comment_id)
    if c is None:
        raise HTTPException(status_code=404, detail="comment_not_found")
    e = db.get(models.Entry, c.entry_id)
    if e is None or not access.can_view_entry(user, e, db=db):
        raise HTTPException(status_code=404, detail="comment_not_found")
    return c, e


def can_comment(user, entry: models.Entry) -> bool:
    return entry.status == "confirmed" and access.can_write(user)


def _require_open_entry(user, entry: models.Entry) -> None:
    access.require_writer(user)
    if entry.status == "trashed":
        raise HTTPException(status_code=409, detail="entry_trashed")
    if entry.status != "confirmed":
        raise HTTPException(status_code=409, detail="entry_not_confirmed")


def _clean_body(body: str | None) -> str:
    text = (body or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="comment_empty")
    if len(text) > MAX_BODY:
        raise HTTPException(status_code=422, detail="comment_too_long")
    return text


def _can_resolve(user, c: models.EntryComment, entry: models.Entry) -> bool:
    if c.kind != "issue" or c.deleted_at is not None or user is None:
        return False
    return (c.employee_id == user.employee_id or entry.uploaded_by == user.employee_id
            or access.is_admin(user))


# ---- 목록 ----

def _to_dict(c: models.EntryComment, entry: models.Entry, user, names: dict[str, str]) -> dict:
    mine = user is not None and c.employee_id == user.employee_id
    deleted = c.deleted_at is not None
    live = entry.status == "confirmed" and not deleted
    return {
        "id": c.id, "kind": c.kind, "parent_id": c.parent_id,
        "body": "" if deleted else c.body,
        "author": {"employee_id": c.employee_id, "name": names.get(c.employee_id)},
        "created_at": _iso(c.created_at), "edited_at": _iso(c.edited_at), "deleted": deleted,
        "status": None if c.kind != "issue" else ("resolved" if c.resolved_at else "open"),
        "resolved": ({"employee_id": c.resolved_by, "name": names.get(c.resolved_by or ""), "at": _iso(c.resolved_at)}
                     if c.resolved_at else None),
        "can_edit": live and mine,
        "can_delete": not deleted and (mine or access.is_admin(user)),
        "can_resolve": live and _can_resolve(user, c, entry),
    }


def list_for_entry(db: Session, entry: models.Entry, user) -> dict:
    rows = db.query(C).filter(C.entry_id == entry.id).order_by(C.created_at, C.id).all()
    names = _names(db, {r.employee_id for r in rows} | {r.resolved_by for r in rows})
    tops, replies = [], {}
    for r in rows:
        if r.parent_id is None:
            tops.append(r)
        else:
            replies.setdefault(r.parent_id, []).append(r)
    items = []
    for t in tops:
        d = _to_dict(t, entry, user, names)
        d["replies"] = [_to_dict(r, entry, user, names) for r in replies.get(t.id, [])]
        if d["deleted"] and not d["replies"]:
            continue   # 답글 없는 삭제 표시는 보이지 않는다(정상 흐름에서는 행이 이미 지워졌다)
        items.append(d)
    open_issues = sum(1 for t in tops if t.kind == "issue" and t.resolved_at is None and t.deleted_at is None)
    return {"items": items, "total": sum(1 for r in rows if r.deleted_at is None), "open_issues": open_issues,
            "can_comment": can_comment(user, entry)}


# ---- 쓰기 ----

def create(db: Session, storage: StoragePaths, entry: models.Entry, user, *, kind: str, body: str,
           parent_id: int | None = None) -> models.EntryComment:
    _require_open_entry(user, entry)
    text = _clean_body(body)
    if kind not in models.COMMENT_KINDS:
        raise HTTPException(status_code=422, detail="bad_comment_kind")
    if parent_id is not None:
        parent = db.get(C, parent_id)
        if parent is None or parent.entry_id != entry.id:
            raise HTTPException(status_code=404, detail="comment_not_found")
        if parent.parent_id is not None:
            raise HTTPException(status_code=422, detail="reply_depth")   # 답글에 답글은 없다
        if parent.deleted_at is not None:
            raise HTTPException(status_code=409, detail="comment_deleted")
        kind = "comment"
    c = C(entry_id=entry.id, parent_id=parent_id, employee_id=user.employee_id, kind=kind, body=text)
    db.add(c)
    db.commit()
    db.refresh(c)
    _write_registry(db, storage)
    return c


def edit(db: Session, storage: StoragePaths, comment_id: int, user, body: str) -> tuple[models.EntryComment, models.Entry]:
    c, e = _comment(db, comment_id, user)
    _require_open_entry(user, e)
    if c.deleted_at is not None:
        raise HTTPException(status_code=409, detail="comment_deleted")
    if c.employee_id != user.employee_id:
        raise HTTPException(status_code=403, detail="not_comment_author")
    text = _clean_body(body)
    if text != c.body:
        c.body, c.edited_at = text, _now()
        db.commit()
        _write_registry(db, storage)
    return c, e


def remove(db: Session, storage: StoragePaths, comment_id: int, user, ip: str | None = None) -> None:
    c, e = _comment(db, comment_id, user)
    if c.deleted_at is not None:
        raise HTTPException(status_code=409, detail="comment_deleted")
    mine = user is not None and c.employee_id == user.employee_id
    if not (mine or access.is_admin(user)):
        raise HTTPException(status_code=403, detail="not_comment_author")
    snapshot = {"comment_id": c.id, "author": c.employee_id, "kind": c.kind, "body": c.body[:PREVIEW_CHARS]}
    has_replies = db.query(C.id).filter(C.parent_id == c.id).first() is not None
    parent_id = c.parent_id
    if has_replies:
        c.deleted_at, c.body = _now(), ""
    else:
        db.delete(c)
        db.flush()
        if parent_id is not None:   # 남은 것이 삭제 표시뿐인 최상위 글은 함께 지운다
            parent = db.get(C, parent_id)
            if (parent is not None and parent.deleted_at is not None
                    and db.query(C.id).filter(C.parent_id == parent.id).first() is None):
                db.delete(parent)
    db.flush()
    if mine:
        db.commit()
    else:   # LV3 가 남의 글을 지웠다 — 감사에 남긴다(record 가 커밋한다)
        audit.record(db, storage, actor=user.employee_id, action="COMMENT_DELETE", target_type="entry",
                     target_id=e.entry_id, before=snapshot, ip=ip)
    _write_registry(db, storage)


def set_resolved(db: Session, storage: StoragePaths, comment_id: int, user, resolved: bool) -> tuple[models.EntryComment, models.Entry]:
    c, e = _comment(db, comment_id, user)
    _require_open_entry(user, e)
    if c.kind != "issue":
        raise HTTPException(status_code=422, detail="not_issue")
    if not _can_resolve(user, c, e):
        raise HTTPException(status_code=403, detail="cannot_resolve")
    if resolved and c.resolved_at is None:
        c.resolved_by, c.resolved_at = user.employee_id, _now()
    elif not resolved and c.resolved_at is not None:
        c.resolved_by, c.resolved_at = None, None
    else:
        return c, e
    db.commit()
    _write_registry(db, storage)
    return c, e


def one(db: Session, c: models.EntryComment, entry: models.Entry, user) -> dict:
    names = _names(db, {c.employee_id, c.resolved_by})
    d = _to_dict(c, entry, user, names)
    d["replies"] = []
    return d


# ---- 새 의견(알림) ----

def seen_at(db: Session, employee_id: str) -> datetime | None:
    row = db.get(models.UserPref, (employee_id, SEEN_KEY))
    if row is None or not row.value:
        return None
    try:
        return datetime.fromisoformat(str(row.value))
    except ValueError:
        return None


def mark_seen(db: Session, employee_id: str) -> datetime:
    now = _now()
    row = db.get(models.UserPref, (employee_id, SEEN_KEY))
    if row is None:
        db.add(models.UserPref(employee_id=employee_id, key=SEEN_KEY, value=now.isoformat()))
    else:
        row.value = now.isoformat()
    db.commit()
    return now


def _assigned_entry_ids(employee_id: str):
    """2026-11-19 — 내가 담당자인 자료 id(SQL 부분 질의). 명부에 사번이 있는 재직자만(손으로 넣은 퇴사자 등은 받을 사람이 없다)."""
    Pn, A = models.Person, models.EntryAssignee
    return (select(A.entry_id).join(Pn, Pn.id == A.person_id)
            .where(Pn.employee_id.isnot(None), func.upper(Pn.employee_id) == (employee_id or "").upper(),
                   Pn.employed.is_(True)))


def _inbox_query(db: Session, user):
    """내게 온 글 — 내가 올린 확정 자료에 남이 쓴 글 + 내 글에 남이 단 답글(지운 글 제외, 지금 볼 수 있는 자료만).
    2026-11-19 — 내가 담당자인 자료에 남이 쓴 글도(자료 대부분이 일괄 이관이라 올린 사람이 한 사람이다. 해석한 사람이 받게)."""
    me = user.employee_id
    P = aliased(C)
    return (db.query(C, models.Entry, P)
            .join(models.Entry, models.Entry.id == C.entry_id)
            .outerjoin(P, P.id == C.parent_id)
            .filter(C.employee_id != me, C.deleted_at.is_(None), models.Entry.status == "confirmed",
                    access.visible_entries_filter(user),
                    or_(models.Entry.uploaded_by == me, and_(P.id.isnot(None), P.employee_id == me),
                        models.Entry.id.in_(_assigned_entry_ids(me)))))


def _since(db: Session, user) -> datetime:
    return seen_at(db, user.employee_id) or (_now() - timedelta(days=UNREAD_DAYS))


def unread_count(db: Session, user) -> int:
    since = _since(db, user)
    q = _inbox_query(db, user).filter(C.created_at > since)
    return q.with_entities(func.count(C.id)).scalar() or 0


def inbox(db: Session, user, limit: int = 50) -> dict:
    since = _since(db, user)
    rows = _inbox_query(db, user).order_by(C.created_at.desc(), C.id.desc()).limit(limit).all()
    names = _names(db, {c.employee_id for c, _e, _p in rows})
    items = []
    for c, e, p in rows:
        body = c.body if len(c.body) <= PREVIEW_CHARS else c.body[:PREVIEW_CHARS] + "…"
        items.append({
            "id": c.id, "kind": c.kind, "body": body,
            "status": None if c.kind != "issue" else ("resolved" if c.resolved_at else "open"),
            "author": {"employee_id": c.employee_id, "name": names.get(c.employee_id)},
            "created_at": _iso(c.created_at),
            "entry": {"entry_id": e.entry_id, "title": e.title},
            "reply_to_me": p is not None and p.employee_id == user.employee_id,
            # 2026-11-19 — 왜 받았나: reply(내 글에 답글) > mine(내가 올린 자료) > assigned(내가 담당자인 자료)
            "reason": ("reply" if p is not None and p.employee_id == user.employee_id
                       else "mine" if e.uploaded_by == user.employee_id else "assigned"),
            "is_new": c.created_at > since,
        })
    return {"items": items, "unread": unread_count(db, user), "seen_at": _iso(seen_at(db, user.employee_id))}


# ---- 갖춤 현황(보완할 자료 '열린 이슈') ----

def open_issue_counts(db: Session, pks) -> dict[int, int]:
    pks = list(pks)
    if not pks:
        return {}
    return dict(db.query(C.entry_id, func.count(C.id))
                .filter(C.entry_id.in_(pks), C.kind == "issue", C.parent_id.is_(None),
                        C.resolved_at.is_(None), C.deleted_at.is_(None))
                .group_by(C.entry_id))


# ---- 재구축(05) ----

def registry_rows(db: Session) -> list[dict]:
    rows = (db.query(C, models.Entry.entry_id).join(models.Entry, models.Entry.id == C.entry_id)
            .filter(models.Entry.entry_id.isnot(None)).order_by(C.id))
    return [{"key": c.id, "parent_key": c.parent_id, "entry_id": eid, "employee_id": c.employee_id, "kind": c.kind,
             "body": c.body, "resolved_by": c.resolved_by, "resolved_at": _iso(c.resolved_at),
             "created_at": _iso(c.created_at), "edited_at": _iso(c.edited_at), "deleted_at": _iso(c.deleted_at)}
            for c, eid in rows]


def restore_from_registry(db: Session, registry: dict) -> int:
    """registry.json 의 comments 를 되살린다. 없는 자료의 글은 건너뛰고, 부모가 없는 답글도 건너뛴다."""
    def dt(v):
        try:
            return datetime.fromisoformat(v) if v else None
        except (TypeError, ValueError):
            return None

    by_id = {eid: pk for pk, eid in db.query(models.Entry.id, models.Entry.entry_id)}
    new_ids: dict = {}
    n = 0
    rows = [r for r in registry.get("comments") or [] if isinstance(r, dict)]
    for r in sorted(rows, key=lambda r: (r.get("parent_key") is not None, r.get("key") or 0)):
        pk = by_id.get(str(r.get("entry_id") or ""))
        who = str(r.get("employee_id") or "").strip()
        if pk is None or not who:
            continue
        parent = None
        if r.get("parent_key") is not None:
            parent = new_ids.get(r["parent_key"])
            if parent is None:
                continue
        kind = r.get("kind") if r.get("kind") in models.COMMENT_KINDS else "comment"
        c = C(entry_id=pk, parent_id=parent, employee_id=who, kind=kind, body=str(r.get("body") or ""),
              resolved_by=r.get("resolved_by"), resolved_at=dt(r.get("resolved_at")),
              created_at=dt(r.get("created_at")) or _now(), edited_at=dt(r.get("edited_at")),
              deleted_at=dt(r.get("deleted_at")))
        db.add(c)
        db.flush()
        new_ids[r.get("key")] = c.id
        n += 1
    return n
