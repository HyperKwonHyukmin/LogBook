"""호선 API — 목록·상세·선종/메모 수정."""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import access, hull_info, models
from ..favorites import favorite_entry_ids
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_auth
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/hulls", tags=["hulls"])


class HullPatch(BaseModel):
    ship_type: str | None = Field(default=None, max_length=50)
    memo: str | None = Field(default=None, max_length=2000)


@router.get("")
def list_hulls(q: str = "", db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return hull_info.list_hulls(db, q, user)


@router.get("/{hull_no}")
def get_hull(hull_no: str, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    d = hull_info.hull_detail(db, hull_no, user)
    # 10 — 타임라인 행마다 내 즐겨찾기 여부(한 번의 질의)
    mine = favorite_entry_ids(db, user.employee_id, [e["entry_id"] for m in d["timeline"] for e in m["entries"]])
    for m in d["timeline"]:
        for e in m["entries"]:
            e["favorite"] = e["entry_id"] in mine
    return d


@router.patch("/{hull_no}")
def patch_hull(hull_no: str, body: HullPatch, request: Request, db: Session = Depends(get_db),
               storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    access.require_shared_writer(user)   # 15 — 호선 선종·메모는 공용 데이터라 LV2 이상
    h = hull_info.update_hull(db, storage, user.employee_id, hull_no, body.model_dump(exclude_unset=True),
                              client_ip(request))
    return {"hull_no": h.hull_no, "ship_type": h.ship_type, "memo": h.memo}
