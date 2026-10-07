"""배치 처리 진행 상황 — 정리 대기 화면이 '지금 무엇을 하는지'(단계·n/N)를 보여 주는 데 쓴다.

⚠ 배치 행(batches)에 쓰지 않고 system_state('batch_progress') 한 행에 따로 쓴다.
process_batch 는 배치 하나를 한 트랜잭션으로 처리한다(중간에 커밋하면 실패·재시도 때 File 행이
중복된다 — 멱등성 I4). 그 트랜잭션이 files 를 넣을 때 외래키 검사로 batches 행에 공유 잠금을
잡으므로, 다른 연결로 그 행을 갱신하면 같은 스레드가 자기 잠금을 기다리며 멈춘다.
system_state 는 외래키가 없어 잠금이 겹치지 않는다. 워커는 하나라 한 번에 한 배치만 처리한다.
"""
import time
from datetime import datetime
from typing import Callable

from sqlalchemy.orm import Session

from ..ops.state import get_state, set_state

KEY = "batch_progress"
# 이보다 오래 갱신이 없으면 지난 기록으로 본다(워커가 처리 중 죽은 경우 등).
STALE_SECONDS = 600
STEPS = ("scan", "files", "propose", "queue")

Reporter = Callable[..., None]


def write_progress(db: Session, batch_key: str, step: str, done: int = 0, total: int = 0) -> None:
    """진행 상황을 남기고 커밋한다(별도 세션에서 부른다)."""
    set_state(db, KEY, {"key": batch_key, "step": step, "done": int(done), "total": int(total),
                        "at": datetime.now().replace(microsecond=0).isoformat()})
    db.commit()


def read_progress(db: Session, batch_key: str, now: datetime | None = None) -> dict | None:
    """이 배치의 진행 상황 — 다른 배치 것이거나 오래됐으면 None."""
    v = get_state(db, KEY)
    if not v or v.get("key") != batch_key or not v.get("at"):
        return None
    try:
        at = datetime.fromisoformat(v["at"])
    except ValueError:
        return None
    if ((now or datetime.now()) - at).total_seconds() > STALE_SECONDS:
        return None
    return {"step": v.get("step"), "done": v.get("done", 0), "total": v.get("total", 0), "at": v["at"]}


def make_reporter(batch_key: str, session_factory, *, min_interval: float = 1.0,
                  clock: Callable[[], float] = time.monotonic) -> Reporter:
    """process_batch 에 넘길 보고 함수 — reporter(step, done, total, force=False).

    파일마다 부르더라도 단계가 바뀌거나 force 일 때, 아니면 min_interval 초에 한 번만 DB 에 쓴다(값싸게).
    쓰기에 실패해도 배치 처리는 계속한다."""
    last = {"step": None, "t": -1e18}

    def report(step: str, done: int = 0, total: int = 0, force: bool = False) -> None:
        t = clock()
        if not force and step == last["step"] and t - last["t"] < min_interval:
            return
        last["step"], last["t"] = step, t
        s = session_factory()
        try:
            write_progress(s, batch_key, step, done, total)
        except Exception:  # noqa: BLE001 — 진행 표시 실패로 처리를 멈추지 않는다
            s.rollback()
        finally:
            s.close()
    return report
