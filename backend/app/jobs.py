"""MySQL 기반 작업 큐(설계 §2: Redis 없음). 워커 하나가 돌지만 SKIP LOCKED 로 중복 실행을 막는다."""
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from . import models

RETRY_STEP = timedelta(minutes=1)


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def enqueue(db: Session, job_type: str, target_id: int) -> models.Job:
    job = models.Job(type=job_type, target_id=target_id)
    db.add(job)
    return job


def claim_next(db: Session, now: datetime | None = None) -> models.Job | None:
    now = now or _now()
    job = (
        db.query(models.Job)
        .filter(models.Job.state == "queued", models.Job.run_after <= now)
        .order_by(models.Job.id)
        .with_for_update(skip_locked=True)
        .first()
    )
    if job is None:
        db.rollback()
        return None
    job.state = "running"
    job.attempts += 1
    db.commit()
    return job


def complete(db: Session, job: models.Job) -> None:
    job.state = "done"
    job.last_error = None
    db.commit()


def fail(db: Session, job: models.Job, error: str, *, max_attempts: int = 3) -> None:
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
