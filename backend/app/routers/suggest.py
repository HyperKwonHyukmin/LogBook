"""자유 입력 칸의 자동완성(설계 §1.3 — 표준 목록 없이 쓴 값을 다시 제안)."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import access, models
from ..database import get_db
from ..dependencies import require_auth

router = APIRouter(prefix="/api", tags=["suggest"])

# 19 — 상단 검색창 자동완성이 한 번에 묻는 종류(호선·구역·태그)
ALL_KINDS = ("hull", "zone", "tag")


def _like_escape(q: str) -> str:
    """사용자가 친 % · _ 를 글자 그대로 찾는다(19)."""
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def suggest_values(db: Session, user, kind: str, q: str, limit: int) -> list[str]:
    """한 종류의 제안 값(접근 권한 13 반영). /suggest 와 /suggest/all 이 같은 규칙을 쓴다."""
    q = _like_escape(q.strip())
    if kind == "hull":
        rows = db.query(models.Hull.hull_no).filter(models.Hull.hull_no.like(f"{q}%", escape="\\"))
        if not access.is_admin(user):
            # 13 — 호선 행은 확정 때 저절로 생긴다: 볼 수 없는 자료에만 있는 호선 번호는 제안하지 않는다.
            # 어떤 자료에도 쓰이지 않은 호선(미리 만들어 둔 행)은 숨길 것이 없으니 그대로 제안한다(태그와 같은 규칙)
            used = db.query(models.EntryHull.hull_no)
            seen = (db.query(models.EntryHull.hull_no).join(models.Entry, models.Entry.id == models.EntryHull.entry_id)
                    .filter(models.Entry.status.in_(("confirmed", "draft")), access.visible_entries_filter(user)))
            rows = rows.filter(models.Hull.hull_no.notin_(used) | models.Hull.hull_no.in_(seen)
                               | models.Hull.ship_type.isnot(None) | models.Hull.memo.isnot(None))
        rows = rows.order_by(models.Hull.hull_no).limit(limit)
    elif kind == "zone":
        rows = (db.query(models.Tag.value).filter(models.Tag.kind == "zone",
                                                  models.Tag.value.like(f"%{q}%", escape="\\"))
                .order_by(models.Tag.value).limit(limit))
    elif kind == "tag":
        # 자유 태그 — 볼 수 없는 Entry 에만 쓰인 이름은 제안하지 않는다(13)
        rows = db.query(models.Tag.value).filter(models.Tag.kind == "free",
                                                 models.Tag.value.like(f"%{q}%", escape="\\"))
        if not access.is_admin(user):
            used = db.query(models.EntryTag.tag_id)
            seen = (db.query(models.EntryTag.tag_id).join(models.Entry, models.Entry.id == models.EntryTag.entry_id)
                    .filter(access.visible_entries_filter(user)))
            rows = rows.filter(models.Tag.id.notin_(used) | models.Tag.id.in_(seen))
        rows = rows.order_by(models.Tag.value).limit(limit)
    else:   # 42 — 해석 종류(analysis_type)는 없앴다
        return []
    return [v for (v,) in rows]


@router.get("/suggest")
def suggest(kind: str = Query(pattern="^(hull|zone|tag)$"), q: str = "",
            limit: int = Query(default=10, ge=1, le=50),
            db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return suggest_values(db, user, kind, q, limit)


@router.get("/suggest/all")
def suggest_all(q: str = Query(default="", max_length=100), limit: int = Query(default=5, ge=1, le=20),
                db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    """상단 검색창 자동완성(19) — 호선·구역·태그 제안을 한 번에 {hull:[…], zone:[…], tag:[…]}.
    빈 검색어는 아무것도 제안하지 않는다(목록 전체가 쏟아지지 않게)."""
    if not q.strip():
        return {k: [] for k in ALL_KINDS}
    return {k: suggest_values(db, user, k, q, limit) for k in ALL_KINDS}
