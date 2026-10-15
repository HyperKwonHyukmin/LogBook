"""판 묶음·비교 화면 응답(14) — Entry 의 계열 목록(+ 인접 비교 상태), 판 정리 저장·자동으로 되돌리기."""
from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import access, audit, models
from ..storage.paths import StoragePaths
from . import job as diff_job
from . import series as rev


def _model_states(db: Session, ids) -> dict[int, models.ModelSummary]:
    ids = list(ids)
    return {s.file_id: s for s in db.query(models.ModelSummary).filter(models.ModelSummary.file_id.in_(ids or [0]))}


def describe_entry(db: Session, entry: models.Entry, viewer, *, ensure_diffs: bool = True) -> dict:
    """GET /entries/{id}/revisions — 계열(판·이름·최신판·인접 비교) + 계열 밖 모델 + token + can_edit.

    읽을 때 대상 파일이 저장된 행과 다르면 다시 맞춘다(자가 복구). 인접 비교가 없거나 낡았으면 대기열에 넣는다
    (휴지통 자료는 넣지 않는다)."""
    rev.sync(db, entry.id)
    series_rows, other_rows = rev._series_rows(db, entry.id)
    ids = {r.file_id for rows in series_rows.values() for r in rows} | {r.file_id for r in other_rows}
    files = rev._files(db, ids)
    states = _model_states(db, ids)
    live = entry.status != "trashed"
    out_series = []
    for key, rows in series_rows.items():
        items = rev.labeled(rows, files)
        for it in items:
            s = states.get(it["file_id"])
            it["model_state"] = s.state if s else None
        diffs = []
        for x, y in zip(items, items[1:]):
            a, b = x["file_id"], y["file_id"]
            sa, sb = states.get(a), states.get(b)
            row = diff_job.find(db, a, b)
            if ensure_diffs and live and (row is None or diff_job.is_stale(row, sa, sb)):
                row = diff_job.ensure(db, a, b, commit=True) or row
            diffs.append({"a": a, "b": b, **diff_job.describe(row, sa, sb)})
        out_series.append({"key": key, "manual": any(r.manual for r in rows), "items": items, "diffs": diffs})
    out_series.sort(key=lambda s: s["items"][0]["name"].casefold())
    others = [{"file_id": r.file_id, "name": files[r.file_id].name, "rel_path": files[r.file_id].rel_path,
               "model_state": states[r.file_id].state if r.file_id in states else None}
              for r in sorted(other_rows, key=lambda r: files[r.file_id].rel_path.casefold())]
    return {"entry_id": entry.entry_id, "series": out_series, "others": others,
            "manual": any(s["manual"] for s in out_series) or any(r.manual for r in other_rows),
            "token": rev.token_of(db, entry.id),
            "can_edit": access.can_edit_entry(viewer, entry) and live}


def _check_edit(user, entry: models.Entry) -> None:
    access.require_writer(user)
    if entry.status == "trashed":
        raise HTTPException(status_code=409, detail="entry_trashed")
    if not access.can_edit_entry(user, entry):
        raise HTTPException(status_code=403, detail="not_uploader")


def _after_save(db: Session, storage: StoragePaths, entry: models.Entry) -> None:
    """확정 자료면 entry.json(판 정리 = 재구축 원천)을 다시 쓴다."""
    if entry.status == "confirmed":
        from ..entries.service import _write_meta_or_queue   # 순환 import 방지
        _write_meta_or_queue(db, storage, entry)


def save(db: Session, storage: StoragePaths, entry: models.Entry, user, body: dict, ip: str | None = None) -> None:
    """판 정리 저장 — 한 번에 Entry 의 판 배치 전체. 감사 ENTRY_REVISIONS 한 줄."""
    _check_edit(user, entry)
    rev.sync(db, entry.id)
    if body.get("token") and body["token"] != rev.token_of(db, entry.id):
        raise HTTPException(status_code=409, detail="revisions_conflict")
    before = rev.snapshot(db, entry.id)
    rev.save_layout(db, entry.id, body.get("series") or [], user.employee_id)
    db.flush()
    audit.record(db, storage, actor=user.employee_id, action="ENTRY_REVISIONS", target_type="entry",
                 target_id=entry.entry_id, before={"series": before}, after={"series": rev.snapshot(db, entry.id)},
                 ip=ip)
    _after_save(db, storage, entry)


def reset(db: Session, storage: StoragePaths, entry: models.Entry, user, ip: str | None = None) -> None:
    """자동 추정으로 되돌리기."""
    _check_edit(user, entry)
    before = rev.snapshot(db, entry.id)
    rev.reset_layout(db, entry.id)
    audit.record(db, storage, actor=user.employee_id, action="ENTRY_REVISIONS", target_type="entry",
                 target_id=entry.entry_id, before={"series": before},
                 after={"series": rev.snapshot(db, entry.id), "auto": True}, ip=ip)
    _after_save(db, storage, entry)


def after_model_change(db: Session, f: models.File | None) -> None:
    """모델 변환이 끝난 뒤(워커) — 그 파일이 든 Entry 의 판 묶음을 다시 맞추고 인접 비교를 대기열에 넣는다.
    실패해도 변환 작업을 깨뜨리지 않는다."""
    if f is None or not f.entry_id:
        return
    try:
        rev.sync(db, f.entry_id)
        entry = db.get(models.Entry, f.entry_id)
        if entry is None or entry.status == "trashed":
            return
        ensure_adjacent(db, entry.id)
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
        rev.log.warning("변환 뒤 판 묶음 갱신 실패: file=%s", f.id, exc_info=True)


def ensure_adjacent(db: Session, entry_pk: int) -> int:
    """계열 인접 판 비교가 없거나 낡았으면 대기열에 넣는다(커밋은 호출자). 넣은 수."""
    n = 0
    series_rows, _ = rev._series_rows(db, entry_pk)
    for rows in series_rows.values():
        for x, y in zip(rows, rows[1:]):
            row = diff_job.find(db, x.file_id, y.file_id)
            sa, sb = diff_job._summaries(db, x.file_id, y.file_id)
            if row is None or diff_job.is_stale(row, sa, sb):
                made = diff_job.ensure(db, x.file_id, y.file_id, commit=False)
                n += bool(made is not None and made.state == "queued")
    return n


def refresh_all(db: Session, *, diffs: bool = True) -> tuple[int, int]:
    """CLI revisions-refresh — 모든 자료(휴지통 밖)의 판 묶음을 맞추고 인접 비교를 넣는다. (바뀐 자료 수, 넣은 비교 수)."""
    pks = [pk for (pk,) in db.query(models.Entry.id).filter(models.Entry.status != "trashed").order_by(models.Entry.id)]
    changed = queued = 0
    for pk in pks:
        changed += bool(rev.sync(db, pk))
        if diffs:
            queued += ensure_adjacent(db, pk)
            db.commit()
    return changed, queued
