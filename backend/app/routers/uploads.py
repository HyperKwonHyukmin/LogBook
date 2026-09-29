"""크롬 업로드 API — 시작 → 조각(PUT, application/octet-stream) → 마치기 / 취소."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from .. import models
from ..database import get_db
from ..dependencies import get_storage, require_auth
from ..storage.paths import StoragePaths
from ..uploads import service

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


class BeginBody(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    target_entry_id: str | None = None


class DeclaredFile(BaseModel):
    rel_path: str
    size: int = Field(ge=0)


class RejectedFile(BaseModel):
    rel_path: str
    reason: str = "drm"


class FinishBody(BaseModel):
    files: list[DeclaredFile]
    rejected: list[RejectedFile] = []


@router.post("", status_code=201)
def begin(body: BeginBody, db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
          user: models.User = Depends(require_auth)):
    b = service.begin(db, storage, user, name=body.name, target_entry_id=body.target_entry_id)
    return {"key": b.key, "state": b.state}


@router.put("/{key}/chunk")
async def chunk(key: str, request: Request, path: str = Query(...), offset: int = Query(ge=0),
                db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
                user: models.User = Depends(require_auth)):
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
    # 동기 서비스(DB + 공유 폴더 8MB 쓰기)는 스레드 풀에서 — 이벤트 루프를 붙잡으면 서버 전체가 멈춘다.
    size = await run_in_threadpool(service.write_chunk, db, storage, user, key, path, offset, bytes(buf))
    return {"size": size}


@router.post("/{key}/finish")
def finish(key: str, body: FinishBody, db: Session = Depends(get_db),
           storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    b = service.finish(db, storage, user, key, files=[f.model_dump() for f in body.files],
                       rejected=[r.model_dump() for r in body.rejected])
    return {"key": b.key, "state": b.state}


@router.delete("/{key}", status_code=204)
def cancel(key: str, db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
           user: models.User = Depends(require_auth)):
    service.cancel(db, storage, user, key)
    return Response(status_code=204)
