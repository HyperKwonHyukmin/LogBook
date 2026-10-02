"""파일 API — 내려받기 링크(토큰)·원본 스트리밍·추출 본문·엑셀 시트 미리보기(설계 §6.3)·
BDF 모델 요약·model.lbm·썸네일(설계 §7, 04a)."""
import os
import uuid
from datetime import datetime, timedelta
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from .. import models
from ..convert.job import SERVABLE_STATES, model_paths
from ..database import get_db
from ..dependencies import get_storage, require_auth
from ..entries.locate import FileUnavailable, file_path
from ..extract.xlsx import sheet_preview
from ..storage.paths import StoragePaths, to_long

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


@router.get("/{file_id}")
def file_meta(file_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    """파일 메타(04b 전체 화면 뷰어 머리줄) — 이름·경로·종류와 소속 Entry. 휴지통 파일은 _file() 이 404."""
    f = _file(db, file_id)
    e = db.get(models.Entry, f.entry_id) if f.entry_id else None
    return {"id": f.id, "name": f.name, "rel_path": f.rel_path, "kind": f.kind, "size": f.size,
            "entry_id": e.entry_id if e else None, "entry_title": e.title if e else None,
            "entry_status": e.status if e else None, "drm_encrypted": bool(f.drm_encrypted)}


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


def _servable(storage: StoragePaths, s: models.ModelSummary | None, which: int = 0) -> bool:
    """이전 결과까지 포함해 보여 줄 파생물이 있는가 — 재변환 대기·실패 중에도 key 의 파일이 있으면 그대로 쓴다."""
    return bool(s is not None and s.key and s.state in SERVABLE_STATES
                and os.path.exists(to_long(model_paths(storage, s.key)[which])))


def _ready_model(db: Session, storage: StoragePaths, f: models.File, which: int) -> models.ModelSummary:
    """which: 0 = lbm, 1 = png. done 인데 파생물이 없으면 model_missing(404), 재변환 대기·실패 중이면
    이전 파생물이 있을 때만 그것을 준다(없으면 model_not_ready — 첫 변환부터 실패한 모델도 여기)."""
    s = db.get(models.ModelSummary, f.id)
    if s is not None and s.state == "done" and s.key:
        return s
    if _servable(storage, s, which):
        return s
    raise HTTPException(status_code=404, detail="model_not_ready")


def _etag_matches(if_none_match: str | None, etag: str) -> bool:
    if not if_none_match:
        return False
    tags = [t.strip() for t in if_none_match.split(",")]
    return "*" in tags or any((t[2:] if t.startswith("W/") else t) == etag for t in tags)


def _derived_response(storage: StoragePaths, s: models.ModelSummary, which: int, media_type: str,
                      if_none_match: str | None, extra: dict | None = None) -> Response:
    """파생물 응답 — key 가 곧 내용이므로 ETag 로 쓰고, 매번 재검증(no-cache)해 재변환된 모델을 놓치지 않는다."""
    etag = f'"{s.key}"'
    headers = {"ETag": etag, "Cache-Control": "private, no-cache"}
    if _etag_matches(if_none_match, etag):
        return Response(status_code=304, headers=headers)
    data = _derived(model_paths(storage, s.key)[which])
    return Response(content=data, media_type=media_type, headers=headers | (extra or {}))


def _derived(path) -> bytes:
    try:
        with open(to_long(path), "rb") as fh:
            return fh.read()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="model_missing")
    except OSError:
        raise HTTPException(status_code=503, detail="storage_unreachable")


@router.get("/{file_id}/model")
def model_summary(file_id: int, db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
                  user: models.User = Depends(require_auth)):
    f = _file(db, file_id)
    s = db.get(models.ModelSummary, f.id)
    if s is None:
        return {"state": None, "key": None}
    has_lbm = _servable(storage, s)
    return {"state": s.state, "error": s.error, "key": s.key, "counts": s.counts, "bbox": s.bbox, "sol": s.sol,
            "fingerprint": s.fingerprint, "warnings": s.warnings or [], "includes": s.includes or [],
            "missing": s.missing or [], "has_lbm": has_lbm}


@router.get("/{file_id}/model.lbm")
def model_lbm(file_id: int, if_none_match: str | None = Header(default=None),
              db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
              user: models.User = Depends(require_auth)):
    s = _ready_model(db, storage, _file(db, file_id), 0)
    return _derived_response(storage, s, 0, "application/octet-stream", if_none_match,
                             {"Content-Encoding": "gzip"})


@router.get("/{file_id}/thumb.png")
def model_thumb(file_id: int, if_none_match: str | None = Header(default=None),
                db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
                user: models.User = Depends(require_auth)):
    s = _ready_model(db, storage, _file(db, file_id), 1)
    return _derived_response(storage, s, 1, "image/png", if_none_match)
