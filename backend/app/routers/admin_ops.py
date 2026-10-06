"""관리자 운영 API(설계 §6.1·§12) — 워커·작업 큐·백업 상태, 재시도·재추출·재변환·수동 백업, 휴지통 영구 삭제.

재구축은 여기 없다 — 빈 DB 전제라 화면 단추로 두면 위험해서 CLI(`python -m app.cli rebuild`)로만 한다."""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import audit, cli, models
from ..config import settings
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_admin
from ..ops import backup
from ..ops.purge import purge_entry
from ..ops.state import WORKER_ALIVE_SECONDS, get_state, set_state, worker_status
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/admin", tags=["admin-ops"])

# 테스트가 갈아 끼운다(실제 mysqldump 를 부르지 않게)
_backup_runner = backup._run_dump
FAILED_LIMIT = 20
EXPIRING_DAYS = 7


class ForceBody(BaseModel):
    force: bool = False


def _failed_jobs(db: Session) -> list[dict]:
    rows = (db.query(models.Job).filter(models.Job.state == "failed")
            .order_by(models.Job.updated_at.desc(), models.Job.id.desc()).limit(FAILED_LIMIT).all())
    # 대상 이름은 종류별로 한 번에 읽는다(N+1 방지)
    file_ids = {j.target_id for j in rows if j.type in ("extract_file", "convert_model")}
    batch_ids = {j.target_id for j in rows if j.type == "process_batch"}
    entry_ids = {j.target_id for j in rows if j.type == "write_meta"}
    files = dict(db.query(models.File.id, models.File.name).filter(models.File.id.in_(file_ids))) if file_ids else {}
    batches = dict(db.query(models.Batch.id, models.Batch.key).filter(models.Batch.id.in_(batch_ids))) \
        if batch_ids else {}
    entries = dict(db.query(models.Entry.id, models.Entry.entry_id).filter(models.Entry.id.in_(entry_ids))) \
        if entry_ids else {}
    names = {"extract_file": files, "convert_model": files, "process_batch": batches, "write_meta": entries}

    def label(j: models.Job) -> str:
        return names.get(j.type, {}).get(j.target_id) or f"#{j.target_id}"

    return [{"id": j.id, "type": j.type, "target_id": j.target_id, "label": label(j), "attempts": j.attempts,
             "last_error": j.last_error, "updated_at": j.updated_at.isoformat() if j.updated_at else None}
            for j in rows]


@router.get("/ops/status")
def status(db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
           admin: models.User = Depends(require_admin)):
    now = datetime.now()
    jobs = [{"type": t, "state": s, "count": n} for t, s, n in
            db.query(models.Job.type, models.Job.state, func.count(models.Job.id))
            .group_by(models.Job.type, models.Job.state).order_by(models.Job.type, models.Job.state)]
    trashed = db.query(models.Entry.id).filter(models.Entry.status == "trashed")
    # 7일 안에 비워질 것 = 휴지통에 들어간 지 (보관일 - 7)일이 지난 것
    expiring = trashed.filter(
        models.Entry.updated_at <= now - timedelta(days=max(0, settings.trash_days - EXPIRING_DAYS))).count()
    return {
        # alive_seconds = '멈춤' 판정 기준(초) — 화면이 안내 문구에 쓴다
        "worker": {**worker_status(db, now), "alive_seconds": WORKER_ALIVE_SECONDS},
        "storage": {"reachable": storage.check_reachable()},
        "jobs": jobs,
        "failed": _failed_jobs(db),
        "backup": get_state(db, "last_backup"),
        "daily": get_state(db, "last_daily"),
        "trash": {"count": trashed.count(), "expiring": expiring, "days": settings.trash_days},
    }


_TARGET_MODELS = {"process_batch": models.Batch, "write_meta": models.Entry,
                  "extract_file": models.File, "convert_model": models.File}


def _target(db: Session, job: models.Job):
    model = _TARGET_MODELS.get(job.type)
    return db.get(model, job.target_id) if model else None


@router.post("/ops/jobs/{job_id}/retry")
def retry(job_id: int, request: Request, db: Session = Depends(get_db),
          storage: StoragePaths = Depends(get_storage), admin: models.User = Depends(require_admin)):
    job = db.get(models.Job, job_id, with_for_update=True, populate_existing=True)
    if job is None:
        raise HTTPException(status_code=404, detail="job_not_found")
    if job.state != "failed":
        raise HTTPException(status_code=409, detail="not_failed")
    target = _target(db, job)
    if target is None:
        db.rollback()
        raise HTTPException(status_code=409, detail="target_gone")
    before = {"state": job.state, "attempts": job.attempts, "last_error": (job.last_error or "")[:500]}
    if job.type == "process_batch":
        # 최종 실패 때 배치를 failed 로 바꿔 두었다 — 그대로면 process_batch 가 '이미 처리됨' 으로 건너뛴다(리뷰 I4)
        target.state, target.error = "staged", None
    job.state, job.attempts, job.last_error = "queued", 0, None
    job.run_after = datetime.now().replace(microsecond=0)
    db.flush()
    audit.record(db, storage, actor=admin.employee_id, action="JOB_RETRY", target_type="job", target_id=str(job.id),
                 before=before, after={"type": job.type, "target_id": job.target_id}, ip=client_ip(request))
    return {"ok": True}


@router.post("/ops/reextract")
def reextract(request: Request, body: ForceBody | None = None, db: Session = Depends(get_db),
              storage: StoragePaths = Depends(get_storage), admin: models.User = Depends(require_admin)):
    force = bool(body and body.force)
    n = cli.enqueue_extract_all(db, force=force)
    audit.record(db, storage, actor=admin.employee_id, action="OPS_REEXTRACT", target_type="system",
                 target_id="extract", after={"force": force, "queued": n}, ip=client_ip(request))
    return {"queued": n}


@router.post("/ops/reconvert")
def reconvert(request: Request, body: ForceBody | None = None, db: Session = Depends(get_db),
              storage: StoragePaths = Depends(get_storage), admin: models.User = Depends(require_admin)):
    force = bool(body and body.force)
    n = cli.enqueue_convert_all(db, force=force)
    audit.record(db, storage, actor=admin.employee_id, action="OPS_RECONVERT", target_type="system",
                 target_id="convert", after={"force": force, "queued": n}, ip=client_ip(request))
    return {"queued": n}


@router.post("/ops/backup")
def run_backup_now(request: Request, db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
                   admin: models.User = Depends(require_admin)):
    now = datetime.now().replace(microsecond=0)
    try:
        r = backup.run_backup(storage, runner=_backup_runner, now=now, manual=True)
        backup.prune_backups(storage, settings.backup_keep)
        result = {"ok": True, **r, "error": None}
    except (backup.BackupError, OSError) as exc:
        # BackupError 메시지는 backup 모듈이 비밀번호를 가린 뒤의 것이다
        result = {"ok": False, "file": None, "size": None, "at": now.isoformat(), "error": str(exc)[:500]}
    set_state(db, "last_backup", result)
    audit.record(db, storage, actor=admin.employee_id, action="OPS_BACKUP", target_type="system",
                 target_id="backup", after=result, ip=client_ip(request))
    if not result["ok"]:
        raise HTTPException(status_code=502, detail={"code": "backup_failed", "message": result["error"]})
    return result


@router.delete("/trash/{entry_id}", status_code=204)
def purge(entry_id: str, request: Request, db: Session = Depends(get_db),
          storage: StoragePaths = Depends(get_storage), admin: models.User = Depends(require_admin)):
    entry = db.query(models.Entry).filter_by(entry_id=entry_id.upper()).first()
    if entry is None:
        raise HTTPException(status_code=404, detail="entry_not_found")
    # 잠금·상태 재확인은 purge_entry 가 한다(그 사이 지워졌으면 404, 복원됐으면 409 not_trashed)
    purge_entry(db, storage, entry, admin.employee_id, client_ip(request))
    return Response(status_code=204)
