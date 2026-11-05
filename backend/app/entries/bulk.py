"""54 — 여러 자료의 분류를 한꺼번에 바꾸기(검색 결과에서 골라). 자료마다 update_entry 를 불러
한 건씩 고친 것과 같은 감사 기록(ENTRY_UPDATE)·version·entry.json 이 남는다. 안 되는 자료는 건너뛰고 이유를 돌려준다."""
from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import access, models, people, vocab
from ..storage.paths import StoragePaths
from . import service

MAX_BULK = 500
LIVE = ("draft", "confirmed")

REASONS = {
    "entry_not_found": "찾을 수 없음",
    "not_uploader": "고칠 권한 없음",
    "entry_trashed": "휴지통에 있음",
    "version_conflict": "다른 사람이 막 고침",
    "has_hulls": "호선이 있어 공용으로 바꾸지 않음",
}


def _reason(exc: HTTPException) -> str:
    code = exc.detail if isinstance(exc.detail, str) else (exc.detail or {}).get("code", "")
    return REASONS.get(code, code or "바꾸지 못함")


def _norm(db: Session, user: models.User, ops: dict) -> dict:
    """더할 값을 분류 목록 규칙으로 한 번만 정리한다(동의어 → 용어, 목록 밖 새 값은 관리자만 — 아니면 전체 422)."""
    admin = access.is_admin(user)
    out = dict(ops)
    out["zones_add"] = vocab.normalize_inputs(db, "zone", ops.get("zones_add") or [], current=[], admin=admin)
    if ops.get("set_target") and ops.get("target"):
        out["target"] = vocab.normalize_input(db, "target", ops["target"], current=None, admin=admin)
    out["assignees_add"] = [p.id for p in people.resolve_refs(db, ops.get("assignees_add") or [])]
    return out


def _patch_for(db: Session, e: models.Entry, ops: dict) -> dict:
    """이 자료에 실제로 바뀌는 칸만. 빈 사전 = 이미 그 값."""
    patch: dict = {}
    fold = lambda xs: {x.casefold() for x in xs}  # noqa: E731
    cur = service.zones_of(db, e)
    drop = fold(ops.get("zones_remove") or [])
    zones = [z for z in cur if z.casefold() not in drop]
    zones += [z for z in ops["zones_add"] if z.casefold() not in fold(zones)]
    if zones != cur:
        patch["zones"] = zones
    if ops.get("set_target"):
        new = ops.get("target") or None
        if (new or "").casefold() != (service.target_of(db, e) or "").casefold():
            patch["target"] = new
    cur_ids = [p["id"] for p in people.assignees_of(db, e)]
    gone = set(ops.get("assignees_remove") or [])
    ids = [i for i in cur_ids if i not in gone] + [i for i in ops["assignees_add"] if i not in cur_ids]
    ids = list(dict.fromkeys(ids))
    if ids != cur_ids:
        patch["assignees"] = [{"id": i} for i in ids]
    if ops.get("no_hull") is not None and bool(ops["no_hull"]) != bool(e.no_hull):
        if ops["no_hull"] and service.hulls_of(db, e):
            # update_entry 는 '공용' 을 고르면 호선을 비운다 — 한꺼번에 바꿀 때 호선을 지우지 않게 막는다
            raise HTTPException(status_code=409, detail="has_hulls")
        patch["no_hull"] = bool(ops["no_hull"])
    return patch


def bulk_classify(db: Session, storage: StoragePaths, user: models.User, entry_ids: list[str], ops: dict,
                  ip: str | None = None, *, dry_run: bool = False) -> dict:
    """→ {changed: [entry_id], same: [entry_id], failed: [{entry_id, title, reason}]}. dry_run 이면 바꾸지 않고 나눠만 본다."""
    ids = list(dict.fromkeys(i.strip().upper() for i in entry_ids if i and i.strip()))
    if not ids:
        raise HTTPException(status_code=422, detail="no_entries")
    if len(ids) > MAX_BULK:
        raise HTTPException(status_code=422, detail="too_many_entries")
    access.require_writer(user)
    ops = _norm(db, user, ops)
    if not dry_run:
        db.commit()   # WorkBench 사번으로 명부에 새로 더한 담당자 — 뒤에서 한 자료가 실패해 rollback 해도 남게
    changed, same, failed = [], [], []
    for eid in ids:
        e = db.query(models.Entry).filter_by(entry_id=eid).first()
        title = e.title if e is not None else ""
        try:
            if e is None or e.status not in LIVE or not access.can_view_entry(user, e, db=db):
                raise HTTPException(status_code=404, detail="entry_not_found")
            service.ensure_editable(user, e)
            patch = _patch_for(db, e, ops)
            if not patch:
                same.append(eid)
                continue
            if not dry_run:
                service.update_entry(db, storage, e, user, {**patch, "version": e.version}, ip)
            changed.append(eid)
        except HTTPException as exc:
            db.rollback()
            failed.append({"entry_id": eid, "title": title, "reason": _reason(exc)})
    if dry_run:
        db.rollback()   # 담당자 해석이 명부에 더한 행 등은 실제로 바꿀 때 다시 만든다
    return {"changed": changed, "same": same, "failed": failed}
