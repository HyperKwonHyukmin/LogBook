"""태그 목록·동의어 묶기/풀기(설계 §6.1 `/tags`). 자유 태그는 팀원 누구나, 구역은 관리자만(08) — 모두 기록된다."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models, tags
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_auth
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/tags", tags=["tags"])


class AliasBody(BaseModel):
    target_id: int


def _tag(db: Session, tag_id: int) -> models.Tag:
    t = db.get(models.Tag, tag_id)
    if t is None:
        raise HTTPException(status_code=404, detail="tag_not_found")
    return t


def _guard_vocab(user: models.User, tag: models.Tag) -> None:
    """구역·해석 종류는 통제 어휘(08) — 동의어 묶기·풀기는 관리자만(분류 목록 화면). 자유 태그는 누구나."""
    if tag.kind != "free" and not user.is_admin:
        raise HTTPException(status_code=403, detail="admin_required")


@router.get("")
def list_tags(kind: str = Query(default="zone", pattern="^(zone|free)$"),
              db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return tags.list_tags(db, kind)


@router.post("/{tag_id}/alias")
def alias(tag_id: int, body: AliasBody, request: Request, db: Session = Depends(get_db),
          storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    _guard_vocab(user, _tag(db, tag_id))
    t = tags.set_alias(db, storage, user.employee_id, _tag(db, tag_id), _tag(db, body.target_id),
                       client_ip(request))
    return tags.tag_to_dict(db, t)


@router.delete("/{tag_id}/alias")
def unalias(tag_id: int, request: Request, db: Session = Depends(get_db),
            storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    _guard_vocab(user, _tag(db, tag_id))
    t = tags.clear_alias(db, storage, user.employee_id, _tag(db, tag_id), client_ip(request))
    return tags.tag_to_dict(db, t)
