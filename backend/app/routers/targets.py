"""69 — 업무별 모음(대상 카드 목록, 대상 화면)."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models, targets
from ..database import get_db
from ..dependencies import require_auth

router = APIRouter(prefix="/api/targets", tags=["targets"])


@router.get("")
def list_targets(db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return targets.list_targets(db, user)


@router.get("/page")
def target_page(value: str = Query(min_length=1, max_length=100), db: Session = Depends(get_db),
                user: models.User = Depends(require_auth)):
    return targets.target_page(db, user, value)
