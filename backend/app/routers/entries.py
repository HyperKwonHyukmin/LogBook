"""Entry API — 조회·수정·확정·쪼개기·합치기·파일 이동·휴지통·복원."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_auth
from ..entries import service
from ..entries.files import entry_dir
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api", tags=["entries"])


class EntryPatch(BaseModel):
    version: int
    title: str | None = Field(default=None, max_length=200)
    analysis_type: str | None = Field(default=None, max_length=50)
    description: str | None = None
    analysis_period: str | None = None
    hulls: list[str] | None = None
    zones: list[str] | None = None
    tags: list[str] | None = None
    merge_into_id: str | None = None


class SplitBody(BaseModel):
    file_ids: list[int]


class MergeBody(BaseModel):
    from_entry_id: str


class MoveBody(BaseModel):
    to_entry_id: str


def _entry(db: Session, entry_id: str) -> models.Entry:
    e = db.query(models.Entry).filter_by(entry_id=entry_id.upper()).first()
    if e is None:
        raise HTTPException(status_code=404, detail="entry_not_found")
    return e


def _detail(db: Session, storage: StoragePaths, e: models.Entry) -> dict:
    """상세 응답 — Entry 사전 + 공유 폴더 경로(확정 Entry 만, 화면의 '경로 복사'용)."""
    d = service.entry_to_dict(db, e)
    d["vault_unc"] = str(entry_dir(storage, e)) if e.status == "confirmed" and e.vault_rel else None
    return d


@router.get("/entries/{entry_id}")
def get_entry(entry_id: str, db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
              user: models.User = Depends(require_auth)):
    return _detail(db, storage, _entry(db, entry_id))


@router.get("/entries/{entry_id}/history")
def entry_history(entry_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    """이 Entry 의 변경 이력(감사 로그) — 최근 것부터 200건."""
    e = _entry(db, entry_id)
    rows = (db.query(models.AuditLog).filter_by(target_type="entry", target_id=e.entry_id)
            .order_by(models.AuditLog.at.desc(), models.AuditLog.id.desc()).limit(200).all())
    names = dict(db.query(models.User.employee_id, models.User.name)
                 .filter(models.User.employee_id.in_({r.employee_id for r in rows if r.employee_id} or {""})))
    return [{"at": r.at.isoformat(), "employee_id": r.employee_id, "name": names.get(r.employee_id),
             "action": r.action, "before": r.before, "after": r.after} for r in rows]


@router.patch("/entries/{entry_id}")
def patch_entry(entry_id: str, body: EntryPatch, request: Request, db: Session = Depends(get_db),
                storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    e = service.update_entry(db, storage, _entry(db, entry_id), user, body.model_dump(exclude_unset=True),
                             client_ip(request))
    return _detail(db, storage, e)


@router.post("/entries/{entry_id}/confirm")
def confirm_entry(entry_id: str, request: Request, db: Session = Depends(get_db),
                  storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    e = service.confirm(db, storage, _entry(db, entry_id), user, client_ip(request))
    return _detail(db, storage, e)


@router.post("/entries/{entry_id}/split")
def split_entry(entry_id: str, body: SplitBody, db: Session = Depends(get_db),
                user: models.User = Depends(require_auth)):
    return service.entry_to_dict(db, service.split(db, _entry(db, entry_id), user, body.file_ids))


@router.post("/entries/{entry_id}/merge")
def merge_entry(entry_id: str, body: MergeBody, db: Session = Depends(get_db),
                user: models.User = Depends(require_auth)):
    e = service.merge(db, _entry(db, entry_id), _entry(db, body.from_entry_id), user)
    return service.entry_to_dict(db, e)


@router.post("/files/{file_id}/move")
def move_file(file_id: int, body: MoveBody, db: Session = Depends(get_db),
              user: models.User = Depends(require_auth)):
    f = db.get(models.File, file_id)
    if f is None or f.entry_id is None:
        raise HTTPException(status_code=404, detail="file_not_found")
    service.move_file(db, f, _entry(db, body.to_entry_id), user)
    return {"ok": True}


@router.delete("/entries/{entry_id}")
def trash_entry(entry_id: str, request: Request, db: Session = Depends(get_db),
                storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    e = service.trash(db, storage, _entry(db, entry_id), user, client_ip(request))
    return service.entry_to_dict(db, e)


@router.post("/entries/{entry_id}/restore")
def restore_entry(entry_id: str, request: Request, db: Session = Depends(get_db),
                  storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    e = service.restore(db, storage, _entry(db, entry_id), user, client_ip(request))
    return _detail(db, storage, e)


@router.get("/trash")
def list_trash(db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    rows = (db.query(models.Entry).filter_by(status="trashed")
            .order_by(models.Entry.updated_at.desc(), models.Entry.id.desc()).limit(200))
    return [{"entry_id": e.entry_id, "title": e.title, "trash_rel": e.trash_rel,
             "restorable": bool(e.vault_rel), "updated_at": e.updated_at.isoformat()} for e in rows]
