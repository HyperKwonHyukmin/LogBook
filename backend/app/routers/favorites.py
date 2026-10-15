"""즐겨찾기(10)·사용자 설정 API."""
from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy.orm import Session

from .. import favorites, models, prefs
from ..database import get_db
from ..dependencies import require_auth
from ..search import SearchQuery, get_search

router = APIRouter(prefix="/api", tags=["favorites"])


@router.get("/favorites")
def list_favorites(limit: int = Query(default=50, ge=1, le=200), offset: int = Query(default=0, ge=0),
                   db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    """내 즐겨찾기 — 최근에 넣은 것부터, 검색 결과(문서 보기)와 같은 행 모양. 휴지통 Entry 는 뺀다."""
    # 13 — 검색과 같은 권한 거르개(볼 수 없게 된 즐겨찾기는 목록·건수에서 빠진다)
    query = SearchQuery(unit="entry", favorites_of=user.employee_id, viewer=user.employee_id, user=user,
                        sort="favorited", limit=limit, offset=offset)
    res = get_search().search(db, query)
    return {"total": res["total"], "items": res["items"]}


@router.put("/favorites/{entry_id}")
def add_favorite(entry_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    e = favorites.add(db, user.employee_id, entry_id, viewer=user)
    return {"entry_id": e.entry_id, "favorite": True}


@router.delete("/favorites/{entry_id}")
def remove_favorite(entry_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    e = favorites.remove(db, user.employee_id, entry_id, viewer=user)
    return {"entry_id": e.entry_id, "favorite": False}


@router.get("/me/prefs")
def get_prefs(db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return prefs.get_all(db, user.employee_id)


@router.put("/me/prefs")
def put_prefs(body: dict = Body(...), db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    """보낸 열쇠만 고친다(값이 null 이면 지운다). 고친 뒤 전체 설정을 돌려준다."""
    return prefs.put(db, user.employee_id, body)
