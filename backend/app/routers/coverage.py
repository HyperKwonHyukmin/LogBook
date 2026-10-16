"""갖춤 현황 API(26) — 보는 사람이 볼 수 있는 확정 자료를 호선 × 구역 칸에 놓을 재료(app/coverage.py)."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..coverage import build_coverage
from ..database import get_db
from ..dependencies import require_auth

router = APIRouter(prefix="/api/coverage", tags=["coverage"])


@router.get("")
def get_coverage(db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return build_coverage(db, user)
