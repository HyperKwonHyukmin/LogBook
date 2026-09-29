"""호선 API — 목록·상세·선종/메모 수정."""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import hull_info, models
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_auth
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/hulls", tags=["hulls"])


class HullPatch(BaseModel):
    ship_type: str | None = Field(default=None, max_length=50)
    memo: str | None = Field(default=None, max_length=2000)


@router.get("")
def list_hulls(q: str = "", db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return hull_info.list_hulls(db, q)


@router.get("/{hull_no}")
def get_hull(hull_no: str, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return hull_info.hull_detail(db, hull_no)


@router.patch("/{hull_no}")
def patch_hull(hull_no: str, body: HullPatch, request: Request, db: Session = Depends(get_db),
               storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    h = hull_info.update_hull(db, storage, user.employee_id, hull_no, body.model_dump(exclude_unset=True),
                              client_ip(request))
    return {"hull_no": h.hull_no, "ship_type": h.ship_type, "memo": h.memo}
