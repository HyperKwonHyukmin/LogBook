"""18-b — WorkBench 앱별 보내기 제한 API. 읽기·판정은 로그인한 사용자, 규칙 바꾸기는 LV3(감사 기록)."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import access, models, wb_targets
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_admin, require_auth
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/wb-targets", tags=["wb-targets"])
admin_router = APIRouter(prefix="/api/admin/wb-targets", tags=["wb-targets"])


class EligibleBody(BaseModel):
    entry_ids: list[str] = Field(default_factory=list)


class RuleBody(BaseModel):
    zones: list[str] = Field(default_factory=list)
    targets: list[str] = Field(default_factory=list)   # 40
    tags: list[str] = Field(default_factory=list)


@router.get("")
def list_targets(db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    """대상별 이름·규칙·선택 띠 조건 문구."""
    return wb_targets.list_targets(db)


@router.post("/{target}/eligible")
def eligible(target: str, body: EligibleBody, db: Session = Depends(get_db),
             user: models.User = Depends(require_auth)):
    """Entry 번호 → {ok, reason}. 볼 수 없거나 없는 Entry 는 빼고 돌려준다(있는지 드러내지 않는다)."""
    wb_targets.check_target(target)
    codes = list(dict.fromkeys(c.strip().upper() for c in body.entry_ids if isinstance(c, str) and c.strip()))
    if len(codes) > wb_targets.MAX_ELIGIBLE_IDS:
        raise HTTPException(status_code=422, detail="too_many_entries")
    if not codes:
        return {}
    rows = {e.id: e for e in db.query(models.Entry).filter(models.Entry.entry_id.in_(codes))}
    visible = access.visible_entry_pks(db, user, rows)
    verdict = wb_targets.Matcher(db, target).entries(visible)
    return {rows[pk].entry_id: {"ok": ok, "reason": reason} for pk, (ok, reason) in verdict.items()}


@admin_router.get("")
def admin_list(db: Session = Depends(get_db), user: models.User = Depends(require_admin)):
    return wb_targets.admin_list(db)


@admin_router.put("/{target}")
def admin_set(target: str, body: RuleBody, request: Request, db: Session = Depends(get_db),
              storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_admin)):
    return wb_targets.set_rule(db, storage, user.employee_id, target, body.zones, body.tags, client_ip(request),
                                targets=body.targets)
