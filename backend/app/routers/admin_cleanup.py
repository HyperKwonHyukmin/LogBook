"""관리자(LV3) '자료 정비'(20) — 필수 분류가 빠진 확정 자료 목록, 제목을 새 형식으로 바꾸기(미리보기·선택 적용·되돌리기).

확정 자료를 숨기거나 상태를 바꾸지 않는다. 제목 적용·되돌리기는 자료 편집과 같은 경로라 감사 기록이 남는다
(ENTRY_RETITLE · ENTRY_RETITLE_REVERT, before/after 에 옛·새 제목). 같은 기능의 CLI: `python -m app.cli naming-cleanup`."""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_admin
from ..entries import cleanup, duplicate_files
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/admin/cleanup", tags=["admin-cleanup"])


class ApplyItem(BaseModel):
    entry_id: str = Field(min_length=1, max_length=10)
    version: int | None = None
    new_title: str | None = Field(default=None, max_length=200)   # 미리보기에서 본 제목(달라졌으면 건너뛴다)


class ApplyBody(BaseModel):
    items: list[ApplyItem] = Field(min_length=1, max_length=cleanup.MAX_LIMIT)


class ResolveBody(BaseModel):
    file_ids: list[int] = Field(min_length=1, max_length=duplicate_files.MAX_RESOLVE)


class RevertBody(BaseModel):
    entry_id: str = Field(min_length=1, max_length=10)


@router.get("/missing")
def missing(missing: str | None = None, uploader: str | None = None, q: str | None = None,
            offset: int = 0, limit: int = 100, db: Session = Depends(get_db),
            user: models.User = Depends(require_admin)):
    return cleanup.missing_list(db, user, missing=missing, uploader=uploader, q=q, offset=offset, limit=limit)


@router.get("/titles")
def titles(status: str | None = None, q: str | None = None, offset: int = 0, limit: int = 100,
           db: Session = Depends(get_db), user: models.User = Depends(require_admin)):
    return cleanup.title_preview(db, user, status=status, q=q, offset=offset, limit=limit)


@router.post("/titles/apply")
def apply(body: ApplyBody, request: Request, db: Session = Depends(get_db),
          storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_admin)):
    return cleanup.apply_titles(db, storage, [i.model_dump() for i in body.items], user=user,
                                ip=client_ip(request))


@router.get("/titles/applied")
def applied(limit: int = 100, db: Session = Depends(get_db), user: models.User = Depends(require_admin)):
    return cleanup.applied_list(db, user, limit=limit)


@router.post("/titles/revert")
def revert(body: RevertBody, request: Request, db: Session = Depends(get_db),
           storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_admin)):
    e = cleanup.revert_title(db, storage, body.entry_id, user=user, ip=client_ip(request))
    return {"entry_id": e.entry_id, "title": e.title, "version": e.version}


@router.get("/duplicates")
def duplicates(category: str | None = None, same: str | None = None, q: str | None = None,
               offset: int = 0, limit: int = 100, db: Session = Depends(get_db),
               user: models.User = Depends(require_admin)):
    """58 — 파일명이 같은 보고서·엑셀·모델(서로 다른 자료 2건 이상)."""
    return duplicate_files.duplicate_list(db, category=category, same=same, q=q, offset=offset, limit=limit)


@router.post("/duplicates/resolve")
def resolve_duplicates(body: ResolveBody, request: Request, db: Session = Depends(get_db),
                       storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_admin)):
    """58 — 고른 파일을 자료에서 빼거나(다른 파일이 남을 때) 자료를 휴지통으로(마지막 파일일 때). 복원 가능."""
    return duplicate_files.resolve(db, storage, body.file_ids, user=user, ip=client_ip(request))
