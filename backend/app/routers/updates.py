"""46 — 개선·업데이트 이력: /updates(독립 HTML 한 장)와 그 내용 /api/admin/updates(LV3).

페이지 자체는 누구나 받지만 내용이 없는 껍데기다 — 브라우저에 있는 LogBook 로그인 토큰(localStorage)으로
API 를 불러 LV3 일 때만 목록을 그린다. 내용은 app/changelog/changelog.json(새 항목은 맨 앞에).
프런트 빌드와 무관하다(145 에 Node 가 없어도 json 만 고쳐 Update 하면 바뀐다).
⚠ spa.py 와 같은 이유(DRM)로 FileResponse 대신 읽은 바이트로 응답한다."""
import json
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from .. import models
from ..dependencies import require_admin

router = APIRouter(tags=["updates"])

HERE = Path(__file__).resolve().parent.parent / "changelog"
PAGE = HERE / "page.html"
DATA = HERE / "changelog.json"


@router.get("/updates", include_in_schema=False)
def updates_page():
    return Response(content=PAGE.read_bytes(), media_type="text/html; charset=utf-8",
                    headers={"Cache-Control": "no-cache"})


@router.get("/api/admin/updates")
def list_updates(user: models.User = Depends(require_admin)):
    items = json.loads(DATA.read_text(encoding="utf-8")).get("items") or []
    return {"items": items}
