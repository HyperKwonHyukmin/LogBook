"""MySQL 기반 작업 큐(설계 §2: Redis 없음). 워커 하나가 돌지만 SKIP LOCKED 로 중복 실행을 막는다."""
from datetime import datetime, timedelta
from typing import Callable

from sqlalchemy.orm import Session

from . import models

RETRY_STEP = timedelta(minutes=1)
MAX_ATTEMPTS = 3          # 작업 하나의 최대 시도 횟수(worker.MAX_ATTEMPTS 가 이 값을 쓴다)
EXHAUSTED_ERROR = "attempts_exhausted"


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def enqueue(db: Session, job_type: str, target_id: int) -> models.Job:
    job = models.Job(type=job_type, target_id=target_id)
    db.add(job)
    return job


# 오래 걸리는 작업(본문 추출·BDF 변환)은 뒤로 미룬다 — 수천 건 쌓여도 배치 처리·메타 쓰기가 먼저 돈다.
# 워커의 한 주기 시간 예산도 이 묶음에 건다(worker.HEAVY_BUDGET_SECONDS).
HEAVY_JOB_TYPES = ("extract_file", "convert_model")
LOW_PRIORITY_TYPES = HEAVY_JOB_TYPES  # 03 의 옛 이름(별칭)


def claim_next(db: Session, now: datetime | None = None, *,
               exclude_types: tuple[str, ...] = (), max_attempts: int = MAX_ATTEMPTS,
               on_exhausted: Callable[[models.Job], None] | None = None) -> models.Job | None:
    """다음 작업을 running 으로 집어 든다.

    시도 횟수가 이미 상한에 닿은 queued 작업은 다시 돌리지 않고 failed 로 끝낸다 — jobs.fail 은
    상한에서 failed 로 두므로, 이런 작업은 워커가 처리 도중 OS 에 죽어(메모리 부족 등) recover_running
    이 되돌린 경우뿐이다. 그대로 집으면 같은 자리에서 또 죽어 영영 돈다. on_exhausted 는 작업 종류별
    후처리(모델·추출 상태를 failed 로)를 맡는다."""
    now = now or _now()
    while True:
        q = db.query(models.Job).filter(models.Job.state == "queued", models.Job.run_after <= now)
        if exclude_types:
            q = q.filter(models.Job.type.notin_(exclude_types))
        job = (
            q.order_by(models.Job.type.in_(HEAVY_JOB_TYPES), models.Job.id)
            .with_for_update(skip_locked=True)
            .first()
        )
        if job is None:
            db.rollback()
            return None
        if job.attempts >= max_attempts:
            job.state, job.last_error = "failed", EXHAUSTED_ERROR
            db.commit()
            if on_exhausted is not None:
                on_exhausted(job)
            continue
        job.state = "running"
        job.attempts += 1
        db.commit()
        return job


def complete(db: Session, job: models.Job) -> None:
    job.state = "done"
    job.last_error = None
    db.commit()


def fail(db: Session, job: models.Job, error: str, *, max_attempts: int = MAX_ATTEMPTS) -> None:
    job.last_error = error[:2000]
    if job.attempts >= max_attempts:
        job.state = "failed"
    else:
        job.state = "queued"
        job.run_after = _now() + RETRY_STEP * job.attempts
    db.commit()


def recover_running(db: Session, *, older_than: timedelta | None = None) -> int:
    """이전 실행이 비정상 종료돼 'running' 에 멈춰 있는 작업을 다시 큐에 넣는다(그대로
    두면 아무도 완료 처리하지 않아 영영 멈춰 있는다).

    `older_than` 없이(워커 시작 시) 부르면 'running' 인 작업을 전부 복구한다 — 프로세스가
    막 죽은 뒤라 지금 일하는 중인 작업이 있을 리 없다. `older_than` 을 주면(매 run_once
    시작 시, I8) updated_at 기준으로 그만큼 오래 'running' 인 것만 복구한다 — 워커가
    살아서 정상적으로 처리 중인 작업(수 초)까지 매 주기 되돌리면 안 된다."""
    q = db.query(models.Job).filter(models.Job.state == "running")
    if older_than is not None:
        q = q.filter(models.Job.updated_at <= _now() - older_than)
    stuck = q.all()
    for job in stuck:
        job.state = "queued"
    db.commit()
    return len(stuck)
