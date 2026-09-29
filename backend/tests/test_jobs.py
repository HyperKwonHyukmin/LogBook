from datetime import datetime, timedelta

from app import jobs, models


def test_enqueue_claim_complete(db):
    jobs.enqueue(db, "process_batch", 7)
    db.commit()
    job = jobs.claim_next(db)
    assert (job.type, job.target_id, job.state, job.attempts) == ("process_batch", 7, "running", 1)
    assert jobs.claim_next(db) is None
    jobs.complete(db, job)
    assert db.get(models.Job, job.id).state == "done"


def test_fail_retries_with_backoff_then_gives_up(db):
    jobs.enqueue(db, "process_batch", 1)
    db.commit()
    job = jobs.claim_next(db)
    jobs.fail(db, job, "공유 폴더 끊김", max_attempts=2)
    assert job.state == "queued" and job.run_after > datetime.now()
    assert jobs.claim_next(db) is None  # 아직 run_after 전
    assert jobs.claim_next(db, now=datetime.now() + timedelta(minutes=5)).id == job.id
    jobs.fail(db, job, "또 실패", max_attempts=2)
    assert job.state == "failed" and job.last_error == "또 실패"


def test_recover_running_requeues_stuck_jobs(db):
    jobs.enqueue(db, "process_batch", 1)
    db.commit()
    job = jobs.claim_next(db)
    assert job.state == "running"
    assert jobs.recover_running(db) == 1
    assert db.get(models.Job, job.id).state == "queued"
    assert jobs.recover_running(db) == 0  # 이미 requeue 된 건 다시 세지 않는다


def test_recover_running_older_than_filters_recent_jobs(db):
    """I8: run_once() 가 매 주기 부르는 형태 — 방금 running 이 된(정상 처리 중인) 작업은
    건드리지 않고, updated_at 기준으로 정말 오래 멈춰 있는 것만 복구한다."""
    jobs.enqueue(db, "process_batch", 1)
    jobs.enqueue(db, "process_batch", 2)
    db.commit()
    fresh = jobs.claim_next(db)
    stale = jobs.claim_next(db)
    assert fresh.state == stale.state == "running"

    # stale 의 updated_at 을 11분 전으로 되돌려 '오래 멈춘 작업' 을 흉내낸다.
    stale.updated_at = datetime.now() - timedelta(minutes=11)
    db.commit()

    recovered = jobs.recover_running(db, older_than=timedelta(minutes=10))
    assert recovered == 1
    db.expire_all()
    assert db.get(models.Job, fresh.id).state == "running"   # 방금 것은 그대로
    assert db.get(models.Job, stale.id).state == "queued"    # 오래된 것만 복구


def test_claim_prefers_non_extract_jobs(db):
    """본문 추출이 쌓여도 배치 처리·메타 쓰기가 먼저 돈다(워커 굶주림 방지)."""
    jobs.enqueue(db, "extract_file", 1)
    jobs.enqueue(db, "extract_file", 2)
    jobs.enqueue(db, "write_meta", 3)
    jobs.enqueue(db, "process_batch", 4)
    db.commit()
    order = []
    while (job := jobs.claim_next(db)) is not None:
        order.append((job.type, job.target_id))
        jobs.complete(db, job)
    assert order == [("write_meta", 3), ("process_batch", 4), ("extract_file", 1), ("extract_file", 2)]


def test_claim_can_exclude_types(db):
    jobs.enqueue(db, "extract_file", 1)
    db.commit()
    assert jobs.claim_next(db, exclude_types=("extract_file",)) is None
    assert jobs.claim_next(db).type == "extract_file"
