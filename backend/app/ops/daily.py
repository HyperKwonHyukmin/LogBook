"""하루 한 번 운영 작업(설계 §12) — 워커가 매 주기 부르지만 실제로는 날짜가 바뀐 뒤 첫 번에만 돈다.

순서: 레지스트리 쓰기 → 백업(+보관 개수 정리) → 휴지통 비우기 → 상태 기록.
- 백업이 실패해도 나머지는 하고 last_backup 에 사유를 남긴다(관리자 운영 화면에 보인다).
  그날은 완료로 치지 않고 RETRY_MINUTES 뒤 다시 시도한다(매 주기 반복하지 않게).
- 워커가 둘 떠 있어도 한쪽만 돌도록 last_daily 행을 잠그고 확인한 뒤 '시도 중' 표시를 커밋한다(리뷰 I8).
- 단계마다 워커 심장 박동을 남긴다(백업이 몇 분 걸려도 멈춤으로 보이지 않게, 리뷰 I3)."""
import logging
from datetime import datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from ..storage.paths import StoragePaths
from .backup import BackupError, prune_backups, run_backup
from .purge import purge_expired
from .registry import write_registry
from .state import heartbeat, set_state

log = logging.getLogger(__name__)
KEY = "last_daily"
RETRY_MINUTES = 60  # 실패한 날의 다시 시도 간격


def _lock_row(db: Session) -> models.SystemState:
    """last_daily 행을 잠근다. 없으면 만든다(두 워커가 동시에 만들면 한쪽은 IntegrityError → 다시 잠금)."""
    for _ in range(2):
        row = (db.query(models.SystemState).filter_by(key=KEY).with_for_update()
               .populate_existing().first())
        if row is not None:
            return row
        db.add(models.SystemState(key=KEY, value={}))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    return db.query(models.SystemState).filter_by(key=KEY).with_for_update().populate_existing().one()


def _claim(db: Session, now: datetime) -> dict | None:
    """오늘 돌아야 하면 '시도 중' 을 기록·커밋하고 이전 값을 돌려준다. 아니면 None(잠금은 풀어 둔다)."""
    if now.hour < settings.daily_hour:
        return None
    row = _lock_row(db)
    last = dict(row.value or {})
    today = now.date().isoformat()
    attempt = last.get("attempt_at")
    if last.get("date") == today:
        db.rollback()
        return None
    if attempt:
        try:
            at = datetime.fromisoformat(attempt)
        except ValueError:
            at = None
        if at is not None and at.date() == now.date() and now - at < timedelta(minutes=RETRY_MINUTES):
            db.rollback()
            return None
    row.value = {**last, "attempt_at": now.isoformat()}
    db.commit()
    return last


def run_daily(db: Session, storage: StoragePaths, now: datetime | None = None, *, backup_runner=None) -> dict:
    now = (now or datetime.now()).replace(microsecond=0)
    last = _claim(db, now)
    if last is None:
        return {"ran": False}
    registry_ok = write_registry(db, storage)
    heartbeat(db)
    try:
        b = run_backup(storage, runner=backup_runner, now=now)
        prune_backups(storage, settings.backup_keep)
        backup = {"ok": True, **b, "error": None}
    except (BackupError, OSError) as exc:
        log.warning("일일 백업 실패: %s", exc)
        backup = {"ok": False, "file": None, "size": None, "at": now.isoformat(), "error": str(exc)[:500]}
    heartbeat(db)
    purged = purge_expired(db, storage, settings.trash_days, now)
    heartbeat(db)
    set_state(db, "last_backup", backup)
    row = _lock_row(db)
    value = {**(row.value or {}), "attempt_at": now.isoformat(), "purged": purged}
    if backup["ok"]:
        # 백업이 된 날만 완료로 친다 — 실패하면 RETRY_MINUTES 뒤 다시 시도한다
        value.update({"date": now.date().isoformat(), "at": now.isoformat()})
    row.value = value
    db.commit()
    return {"ran": True, "backup": backup, "purged": purged, "registry": registry_ok}
