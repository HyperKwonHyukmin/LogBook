"""70 업데이트 안내(Update Note) — 바뀐 사용법을 사용자에게 알리는 글. 한 건마다 공유 주소 /update-notes/<id>.

WorkBench 의 '업데이트 안내'(/updates, UpdateWeb/updates.json)를 본떴다. 내용은 app/update_notes/notes.json
(새 안내가 맨 앞), 그림은 같은 폴더 img/. 작성 화면은 없다 — 파일을 고쳐 커밋하고 145 Update(프런트 빌드 불필요).
개발 기록인 업데이트 이력(46, changelog.json, LV3)과 다르다: 이것은 로그인한 사람 누구나 읽는다.
그림은 <img> 가 Bearer 토큰을 못 보내므로 로그인 없이 준다(안내용 화면 그림뿐이다).
"""
import json
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from .. import models
from ..dependencies import require_auth

router = APIRouter(tags=["update-notes"])

ROOT = Path(__file__).resolve().parent.parent / "update_notes"
DATA = ROOT / "notes.json"
IMG_DIR = ROOT / "img"

NOTE_ID = re.compile(r"^[0-9a-z][0-9a-z-]{0,63}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
IMG_NAME = re.compile(r"^[0-9A-Za-z][0-9A-Za-z_-]{0,80}\.(png|jpg|jpeg|webp|gif)$")
LIST_FIELDS = ("id", "date", "kind", "title", "summary")


def load_notes(path: Path = DATA) -> list[dict]:
    """형식이 맞는 안내만, 날짜 최근 순(같은 날은 파일 순서). id 가 겹치면 앞의 것."""
    try:
        items = json.loads(path.read_text(encoding="utf-8")).get("items") or []
    except (OSError, ValueError):
        return []
    out, seen = [], set()
    for it in items:
        if not isinstance(it, dict):
            continue
        nid, date, title = it.get("id"), it.get("date"), it.get("title")
        if not (isinstance(nid, str) and NOTE_ID.match(nid) and isinstance(date, str) and DATE.match(date)
                and isinstance(title, str) and title.strip()) or nid in seen:
            continue
        seen.add(nid)
        out.append(it)
    return sorted(out, key=lambda x: x["date"], reverse=True)


@router.get("/api/update-notes")
def list_notes(user: models.User = Depends(require_auth)):
    return {"items": [{k: it.get(k) for k in LIST_FIELDS} for it in load_notes()]}


@router.get("/api/update-notes/img/{name}")
def note_image(name: str):
    if not IMG_NAME.match(name):
        raise HTTPException(status_code=404, detail="not_found")
    path = (IMG_DIR / name).resolve()
    if not path.is_file() or not path.is_relative_to(IMG_DIR.resolve()):
        raise HTTPException(status_code=404, detail="not_found")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=3600"})


@router.get("/api/update-notes/{note_id}")
def get_note(note_id: str, user: models.User = Depends(require_auth)):
    for it in load_notes():
        if it["id"] == note_id:
            return it
    raise HTTPException(status_code=404, detail="note_not_found")
