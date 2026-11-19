"""64 — 나의 메모(개인 지식 노트) API. 쓴 사람만 읽고 쓴다."""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models, notes
from ..database import get_db
from ..dependencies import require_auth

router = APIRouter(prefix="/api", tags=["notes"])


class NoteBody(BaseModel):
    body: str = Field(default="", max_length=notes.MAX_BODY + 1000)   # 길이 오류는 notes.put 이 note_too_long 으로


@router.get("/me/notes")
def my_notes(q: str = Query(default="", max_length=200), limit: int = Query(default=200, ge=1, le=500),
             db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    """나의 메모 목록 — 고친 시각 최근 순. q 는 메모 본문, 자료 제목, 자료 번호에서 찾는다."""
    return notes.listing(db, user, q=q, limit=limit)


@router.get("/entries/{entry_id}/note")
def get_note(entry_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return notes.get(db, user, entry_id)


@router.put("/entries/{entry_id}/note")
def put_note(entry_id: str, payload: NoteBody, db: Session = Depends(get_db),
             user: models.User = Depends(require_auth)):
    """저장(없으면 만든다). 빈 본문이면 지운다."""
    return notes.put(db, user, entry_id, payload.body)
