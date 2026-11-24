"""배치 목록·주인 지정(정리 대기 화면용)."""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import String, and_, cast, exists, or_, select
from sqlalchemy.orm import Session

from .. import access, audit, models
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_auth, require_writer
from ..entries import task_import
from ..entries.service import entry_to_dict
from ..ingest import duplicates
from ..ingest.progress import read_progress
from ..ops.state import worker_status
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/batches", tags=["batches"])
# 17 — 동일 BDF 로 모두 빠져 초안 없이 끝난 배치를 정리 대기에 남겨 두는 날 수
DUPLICATE_DONE_DAYS = 3


def queue_context(db: Session) -> dict:
    """배치 여럿이 같이 쓰는 큐 상황 — 워커 생존, 지금 도는 작업들(한 번만 읽는다)."""
    running = db.query(models.Job.type, models.Job.target_id).filter(models.Job.state == "running").all()
    return {"worker": worker_status(db), "running": running}


def _staged_info(db: Session, b: models.Batch, ctx: dict) -> dict:
    """분석 중(staged) 배치 — 서버가 지금 무엇을 하고 있는지(정리 대기 화면의 설명용)."""
    job = (db.query(models.Job).filter(models.Job.type == "process_batch", models.Job.target_id == b.id)
           .order_by(models.Job.id.desc()).first())
    ahead = 0
    if job is not None and job.state == "queued":
        ahead = (db.query(models.Job.id)
                 .filter(models.Job.type == "process_batch", models.Job.state == "queued", models.Job.id < job.id)
                 .count())
    # 워커가 이 배치 말고 다른 작업을 붙들고 있으면(긴 BDF 변환·해석 검증 등) 그 종류를 알린다
    busy = sorted({t for t, target in ctx["running"] if not (t == "process_batch" and target == b.id)})
    return {
        "progress": read_progress(db, b.key),
        "queue": {
            "job_state": job.state if job else None,
            "attempts": job.attempts if job else 0,
            "last_error": (job.last_error or None) if job and job.state == "queued" and job.attempts else None,
            "ahead": ahead,
            "busy_with": busy,
            "worker_alive": bool(ctx["worker"]["alive"]),
            "worker_at": ctx["worker"]["at"],
        },
    }


def batch_to_dict(db: Session, b: models.Batch, ctx: dict | None = None, viewer=None, lite: bool = False) -> dict:
    """배치 한 덩어리. viewer 를 주면 그가 볼 수 없는 초안(비공개로 둔 남의 초안)은 빼고(13),
    초안 안의 다른 Entry 참조(합치기 제안 등)도 그의 권한으로 거른다.
    68 — lite 면 초안과 파일을 싣지 않고 보이는 초안 수(draft_count)만 싣는다(줄 목록 화면의 묶음 머리, 진행 카드용)."""
    q = db.query(models.Entry).filter_by(batch_id=b.id, status="draft")
    if viewer is not None:
        q = q.filter(access.visible_entries_filter(viewer))
    drafts = [] if lite else q.order_by(models.Entry.id).all()
    draft_count = q.count() if lite else len(drafts)
    d = {"key": b.key, "source": b.source, "original_name": b.original_name, "state": b.state,
         "uploader": b.uploader, "uploader_guess": b.uploader_guess, "owner_account": b.owner_account,
         "received_at": b.received_at.isoformat(),
         # 17 — 완전 동일 BDF 로 뺀 항목은 대상(파일 id)을 보는 사람 권한으로 설명해 싣는다(볼 수 없는 대상은 hidden)
         "excluded": duplicates.public_excluded(db, b.excluded, viewer), "error": b.error,
         "allow_duplicates": bool(b.allow_duplicates),
         # 66 — '올리고 바로 확정'을 켰는지와 결과 {confirmed: [E…], kept: [{entry_id, reason}]}(정리가 끝난 뒤)
         "auto_confirm": bool(isinstance(b.preset, dict) and b.preset.get("auto_confirm")),
         "auto_result": b.preset.get("auto_result") if isinstance(b.preset, dict) else None,
         "target_entry_id": b.target_entry_id, "draft_count": draft_count,
         # 68 — 과제 엑셀 묶음: 미리보기(review) 또는 만든 결과
         **({"task_sheet": task_import.preview(db, b, viewer)} if task_import.is_task_batch(b) else {}),
         "entries": [entry_to_dict(db, e, viewer=viewer) for e in drafts]}
    if lite:
        d.pop("entries")
    if b.state == "staged" or drafts:
        ctx = ctx or queue_context(db)
    if b.state == "staged":
        d.update(_staged_info(db, b, ctx))
    if drafts:
        # 지금 3D 로 바꾸는 중인 BDF — 변환 기록은 queued 그대로라 작업 표에서 가린다
        converting = {target for t, target in ctx["running"] if t == "convert_model"}
        for e in d["entries"]:
            for f in e["files"]:
                if f.get("model") is not None:
                    f["model"]["running"] = f["id"] in converting
    if b.target_entry_id and b.state == "done":
        # 62 — [파일 추가]가 실제로 붙인 파일(대상 자료 안 경로). 화면이 '추가한 파일 N개'·'새 파일' 표시에 쓴다
        d["added"] = [{"id": i, "rel_path": r} for i, r in db.query(models.File.id, models.File.rel_path)
                      .filter(models.File.batch_id == b.id, models.File.entry_id == b.target_entry_id)
                      .order_by(models.File.rel_path)]
    if b.target_entry_id and b.state in ("staged", "processed"):
        target = db.get(models.Entry, b.target_entry_id)
        if target is not None and target.status == "draft" and (viewer is None or access.can_view_entry(viewer, target, db=db)):
            d["attachment_target"] = target.entry_id
            # Proposals are temporary attachment work, not another item to approve.
            d["draft_count"] = 0
            if not lite:
                d["entries"] = []
    return d


@router.get("")
def list_batches(scope: str = Query(default="mine", pattern="^(mine|unclaimed|all)$"),
                 lite: bool = Query(default=False),
                 db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    """lite(68) — 초안과 파일 없이 묶음 머리, 진행(queue, progress), 제외 파일, 자동 확정 결과, 첨부 대상만.
    초안 줄은 GET /api/inbox/drafts 가 따로 준다."""
    # 17 — 완전 동일 BDF 만 있어 초안 하나 없이 끝난(done) 배치도 며칠은 보인다 — 탐색기로 넣은 사람이 왜 사라졌는지
    # 알 수 있게(일부만 빠지고 나머지를 확정한 배치는 남기지 않는다)
    recent = datetime.now() - timedelta(days=DUPLICATE_DONE_DAYS)
    q = db.query(models.Batch).filter(or_(
        models.Batch.state.in_(("staged", "processed", "failed", "review")),   # 68 — review = 과제 엑셀 미리보기 대기
        and_(models.Batch.state == "done", models.Batch.processed_at >= recent,
             cast(models.Batch.excluded, String).like(f"%{duplicates.REASON_MODEL}%"),
             ~exists().where(models.Entry.batch_id == models.Batch.id)),
        # 66 — 자동 확정한 묶음은 하루 동안 남겨 '3단계 확정 완료'와 확정한 자료를 보인다
        and_(models.Batch.state == "done", models.Batch.processed_at >= datetime.now() - timedelta(hours=AUTO_DONE_HOURS),
             cast(models.Batch.preset, String).like('%"auto_result"%')),
        # 68 — 과제 엑셀로 만들기가 모두 실패해 끝난 묶음도 하루 남겨 행별 사유를 보인다
        and_(models.Batch.state == "done", models.Batch.processed_at >= datetime.now() - timedelta(hours=AUTO_DONE_HOURS),
             cast(models.Batch.preset, String).like('%"task_result"%'))))
    if scope == "mine":
        q = q.filter(models.Batch.uploader == user.employee_id)
    elif scope == "unclaimed":
        q = q.filter(models.Batch.uploader.is_(None))
    rows = q.order_by(models.Batch.received_at.desc(), models.Batch.id.desc()).limit(200).all()
    rows = [b for b in rows if b.state != "done" or _has_duplicate_exclusion(b) or _auto_result(b) or _task_failed(b)]
    ctx = queue_context(db) if rows else None
    out = [batch_to_dict(db, b, ctx, viewer=user, lite=lite) for b in rows]
    # 13 — 남의 배치인데 남은 초안이 모두 볼 수 없는 것이면 배치째 뺀다(이름도 드러내지 않는다)
    return [d for d, b in zip(out, rows) if d["draft_count"] or not _has_hidden_drafts(db, b, user)]


AUTO_DONE_HOURS = 24


def _auto_result(b: models.Batch) -> dict | None:
    return b.preset.get("auto_result") if isinstance(b.preset, dict) else None


def _task_failed(b: models.Batch) -> bool:
    r = b.preset.get(task_import.RESULT_KEY) if isinstance(b.preset, dict) else None
    return bool(isinstance(r, dict) and r.get("failed") and not r.get("created"))


def _has_duplicate_exclusion(b: models.Batch) -> bool:
    return any(isinstance(x, dict) and x.get("reason") == duplicates.REASON_MODEL for x in (b.excluded or []))


def _has_hidden_drafts(db: Session, b: models.Batch, user: models.User) -> bool:
    if access.is_admin(user) or (b.uploader and b.uploader == user.employee_id):
        return False
    return db.query(models.Entry.id).filter_by(batch_id=b.id, status="draft").first() is not None


def _has_unseen_drafts(db: Session, b: models.Batch, user: models.User) -> bool:
    """이 배치에 user 가 볼 수 없는 초안이 하나라도 있는가(13 — 가져가기 차단용)."""
    if access.is_admin(user):
        return False
    return (db.query(models.Entry.id).filter(models.Entry.batch_id == b.id, models.Entry.status == "draft",
                                             ~access.visible_entries_filter(user)).first()) is not None


SUMMARY_NAMES = 50   # 62 — 같은 이름 경고에 쓰는 내 진행 중 묶음 수 상한


@router.get("/summary")
def batch_summary(db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    """62 — 내 정리 대기 요약(메뉴 배지·다른 창에서 올리는 중 안내·폴더 창의 같은 이름 경고).
    drafts = 확정하지 않은 내 초안 수(68 — 내가 담당한 초안 포함, 파일 0개 초안과 임시 첨부 초안은 빼고), staged = 서버가 정리 중인 묶음 수, uploading = 브라우저가 아직 보내는 중인 묶음 수
    (STALE_AFTER 가 지나면 cleanup_stale 이 지우므로 그 안의 것만), names = 진행 중 묶음 [{name, state, received_at}]."""
    from ..uploads.service import STALE_AFTER
    me = user.employee_id
    from ..entries.inbox_rows import draft_query
    live = select(models.File.entry_id).where(models.File.entry_id.isnot(None), models.File.location != "trash")
    drafts = draft_query(db, user, "mine").filter(models.Entry.id.in_(live)).count()
    fresh = datetime.now() - STALE_AFTER
    rows = (db.query(models.Batch.original_name, models.Batch.state, models.Batch.received_at)
            .filter(models.Batch.uploader == me, or_(
                models.Batch.state.in_(("staged", "processed")),
                and_(models.Batch.state == "uploading", models.Batch.received_at >= fresh)))
            .order_by(models.Batch.received_at.desc()).all())
    # processed 인데 초안이 모두 확정·버려진 묶음은 이름 경고에서 뺀다(정리 대기 목록에도 할 일이 없다)
    open_names = {n for (n,) in db.query(models.Batch.original_name)
                  .join(models.Entry, models.Entry.batch_id == models.Batch.id)
                  .filter(models.Batch.uploader == me, models.Batch.state == "processed",
                          models.Entry.status == "draft").distinct()}
    names = [{"name": n, "state": s, "received_at": r.isoformat() if r else None}
             for n, s, r in rows if s != "processed" or n in open_names][:SUMMARY_NAMES]
    # 68 — 초안 만들기를 기다리는 과제 엑셀 묶음도 할 일로 센다
    review = db.query(models.Batch.id).filter(models.Batch.uploader == me, models.Batch.state == "review").count()
    return {"drafts": drafts + review,
            "staged": sum(1 for _n, s, _r in rows if s == "staged"),
            "uploading": sum(1 for _n, s, _r in rows if s == "uploading"),
            "names": names}


@router.get("/task-template")
def task_template(db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    """과제 엑셀 양식(2026-11-24) — 올해 연도와 지금 분류 목록의 대상으로 만든다. 로그인한 누구나."""
    from urllib.parse import quote

    from .. import vocab
    from ..ingest.task_template import build_template

    year = datetime.now().year
    targets = [t.value for t in vocab.Vocab(db, "target").terms if t.active]
    name = f"과제엑셀_양식_{year}.xlsx"
    return Response(build_template(year, targets),
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f"attachment; filename=\"task_template_{year}.xlsx\"; filename*=UTF-8''{quote(name)}",
                             "Cache-Control": "private, no-store"})


@router.get("/{key}")
def get_batch(key: str, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    """배치 하나 — Entry 상세의 [파일 추가]가 올린 뒤 합쳐질 때까지 상태를 본다(state·excluded·error)."""
    b = db.query(models.Batch).filter_by(key=key).first()
    if b is None:
        raise HTTPException(status_code=404, detail="batch_not_found")
    d = batch_to_dict(db, b, viewer=user)
    if not d["entries"] and _has_hidden_drafts(db, b, user):
        raise HTTPException(status_code=404, detail="batch_not_found")   # 13 — 볼 수 없는 초안뿐
    return d


class TaskDraftsBody(BaseModel):
    rows: list[int] = Field(default_factory=list, max_length=2000)


@router.post("/{key}/task-drafts")
def task_drafts(key: str, body: TaskDraftsBody, request: Request, db: Session = Depends(get_db),
                storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    """68 — 과제 엑셀 미리보기에서 고른 행으로 파일 없는 초안을 만든다(LV2 이상인 올린 사람, LV3). 한 번만(review 일 때)."""
    if not body.rows:
        raise HTTPException(status_code=422, detail="no_rows_selected")
    out = task_import.create_drafts(db, storage, key, user, body.rows, client_ip(request))
    b = db.query(models.Batch).filter_by(key=key).first()
    return {**out, "batch": batch_to_dict(db, b, viewer=user, lite=True)}


@router.post("/{key}/task-discard")
def task_discard(key: str, request: Request, db: Session = Depends(get_db),
                 storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    """68 — 과제 엑셀 묶음을 초안 없이 끝낸다(올린 사람, LV3). 원본 엑셀은 휴지통 폴더로."""
    task_import.discard(db, storage, key, user, client_ip(request))
    return {"ok": True}


@router.post("/{key}/claim")
def claim(key: str, request: Request, db: Session = Depends(get_db),
          storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_writer)):
    b = db.query(models.Batch).filter_by(key=key).first()
    if b is None or _has_unseen_drafts(db, b, user):
        # 13 — 볼 수 없는 초안이 든 배치를 가져가면 올린 사람이 되어 그 초안을 보게 된다(권한 상승).
        # 목록·단건에서 숨는 배치와 같게 '없음'으로 답한다.
        raise HTTPException(status_code=404, detail="batch_not_found")
    # 조건부 UPDATE(uploader IS NULL) 로 원자적으로 처리한다(I5) — 먼저 읽고 나서
    # 따로 쓰면, 두 요청이 동시에 "아직 주인 없음" 을 보고 둘 다 통과할 수 있다.
    # 영향 행이 1이 아니면(이미 누가 가져갔거나 그 사이 없어짐) 409.
    result = (
        db.query(models.Batch)
        .filter(models.Batch.id == b.id, models.Batch.uploader.is_(None))
        .update({"uploader": user.employee_id}, synchronize_session=False)
    )
    if result != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail="already_claimed")
    db.query(models.Entry).filter_by(batch_id=b.id, status="draft").update(
        {"uploaded_by": user.employee_id}, synchronize_session=False)
    audit.record(db, storage, actor=user.employee_id, action="BATCH_CLAIM", target_type="batch",
                 target_id=key, after={"uploader": user.employee_id}, ip=client_ip(request))
    db.refresh(b)
    return batch_to_dict(db, b, viewer=user)
