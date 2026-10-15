"""판 묶음·비교 API(14).

    GET  /api/entries/{id}/revisions          계열(판·이름·최신판·인접 비교) + 계열 밖 모델 + token
    PUT  /api/entries/{id}/revisions          판 정리 저장(올린 사람·관리자) — 감사 ENTRY_REVISIONS
    POST /api/entries/{id}/revisions/reset    자동 추정으로 되돌리기
    GET  /api/files/{a}/diff/{b}              비교 상태·요약(대기열에 넣지 않음)
    POST /api/files/{a}/diff/{b}              비교 요청(낡았거나 실패면 다시)
    GET  /api/files/{a}/diff/{b}/detail       상세(gzip JSON)
    GET  /api/files/{a}/diff/{b}/item         한 ID 의 전후 값(16 — 두 판 lbm + 상세 목록 이름)

13 — 볼 수 없는 Entry·파일은 404(존재를 숨긴다). 비교는 원본을 바꾸지 않는 보기 동작이라 guest 도 요청할 수 있다."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import access, models
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_auth
from ..revisions import item as diff_item
from ..revisions import job as diff_job
from ..revisions import service
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api", tags=["revisions"])


class SeriesBody(BaseModel):
    file_ids: list[int] = Field(default_factory=list, max_length=500)
    latest: int | None = None
    labels: dict[int, str | None] = Field(default_factory=dict)


class LayoutBody(BaseModel):
    token: str | None = None
    series: list[SeriesBody] = Field(default_factory=list, max_length=200)


def _entry(db: Session, entry_id: str, user) -> models.Entry:
    e = db.query(models.Entry).filter_by(entry_id=entry_id.upper()).first()
    return access.ensure_visible(db, user, e)


@router.get("/entries/{entry_id}/revisions")
def get_revisions(entry_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return service.describe_entry(db, _entry(db, entry_id, user), user)


@router.put("/entries/{entry_id}/revisions")
def put_revisions(entry_id: str, body: LayoutBody, request: Request, db: Session = Depends(get_db),
                  storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    e = _entry(db, entry_id, user)
    service.save(db, storage, e, user, body.model_dump(), client_ip(request))
    return service.describe_entry(db, e, user)


@router.post("/entries/{entry_id}/revisions/reset")
def reset_revisions(entry_id: str, request: Request, db: Session = Depends(get_db),
                    storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    e = _entry(db, entry_id, user)
    service.reset(db, storage, e, user, client_ip(request))
    return service.describe_entry(db, e, user)


def _model(db: Session, file_id: int, user) -> models.File:
    f = db.get(models.File, file_id)
    if f is None or f.location == "trash" or not access.file_visible(db, user, f):
        raise HTTPException(status_code=404, detail="file_not_found")
    return f


def _pair(db: Session, a: int, b: int, user) -> tuple[models.File, models.File]:
    fa, fb = _model(db, a, user), _model(db, b, user)
    if fa.id == fb.id:
        raise HTTPException(status_code=422, detail="same_file")
    if fa.kind != "model" or fb.kind != "model":
        raise HTTPException(status_code=422, detail="not_model")
    return fa, fb


@router.get("/files/{a}/diff/{b}")
def get_diff(a: int, b: int, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    fa, fb = _pair(db, a, b, user)
    sa, sb = diff_job._summaries(db, fa.id, fb.id)
    return {"a": fa.id, "b": fb.id, **diff_job.describe(diff_job.find(db, fa.id, fb.id), sa, sb)}


@router.post("/files/{a}/diff/{b}")
def request_diff(a: int, b: int, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    fa, fb = _pair(db, a, b, user)
    row = diff_job.ensure(db, fa.id, fb.id, requested_by=user.employee_id, retry=True)
    if row is None:
        raise HTTPException(status_code=409, detail="model_not_ready")
    sa, sb = diff_job._summaries(db, fa.id, fb.id)
    return {"a": fa.id, "b": fb.id, **diff_job.describe(row, sa, sb)}


@router.get("/files/{a}/diff/{b}/detail")
def diff_detail(a: int, b: int, db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
                user: models.User = Depends(require_auth)):
    fa, fb = _pair(db, a, b, user)
    row = diff_job.find(db, fa.id, fb.id)
    data = diff_job.read_detail(storage, row) if row is not None else None
    if data is None:
        raise HTTPException(status_code=404, detail="diff_not_ready")
    return Response(content=data, media_type="application/json",
                    headers={"Content-Encoding": "gzip", "Cache-Control": "private, no-cache"})


@router.get("/files/{a}/diff/{b}/item")
def diff_item_values(a: int, b: int, kind: str = Query(...), id: int = Query(...),  # noqa: A002 — 주소 이름
                     db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
                     user: models.User = Depends(require_auth)):
    """16 — 한 요소·절점·강체의 앞 판(a)·뒤 판(b) 값. 두 파일 중 하나라도 볼 수 없으면 404(존재를 숨긴다)."""
    fa, fb = _pair(db, a, b, user)
    if kind not in diff_item.KINDS:
        raise HTTPException(status_code=422, detail="bad_kind")
    sa, sb = diff_job._summaries(db, fa.id, fb.id)
    row = diff_job.find(db, fa.id, fb.id)
    detail = None
    if row is not None and not diff_job.is_stale(row, sa, sb):
        detail = diff_item.read_detail_json(diff_job.read_detail(storage, row))
    try:
        out = diff_item.describe_item(storage, sa, sb, kind, id, detail)
    except diff_item.LbmMissing:
        raise HTTPException(status_code=409, detail="model_not_ready")
    except OSError:
        raise HTTPException(status_code=503, detail="storage_unreachable")
    return {"a_file": fa.id, "b_file": fb.id, "diff_ready": detail is not None, **out}
