"""68 — '올리기와 확정' 줄 목록(초안 1건 = 한 줄)과 상태별 숫자. 고른 초안의 상세는 GET /api/entries/{id}."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..dependencies import require_auth
from ..entries.inbox_rows import STATES, draft_rows

router = APIRouter(prefix="/api/inbox", tags=["inbox"])
_STATE_RE = "^(" + "|".join(STATES) + ")(,(" + "|".join(STATES) + "))*$"


@router.get("/drafts")
def list_drafts(scope: str = Query(default="mine", pattern="^(mine|unclaimed|all)$"),
                who: str = Query(default="all", pattern="^(all|uploaded|assigned)$"),
                state: str | None = Query(default=None, pattern=_STATE_RE),
                batch: str | None = Query(default=None, max_length=100),
                q: str = Query(default="", max_length=100),
                offset: int = Query(default=0, ge=0), limit: int = Query(default=500, ge=1, le=1000),
                db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return draft_rows(db, user, scope=scope, who=who, state=state, batch=batch, q=q, offset=offset, limit=limit)
