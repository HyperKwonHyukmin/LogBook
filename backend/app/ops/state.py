"""system_state 읽기·쓰기와 워커 생존 판정."""
from datetime import datetime

from sqlalchemy.orm import Session

from .. import models

# 이보다 오래 소식이 없으면 멈춘 것으로 본다. 워커는 주기 시작·작업 1건마다·일일 작업 단계마다 박동을
# 남기지만, 큰 BDF 변환이나 백업 한 단계가 몇 분 걸릴 수 있어 넉넉히 잡는다(리뷰 I3).
WORKER_ALIVE_SECONDS = 600


def get_state(db: Session, key: str):
    row = db.get(models.SystemState, key)
    return row.value if row else None


def set_state(db: Session, key: str, value) -> None:
    """커밋은 호출자가 한다.

    새 행은 바로 flush 한다 — 세션이 autoflush 를 끄고 있어서, 커밋 전에 같은 키로 다시
    부르면 db.get 이 방금 더한(아직 pending 인) 행을 못 찾고 중복 행을 넣으려 한다."""
    row = db.get(models.SystemState, key)
    if row is None:
        db.add(models.SystemState(key=key, value=value))
        db.flush()
    else:
        row.value = value


def worker_status(db: Session, now: datetime | None = None) -> dict:
    now = now or datetime.now()
    hb = get_state(db, "worker_heartbeat")
    if not hb or not hb.get("at"):
        return {"alive": False, "at": None, "stats": None}
    at = datetime.fromisoformat(hb["at"])
    return {"alive": (now - at).total_seconds() <= WORKER_ALIVE_SECONDS, "at": hb["at"], "stats": hb.get("stats")}


def heartbeat(db: Session, stats: dict | None = None) -> None:
    """워커 심장 박동을 남기고 커밋한다. stats 를 안 주면 직전 값을 그대로 둔다(시각만 갱신)."""
    if stats is None:
        prev = get_state(db, "worker_heartbeat") or {}
        stats = prev.get("stats") or {}
    set_state(db, "worker_heartbeat", {"at": datetime.now().replace(microsecond=0).isoformat(),
                                       "stats": dict(stats)})
    db.commit()
