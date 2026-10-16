"""관계 지도 API(25) — 보는 사람이 볼 수 있는 확정 자료의 그래프 한 벌(app/graph.py)."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..dependencies import require_auth
from ..graph import build_graph

router = APIRouter(prefix="/api/graph", tags=["graph"])


@router.get("")
def get_graph(db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return build_graph(db, user)
