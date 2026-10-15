"""권한 한 곳(13 구조, 15 규칙) — LogBook 등급(LV1~LV3)과 Entry 공개 단계.

등급(15) — 사용자는 WorkBench 가입자다(app/wb_users.py). LogBook 은 등급만 따로 둔다.
    LV1 게스트  공유 자료 + 개별 허락받은 자료 + 자기가 올린 자료. 올리기·자기 자료 수정·공유/허락은 된다.
    LV2 일반    공유 + 일반 자료(+ 블록은 개별 허락 있을 때). 공용 데이터(태그 동의어·호선 메모)·해석 검증.
    LV3 관리자  모든 자료 열람·수정·휴지통, 블록 지정·해제, 등급 지정, 분류 목록·운영.
    실효 등급 = WorkBench 관리자(users.wb_admin)면 3, 아니면 저장값(users.level).

공개 단계(Entry.access):
    shared   공유 — LV1 이상 모두
    normal   일반 — LV2 이상(기본). 알 수 없는 값(13 의 public/private 가 남은 행)도 일반으로 다룬다
    blocked  블록 — LV3 만
    올린 사람은 자기 자료를 늘 본다(블록돼도). 개별 허락(entry_grants)은 단계와 무관하게 그 사람에게 보인다.

**볼 수 없는 Entry 는 존재 자체를 숨긴다** — 상세·파일·이력은 404, 목록·건수에서는 빠진다.
목록 질의는 visible_entries_filter() 를 SQL 조건으로 끼워 쓴다(파이썬 후처리로 쪽 건수가 틀어지지 않게).
쓰기 금지는 숨김과 별개라 403 이다.
"""
from fastapi import HTTPException
from sqlalchemy import and_, false, or_, select, true
from sqlalchemy.orm import Session

from . import models

LEVELS = models.USER_LEVELS
LEVEL_LABELS = {1: "게스트", 2: "일반", 3: "관리자"}
ACCESS_LABELS = {"shared": "공유", "normal": "일반", "blocked": "블록"}


def level_of(user) -> int:
    """실효 등급 — WorkBench 관리자면 3, 아니면 저장값(없으면 1). None(로그인 안 함)은 0."""
    if user is None:
        return 0
    if getattr(user, "wb_admin", False):
        return 3
    lv = getattr(user, "level", None)
    return lv if lv in LEVELS else 1


def is_admin(user) -> bool:
    """LV3(관리자) — 예전 is_admin 검사를 모두 이것으로 바꿨다."""
    return level_of(user) >= 3


def can_write(user) -> bool:
    """올리기·자기 자료 수정 — 로그인한 누구나(LV1 이상, 15)."""
    return level_of(user) >= 1


def require_writer(user) -> None:
    if not can_write(user):
        raise HTTPException(status_code=403, detail="read_only_role")


def can_write_shared(user) -> bool:
    """공용 데이터(자유 태그 동의어·호선 선종/메모)와 남의 자료 해석 검증 — LV2 이상."""
    return level_of(user) >= 2


def require_shared_writer(user) -> None:
    if not can_write_shared(user):
        raise HTTPException(status_code=403, detail="level2_required")


def access_of(entry: models.Entry) -> str:
    """Entry 의 공개 단계. 알 수 없는 값(옮기기 전 13 값 등)은 '일반'."""
    a = getattr(entry, "access", None)
    return a if a in ("shared", "blocked") else "normal"


# ---- Entry 열람 ----

def visible_entries_filter(user):
    """SQL 조건 — 이 사용자가 볼 수 있는 Entry(models.Entry 기준). query.filter(...) 에 그대로 끼운다.

    상태(초안·확정·휴지통) 조건은 넣지 않는다 — 부르는 쪽이 원래 쓰던 상태 조건과 함께 쓴다."""
    E = models.Entry
    if user is None:
        return false()
    lv = level_of(user)
    if lv >= 3:
        return true()
    conds = [
        E.access == "shared",
        # uploaded_by 는 NULL 일 수 있다(주인 없는 배치의 초안). 그대로 비교하면 NULL 이 되어
        # ~visible_entries_filter() (감사 로그·배치 가져가기의 '숨은 것' 조건)가 그 행을 놓친다 — NULL 안전하게
        and_(E.uploaded_by.isnot(None), E.uploaded_by == user.employee_id),
        E.id.in_(select(models.EntryGrant.entry_id).where(models.EntryGrant.employee_id == user.employee_id)),
    ]
    if lv >= 2:
        conds.append(E.access != "blocked")
    return or_(*conds)


def _grant_holders(db: Session, entry: models.Entry) -> set[str]:
    return {e for (e,) in db.query(models.EntryGrant.employee_id).filter_by(entry_id=entry.id)}


def can_view_entry(user, entry: models.Entry | None, grants=None, db: Session | None = None) -> bool:
    """이 사용자가 이 Entry 를 볼 수 있는가. grants 는 그 Entry 의 허락받은 사번 모음(없으면 db 로 읽는다).

    visible_entries_filter() 와 같은 규칙이다(둘을 함께 고칠 것 — test_access_15 가 둘을 비교한다)."""
    if entry is None or user is None:
        return False
    lv = level_of(user)
    a = access_of(entry)
    if lv >= 3 or a == "shared":
        return True
    if entry.uploaded_by and entry.uploaded_by == user.employee_id:
        return True
    if lv >= 2 and a != "blocked":
        return True
    if grants is None:
        grants = _grant_holders(db, entry) if db is not None else set()
    return user.employee_id in grants


def ensure_visible(db: Session, user, entry: models.Entry | None, detail: str = "entry_not_found") -> models.Entry:
    """볼 수 없으면(없는 것과 똑같이) 404."""
    if entry is None or not can_view_entry(user, entry, db=db):
        raise HTTPException(status_code=404, detail=detail)
    return entry


def visible_entry_pks(db: Session, user, pks) -> set[int]:
    """주어진 Entry pk 중 볼 수 있는 것 — 한 번의 질의."""
    pks = [p for p in set(pks) if p is not None]
    if not pks:
        return set()
    if is_admin(user):
        return set(pks)
    return {i for (i,) in db.query(models.Entry.id).filter(models.Entry.id.in_(pks), visible_entries_filter(user))}


def file_visible(db: Session, user, f: models.File | None) -> bool:
    """파일은 그 파일이 든 Entry 를 볼 수 있을 때만 보인다. Entry 가 없는 파일(배치에서 빠진 것)은
    그 배치를 올린 사람·LV3 만."""
    if f is None:
        return False
    if f.entry_id is None:
        if is_admin(user):
            return True
        b = db.get(models.Batch, f.batch_id) if f.batch_id else None
        return bool(b is not None and b.uploader and user is not None and b.uploader == user.employee_id)
    return can_view_entry(user, db.get(models.Entry, f.entry_id), db=db)


# ---- Entry 쓰기 ----

def is_uploader(user, entry: models.Entry) -> bool:
    return bool(user is not None and entry.uploaded_by and entry.uploaded_by == user.employee_id)


def can_edit_entry(user, entry: models.Entry) -> bool:
    """Entry 수정·휴지통·복원·파일 추가·판 정리 — 올린 사람(LV1 이상) 또는 LV3."""
    if user is None or not can_write(user):
        return False
    return is_admin(user) or is_uploader(user, entry)


def ensure_can_edit(user, entry: models.Entry) -> None:
    require_writer(user)
    if not can_edit_entry(user, entry):
        raise HTTPException(status_code=403, detail="not_uploader")


def can_manage_access(user, entry: models.Entry) -> bool:
    """공유/일반 바꾸기·개별 허락 — 올린 사람 + LV3. 블록된 자료는 LV3 만(올린 사람도 못 바꾼다)."""
    if not can_edit_entry(user, entry):
        return False
    return is_admin(user) or access_of(entry) != "blocked"


def ensure_can_manage_access(user, entry: models.Entry, new_access: str | None = None) -> None:
    """공개 단계 바꾸기·허락 주기/회수 권한. new_access='blocked' 이거나 지금 블록이면 LV3 만(403 level3_required)."""
    ensure_can_edit(user, entry)
    if not is_admin(user) and (access_of(entry) == "blocked" or new_access == "blocked"):
        raise HTTPException(status_code=403, detail="level3_required")


def access_brief(entry: models.Entry) -> dict:
    """화면용 공개 단계 한 덩어리 — {access, label}. 일반(기본)은 label 없음(배지를 그리지 않는다)."""
    a = access_of(entry)
    return {"access": a, "label": None if a == "normal" else ACCESS_LABELS[a]}


class _System:
    """내부 호출용 '모두 보는' 사용자(CLI·워커·테스트의 직접 검색). API 요청에는 쓰지 않는다."""
    employee_id = "system"
    level = 3
    wb_admin = False
    is_admin = True
    status = "active"


SYSTEM = _System()
