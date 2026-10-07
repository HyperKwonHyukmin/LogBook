"""검색 API(설계 §6.2)."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..dependencies import require_auth
from ..search import SearchQuery, get_search

router = APIRouter(prefix="/api", tags=["search"])


@router.get("/search")
def search(q: str = "", unit: str = Query(default="entry", pattern="^(entry|file)$"),
           hull: str | None = None, ship_type: str | None = None, analysis_type: str | None = None,
           zone: str | None = None, year: str | None = None, uploaded_by: str | None = None,
           kind: str | None = None, tag: str | None = None, drafts: bool = False,
           sort: str | None = Query(default=None, pattern="^(relevance|period|recent)$"),
           limit: int = Query(default=50, ge=1, le=200), offset: int = Query(default=0, ge=0),
           db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    filters = {"hull": hull, "ship_type": ship_type, "analysis_type": analysis_type, "zone": zone,
               "year": year, "uploaded_by": uploaded_by, "kind": kind, "tag": tag}
    query = SearchQuery(q=q.strip()[:200], unit=unit, filters={k: v for k, v in filters.items() if v},
                        include_drafts=drafts, limit=limit, offset=offset, sort=sort)
    return get_search().search(db, query)
