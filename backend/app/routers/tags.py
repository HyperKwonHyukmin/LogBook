"""태그 목록·동의어 묶기/풀기(설계 §6.1 `/tags`). 팀원 누구나 할 수 있고 모두 기록된다."""
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


@router.get("")
def list_tags(kind: str = Query(default="zone", pattern="^(zone|free)$"),
              db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return tags.list_tags(db, kind)


@router.post("/{tag_id}/alias")
def alias(tag_id: int, body: AliasBody, request: Request, db: Session = Depends(get_db),
          storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    t = tags.set_alias(db, storage, user.employee_id, _tag(db, tag_id), _tag(db, body.target_id),
                       client_ip(request))
    return tags.tag_to_dict(db, t)


@router.delete("/{tag_id}/alias")
def unalias(tag_id: int, request: Request, db: Session = Depends(get_db),
            storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    t = tags.clear_alias(db, storage, user.employee_id, _tag(db, tag_id), client_ip(request))
    return tags.tag_to_dict(db, t)
