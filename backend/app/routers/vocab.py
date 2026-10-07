"""분류 목록 API(08) — 해석 종류·구역 통제 어휘. 목록 읽기는 누구나, 바꾸기는 관리자만(모두 기록)."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models, vocab
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_admin, require_auth
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/vocab", tags=["vocab"])
KIND = Query(pattern="^(atype|zone)$")


class TermBody(BaseModel):
    kind: str = Field(pattern="^(atype|zone)$")
    value: str = Field(min_length=1, max_length=100)


class TermPatch(BaseModel):
    value: str | None = Field(default=None, max_length=100)
    active: bool | None = None


class OrderBody(BaseModel):
    kind: str = Field(pattern="^(atype|zone)$")
    ids: list[int]


class ValueBody(BaseModel):
    value: str = Field(min_length=1, max_length=100)


def _tag(db: Session, tag_id: int) -> models.Tag:
    t = db.get(models.Tag, tag_id)
    if t is None:
        raise HTTPException(status_code=404, detail="term_not_found")
    return t


def _term_dict(t: models.Tag) -> dict:
    return {"id": t.id, "kind": t.kind, "value": t.value, "active": bool(t.active)}


@router.get("")
def list_vocab(kind: str = KIND, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return {"kind": kind, "other": vocab.OTHER, "terms": vocab.list_terms(db, kind)}


@router.get("/unlisted")
def unlisted(kind: str = KIND, db: Session = Depends(get_db), user: models.User = Depends(require_admin)):
    return vocab.unlisted(db, kind)


@router.post("/terms")
def add_term(body: TermBody, request: Request, db: Session = Depends(get_db),
             storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_admin)):
    t = vocab.add_term(db, storage, user.employee_id, body.kind, body.value, client_ip(request))
    return _term_dict(t)


@router.patch("/terms/{tag_id}")
def update_term(tag_id: int, body: TermPatch, request: Request, db: Session = Depends(get_db),
                storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_admin)):
    t = vocab.update_term(db, storage, user.employee_id, _tag(db, tag_id), value=body.value, active=body.active,
                          ip=client_ip(request))
    return _term_dict(t)


@router.post("/reorder")
def reorder(body: OrderBody, request: Request, db: Session = Depends(get_db),
            storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_admin)):
    vocab.reorder(db, storage, user.employee_id, body.kind, body.ids, client_ip(request))
    return {"ok": True}


@router.post("/terms/{tag_id}/merge")
def merge(tag_id: int, body: ValueBody, request: Request, db: Session = Depends(get_db),
          storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_admin)):
    """목록 밖 값을 이 용어로 합친다 — Entry 값을 바꾸고 그 값을 동의어로 남긴다."""
    term = _tag(db, tag_id)
    return vocab.merge_value(db, storage, user.employee_id, term.kind, body.value, term, ip=client_ip(request))


@router.post("/terms/{tag_id}/synonyms")
def add_synonym(tag_id: int, body: ValueBody, request: Request, db: Session = Depends(get_db),
                storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_admin)):
    term = _tag(db, tag_id)
    return vocab.merge_value(db, storage, user.employee_id, term.kind, body.value, term, create=True,
                             ip=client_ip(request))


@router.delete("/synonyms/{tag_id}")
def remove_synonym(tag_id: int, request: Request, db: Session = Depends(get_db),
                   storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_admin)):
    vocab.remove_synonym(db, storage, user.employee_id, db.get(models.Tag, tag_id), client_ip(request))
    return {"ok": True}
