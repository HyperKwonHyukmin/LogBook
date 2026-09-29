"""파일 API — 내려받기 링크(토큰)·원본 스트리밍·추출 본문·엑셀 시트 미리보기(설계 §6.3)."""
import os
import uuid
from datetime import datetime, timedelta
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..dependencies import get_storage, require_auth
from ..entries.locate import FileUnavailable, file_path
from ..extract.xlsx import sheet_preview
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/files", tags=["files"])

LINK_TTL = timedelta(minutes=10)
STREAM_CHUNK = 1024 * 1024
TEXT_PREVIEW_CHARS = 20_000
SHEET_MAX_BYTES = 50 * 1024 * 1024
INLINE_TYPES = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def _file(db: Session, file_id: int) -> models.File:
    f = db.get(models.File, file_id)
    if f is None or f.location == "trash":
        raise HTTPException(status_code=404, detail="file_not_found")
    return f


def _path(db: Session, storage: StoragePaths, f: models.File) -> str:
    try:
        return file_path(db, storage, f)
    except FileUnavailable:
        raise HTTPException(status_code=404, detail="file_missing")


def _disposition(name: str, inline: bool) -> str:
    fallback = "".join(c if 32 <= ord(c) < 127 and c not in '"\\' else "_" for c in name) or "file"
    return f"{'inline' if inline else 'attachment'}; filename=\"{fallback}\"; filename*=UTF-8''{quote(name)}"


@router.post("/{file_id}/link")
def create_link(file_id: int, inline: bool = False, db: Session = Depends(get_db),
                user: models.User = Depends(require_auth)):
    f = _file(db, file_id)
    now = _now()
    db.query(models.DownloadToken).filter(models.DownloadToken.expires_at <= now).delete(synchronize_session=False)
    tok = models.DownloadToken(token=str(uuid.uuid4()), file_id=f.id, employee_id=user.employee_id,
                               expires_at=now + LINK_TTL)
    db.add(tok)
    db.commit()
    url = f"/api/files/{f.id}/content?t={tok.token}" + ("&inline=1" if inline else "")
    return {"url": url, "expires_at": tok.expires_at.isoformat()}


@router.get("/{file_id}/content")
def content(file_id: int, t: str = Query(default=""), inline: bool = False, db: Session = Depends(get_db),
            storage: StoragePaths = Depends(get_storage)):
    tok = db.get(models.DownloadToken, t) if t else None
    # 만료 시각 그 순간도 만료로 본다 — MySQL DATETIME 은 소수 초를 반올림해 저장하므로
    # '<' 로 비교하면 초 경계에서 막 만료된 토큰이 1초 동안 통과할 수 있다.
    if tok is None or tok.file_id != file_id or tok.expires_at <= _now():
        raise HTTPException(status_code=403, detail="link_invalid")
    f = _file(db, file_id)
    path = _path(db, storage, f)
    name, ext, drm = f.name, f.ext, f.drm_encrypted
    # 큰 파일을 흘려보내는 동안 DB 연결을 붙잡지 않는다 — yield 의존성(get_db)은 응답이 끝난 뒤에야
    # 세션을 닫으므로, 필요한 값을 다 읽었으면 여기서 먼저 닫아 연결을 풀에 돌려준다.
    db.close()
    try:
        fh = open(path, "rb")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="file_missing")
    except OSError:
        raise HTTPException(status_code=503, detail="storage_unreachable")
    as_inline = inline and ext in INLINE_TYPES
    headers = {"Content-Disposition": _disposition(name, as_inline), "Cache-Control": "private, no-store",
               "X-Content-Type-Options": "nosniff"}
    if not drm:
        headers["Content-Length"] = str(os.fstat(fh.fileno()).st_size)

    def stream():
        with fh:
            while chunk := fh.read(STREAM_CHUNK):
                yield chunk

    media = INLINE_TYPES[ext] if as_inline else "application/octet-stream"
    return StreamingResponse(stream(), media_type=media, headers=headers)


@router.get("/{file_id}/text")
def text(file_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    f = _file(db, file_id)
    x = db.get(models.FileExtract, f.id)
    chunks = (db.query(models.FileText).filter_by(file_id=f.id).order_by(models.FileText.seq).all()) if x else []
    return {"state": x.state if x else None, "error": x.error if x else None, "summary": x.summary if x else None,
            "chunks": [{"locator": c.locator, "text": c.text[:TEXT_PREVIEW_CHARS]} for c in chunks]}


@router.get("/{file_id}/sheet")
def sheet(file_id: int, name: str | None = None, db: Session = Depends(get_db),
          storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    f = _file(db, file_id)
    if f.ext not in (".xlsx", ".xlsm"):
        raise HTTPException(status_code=422, detail="not_sheet")
    if f.drm_encrypted:
        raise HTTPException(status_code=409, detail="drm_encrypted")
    if f.size > SHEET_MAX_BYTES:
        raise HTTPException(status_code=413, detail="too_large")
    try:
        with open(_path(db, storage, f), "rb") as fh:
            data = fh.read()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="file_missing")
    except OSError:
        raise HTTPException(status_code=503, detail="storage_unreachable")
    try:
        return sheet_preview(data, name)
    except Exception:
        raise HTTPException(status_code=422, detail="unreadable")
