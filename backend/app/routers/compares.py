"""최근 비교 API(11) — 내가 연 모델 비교 기록."""
from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy.orm import Session

from .. import compares, models
from ..database import get_db
from ..dependencies import require_auth

router = APIRouter(prefix="/api/me", tags=["compares"])


@router.get("/compares")
def list_compares(limit: int = Query(default=compares.KEEP, ge=1, le=compares.KEEP),
                  db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    """최근에 연 것부터. files[] 에 이름·Entry·호선·모델 상태(available/note)·썸네일 key."""
    return {"items": compares.list_recent(db, user.employee_id, limit, viewer=user)}


@router.post("/compares")
def record_compare(body: dict = Body(...), db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    """비교를 열었다고 남긴다 — body = {file_ids: [..]}(2~4개, 순서 = 화면 칸 순서)."""
    row = compares.record(db, user.employee_id, body.get("file_ids"), viewer=user)
    return {"id": row.id, "file_ids": row.file_ids, "open_count": row.open_count,
            "last_opened_at": row.last_opened_at.isoformat()}


@router.delete("/compares/{history_id}")
def delete_compare(history_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    compares.remove(db, user.employee_id, history_id)
    return {"ok": True}


@router.delete("/compares")
def clear_compares(db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return {"deleted": compares.clear(db, user.employee_id)}
