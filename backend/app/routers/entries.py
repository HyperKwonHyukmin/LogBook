"""Entry API — 조회·수정·확정·쪼개기·합치기·파일 이동·휴지통·복원·공개 단계(13, 15 규칙).

13 — 볼 수 없는 Entry 는 모든 경로에서 404(존재를 숨긴다). _entry(db, id, user) 가 그 한 곳이다."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import access, audit, models
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_auth
from ..entries import service
from ..entries.files import entry_dir
from ..favorites import favorite_pks
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api", tags=["entries"])


class AssigneeRef(BaseModel):
    """46 — 담당자 하나: 명부 행 id, 또는 아직 명부에 없는 WorkBench 사용자의 사번."""
    id: int | None = None
    employee_id: str | None = Field(default=None, max_length=20)


class EntryPatch(BaseModel):
    # 42 — analysis_type 은 받지 않는다(옛 화면이 보내도 모르는 칸으로 무시)
    version: int
    title: str | None = Field(default=None, max_length=200)
    description: str | None = None
    hulls: list[str] | None = None
    zones: list[str] | None = None
    target: str | None = Field(default=None, max_length=100)   # 38 — 대상 구조물(빈 값 = 지움)
    tags: list[str] | None = None
    merge_into_id: str | None = None
    access: str | None = Field(default=None, pattern="^(shared|normal|blocked)$")   # 15 — 초안에서만
    no_hull: bool | None = None       # 20 — '호선 없음(공용)'
    title_auto: bool | None = None
    assignees: list[AssigneeRef] | None = Field(default=None, max_length=20)   # 46 — 담당자(순서대로, 첫 사람이 주)    # 20 — 제목을 형식대로 다시 만들기(호선·구역·대상 + 구별자)


class AccessBody(BaseModel):
    """15 — 공개 단계: 공유(LV1 이상) · 일반(LV2 이상) · 블록(LV3 만)."""
    access: str = Field(pattern="^(shared|normal|blocked)$")
    version: int | None = None


class GrantBody(BaseModel):
    employee_id: str = Field(min_length=1, max_length=20)


class GrantManyBody(BaseModel):
    employee_ids: list[str] = Field(min_length=1, max_length=200)


class SplitBody(BaseModel):
    file_ids: list[int]


class MergeBody(BaseModel):
    from_entry_id: str


class MoveBody(BaseModel):
    to_entry_id: str


class FilesBody(BaseModel):
    """37 — 확정 자료에서 파일 빼기·되돌리기."""
    file_ids: list[int] = Field(min_length=1, max_length=500)
    version: int | None = None


def _entry(db: Session, entry_id: str, user: models.User) -> models.Entry:
    """번호로 Entry 를 찾는다 — 없거나 이 사용자가 볼 수 없으면 404 entry_not_found(13)."""
    e = db.query(models.Entry).filter_by(entry_id=entry_id.upper()).first()
    return access.ensure_visible(db, user, e)


def _detail(db: Session, storage: StoragePaths, e: models.Entry, user: models.User) -> dict:
    """상세 응답 — Entry 사전 + 공유 폴더 경로(확정 Entry 만, 화면의 '경로 복사'용) + 내 즐겨찾기 여부(10)."""
    d = service.entry_to_dict(db, e, viewer=user)
    d["vault_unc"] = str(entry_dir(storage, e)) if e.status == "confirmed" and e.vault_rel else None
    d["favorite"] = bool(e.id in favorite_pks(db, user.employee_id, [e.id]))
    return d


@router.get("/entries/{entry_id}")
def get_entry(entry_id: str, db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
              user: models.User = Depends(require_auth)):
    return _detail(db, storage, _entry(db, entry_id, user), user)


@router.get("/entries/{entry_id}/history")
def entry_history(entry_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    """이 Entry 의 변경 이력(감사 로그) — 최근 것부터 200건. 열람 허락·회수는 남기지 않는다(2026-10-20)."""
    e = _entry(db, entry_id, user)
    rows = (db.query(models.AuditLog).filter_by(target_type="entry", target_id=e.entry_id)
            .filter(models.AuditLog.action.notin_(audit.NOT_KEPT))
            .order_by(models.AuditLog.at.desc(), models.AuditLog.id.desc()).limit(200).all())
    ids = {r.employee_id for r in rows if r.employee_id}
    names = dict(db.query(models.User.employee_id, models.User.name)
                 .filter(models.User.employee_id.in_(ids or {""})))
    return [{"at": r.at.isoformat(), "employee_id": r.employee_id, "name": names.get(r.employee_id),
             "action": r.action, "before": r.before, "after": r.after} for r in rows]


@router.patch("/entries/{entry_id}")
def patch_entry(entry_id: str, body: EntryPatch, request: Request, db: Session = Depends(get_db),
                storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    e = service.update_entry(db, storage, _entry(db, entry_id, user), user, body.model_dump(exclude_unset=True),
                             client_ip(request))
    return _detail(db, storage, e, user)


@router.post("/entries/{entry_id}/confirm")
def confirm_entry(entry_id: str, request: Request, force: bool = False, db: Session = Depends(get_db),
                  storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    # 17 — 완전 동일 BDF 가 그 사이 생겼으면 409 duplicate_model. force=true 는 LV3 만(감사 after.duplicates_forced)
    e = service.confirm(db, storage, _entry(db, entry_id, user), user, client_ip(request), force=force)
    return _detail(db, storage, e, user)


@router.post("/entries/{entry_id}/split")
def split_entry(entry_id: str, body: SplitBody, db: Session = Depends(get_db),
                user: models.User = Depends(require_auth)):
    return service.entry_to_dict(db, service.split(db, _entry(db, entry_id, user), user, body.file_ids), viewer=user)


@router.post("/entries/{entry_id}/merge")
def merge_entry(entry_id: str, body: MergeBody, db: Session = Depends(get_db),
                user: models.User = Depends(require_auth)):
    e = service.merge(db, _entry(db, entry_id, user), _entry(db, body.from_entry_id, user), user)
    return service.entry_to_dict(db, e, viewer=user)


@router.post("/files/{file_id}/move")
def move_file(file_id: int, body: MoveBody, db: Session = Depends(get_db),
              user: models.User = Depends(require_auth)):
    f = db.get(models.File, file_id)
    if f is None or f.entry_id is None or not access.file_visible(db, user, f):
        raise HTTPException(status_code=404, detail="file_not_found")
    service.move_file(db, f, _entry(db, body.to_entry_id, user), user)
    return {"ok": True}


@router.post("/entries/{entry_id}/files/remove")
def remove_files(entry_id: str, body: FilesBody, request: Request, db: Session = Depends(get_db),
                 storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    """37 — 확정 자료에서 파일을 뺀다(휴지통 폴더로, 되돌릴 수 있다). 올린 사람·LV3. 감사 ENTRY_FILES_REMOVED."""
    e = service.remove_files(db, storage, _entry(db, entry_id, user), user, body.file_ids, body.version,
                             client_ip(request))
    return _detail(db, storage, e, user)


@router.post("/entries/{entry_id}/files/restore")
def restore_files(entry_id: str, body: FilesBody, request: Request, db: Session = Depends(get_db),
                  storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    """37 — 뺀 파일 되돌리기. 감사 ENTRY_FILES_RESTORED."""
    e = service.restore_files(db, storage, _entry(db, entry_id, user), user, body.file_ids, client_ip(request))
    return _detail(db, storage, e, user)


@router.delete("/entries/{entry_id}")
def trash_entry(entry_id: str, request: Request, db: Session = Depends(get_db),
                storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    e = service.trash(db, storage, _entry(db, entry_id, user), user, client_ip(request))
    return service.entry_to_dict(db, e, viewer=user)


@router.post("/entries/{entry_id}/restore")
def restore_entry(entry_id: str, request: Request, db: Session = Depends(get_db),
                  storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    e = service.restore(db, storage, _entry(db, entry_id, user), user, client_ip(request))
    return _detail(db, storage, e, user)


@router.get("/trash")
def list_trash(db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    rows = (db.query(models.Entry).filter(models.Entry.status == "trashed", access.visible_entries_filter(user))
            .order_by(models.Entry.updated_at.desc(), models.Entry.id.desc()).limit(200))
    return [{"entry_id": e.entry_id, "title": e.title, "trash_rel": e.trash_rel,
             "restorable": bool(e.vault_rel), "updated_at": e.updated_at.isoformat(),
             "can_restore": access.can_edit_entry(user, e), **access.access_brief(e)} for e in rows]


# ---- 13: 공개 범위·열람 허락 ----

@router.put("/entries/{entry_id}/access")
def put_access(entry_id: str, body: AccessBody, request: Request, db: Session = Depends(get_db),
               storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    """공개 단계 바꾸기 — 공유↔일반은 올린 사람 + LV3, 블록 지정·해제는 LV3 만(아니면 403). 감사 ENTRY_ACCESS."""
    e = service.set_access(db, storage, _entry(db, entry_id, user), user, body.access, body.version,
                           client_ip(request))
    return _detail(db, storage, e, user)


@router.put("/entries/{entry_id}/grants")
def add_grant(entry_id: str, body: GrantBody, request: Request, db: Session = Depends(get_db),
              storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    """개별 열람 허락 주기 — 대상은 WorkBench 활성 사용자(LV1 포함). 블록 자료는 LV3 만."""
    e = _entry(db, entry_id, user)
    service.grant(db, storage, e, user, body.employee_id, client_ip(request))
    return {"grants": service.grants_of(db, e)}


@router.post("/entries/{entry_id}/grants")
def add_grants(entry_id: str, body: GrantManyBody, request: Request, db: Session = Depends(get_db),
               storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    """여러 사람에게 한 번에 열람 허락(31) — 사용자 목록에서 체크한 사람들. 한 명이라도 안 되면 아무도 더하지 않는다."""
    e = _entry(db, entry_id, user)
    added = service.grant_many(db, storage, e, user, body.employee_ids, client_ip(request))
    return {"grants": service.grants_of(db, e), "added": added}


@router.delete("/entries/{entry_id}/grants/{employee_id}")
def delete_grant(entry_id: str, employee_id: str, request: Request, db: Session = Depends(get_db),
                 storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    e = _entry(db, entry_id, user)
    service.revoke(db, storage, e, user, employee_id, client_ip(request))
    return {"grants": service.grants_of(db, e)}


LOOKUP_LIMIT = 500


@router.get("/users/lookup")
def lookup_users(q: str = "", db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    """열람 허락 대상 고르기(15·31) — WorkBench 활성 사용자. 검색어가 없으면 가입자 전체(이름 순, 최대 500명),
    있으면 이름·사번·부서에 그 글자가 들어간 사람. 로그인한 누구나(자기 자료에 허락을 준다)."""
    from .. import wb_users

    try:
        rows = wb_users.list_active(db, q.strip(), limit=LOOKUP_LIMIT)
    except wb_users.WbUnavailable:
        raise HTTPException(status_code=503, detail="wb_unavailable")
    levels = dict(db.query(models.User.employee_id, models.User.level)
                  .filter(models.User.employee_id.in_([u.employee_id for u in rows] or [""])))
    return [{"employee_id": u.employee_id, "name": u.name, "department": u.department, "position": u.position,
             "level": 3 if u.is_admin else (levels.get(u.employee_id) or 1)} for u in rows]
