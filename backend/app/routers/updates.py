"""46 — 개선·업데이트 이력: 내용 /api/admin/updates(LV3)와 옛 주소 /updates.

화면은 앱 안의 관리 › 업데이트 이력(`/admin/updates`, frontend `pages/admin/UpdatesPage.jsx`) — 사이드 메뉴가 그대로 남는다.
처음에는 독립 HTML 한 장(/updates)이었는데 앱을 벗어나 메뉴가 사라져서 옮겼다(2026-10-22). 이미 알려 준 /updates 주소는
같은 질의(?period=…)를 붙여 새 화면으로 넘긴다. 내용은 app/changelog/changelog.json(새 항목은 맨 앞에) — 프런트 빌드와 무관하다."""
import json
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse

from .. import models
from ..dependencies import require_admin

router = APIRouter(tags=["updates"])

DATA = Path(__file__).resolve().parent.parent / "changelog" / "changelog.json"


@router.get("/updates", include_in_schema=False)
def old_updates_page(request: Request):
    query = request.url.query
    return RedirectResponse(url="/admin/updates" + (f"?{query}" if query else ""), status_code=307)


@router.get("/api/admin/updates")
def list_updates(user: models.User = Depends(require_admin)):
    items = json.loads(DATA.read_text(encoding="utf-8")).get("items") or []
    return {"items": items}
