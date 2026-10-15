"""즐겨찾기(10) — 사용자별 Entry 목록. 검색·상세·호선 화면이 '내 즐겨찾기인가' 를 한 번에 묻는다.

Entry 는 화면에서 entry_id(E000123) 로, 표에는 pk(entries.id) 로 잇는다."""
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import access, models

LIVE_STATUSES = ("confirmed", "draft")   # 휴지통 Entry 는 목록에서 숨긴다(행은 남아 복원 때 돌아온다)


def favorite_times(db: Session, employee_id: str | None) -> dict[int, datetime]:
    """내 즐겨찾기 전체 — Entry pk → 즐겨찾기한 시각."""
    if not employee_id:
        return {}
    return dict(db.query(models.Favorite.entry_id, models.Favorite.created_at)
                .filter(models.Favorite.employee_id == employee_id))


def favorite_pks(db: Session, employee_id: str | None, pks) -> set[int]:
    """주어진 Entry pk 중 내 즐겨찾기 — 한 번의 질의(행마다 묻지 않는다)."""
    pks = list(pks)
    if not employee_id or not pks:
        return set()
    return {i for (i,) in db.query(models.Favorite.entry_id)
            .filter(models.Favorite.employee_id == employee_id, models.Favorite.entry_id.in_(pks))}


def favorite_entry_ids(db: Session, employee_id: str | None, entry_ids) -> set[str]:
    """주어진 Entry 번호(E000123) 중 내 즐겨찾기."""
    entry_ids = [e for e in entry_ids if e]
    if not employee_id or not entry_ids:
        return set()
    return {e for (e,) in db.query(models.Entry.entry_id)
            .join(models.Favorite, models.Favorite.entry_id == models.Entry.id)
            .filter(models.Favorite.employee_id == employee_id, models.Entry.entry_id.in_(entry_ids))}


def _entry(db: Session, entry_id: str, viewer=None) -> models.Entry:
    """번호로 Entry — 없거나 viewer 가 볼 수 없으면 404(13)."""
    e = db.query(models.Entry).filter_by(entry_id=entry_id.upper()).first()
    if e is None or (viewer is not None and not access.can_view_entry(viewer, e, db=db)):
        raise HTTPException(status_code=404, detail="entry_not_found")
    return e


def add(db: Session, employee_id: str, entry_id: str, viewer=None) -> models.Entry:
    """즐겨찾기에 넣는다. 이미 있으면 그대로(여러 번 불러도 같다). 휴지통 Entry 는 넣지 않는다."""
    e = _entry(db, entry_id, viewer)
    if e.status == "trashed":
        raise HTTPException(status_code=409, detail="entry_trashed")
    exists = db.query(models.Favorite.id).filter_by(employee_id=employee_id, entry_id=e.id).first()
    if exists is None:
        db.add(models.Favorite(employee_id=employee_id, entry_id=e.id))
        try:
            db.commit()
        except IntegrityError:   # 같은 사용자가 두 탭에서 동시에 눌렀다 — 이미 들어갔다
            db.rollback()
    return e


def remove(db: Session, employee_id: str, entry_id: str, viewer=None) -> models.Entry:
    """즐겨찾기에서 뺀다. 없으면 그대로. 휴지통 Entry 도 뺄 수 있다. 볼 수 없는 Entry 는 404(13)."""
    e = _entry(db, entry_id, viewer)
    db.query(models.Favorite).filter_by(employee_id=employee_id, entry_id=e.id).delete(synchronize_session=False)
    db.commit()
    return e
