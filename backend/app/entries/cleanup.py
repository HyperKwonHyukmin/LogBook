"""20 — 기존 자료 정비: 필수 분류가 빠진 확정 자료 목록 · 제목을 새 형식으로 바꾸기(미리보기 → 선택 적용 → 되돌리기).

관리 화면 '자료 정비'(routers/admin_cleanup.py)와 CLI `naming-cleanup` 이 같은 함수를 쓴다.
- 확정 자료를 숨기거나 상태를 바꾸지 않는다 — 목록·'보완 필요' 표시만.
- 제목 적용은 자료 편집과 같은 경로(service.update_entry)를 타서 version 이 오르고 감사 기록(ENTRY_RETITLE,
  before/after 에 옛·새 제목)과 entry.json 이 남는다. 되돌리기는 그 감사 기록의 옛 제목으로(ENTRY_RETITLE_REVERT).
- 필수 분류가 빠진 BDF 자료와 호선·구역·해석 종류가 하나도 없는 자료는 제목 변경 대상에서 뺀다(사유를 보인다).
- 21 — 호선이 없는 자료의 프로젝트는 호선 칸을 채우고(필수 분류) 제목 머리가 된다(naming.compose_title).
"""
from collections import defaultdict

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import access, models
from ..storage.paths import StoragePaths
from . import naming, quality

RETITLE = "ENTRY_RETITLE"
RETITLE_REVERT = "ENTRY_RETITLE_REVERT"
MISSING_LABELS = {"hull": "호선", "zone": "구역", "analysis_type": "해석 종류"}
MAX_LIMIT = 500


def _facts(db: Session, user=None) -> list[dict]:
    """확정 자료마다 호선·구역·해석 종류·BDF 여부를 한 번에 읽는다(자료 수천 건 전제 — 질의 4번)."""
    q = db.query(models.Entry).filter(models.Entry.status == "confirmed")
    if user is not None:
        q = q.filter(access.visible_entries_filter(user))
    entries = q.order_by(models.Entry.id).all()
    ids = [e.id for e in entries] or [0]
    hulls: dict[int, list[str]] = defaultdict(list)
    for eid, h in (db.query(models.EntryHull.entry_id, models.EntryHull.hull_no)
                   .filter(models.EntryHull.entry_id.in_(ids))
                   .order_by(models.EntryHull.entry_id, models.EntryHull.is_primary.desc(), models.EntryHull.hull_no)):
        hulls[eid].append(h)
    zones: dict[int, list[str]] = defaultdict(list)
    for eid, v in (db.query(models.EntryTag.entry_id, models.Tag.value)
                   .join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
                   .filter(models.EntryTag.entry_id.in_(ids), models.Tag.kind == "zone").order_by(models.Tag.value)):
        zones[eid].append(v)
    # 21 — 프로젝트(자료당 하나). 호선이 없으면 제목 머리이고, 호선 대신 필수 칸을 채운다
    projects: dict[int, str] = {}
    for eid, v in (db.query(models.EntryTag.entry_id, models.Tag.value)
                   .join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
                   .filter(models.EntryTag.entry_id.in_(ids), models.Tag.kind == "project").order_by(models.Tag.value)):
        projects.setdefault(eid, v)
    bdf = {eid for (eid,) in db.query(models.File.entry_id).filter(
        models.File.entry_id.in_(ids), models.File.kind == "model", models.File.location != "trash").distinct()}
    out = []
    for e in entries:
        missing = quality.missing_fields(has_bdf=e.id in bdf, hulls=hulls[e.id], no_hull=bool(e.no_hull),
                                         zones=zones[e.id], analysis_type=e.analysis_type,
                                         project=projects.get(e.id))
        out.append({"entry": e, "hulls": hulls[e.id], "zones": zones[e.id], "has_bdf": e.id in bdf,
                    "project": projects.get(e.id), "missing": missing})
    return out


def _names(db: Session, ids) -> dict[str, str]:
    ids = {i for i in ids if i}
    return dict(db.query(models.User.employee_id, models.User.name)
                .filter(models.User.employee_id.in_(ids or {""}))) if ids else {}


def missing_list(db: Session, user=None, *, missing: str | None = None, uploader: str | None = None,
                 q: str | None = None, offset: int = 0, limit: int = 100) -> dict:
    """필수 분류가 빠진 확정 BDF 자료 — 무엇이 빠졌는지·올린 사람. missing(hull|zone|analysis_type)·uploader·q(번호·제목)."""
    rows = [r for r in _facts(db, user) if r["missing"]]
    counts = {k: sum(1 for r in rows if k in r["missing"]) for k in quality.REQUIRED}
    by_uploader: dict[str, int] = defaultdict(int)
    for r in rows:
        by_uploader[r["entry"].uploaded_by or ""] += 1
    if missing in quality.REQUIRED:
        rows = [r for r in rows if missing in r["missing"]]
    if uploader:
        rows = [r for r in rows if (r["entry"].uploaded_by or "") == uploader]
    if q and q.strip():
        k = naming.key(q)
        rows = [r for r in rows if k in naming.key(r["entry"].entry_id) or k in naming.key(r["entry"].title)]
    total = len(rows)
    page = rows[max(0, offset): max(0, offset) + max(1, min(limit, MAX_LIMIT))]
    names = _names(db, [r["entry"].uploaded_by for r in page] + list(by_uploader))
    return {
        "total": total, "counts": counts, "all": sum(by_uploader.values()),
        "uploaders": [{"employee_id": k or None, "name": names.get(k), "count": n}
                      for k, n in sorted(by_uploader.items(), key=lambda x: (-x[1], x[0]))],
        "items": [{"entry_id": r["entry"].entry_id, "title": r["entry"].title, "version": r["entry"].version,
                   "missing": r["missing"], "hulls": r["hulls"], "no_hull": bool(r["entry"].no_hull),
                   "project": r.get("project"), "zones": r["zones"], "analysis_type": r["entry"].analysis_type,
                   "uploaded_by": r["entry"].uploaded_by, "uploader_name": names.get(r["entry"].uploaded_by),
                   "confirmed_at": r["entry"].confirmed_at.isoformat() if r["entry"].confirmed_at else None}
                  for r in page],
    }


def _proposal(ctx: quality.TitleContext, r: dict) -> dict | None:
    """자료 하나의 제목 제안. 바꿀 것이 없으면 None. blocked 면 reason 을 단다."""
    e = r["entry"]
    source = ctx.source_of(e)
    project = r.get("project")
    phrases = (ctx.phrases("zone", r["zones"]) + ctx.phrases("atype", [e.analysis_type] if e.analysis_type else [])
               + ([project] if project else []))
    structured = naming.compose_title(hulls=r["hulls"], no_hull=bool(e.no_hull), zones=r["zones"],
                                      analysis_type=e.analysis_type, project=project,
                                      distinct=naming.distinct_part(source, hulls=r["hulls"], phrases=phrases))
    current = (e.title or "").strip()
    if structured and structured == current:
        return None
    base = {"entry_id": e.entry_id, "version": e.version, "title": e.title, "source": source,
            "uploaded_by": e.uploaded_by}
    if r["missing"]:
        return base | {"status": "blocked", "new_title": None, "missing": r["missing"],
                       "reason": "필수 분류 빠짐: " + ", ".join(MISSING_LABELS[k] for k in r["missing"])}
    if not structured:
        return base | {"status": "blocked", "new_title": None, "missing": [],
                       "reason": "호선(또는 프로젝트)·구역·해석 종류가 하나도 없음"}
    return base | {"status": "ready", "new_title": structured, "missing": []}


def title_preview(db: Session, user=None, *, status: str | None = None, q: str | None = None,
                  offset: int = 0, limit: int = 100) -> dict:
    """확정 자료의 제목을 새 형식으로 바꿀 때의 미리보기 — ready(바꿀 수 있음)·blocked(사유). 이미 형식이면 뺀다."""
    ctx = quality.TitleContext(db)
    props = [p for p in (_proposal(ctx, r) for r in _facts(db, user)) if p is not None]
    counts = {"ready": sum(1 for p in props if p["status"] == "ready"),
              "blocked": sum(1 for p in props if p["status"] == "blocked")}
    if status in counts:
        props = [p for p in props if p["status"] == status]
    if q and q.strip():
        k = naming.key(q)
        props = [p for p in props if k in naming.key(p["entry_id"]) or k in naming.key(p["title"])
                 or k in naming.key(p["new_title"] or "")]
    total = len(props)
    page = props[max(0, offset): max(0, offset) + max(1, min(limit, MAX_LIMIT))]
    names = _names(db, [p["uploaded_by"] for p in page])
    for p in page:
        p["uploader_name"] = names.get(p["uploaded_by"])
    return {"total": total, "counts": counts, "items": page}


def apply_titles(db: Session, storage: StoragePaths, items: list[dict], *, user=None,
                 system_actor: str | None = None, ip: str | None = None) -> dict:
    """제목 바꾸기 — items = [{entry_id, version, new_title?}]. 적용 직전에 다시 계산해, 미리보기 뒤 자료가 바뀌었으면
    (version·제안 제목이 다르면) 건너뛴다. 자료 편집과 같은 경로(update_entry, 감사 ENTRY_RETITLE)."""
    from .service import update_entry

    ctx = quality.TitleContext(db)
    done, skipped = [], []
    for it in items:
        eid = str(it.get("entry_id") or "").upper()
        e = db.query(models.Entry).filter_by(entry_id=eid).first()
        if e is None or e.status != "confirmed" or (user is not None and not access.can_view_entry(user, e, db=db)):
            skipped.append({"entry_id": eid, "reason": "not_found"})
            continue
        if it.get("version") is not None and int(it["version"]) != e.version:
            skipped.append({"entry_id": eid, "reason": "version_conflict"})
            continue
        r = _facts_one(db, e)[0]
        prop = _proposal(ctx, r)
        if prop is None:
            skipped.append({"entry_id": eid, "reason": "already_formatted"})
            continue
        if prop["status"] != "ready":
            skipped.append({"entry_id": eid, "reason": "blocked", "detail": prop["reason"]})
            continue
        if it.get("new_title") and it["new_title"] != prop["new_title"]:
            skipped.append({"entry_id": eid, "reason": "proposal_changed", "new_title": prop["new_title"]})
            continue
        try:
            update_entry(db, storage, e, user, {"version": e.version, "title": prop["new_title"]}, ip,
                         action=RETITLE, system_actor=system_actor)
        except HTTPException as exc:
            db.rollback()
            skipped.append({"entry_id": eid, "reason": str(exc.detail)})
            continue
        done.append({"entry_id": eid, "old_title": prop["title"], "new_title": prop["new_title"]})
    return {"applied": done, "skipped": skipped}


def _facts_one(db: Session, e: models.Entry) -> list[dict]:
    from .service import hulls_of, project_of, zones_of

    hulls = [h.hull_no for h in hulls_of(db, e)]
    zones = zones_of(db, e)
    project = project_of(db, e)
    has_bdf = quality.has_model(db, e)
    return [{"entry": e, "hulls": hulls, "zones": zones, "has_bdf": has_bdf, "project": project,
             "missing": quality.missing_fields(has_bdf=has_bdf, hulls=hulls, no_hull=bool(e.no_hull), zones=zones,
                                               analysis_type=e.analysis_type, project=project)}]


def applied_list(db: Session, user=None, limit: int = 100) -> list[dict]:
    """최근 제목 바꾸기 기록(감사 ENTRY_RETITLE) — 되돌릴 수 있는가(지금 제목이 바꾼 제목 그대로이고 아직 안 되돌렸는가)."""
    rows = (db.query(models.AuditLog).filter(models.AuditLog.action == RETITLE)
            .order_by(models.AuditLog.at.desc(), models.AuditLog.id.desc()).limit(max(1, min(limit, MAX_LIMIT))).all())
    ids = {r.target_id for r in rows}
    entries = {e.entry_id: e for e in db.query(models.Entry).filter(models.Entry.entry_id.in_(ids or {""}))}
    reverts = defaultdict(list)
    for r in (db.query(models.AuditLog).filter(models.AuditLog.action == RETITLE_REVERT,
                                               models.AuditLog.target_id.in_(ids or {""}))):
        reverts[r.target_id].append(r.id)
    out = []
    for r in rows:
        e = entries.get(r.target_id)
        if e is None or (user is not None and not access.can_view_entry(user, e, db=db)):
            continue
        old, new = (r.before or {}).get("title"), (r.after or {}).get("title")
        reverted = any(x > r.id for x in reverts[r.target_id])
        out.append({"audit_id": r.id, "at": r.at.isoformat(), "employee_id": r.employee_id,
                    "entry_id": r.target_id, "old_title": old, "new_title": new, "current_title": e.title,
                    "reverted": reverted,
                    "can_revert": (not reverted and e.status == "confirmed" and (e.title or "") == (new or ""))})
    return out


def revert_title(db: Session, storage: StoragePaths, entry_id: str, *, user=None, system_actor: str | None = None,
                 ip: str | None = None) -> models.Entry:
    """마지막 제목 바꾸기(ENTRY_RETITLE)를 되돌린다 — 지금 제목이 그때 바꾼 제목 그대로일 때만(아니면 409)."""
    from .service import update_entry

    eid = (entry_id or "").upper()
    e = db.query(models.Entry).filter_by(entry_id=eid).first()
    if e is None or (user is not None and not access.can_view_entry(user, e, db=db)):
        raise HTTPException(status_code=404, detail="entry_not_found")
    last = (db.query(models.AuditLog).filter(models.AuditLog.target_id == eid,
                                             models.AuditLog.action.in_((RETITLE, RETITLE_REVERT)))
            .order_by(models.AuditLog.id.desc()).first())
    if last is None or last.action != RETITLE:
        raise HTTPException(status_code=409, detail="nothing_to_revert")
    old, new = (last.before or {}).get("title"), (last.after or {}).get("title")
    if not old or (e.title or "") != (new or ""):
        raise HTTPException(status_code=409, detail="title_changed_since")
    return update_entry(db, storage, e, user, {"version": e.version, "title": old}, ip,
                        action=RETITLE_REVERT, system_actor=system_actor)
