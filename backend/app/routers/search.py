"""검색 API(설계 §6.2)."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..dependencies import require_auth
from ..search import SearchQuery, get_search
from ..search.base import filter_values

router = APIRouter(prefix="/api", tags=["search"])


@router.get("/search")
def search(q: str = "", unit: str = Query(default="entry", pattern="^(entry|file)$"),
           hull: list[str] | None = Query(default=None), ship_type: list[str] | None = Query(default=None),
           analysis_type: list[str] | None = Query(default=None), zone: list[str] | None = Query(default=None),
           uploaded_by: list[str] | None = Query(default=None), kind: list[str] | None = Query(default=None),
           tag: list[str] | None = Query(default=None), project: list[str] | None = Query(default=None),
           drafts: bool = False, fav: bool = False,
           sort: str | None = Query(default=None, pattern="^(relevance|period|recent|favorited|hull|title)$"),
           limit: int = Query(default=50, ge=1, le=200), offset: int = Query(default=0, ge=0),
           group: str | None = Query(default=None, pattern="^(hull|zone|uploaded_by|analysis_type|tag|project)$"),
           group_value: str | None = Query(default=None, max_length=200),
           group_sort: str = Query(default="count", pattern="^(count|name)$"),
           group_rows: int = Query(default=5, ge=1, le=50),
           group_limit: int = Query(default=30, ge=1, le=200), group_offset: int = Query(default=0, ge=0),
           db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    # 15 — 옛 주소의 year=(해석 연도)는 받지 않는다(무시). sort=period 는 최신순으로 받는다
    # 19 — 칸마다 값 여러 개는 같은 이름을 되풀이한다(?hull=3496&hull=3497 — 같은 칸 안은 OR, 칸끼리는 AND).
    # 값에 쉼표가 들어갈 수 있어(태그·구역) 쉼표로 나누지 않는다. 옛 단일값 주소(?zone=X)는 그대로 값 하나다
    filters = {"hull": hull, "ship_type": ship_type, "analysis_type": analysis_type, "zone": zone,
               "uploaded_by": uploaded_by, "kind": kind, "tag": tag, "project": project}   # 21 — 프로젝트
    filters = {k: vs for k, vs in ((k, filter_values(v)) for k, v in filters.items()) if vs}
    query = SearchQuery(q=q.strip()[:200], unit=unit, filters=filters,
                        include_drafts=drafts, limit=limit, offset=offset, sort=sort,
                        viewer=user.employee_id, user=user, favorites_of=user.employee_id if fav else None,
                        group=group, group_value=group_value, group_sort=group_sort, group_rows=group_rows,
                        group_limit=group_limit, group_offset=group_offset)
    # 11 — group 이 있으면 결과를 그 속성 값으로 묶는다(문서 보기에서만): groups[{value,label,count,items}].
    # group_value(값, 없음 묶음은 "__none__")를 함께 보내면 그 묶음 하나의 행을 limit/offset 으로 준다('더 보기').
    return get_search().search(db, query)


@router.get("/search/browse")
def browse(drafts: bool = False, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    """분류 화면(09) — 속성(필터 차원)마다 모든 값과 Entry 수. 값을 누르면 그 필터로 검색한다."""
    return get_search().browse(db, include_drafts=drafts, user=user)
