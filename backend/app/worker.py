# backend/app/worker.py
"""Logbook 워커 — Inbox 감시와 배치 처리(설계 §2: API 와 별도 프로세스).

실행 (backend 폴더): .venv\\Scripts\\python.exe -m app.worker
"""
import logging
import os
import time
from datetime import timedelta
from logging.handlers import RotatingFileHandler

from sqlalchemy.orm import Session

from . import jobs, models
from .database import Base, SessionLocal, engine
from .dependencies import get_storage
from .convert.job import mark_failed as mark_convert_failed
from .convert.job import run_convert
from .entries.files import write_entry_files
from .extract.job import mark_failed, run_extract
from .ingest.inbox import InboxWatcher, stage_item
from .ingest.process import process_batch
from .ops.daily import run_daily
from .ops.state import heartbeat
from .storage.paths import StoragePaths, to_long
from .uploads.service import cleanup_stale

log = logging.getLogger("logbook.worker")
POLL_SECONDS = 30
MAX_ATTEMPTS = jobs.MAX_ATTEMPTS
STUCK_JOB_AFTER = timedelta(minutes=10)
# 한 주기에서 무거운 작업(본문 추출·BDF 변환, jobs.HEAVY_JOB_TYPES)에 쓰는 시간 상한(초).
# 넘으면 남은 무거운 작업은 다음 주기로 미뤄 Inbox 감시와 배치 처리가 주기마다 돌아오게 한다
# (다른 종류 작업은 계속 처리한다).
HEAVY_BUDGET_SECONDS = 120
EXTRACT_BUDGET_SECONDS = HEAVY_BUDGET_SECONDS  # 03 의 옛 이름(별칭)
_clock = time.monotonic  # 테스트가 바꿔 끼운다


def run_once(db: Session, storage: StoragePaths, watcher: InboxWatcher) -> dict:
    # 매 주기 시작 시, 10분 넘게 'running' 에 멈춰 있는 작업만 복구한다(I8) — 워커가
    # 살아서 정상 처리 중인(수 초짜리) 작업까지 매번 되돌리면 안 된다. 워커 시작 시
    # 전체 복구는 main() 이 별도로 한다.
    heartbeat(db)  # 주기 시작(리뷰 I3) — 앞선 주기의 통계는 그대로 둔다
    recovered = jobs.recover_running(db, older_than=STUCK_JOB_AFTER)
    if recovered:
        log.warning("%d분 넘게 멈춰 있던 작업 %d개를 복구했습니다.", STUCK_JOB_AFTER.seconds // 60, recovered)

    removed = cleanup_stale(db, storage)
    if removed:
        log.info("끝나지 않은 웹 업로드 %d건을 정리했습니다.", removed)

    # 하루 한 번(02시 이후 첫 주기) 레지스트리·백업·휴지통 비우기(05). 실패해도 워커는 계속 돈다.
    try:
        daily = run_daily(db, storage)
        if daily.get("ran"):
            log.info("일일 작업: %s", daily)
    except Exception:
        db.rollback()
        log.exception("일일 작업 실패")

    stats = {"staged": 0, "processed": 0, "failed": 0}
    for item in watcher.poll():
        try:
            stage_item(db, storage, item)
            watcher.forget(item)
            stats["staged"] += 1
        except OSError as exc:
            db.rollback()
            log.warning("배치 받기 실패(다음 주기에 재시도): %s — %s", item.name, exc)
    def exhausted(job: models.Job) -> None:
        # OS 에 죽어 시도 횟수를 다 쓴 작업 — 다시 돌리지 않고 최종 실패 후처리만 한다
        log.error("시도 횟수를 다 쓴 작업을 실패로 끝냅니다: %s %s", job.type, job.target_id)
        _final_failure(db, job, jobs.EXHAUSTED_ERROR)
        stats["failed"] += 1

    started = _clock()
    while True:
        over_budget = _clock() - started >= HEAVY_BUDGET_SECONDS
        job = jobs.claim_next(db, exclude_types=jobs.HEAVY_JOB_TYPES if over_budget else (),
                              max_attempts=MAX_ATTEMPTS, on_exhausted=exhausted)
        if job is None:
            break
        try:
            if job.type == "process_batch":
                batch = db.get(models.Batch, job.target_id)
                if batch is None:
                    raise RuntimeError(f"배치를 찾을 수 없음: {job.target_id}")
                process_batch(db, storage, batch)
            elif job.type == "write_meta":
                entry = db.get(models.Entry, job.target_id)
                if entry is None:
                    raise RuntimeError(f"Entry 를 찾을 수 없음: {job.target_id}")
                write_entry_files(db, storage, entry)
            elif job.type == "extract_file":
                f = db.get(models.File, job.target_id)
                if f is None:
                    raise RuntimeError(f"파일을 찾을 수 없음: {job.target_id}")
                run_extract(db, storage, f)
            elif job.type == "convert_model":
                f = db.get(models.File, job.target_id)
                if f is None:
                    raise RuntimeError(f"파일을 찾을 수 없음: {job.target_id}")
                run_convert(db, storage, f)
            else:
                raise RuntimeError(f"알 수 없는 작업: {job.type} {job.target_id}")
            jobs.complete(db, job)
            stats["processed"] += 1
            heartbeat(db, stats)  # 작업 1건마다(긴 변환이 이어져도 멈춤으로 보이지 않게)
        except Exception as exc:  # 작업 하나의 실패가 워커를 멈추지 않게
            db.rollback()
            job = db.get(models.Job, job.id)
            jobs.fail(db, job, str(exc), max_attempts=MAX_ATTEMPTS)
            if job.state == "failed":
                _final_failure(db, job, str(exc))
            stats["failed"] += 1
            log.exception("작업 처리 실패: %s %s", job.type, job.target_id)
            heartbeat(db, stats)
    # 심장 박동 — 관리자 운영 화면이 워커가 살아 있는지 이것으로 판단한다(05)
    heartbeat(db, stats)
    return stats


def _final_failure(db: Session, job: models.Job, error: str) -> None:
    """작업이 최종 실패했을 때 대상의 상태가 queued 로 영영 남지 않게 한다."""
    if job.type == "process_batch":
        batch = db.get(models.Batch, job.target_id)
        if batch is not None:
            batch.state, batch.error = "failed", error[:2000]
            db.commit()
    elif job.type == "extract_file":
        # 끝내 못 읽은 파일(이동 중·잠김·경로 없음)
        mark_failed(db, job.target_id, error)
    elif job.type == "convert_model":
        # 끝내 못 읽은 BDF
        mark_convert_failed(db, job.target_id, error)


def _log_orphaned_staging_folders(db: Session, storage: StoragePaths) -> None:
    """배치 행이 없는 `_staging\\<key>` 폴더를 로그로 남긴다(I2) — stage_item 의 파일
    이동은 됐는데 그 뒤 배치 행 생성이 실패해 보정(undo)까지 실패한 경우 등, 드물게
    고아 폴더가 남을 수 있다. 자동으로 지우지 않는다(사람이 내용을 보고 판단해야 한다)."""
    try:
        with os.scandir(to_long(storage.staging)) as it:
            keys = [e.name for e in it if e.is_dir()]
    except OSError:
        return
    known = {k for (k,) in db.query(models.Batch.key)}
    orphans = sorted(k for k in keys if k not in known)
    if orphans:
        log.warning("배치 행이 없는 staging 폴더 %d개 — 수동 확인 필요: %s", len(orphans), orphans)


def _setup_logging(storage: StoragePaths) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    try:
        handler = RotatingFileHandler(to_long(storage.logs_dir / "worker.log"), maxBytes=5_000_000,
                                      backupCount=5, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        logging.getLogger().addHandler(handler)
    except OSError as exc:
        log.warning("로그 파일을 열 수 없습니다(콘솔만 사용): %s", exc)


def main() -> None:
    storage = get_storage()
    Base.metadata.create_all(bind=engine)
    try:
        storage.ensure_layout()
    except OSError:
        pass
    _setup_logging(storage)

    # 이전 실행이 비정상 종료돼 'running' 에 멈춰 있는 작업을 루프 시작 전에 한 번 복구한다
    # (그대로 두면 아무도 완료 처리하지 않아 영영 멈춰 있는다). run_once() 안에서도 매
    # 주기 10분 넘게 멈춘 것만 다시 확인하지만(I8), 시작 시점의 전체 복구는 남겨 둔다.
    recover_db = SessionLocal()
    try:
        recovered = jobs.recover_running(recover_db)
        if recovered:
            log.info("이전 실행에서 멈춘 작업 %d개를 복구해 다시 큐에 넣었습니다.", recovered)
        _log_orphaned_staging_folders(recover_db, storage)
    finally:
        recover_db.close()

    watcher = InboxWatcher(storage)
    log.info("워커 시작 — 저장소 %s, %s초 주기", storage.root, POLL_SECONDS)
    while True:
        if storage.check_reachable():
            db = SessionLocal()
            try:
                stats = run_once(db, storage, watcher)
                if any(stats.values()):
                    log.info("처리 결과 %s", stats)
            except Exception:
                log.exception("주기 처리 중 오류")
            finally:
                db.close()
        else:
            log.warning("공유 폴더에 연결할 수 없어 이번 주기를 건너뜁니다.")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
