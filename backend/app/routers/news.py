"""72 — 새 자료 표시 API."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import access, models, news
from ..database import get_db
from ..dependencies import require_auth

router = APIRouter(prefix="/api/me/news", tags=["news"])


class SeenIn(BaseModel):
    entry_id: str = Field(max_length=20)


@router.get("")
def get_news(db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return news.summary(db, user)


@router.post("/seen")
def seen(body: SeenIn, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    e = db.query(models.Entry).filter_by(entry_id=body.entry_id.strip().upper()).first()
    if e is None or not access.can_view_entry(user, e, db=db):
        raise HTTPException(status_code=404, detail="entry_not_found")
    news.mark_seen(db, user, e)
    return {"count": news.count(db, user)}


@router.post("/seen-all")
def seen_all(db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    news.seen_all(db, user)
    return news.summary(db, user)
