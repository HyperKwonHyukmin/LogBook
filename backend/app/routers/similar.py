"""선례 찾기 API(27) — 기준 BDF 와 비슷한 확정 모델(app/similar.py).

    GET  /api/similar?file_id=N[&zone=&analysis_type=]   LogBook 의 BDF 가 기준
    POST /api/similar/bdf?name=…[&zone=&analysis_type=]  본문 = BDF 바이트(저장하지 않는다, 32MB 까지)
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..dependencies import require_auth
from ..similar import MAX_UPLOAD_BYTES, BdfUnreadable, base_from_file, features_from_bdf, find_similar

router = APIRouter(prefix="/api/similar", tags=["similar"])


def _override(base: dict, zone: str | None, analysis_type: str | None) -> dict:
    # 빈 문자열 = '모름'으로 지움, None = 기준 자료의 값 그대로
    if zone is not None:
        base["zone"] = zone or None
    if analysis_type is not None:
        base["atype"] = analysis_type or None
    return base


def _base_out(base: dict) -> dict:
    keys = ("name", "file_id", "model_key", "entry_id", "entry_title", "zone", "atype", "dims", "elems", "mix",
            "sections", "sol", "missing_includes")
    return {k: base.get(k) for k in keys} | {"has_signature": bool(base.get("sig"))}


@router.get("")
def similar_to_file(file_id: int = Query(...), zone: str | None = None, analysis_type: str | None = None,
                    db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    base = base_from_file(db, user, file_id)
    if base is None:
        raise HTTPException(status_code=404, detail="similar_base_not_found")
    base = _override(base, zone, analysis_type)
    return {"base": _base_out(base), **find_similar(db, user, base, exclude_file=file_id)}


@router.post("/bdf")
async def similar_to_upload(request: Request, name: str = Query(..., max_length=255), zone: str | None = None,
                            analysis_type: str | None = None, db: Session = Depends(get_db),
                            user: models.User = Depends(require_auth)):
    too_large = HTTPException(status_code=413, detail="bdf_too_large")
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES:
        raise too_large
    buf = bytearray()
    async for part in request.stream():
        buf += part
        if len(buf) > MAX_UPLOAD_BYTES:
            raise too_large
    try:
        feat = await run_in_threadpool(features_from_bdf, bytes(buf), name)
    except BdfUnreadable as exc:
        raise HTTPException(status_code=422, detail=f"bdf_{exc.code}") from exc
    base = _override({**feat, "name": name}, zone, analysis_type)
    result = await run_in_threadpool(find_similar, db, user, base)
    return {"base": _base_out(base), **result}
