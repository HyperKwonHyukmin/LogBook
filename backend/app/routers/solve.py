"""해석 검증 API(06 §5) — 로그인한 모든 사용자가 버튼으로 검증을 요청하고 결과·f06 을 본다.

원본 파일은 바뀌지 않는다(해석용 사본은 워커 PC 의 임시 폴더에서만 만들고 지운다 — solve.job)."""
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from .. import audit, models
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_auth
from ..solve.job import describe, enqueue_solve, read_f06
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/files", tags=["solve"])


def _model_file(db: Session, file_id: int) -> models.File:
    f = db.get(models.File, file_id)
    if f is None or f.location == "trash":
        raise HTTPException(status_code=404, detail="file_not_found")
    return f


@router.get("/{file_id}/solve-check")
def get_solve_check(file_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    f = _model_file(db, file_id)
    return describe(db, db.get(models.SolveCheck, f.id), db.get(models.ModelSummary, f.id))


@router.post("/{file_id}/solve-check")
def request_solve_check(file_id: int, request: Request, db: Session = Depends(get_db),
                        storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    f = _model_file(db, file_id)
    summary = db.get(models.ModelSummary, f.id)
    if f.kind != "model" or summary is None or summary.state != "done":
        raise HTTPException(status_code=409, detail="model_not_ready")
    row = db.get(models.SolveCheck, f.id, with_for_update=True, populate_existing=True)
    if row is not None and row.state in ("queued", "running"):
        db.rollback()
        return describe(db, row, summary)      # 이미 대기·실행 중 — 그대로 돌려준다
    before = {"state": row.state, "error_types": row.error_types} if row is not None else None
    row = enqueue_solve(db, f, user.employee_id)
    db.flush()
    audit.record(db, storage, actor=user.employee_id, action="SOLVE_CHECK", target_type="file",
                 target_id=str(f.id), before=before, after={"name": f.name, "state": "queued"},
                 ip=client_ip(request))
    return describe(db, db.get(models.SolveCheck, f.id), summary)


@router.get("/{file_id}/solve-check.f06")
def solve_check_f06(file_id: int, db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
                    user: models.User = Depends(require_auth)):
    f = _model_file(db, file_id)
    row = db.get(models.SolveCheck, f.id)
    try:
        data = read_f06(storage, row) if row is not None else None
    except OSError:
        raise HTTPException(status_code=503, detail="storage_unreachable")
    if data is None:
        raise HTTPException(status_code=404, detail="f06_not_found")
    stem = f.name.rsplit(".", 1)[0] if "." in f.name else f.name
    name = f"{stem}_solve-check.f06"
    fallback = "".join(c if 32 <= ord(c) < 127 and c not in '"\\' else "_" for c in name)
    # DRM 환경 규칙: stat 크기 대신 read() 로 받은 바이트로 응답한다(Content-Length 가 실제 본문과 같다)
    return Response(content=data, media_type="text/plain; charset=latin-1",
                    headers={"Content-Disposition": f"attachment; filename=\"{fallback}\"; "
                                                    f"filename*=UTF-8''{quote(name)}",
                             "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})
