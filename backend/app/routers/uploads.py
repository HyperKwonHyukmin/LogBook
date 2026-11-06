"""크롬 업로드 API — 시작 → 조각(PUT, application/octet-stream) → 마치기 / 취소."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from .. import models
from ..database import get_db
from ..dependencies import get_storage, require_writer
from ..storage.paths import StoragePaths
from ..uploads import hint, service

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


class BeginBody(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    target_entry_id: str | None = None
    target_status: str | None = Field(default=None, pattern="^(draft|confirmed)$")
    # 52 — 폴더째 올리기: 모든 초안에 넣을 공통 분류 {zones, target, assignees: [{id}|{employee_id}]}, 과제 폴더마다 1건
    preset: dict | None = None
    split_top: bool = False
    whole: bool = False   # '폴더 전체를 자료 1건' — 하위 폴더 호선이 달라도 나누지 않는다


class DeclaredFile(BaseModel):
    rel_path: str
    size: int = Field(ge=0)


class RejectedFile(BaseModel):
    rel_path: str
    reason: str = "drm"


class FinishBody(BaseModel):
    files: list[DeclaredFile]
    rejected: list[RejectedFile] = []
    # 17 — LV3 '그래도 올리기': 완전 동일 BDF 도 받는다(감사 UPLOAD_DUPLICATE_FORCED). 그 밖 등급은 403
    force: bool = False


@router.post("", status_code=201)
def begin(body: BeginBody, db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
          user: models.User = Depends(require_writer)):
    b = service.begin(db, storage, user, name=body.name, target_entry_id=body.target_entry_id,
                      target_status=body.target_status, preset=body.preset, split_top=body.split_top,
                      whole=body.whole)
    return {"key": b.key, "state": b.state}


@router.get("/rules")
def rules(_user: models.User = Depends(require_writer)):
    """52 — 폴더째 올리기 목록이 쓰는 규칙: 서버가 늘 지우는 임시 파일 무늬, 처음에 체크를 풀어 두는 형식."""
    from ..ingest.rules import EXCLUDE_PATTERNS, SKIP_BY_DEFAULT_EXTS, SKIP_WITH_INP_EXTS

    return {"excluded_patterns": list(EXCLUDE_PATTERNS), "skip_by_default": list(SKIP_BY_DEFAULT_EXTS),
            "skip_with_inp": list(SKIP_WITH_INP_EXTS)}


class SimilarPresetBody(BaseModel):
    texts: list[str] = Field(default_factory=list, max_length=hint.TEXTS_MAX)


@router.post("/similar-preset")
def similar_preset(body: SimilarPresetBody, db: Session = Depends(get_db), user: models.User = Depends(require_writer)):
    """56 — 폴더 올리기 창의 공통 분류 기본값: 폴더 이름(texts)과 낱말이 겹치는 기존 확정 자료의 구역·대상. 없으면 빈 값.
    읽기만 하지만 이름 목록이 길 수 있어 POST 로 받는다."""
    p = hint.similar_preset(db, user, [t[:255] for t in body.texts]) or {}
    return {"zones": p.get("zones") or [], "target": p.get("target"),
            "from_entry": p.get("from_entry"), "from_title": p.get("from_title")}


@router.put("/{key}/chunk")
async def chunk(key: str, request: Request, path: str = Query(...), offset: int = Query(ge=0),
                db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
                user: models.User = Depends(require_writer)):
    too_large = HTTPException(status_code=413, detail="chunk_too_large")
    # 본문을 다 받기 전에 크기를 끊는다 — 먼저 Content-Length, 없거나 거짓이면 받는 도중에.
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > service.MAX_CHUNK:
        raise too_large
    buf = bytearray()
    async for part in request.stream():
        buf += part
        if len(buf) > service.MAX_CHUNK:
            raise too_large
    # 동기 서비스(DB + 공유 폴더 조각 쓰기)는 스레드 풀에서 — 이벤트 루프를 붙잡으면 서버 전체가 멈춘다.
    size = await run_in_threadpool(service.write_chunk, db, storage, user, key, path, offset, bytes(buf))
    return {"size": size}


@router.post("/{key}/finish")
def finish(key: str, body: FinishBody, db: Session = Depends(get_db),
           storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_writer)):
    # 17 — {key(모두 막히면 None), state: staged|blocked, blocked: [막힌 BDF 와 같은 기존 자료], deferred}
    return service.finish(db, storage, user, key, files=[f.model_dump() for f in body.files],
                          rejected=[r.model_dump() for r in body.rejected], force=body.force)


@router.delete("/{key}", status_code=204)
def cancel(key: str, db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
           user: models.User = Depends(require_writer)):
    service.cancel(db, storage, user, key)
    return Response(status_code=204)
