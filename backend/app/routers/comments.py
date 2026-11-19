"""63 — 자료 의견과 이슈 API. 규칙은 app/comments.py 머리말."""
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import comments, models
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_auth
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api", tags=["comments"])


class CommentIn(BaseModel):
    kind: Literal["comment", "issue"] = "comment"
    body: str = Field(max_length=comments.MAX_BODY + 200)   # 앞뒤 공백을 자른 뒤 MAX_BODY 로 다시 본다
    parent_id: int | None = None


class CommentEdit(BaseModel):
    body: str = Field(max_length=comments.MAX_BODY + 200)


@router.get("/entries/{entry_id}/comments")
def list_comments(entry_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    e = comments.entry_for(db, entry_id, user)
    return comments.list_for_entry(db, e, user)


@router.post("/entries/{entry_id}/comments", status_code=201)
def add_comment(entry_id: str, body: CommentIn, db: Session = Depends(get_db),
                storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    e = comments.entry_for(db, entry_id, user)
    c = comments.create(db, storage, e, user, kind=body.kind, body=body.body, parent_id=body.parent_id)
    return comments.one(db, c, e, user)


@router.patch("/comments/{comment_id}")
def edit_comment(comment_id: int, body: CommentEdit, db: Session = Depends(get_db),
                 storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    c, e = comments.edit(db, storage, comment_id, user, body.body)
    return comments.one(db, c, e, user)


@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: int, request: Request, db: Session = Depends(get_db),
                   storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    comments.remove(db, storage, comment_id, user, ip=client_ip(request))
    return {"ok": True}


@router.post("/comments/{comment_id}/resolve")
def resolve_comment(comment_id: int, db: Session = Depends(get_db),
                    storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    c, e = comments.set_resolved(db, storage, comment_id, user, True)
    return comments.one(db, c, e, user)


@router.delete("/comments/{comment_id}/resolve")
def reopen_comment(comment_id: int, db: Session = Depends(get_db),
                   storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    c, e = comments.set_resolved(db, storage, comment_id, user, False)
    return comments.one(db, c, e, user)


@router.get("/me/comments")
def my_comments(limit: int = Query(default=50, ge=1, le=200), db: Session = Depends(get_db),
                user: models.User = Depends(require_auth)):
    return comments.inbox(db, user, limit=limit)


@router.get("/me/comments/summary")
def my_comments_summary(db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return {"unread": comments.unread_count(db, user)}


@router.post("/me/comments/seen")
def my_comments_seen(db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    at = comments.mark_seen(db, user.employee_id)
    return {"seen_at": at.isoformat()}
