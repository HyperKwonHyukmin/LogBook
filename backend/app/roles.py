"""LogBook 등급 바꾸기(15) — 관리 화면(routers/users.py)과 CLI(set-level·create-admin)가 같이 쓴다.

규칙
- LV3 만 바꾼다(LV3 끼리 동등 — 13 의 Master 는 없앴다).
- 자기 자신의 등급은 바꿀 수 없다(400 cannot_change_self). 그래서 화면에서는 LV3 가 0명이 될 수 없다
  (바꾸는 사람이 LV3 로 남는다). 행위자가 없는 CLI 는 내린 뒤 실효 LV3 가 0명이면 거부한다(409 last_level3).
- WorkBench 관리자(is_admin=1)는 실효 LV3 로 고정이라 LogBook 에서 바꿀 수 없다(409 wb_admin_locked).
- 대상은 WorkBench 활성 사용자다(없으면 404 user_not_found, 비활성 422 wb_user_inactive). LogBook 에 들어온 적
  없는 사람이면 users 행을 만든다(이름·부서·직급은 WorkBench 값).
- actor 가 None 이면 CLI(서버 콘솔) — 화면 권한 검사는 건너뛴다."""
from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import access, audit, models, wb_users
from .schemas import user_snapshot
from .storage.paths import StoragePaths


def _err(status: int, code: str):
    raise HTTPException(status_code=status, detail=code)


def apply_wb(user: models.User, wb: wb_users.WbUser) -> bool:
    """WorkBench 값(이름·부서·직급·관리자)을 LogBook 행에 덮어쓴다. 바뀐 것이 있으면 True."""
    changed = False
    for attr, value in (("name", (wb.name or user.name or wb.employee_id)[:50]), ("department", wb.department),
                        ("position", wb.position), ("wb_admin", bool(wb.is_admin))):
        if getattr(user, attr) != value:
            setattr(user, attr, value)
            changed = True
    return changed


def ensure_local_user(db: Session, wb: wb_users.WbUser) -> tuple[models.User, bool]:
    """WorkBench 사용자에 대응하는 LogBook 행(없으면 LV1 로 만든다). (행, 새로 만들었나)."""
    u = db.query(models.User).filter_by(employee_id=wb.employee_id).first()
    created = u is None
    if created:
        u = models.User(employee_id=wb.employee_id, name=(wb.name or wb.employee_id)[:50], status="active", level=1)
        db.add(u)
    apply_wb(u, wb)
    u.status = "active"
    return u, created


def _effective_level3_count(db: Session, excluding: str) -> int:
    """excluding 을 뺀 실효 LV3 수 — 저장 LV3 + WorkBench 활성 관리자(읽을 수 없으면 저장값만)."""
    stored = {e for (e,) in db.query(models.User.employee_id).filter(models.User.level == 3,
                                                                     models.User.employee_id != excluding)}
    try:
        t_admins = {u.employee_id for u in wb_users.list_active(db) if u.is_admin and u.employee_id != excluding}
    except wb_users.WbUnavailable:
        t_admins = set()
    return len(stored | t_admins)


def set_level(db: Session, storage: StoragePaths, actor: models.User | None, employee_id: str, level: int,
              ip: str | None = None) -> models.User:
    """등급을 바꾸고 감사 USER_LEVEL 을 남긴다(커밋까지). 바꾼(또는 그대로인) LogBook 행을 돌려준다."""
    if level not in models.USER_LEVELS:
        _err(422, "invalid_level")
    eid = (employee_id or "").strip().upper()
    if actor is not None:
        if not access.is_admin(actor):
            _err(403, "admin_required")
        if actor.employee_id == eid:
            _err(400, "cannot_change_self")
    try:
        wb = wb_users.fetch(db, eid)
    except wb_users.WbUnavailable:
        _err(503, "wb_unavailable")
    if wb is None:
        _err(404, "user_not_found")
    if not wb.is_active:
        _err(422, "wb_user_inactive")
    if wb.is_admin:
        _err(409, "wb_admin_locked")
    user, _created = ensure_local_user(db, wb)
    if (user.level or 1) == level:
        db.commit()
        return user
    if actor is None and (user.level or 1) == 3 and _effective_level3_count(db, eid) == 0:
        db.rollback()
        _err(409, "last_level3")
    before = user_snapshot(user)
    user.level = level
    db.flush()
    audit.record(db, storage, actor=actor.employee_id if actor is not None else "system", action="USER_LEVEL",
                 target_type="user", target_id=user.employee_id, before=before, after=user_snapshot(user), ip=ip)
    db.refresh(user)
    from .ops.registry import write_registry  # 순환 import 방지

    write_registry(db, storage)
    return user


def reset_to_guest(db: Session, storage: StoragePaths, apply: bool = False) -> list[models.User]:
    """31 — 관리자가 아닌 사용자를 모두 LV1(게스트)로 내린다(CLI level-guest). 모델 자료(일반 공개)가 보이지 않게
    하려는 일괄 정리다. 관리자는 그대로 둔다: WorkBench 관리자(wb_admin, 실효 LV3)와 LogBook 에서 LV3 로 지정한 사람.
    apply 가 거짓이면 대상만 돌려준다. 참이면 사람마다 감사 USER_LEVEL(행위자 system)을 남기고 registry 를 한 번 쓴다."""
    rows = (db.query(models.User)
            .filter(models.User.level == 2, models.User.wb_admin.is_(False))
            .order_by(models.User.name, models.User.employee_id).all())
    if not apply or not rows:
        return rows
    for user in rows:
        before = user_snapshot(user)
        user.level = 1
        db.flush()
        audit.record(db, storage, actor="system", action="USER_LEVEL", target_type="user",
                     target_id=user.employee_id, before=before, after=user_snapshot(user))
    db.commit()
    from .ops.registry import write_registry  # 순환 import 방지

    write_registry(db, storage)
    return rows
