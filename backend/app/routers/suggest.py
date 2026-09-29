"""자유 입력 칸의 자동완성(설계 §1.3 — 표준 목록 없이 쓴 값을 다시 제안)."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..dependencies import require_auth

router = APIRouter(prefix="/api", tags=["suggest"])


@router.get("/suggest")
def suggest(kind: str = Query(pattern="^(hull|zone|analysis_type)$"), q: str = "",
            limit: int = Query(default=10, ge=1, le=50),
            db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    q = q.strip()
    if kind == "hull":
        rows = (db.query(models.Hull.hull_no).filter(models.Hull.hull_no.like(f"{q}%"))
                .order_by(models.Hull.hull_no).limit(limit))
    elif kind == "zone":
        rows = (db.query(models.Tag.value).filter(models.Tag.kind == "zone", models.Tag.value.like(f"%{q}%"))
                .order_by(models.Tag.value).limit(limit))
    else:
        rows = (db.query(models.Entry.analysis_type).distinct()
                .filter(models.Entry.analysis_type.isnot(None), models.Entry.analysis_type.like(f"%{q}%"))
                .order_by(models.Entry.analysis_type).limit(limit))
    return [v for (v,) in rows]
