"""57 — 관리 › 자료 현황·자료 목록(LV3). 읽기만 — 고치기는 /api/entries/bulk-classify(54)."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import admin_stats, models
from ..database import get_db
from ..dependencies import require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/stats")
def stats(db: Session = Depends(get_db), _admin: models.User = Depends(require_admin)):
    """확정 자료 통계 — 요약·형식 묶음별(확장자 포함)·월별 추이·구역·대상·호선 상위."""
    return admin_stats.stats(db)


@router.get("/entry-table")
def entry_table(drafts: bool = Query(default=False), db: Session = Depends(get_db),
                _admin: models.User = Depends(require_admin)):
    """모든 확정 자료(drafts=true 면 정리 대기 초안 포함)의 호선·구역·대상·담당자·공개 범위·파일 묶음별 개수."""
    return admin_stats.entry_table(db, drafts=drafts)
