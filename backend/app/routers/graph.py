"""관계 지도 API(25) — 보는 사람이 볼 수 있는 확정 자료의 그래프 한 벌(app/graph.py).
32 — 보고서 본문 색인(22)을 열 수 있으면 문서 관계(본문 겹침·본문 비슷함)도 싣는다. 못 열면 그 부분만 빠진다."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..dependencies import require_auth
from ..graph import build_graph
from .reports import get_report_index

router = APIRouter(prefix="/api/graph", tags=["graph"])


@router.get("")
def get_graph(db: Session = Depends(get_db), user: models.User = Depends(require_auth),
              store=Depends(get_report_index)):
    return build_graph(db, user, store)
