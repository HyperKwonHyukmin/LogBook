"""Entry 서비스 — 조회 변환·수정·호선/구역·확정·휴지통·복원·쪼개기·합치기."""
import logging
import os
import re
from datetime import datetime, timedelta
from pathlib import Path, PurePosixPath

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import access, audit, jobs, models, vocab
from ..storage.paths import StoragePaths, long_join, to_long
from ..revisions.series import refresh as refresh_revisions, series_brief
from .same_model import find_same_models
from . import quality

logger = logging.getLogger(__name__)

HULL_PATTERN = re.compile(r"^[0-9]{4}$")
# 15 — 해석 시기(analysis_period)는 뺐다(열은 남지만 받지도 보이지도 않는다)
EDITABLE_FIELDS = ("title", "analysis_type", "description")


def hulls_of(db: Session, entry: models.Entry) -> list[models.EntryHull]:
    return (db.query(models.EntryHull).filter_by(entry_id=entry.id)
            .order_by(models.EntryHull.is_primary.desc(), models.EntryHull.hull_no).all())


def tags_of(db: Session, entry: models.Entry, kind: str) -> list[str]:
    rows = (db.query(models.Tag.value).join(models.EntryTag, models.EntryTag.tag_id == models.Tag.id)
            .filter(models.EntryTag.entry_id == entry.id, models.Tag.kind == kind)
            .order_by(models.Tag.value).all())
    return [v for (v,) in rows]


def zones_of(db: Session, entry: models.Entry) -> list[str]:
    return tags_of(db, entry, "zone")


def target_of(db: Session, entry: models.Entry) -> str | None:
    """38 — 대상 구조물(자료당 하나, 선택 칸). 옛 자료에 여럿이 남아 있으면 첫 값."""
    values = tags_of(db, entry, "target")
    return values[0] if values else None


def file_rank(f: models.File, model_rows: dict[int, models.ModelSummary] | None = None) -> int:
    """파일 목록 순서 — 해석 모델을 맨 위에 둬 목록에서 바로 열어 보게 한다.
    0 = 변환된 모델(본 BDF, 3D 로 열림) · 1 = 그 밖의 모델 파일(변환 전·INCLUDE) · 2 = 나머지."""
    if model_rows and f.id in model_rows:
        return 0
    return 1 if f.kind == "model" else 2


def file_to_dict(f: models.File, duplicate_entries: dict[int, str | None] | None = None,
                 extracts: dict[int, models.FileExtract] | None = None,
                 model_rows: dict[int, models.ModelSummary] | None = None,
                 same_models: dict[int, dict] | None = None) -> dict:
    x = (extracts or {}).get(f.id)
    s = (model_rows or {}).get(f.id)
    # 같은 BDF(12) — 서명이 없으면(변환 전·실패·include) 빈 목록
    same = (same_models or {}).get(f.id) or {"same_model": [], "same_model_total": 0,
                                             "same_geometry": [], "same_geometry_total": 0}
    return {"id": f.id, "rel_path": f.rel_path, "name": f.name, "kind": f.kind, "size": f.size,
            "sha256": f.sha256, "drm_encrypted": f.drm_encrypted, "duplicate_of_id": f.duplicate_of_id,
            "duplicate_of_entry": (duplicate_entries or {}).get(f.duplicate_of_id),
            "location": f.location,
            "extract": {"state": x.state, "error": x.error, "summary": x.summary} if x else None,
            # BDF 변환 상태(04a) — 모델 파일이 아니거나 변환 기록이 없으면 None
            "model": ({"state": s.state, "error": s.error, "counts": s.counts, "bbox": s.bbox,
                       "missing": s.missing or [], "warnings": (s.warnings or [])[:10],
                       # lbm 형식 버전(04c) — 변환 결과가 없으면 None, 04c 이전 결과(NULL)는 1
                       "format_version": (s.format_version or 1) if s.key else None, **same} if s else None)}


def _entry_ref(db: Session, entry_pk: int | None, viewer=None) -> dict | None:
    """다른 Entry 를 가리키는 짧은 참조. viewer 가 볼 수 없는 Entry 면 None(존재를 숨긴다, 13)."""
    if entry_pk is None:
        return None
    e = db.get(models.Entry, entry_pk)
    if e is None or (viewer is not None and not access.can_view_entry(viewer, e, db=db)):
        return None
    return {"entry_id": e.entry_id, "title": e.title}


def grants_of(db: Session, entry: models.Entry) -> list[dict]:
    """Entry 의 개별 열람 허락 목록(15) — 이름·등급·효력. 효력 = 대상이 지금 WorkBench 활성 사용자.
    WorkBench 표를 읽을 수 없으면 LogBook 에 남은 이름만 싣고 효력은 None(모름)."""
    from .. import wb_users

    rows = (db.query(models.EntryGrant).filter_by(entry_id=entry.id)
            .order_by(models.EntryGrant.granted_at, models.EntryGrant.id).all())
    ids = [g.employee_id for g in rows]
    users = {u.employee_id: u for u in db.query(models.User).filter(models.User.employee_id.in_(ids or [""]))}
    try:
        wb = wb_users.fetch_many(db, ids)
    except wb_users.WbUnavailable:
        wb = None
    out = []
    for g in rows:
        u, w = users.get(g.employee_id), (wb or {}).get(g.employee_id)
        level = 3 if (w is not None and w.is_admin) else ((u.level or 1) if u is not None else 1)
        out.append({"employee_id": g.employee_id,
                    "name": (w.name if w is not None else None) or (u.name if u is not None else None),
                    "department": (w.department if w is not None else None) or (u.department if u is not None else None),
                    "level": level,
                    "effective": None if wb is None else bool(w is not None and w.is_active),
                    "granted_by": g.granted_by, "granted_at": g.granted_at.isoformat() if g.granted_at else None})
    return out


def entry_to_dict(db: Session, entry: models.Entry, viewer=None) -> dict:
    """Entry 사전. viewer(요청한 사용자)를 주면 그가 볼 수 없는 다른 Entry 참조(바이트 동일 파일의 소속·
    같은 BDF·합치기 제안)를 숨기고, 공개 범위를 바꿀 수 있으면 열람 허락 목록을 싣는다(13).
    viewer 가 None 이면 내부용(entry.json·감사 스냅숏) — 숨기지 않는다. API 응답에는 반드시 viewer 를 준다."""
    hulls = hulls_of(db, entry)
    hull_rows = {h.hull_no: h for h in
                 db.query(models.Hull).filter(models.Hull.hull_no.in_([x.hull_no for x in hulls]))} if hulls else {}
    ship = {no: h.ship_type for no, h in hull_rows.items()}
    files = db.query(models.File).filter_by(entry_id=entry.id).order_by(models.File.rel_path).all()
    dup_ids = [f.duplicate_of_id for f in files if f.duplicate_of_id]
    dup_rows = (db.query(models.File.id, models.Entry.id, models.Entry.entry_id)
                .join(models.Entry, models.Entry.id == models.File.entry_id)
                .filter(models.File.id.in_(dup_ids)).all()) if dup_ids else []
    seen_pks = access.visible_entry_pks(db, viewer, {pk for _f, pk, _e in dup_rows}) if viewer is not None else None
    # 13 — 볼 수 없는 Entry 에 있는 같은 파일은 '어디에 있는지' 를 숨긴다(소속 번호 None)
    dup_entries = {fid: (eid if seen_pks is None or pk in seen_pks else None) for fid, pk, eid in dup_rows}
    extracts = {x.file_id: x for x in db.query(models.FileExtract)
                .filter(models.FileExtract.file_id.in_([f.id for f in files]))} if files else {}
    model_rows = {s.file_id: s for s in db.query(models.ModelSummary)
                  .filter(models.ModelSummary.file_id.in_([f.id for f in files]))} if files else {}
    files = sorted(files, key=lambda f: file_rank(f, model_rows))  # 안정 정렬 — 같은 순위 안은 rel_path 순
    same_models = find_same_models(db, model_rows, files, viewer=viewer)
    suggested = _entry_ref(db, entry.suggested_entry_id, viewer)
    merge_into = _entry_ref(db, entry.merge_into_id, viewer)
    # 20 — 필수 분류(BDF 자료는 호선·구역 또는 대상(40)·해석 종류)
    zones = zones_of(db, entry)
    target = target_of(db, entry)
    missing = quality.missing_fields(has_bdf=any(f.kind == "model" and f.location != "trash" for f in files),
                                     hulls=[h.hull_no for h in hulls], no_hull=bool(entry.no_hull), zones=zones,
                                     target=target, analysis_type=entry.analysis_type)
    d = {
        "id": entry.id, "entry_id": entry.entry_id, "status": entry.status, "title": entry.title,
        "analysis_type": entry.analysis_type, "description": entry.description, "version": entry.version,
        "hulls": [{"hull_no": h.hull_no, "ship_type": ship.get(h.hull_no), "is_primary": bool(h.is_primary)}
                  for h in hulls],
        "no_hull": bool(entry.no_hull),
        "zones": zones,
        "target": target,   # 38 — 대상 구조물
        "tags": tags_of(db, entry, "free"),
        "hull_evidence": entry.hull_evidence or [],
        "uploaded_by": entry.uploaded_by, "confirmed_by": entry.confirmed_by,
        "confirmed_at": entry.confirmed_at.isoformat() if entry.confirmed_at else None,
        "batch_id": entry.batch_id, "merge_into_id": entry.merge_into_id,
        "suggested_entry_id": entry.suggested_entry_id if (viewer is None or suggested) else None,
        "vault_rel": entry.vault_rel,
        "files": [file_to_dict(f, dup_entries, extracts, model_rows, same_models) for f in files],
        "suggested_entry": suggested,
        "merge_into": merge_into,
        # 14 — 판 묶음(저장된 행만 읽는다 — 정리 대기 카드의 짧은 흐름 줄). 상세 화면은 /revisions 를 따로 읽는다
        "revisions": series_brief(db, entry.id),
        **access.access_brief(entry),
        # 20 — 빠진 필수 칸(BDF 자료만 — 초안이면 확정을 막는다)·제목 초안(형식대로 만든 제목)
        "required_missing": missing,
        "title_source": entry.title_source,
        "title_draft": None,
    }
    if entry.status != "trashed":
        ctx = quality.TitleContext(db)
        d["title_draft"] = ctx.draft(entry)
        # 초안 제목이 초안 그대로(사람이 고치지 않음)면 값을 바꿀 때 제목이 따라 바뀐다(update_entry)
        d["title_is_auto"] = entry.status == "draft" and ctx.is_auto(entry)
    if viewer is not None:
        from ..hull_info import plm_of   # 순환 import 방지(hull_info 가 이 모듈을 읽는다)

        # 30 — 속성 칸 호선 아래 PLM 선박 정보(조회 안 했으면 None). entry.json(viewer None)에는 넣지 않는다
        for h in d["hulls"]:
            h["plm"] = plm_of(hull_rows.get(h["hull_no"]))
        if not merge_into:
            d["merge_into_id"] = None
        d["can_edit"] = access.can_edit_entry(viewer, entry)
        # 39 — WorkBench 해석 출처(LOGBOOK_WB_ORIGIN_SHOW 가 켜졌을 때만 — Core 03-safety '기본 꺼짐')
        from ..config import settings as _settings
        if _settings.wb_origin_show:
            from .. import wb_origin
            d["wb_origins"] = wb_origin.entry_origins(db, files)
        # 37 — 이 자료에서 뺀 파일(되돌리기용). 고칠 수 있는 사람에게만
        if d["can_edit"] and entry.status == "confirmed":
            d["removed_files"] = removed_files_of(db, entry)
        # 15 — 공유/일반·허락은 올린 사람 + LV3(블록된 자료는 LV3 만), 블록 지정·해제는 LV3 만
        d["can_manage_access"] = access.can_manage_access(viewer, entry) and entry.status != "trashed"
        d["can_block"] = access.is_admin(viewer) and entry.status != "trashed"
        if d["can_manage_access"]:
            d["grants"] = grants_of(db, entry)
        # 20 — '보완 필요'(확정 자료에 빠진 필수 칸)는 고칠 수 있는 사람(올린 사람·LV3)에게만
        d["needs_fix"] = missing if (entry.status == "confirmed" and d["can_edit"]) else []
        # 20 — 확정 전 같은 호선의 같은·비슷한 제목(막지 않는다). 기존 자료에 추가하는 초안은 보지 않는다
        if entry.status == "draft" and not entry.merge_into_id:
            d["similar_entries"] = quality.similar_entries(db, entry, viewer)
    if entry.status == "draft":
        from .draft_attachments import pending_batches
        d["pending_attachments"] = [{"key": b.key, "state": b.state}
                                    for b in pending_batches(db, entry.id)]
    return d


def snapshot(db: Session, entry: models.Entry) -> dict:
    d = entry_to_dict(db, entry)
    return {k: d[k] for k in ("title", "analysis_type", "description", "zones", "tags")} | {
        "hulls": [h["hull_no"] for h in d["hulls"]]} | ({"no_hull": True} if d["no_hull"] else {}) | (
        {"target": d["target"]} if d["target"] else {})   # 38 — 값이 있을 때만(no_hull 과 같은 방식)


def can_edit_draft(user: models.User, entry: models.Entry) -> bool:
    """초안 — 올린 사람 또는 관리자 이상(guest 는 아무것도 못 고친다, 13)."""
    return access.can_edit_entry(user, entry)


def ensure_editable(user: models.User, entry: models.Entry) -> None:
    """초안·확정 모두 올린 사람 또는 관리자 이상(13 — 예전에는 확정 자료를 누구나 고쳤다). guest 는 403."""
    access.require_writer(user)
    if entry.status == "trashed":
        raise HTTPException(status_code=409, detail="entry_trashed")
    if not access.can_edit_entry(user, entry):
        raise HTTPException(status_code=403, detail="not_uploader")


def _lock(db: Session, entry: models.Entry) -> models.Entry:
    """동시 요청끼리 같은 Entry 를 건드리지 못하게 행 잠금을 걸고, 잠근 뒤의 최신 상태로
    다시 읽는다(I6) — 잠그기 전에 읽은 값 기준으로 상태를 검사하면, 그 사이 다른 요청이
    상태를 이미 바꿨을 수 있다(예: 두 요청이 동시에 확정을 시도).

    ⚠ populate_existing=True 가 반드시 있어야 한다. entry 가 이미 이 세션의 identity map
    에 있으면(이 함수 호출 전에 이미 한 번 읽은 경우, 실사용에서 항상 그렇다) db.get() 은
    with_for_update 로 실제 SELECT ... FOR UPDATE 를 보내 행을 잠그면서도, 그 쿼리 결과로
    파이썬 객체의 속성을 다시 채우지는 않는다 — 캐시된(오래된) status/version 을 계속
    들고 있게 되어 "잠근 뒤 다시 검사" 가 무의미해진다."""
    locked = db.get(models.Entry, entry.id, with_for_update=True, populate_existing=True)
    if locked is None:
        # 잠금을 기다리는 사이 다른 요청이 지웠다(예: 휴지통 영구 삭제, 05) — 500 대신 404
        db.rollback()
        raise HTTPException(status_code=404, detail="entry_not_found")
    return locked


def set_hulls(db: Session, entry: models.Entry, hull_nos: list[str]) -> None:
    clean = list(dict.fromkeys(h.strip() for h in hull_nos if h.strip()))
    if any(not HULL_PATTERN.fullmatch(h) for h in clean):
        raise HTTPException(status_code=422, detail="invalid_hull")
    db.query(models.EntryHull).filter_by(entry_id=entry.id).delete(synchronize_session=False)
    for i, h in enumerate(clean):
        db.add(models.EntryHull(entry_id=entry.id, hull_no=h, is_primary=(i == 0)))


def set_tags(db: Session, entry: models.Entry, kind: str, values: list[str]) -> None:
    """이 종류(kind)의 태그만 바꾼다 — 다른 종류(구역 ↔ 자유 태그)는 건드리지 않는다."""
    old = [i for (i,) in db.query(models.EntryTag.tag_id).join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
           .filter(models.EntryTag.entry_id == entry.id, models.Tag.kind == kind)]
    if old:
        db.query(models.EntryTag).filter(models.EntryTag.entry_id == entry.id,
                                         models.EntryTag.tag_id.in_(old)).delete(synchronize_session=False)
    added: set[int] = set()
    for v in dict.fromkeys(x.strip()[:100] for x in values if x and x.strip()):
        tag = db.query(models.Tag).filter_by(kind=kind, value=v).first()
        if tag is None:
            tag = models.Tag(kind=kind, value=v)
            db.add(tag)
            db.flush()
        # FWD·fwd 처럼 대소문자만 다른 값은 MySQL 정렬 규칙상 같은 태그 한 개다. 세션이 autoflush 를
        # 끄고 있어 DB 조회로는 방금 더한 행이 안 보이므로, 이번 호출에서 넣은 태그 id 로 거른다.
        if tag.id in added:
            continue
        added.add(tag.id)
        db.add(models.EntryTag(entry_id=entry.id, tag_id=tag.id))


def set_zones(db: Session, entry: models.Entry, values: list[str]) -> None:
    set_tags(db, entry, "zone", values)


def _set_merge_into(db: Session, entry: models.Entry, value: str | None, user: models.User | None = None) -> None:
    """PATCH 로 초안의 merge_into_id 를 바꾼다(I9) — 확정 시점에 대상이 이미 휴지통이거나
    없어졌으면 confirm() 이 409 target_not_confirmed 로 막지만, 그때까지는 손 쓸 방법이
    없었다. 이제 사용자가 이 필드를 비워(null) 그 초안을 일반 확정으로 되돌릴 수 있다."""
    if entry.status != "draft":
        raise HTTPException(status_code=422, detail="merge_into_id_only_for_draft")
    if not value:
        entry.merge_into_id = None
        return
    target = db.query(models.Entry).filter_by(entry_id=str(value).upper()).first()
    # 13 — 볼 수 없는 Entry 는 없는 것과 같다
    if target is None or (user is not None and not access.can_view_entry(user, target, db=db)):
        raise HTTPException(status_code=422, detail="merge_target_not_found")
    entry.merge_into_id = target.id


# 20 — 이 칸이 바뀌면 (사람이 고치지 않은) 초안 제목을 형식대로 다시 만든다
TITLE_VALUE_FIELDS = ("hulls", "no_hull", "zones", "analysis_type", "target")


def update_entry(db: Session, storage: StoragePaths, entry: models.Entry, user: models.User | None,
                 patch: dict, ip: str | None = None, *, action: str = "ENTRY_UPDATE",
                 system_actor: str | None = None) -> models.Entry:
    """Entry 고치기(초안·확정 공용).

    20 — patch.no_hull('호선 없음(공용)'), patch.title_auto(제목을 형식대로 다시 만들기). 초안은 제목이 초안 그대로
    (사람이 고치지 않음)면 호선·구역·해석 종류를 바꿀 때 제목도 따라 바뀐다. action·system_actor — 관리 정비
    (자료 정비 화면·CLI)가 같은 경로로 고치며 감사 동작 이름을 달리 남긴다. system_actor 가 있으면 권한 검사 없이
    그 이름으로 기록한다(서버 콘솔 CLI 전용 — API 는 넘기지 않는다)."""
    entry = _lock(db, entry)
    if system_actor is None:
        ensure_editable(user, entry)
    elif entry.status == "trashed":
        raise HTTPException(status_code=409, detail="entry_trashed")
    actor = system_actor or user.employee_id
    admin = True if system_actor is not None else access.is_admin(user)
    if patch.get("version") != entry.version:
        raise HTTPException(status_code=409, detail="version_conflict")
    if patch.get("no_hull") and patch.get("hulls"):
        raise HTTPException(status_code=422, detail="no_hull_with_hulls")
    ctx = quality.TitleContext(db)
    old_title = (entry.title or "").strip()
    # 바꾸기 전 값 기준으로 '초안 제목이 초안 그대로인가' — 사람이 고친 제목은 덮지 않는다
    was_auto = entry.status == "draft" and ctx.is_auto(entry)
    if entry.status == "confirmed" and "title" in patch and not (patch["title"] or "").strip():
        raise HTTPException(status_code=422, detail="title_required")  # M6
    # 08 — 해석 종류·구역은 통제 어휘: 동의어·표기 변형은 용어로 바꾸고, 목록 밖 새 값은 관리자만
    if "analysis_type" in patch:
        patch = {**patch, "analysis_type": vocab.normalize_input(
            db, "atype", patch["analysis_type"], current=entry.analysis_type, admin=admin)}
    if "zones" in patch:
        patch = {**patch, "zones": vocab.normalize_inputs(
            db, "zone", patch["zones"] or [], current=zones_of(db, entry), admin=admin)}
    if "target" in patch:   # 38 — 대상 구조물(선택 칸, 하나)
        patch = {**patch, "target": vocab.normalize_input(
            db, "target", patch["target"], current=target_of(db, entry), admin=admin)}
    before = snapshot(db, entry) if entry.status == "confirmed" else None
    for field_name in EDITABLE_FIELDS:
        if field_name in patch:
            value = patch[field_name]
            setattr(entry, field_name, (value or "").strip() if field_name == "title" else (value or None))
    if "hulls" in patch:
        set_hulls(db, entry, patch["hulls"] or [])
        if patch["hulls"]:
            entry.no_hull = False   # 호선을 넣으면 '공용' 표시는 풀린다
    if patch.get("no_hull") is not None:
        entry.no_hull = bool(patch["no_hull"])
        if entry.no_hull and "hulls" not in patch:
            set_hulls(db, entry, [])   # '호선 없음(공용)' 을 고르면 호선을 비운다
    if "zones" in patch:
        set_zones(db, entry, patch["zones"] or [])
    if "target" in patch:
        set_tags(db, entry, "target", [patch["target"]] if patch["target"] else [])
    if "tags" in patch:
        set_tags(db, entry, "free", patch["tags"] or [])
    if "merge_into_id" in patch:
        _set_merge_into(db, entry, patch["merge_into_id"], user)
    if patch.get("access"):
        if entry.status != "draft":
            # 확정 자료의 공개 단계는 set_access(감사 ENTRY_ACCESS)로만 바꾼다
            raise HTTPException(status_code=422, detail="use_access_endpoint")
        if patch["access"] != access.access_of(entry):
            access.ensure_can_manage_access(user, entry, patch["access"])
            _apply_access(entry, patch["access"])
    db.flush()
    # 20 — 제목 초안 따라가기: [형식대로 다시 만들기](title_auto), 또는 초안 제목이 초안 그대로이고 값이 바뀌었을 때
    title_kept = "title" not in patch or (patch["title"] or "").strip() == old_title
    if patch.get("title_auto") or (was_auto and title_kept and any(k in patch for k in TITLE_VALUE_FIELDS)):
        new_title = ctx.draft(entry)
        if new_title:
            entry.title = new_title
    entry.version += 1
    db.flush()
    if entry.status == "confirmed":
        if "hulls" in patch:
            # 30 — 확정 자료에 새로 넣은 호선도 호선 행을 만들고 PLM 자동 조회 대상에 올린다(설정돼 있을 때만)
            _ensure_hulls(db, entry)
            db.flush()
            from .. import plm_ship

            plm_ship.enqueue_fill(db)
        after = snapshot(db, entry)
        audit.record(db, storage, actor=actor, action=action, target_type="entry",
                     target_id=entry.entry_id, before=before, after=after, ip=ip)
        db.commit()
        _write_meta_or_queue(db, storage, entry)
    else:
        db.commit()
    return entry


ADMIN_TAKEOVER_DAYS = 30


def _now():
    return datetime.now().replace(microsecond=0)


def _write_meta_or_queue(db: Session, storage: StoragePaths, entry: models.Entry) -> None:
    """entry.json/_INFO.txt 를 쓴다. 실패해도(OSError) 이미 커밋된 DB 상태(확정·수정 등)를
    되돌리지 않는다 — 대신 재시도 작업을 큐에 넣고 계속한다(I3). 호출 시점에 Entry 의
    DB 트랜잭션은 이미 커밋돼 있어야 한다(이 함수 자체가 실패해도 그 커밋은 안전하다)."""
    from .files import write_entry_files

    try:
        write_entry_files(db, storage, entry)
    except OSError as exc:
        logger.warning("entry.json/_INFO.txt 쓰기 실패 — 재시도 작업을 큐에 등록: %s (%s)",
                       entry.entry_id, exc)
        if not jobs.has_queued(db, "write_meta", entry.id):   # 끊김이 길면 수정마다 쌓이지 않게
            jobs.enqueue(db, "write_meta", entry.id)
        db.commit()


def _check_confirmer(db: Session, user: models.User, entry: models.Entry) -> models.Batch | None:
    access.require_writer(user)
    batch = db.get(models.Batch, entry.batch_id) if entry.batch_id else None
    if entry.uploaded_by and entry.uploaded_by == user.employee_id:
        return batch
    if access.is_admin(user) and batch and batch.received_at <= datetime.now() - timedelta(days=ADMIN_TAKEOVER_DAYS):
        return batch
    raise HTTPException(status_code=403, detail="not_uploader")


def auto_merge_batch(db: Session, storage: StoragePaths, batch: models.Batch) -> int:
    """확정 자료의 [파일 추가]로 올린 배치(target_entry_id)는 정리 대기를 거치지 않고 곧장 그 자료에 합친다.
    올린 사람이 확정하는 것과 같다(confirm 의 merge 경로 — 감사 ENTRY_FILES_ADDED, 이력, 모델 재변환).
    대상이 그 사이 휴지통에 가는 등 합치지 못하면 초안을 정리 대기에 그대로 남긴다(사람이 판단). 합친 초안 수."""
    if not batch.target_entry_id or batch.state != "processed":
        return 0
    user = db.query(models.User).filter_by(employee_id=batch.uploader).first() if batch.uploader else None
    if user is None:
        return 0
    target = db.get(models.Entry, batch.target_entry_id, populate_existing=True)
    if target is not None and target.status == "draft":
        from .draft_attachments import attach_processed_batch
        return attach_processed_batch(db, storage, batch, user)
    merged = 0
    drafts = db.query(models.Entry).filter_by(batch_id=batch.id, status="draft").order_by(models.Entry.id).all()
    for draft in drafts:
        if draft.merge_into_id != batch.target_entry_id:
            continue
        try:
            confirm(db, storage, draft, user)
            merged += 1
        except Exception as exc:  # noqa: BLE001 — 합치기 실패는 배치 처리 실패가 아니다(초안이 남는다)
            db.rollback()
            logger.warning("배치 %s 자동 추가 실패 — 정리 대기에 남김: %s", batch.key,
                           getattr(exc, "detail", exc))
            break
    return merged


def _finish_batch(db: Session, storage: StoragePaths, batch: models.Batch | None) -> None:
    from .files import remove_empty_dirs

    if batch is None:
        return
    left = db.query(models.Entry.id).filter_by(batch_id=batch.id, status="draft").count()
    if left == 0:
        batch.state = "done"
        remove_empty_dirs(storage.staging / batch.key)


def _ensure_hulls(db: Session, entry: models.Entry) -> None:
    for h in hulls_of(db, entry):
        if db.get(models.Hull, h.hull_no) is None:
            db.add(models.Hull(hull_no=h.hull_no))


def _clear_dangling_references(db: Session, entry_id: int) -> None:
    """`db.delete(entry)` 직전에 호출 — 지우려는 Entry(id=entry_id)를 가리키는 다른 행이
    남아 있으면 FK 위반으로 삭제 자체가 실패한다. 정상 흐름에서는 잘 안 생기는 조합이지만
    (merge_into_id 는 보통 확정 Entry 를, suggested_entry_id 도 확정 Entry 만 가리킨다),
    미래의 경로나 수동 데이터로도 FK 에러 없이 항상 지울 수 있도록 방어적으로 비운다."""
    db.query(models.Entry).filter_by(merge_into_id=entry_id).update(
        {"merge_into_id": None}, synchronize_session=False)
    db.query(models.Entry).filter_by(suggested_entry_id=entry_id).update(
        {"suggested_entry_id": None}, synchronize_session=False)
    db.query(models.Batch).filter_by(target_entry_id=entry_id).update(
        {"target_entry_id": None}, synchronize_session=False)
    # 10 — 즐겨찾기는 Entry 와 함께 사라진다(영구 삭제·합치기). 휴지통 이동은 여기를 거치지 않아 남는다
    db.query(models.Favorite).filter_by(entry_id=entry_id).delete(synchronize_session=False)


def _recheck_duplicates(db: Session, user: models.User, batch: models.Batch, files: list[models.File],
                        force: bool) -> list[dict]:
    """17 — 확정 직전 재검사: 들어온 뒤 그 사이 생긴 완전 동일 BDF(옛 모델이 서명을 얻음·관리자 강제 업로드 등)가 있으면 409.
    LV3 force 면 통과시키고 감사에 남길 목록을 돌려준다. allow_duplicates 배치(LV3 '그래도 올리기')는 보지 않는다."""
    from ..ingest import duplicates

    if batch.allow_duplicates:
        return []
    found = duplicates.entry_duplicates(db, files, exclude_batch_id=batch.id)
    if not found:
        return []
    if force:
        return [{"name": f.rel_path, "entries": sorted({d["entry_id"] for d in
                                                        duplicates.describe(db, ids, None, limit=50)["matches"]})}
                for f, ids in found]
    raise HTTPException(status_code=409, detail={
        "code": "duplicate_model",
        "files": [{"file_id": f.id, "name": f.name, "rel_path": f.rel_path, **duplicates.describe(db, ids, user)}
                  for f, ids in found]})


def confirm(db: Session, storage: StoragePaths, entry: models.Entry, user: models.User,
            ip: str | None = None, force: bool = False) -> models.Entry:
    """초안 확정(새 Entry) 또는 기존 자료에 합치기(merge_into_id). force = LV3 가 완전 동일 BDF 409 를 넘긴다(17)."""
    from .files import entry_dir, move_all, plan_rel, rel_move_pairs

    if force and not access.is_admin(user):
        raise HTTPException(status_code=403, detail="level3_required")
    entry = _lock(db, entry)
    if entry.status != "draft":
        raise HTTPException(status_code=409, detail="not_draft")
    batch = _check_confirmer(db, user, entry)
    if batch is None:
        raise HTTPException(status_code=409, detail="no_batch")  # M7
    from .draft_attachments import ensure_no_pending
    ensure_no_pending(db, entry)
    files = db.query(models.File).filter_by(entry_id=entry.id).all()
    staging_root = storage.staging / batch.key
    forced = _recheck_duplicates(db, user, batch, files, force)
    extra = {"duplicates_forced": forced} if forced else {}

    if entry.merge_into_id:
        target = db.get(models.Entry, entry.merge_into_id)
        # 13 — 볼 수 없는 대상은 없는 것과 같고, 남의 자료에는 파일을 더하지 못한다(수정 권한)
        if target is None or target.status != "confirmed" or not access.can_view_entry(user, target, db=db):
            raise HTTPException(status_code=409, detail="target_not_confirmed")
        if not access.can_edit_entry(user, target):
            raise HTTPException(status_code=403, detail="not_uploader")
        target = _lock(db, target)
        if target.status != "confirmed":
            raise HTTPException(status_code=409, detail="target_not_confirmed")
        files_root = entry_dir(storage, target) / "files"
        planned: set[str] = set()
        # 대상 자료가 이미 쓰는 이름 — 중단된 앞선 시도가 옮겨 둔 사본을 찾을 때 남의 파일을 집지 않게(리뷰 7)
        taken = {r.casefold() for (r,) in db.query(models.File.rel_path).filter_by(entry_id=target.id)}
        plans = [(f, plan_rel(staging_root, files_root, f, planned, taken)) for f in files]
        undo = move_all(rel_move_pairs(staging_root, files_root, plans))
        try:
            for f, r in plans:
                f.entry_id, f.rel_path, f.location = target.id, r, "vault"
            db.query(models.ModelRevision).filter_by(entry_id=entry.id).delete(synchronize_session=False)
            _clear_dangling_references(db, entry.id)
            db.delete(entry)
            target.version += 1
            db.flush()
            audit.record(db, storage, actor=user.employee_id, action="ENTRY_FILES_ADDED", target_type="entry",
                         target_id=target.entry_id, after={"files": [r for _, r in plans]} | extra, ip=ip)
        except Exception:
            db.rollback()
            undo()
            raise
        _finish_batch(db, storage, batch)
        # 파일이 더해졌다 — INCLUDE 를 못 찾았거나 실패했던 모델을 다시 변환한다(설계 §7.7).
        # 새로 들어온 모델 파일은 배치 처리 때 이미 변환 작업이 들어가 있다.
        # 한계(알려진 것): unique_rel 이 이름 충돌로 파일 이름을 바꾸면(예: mesh(1).bdf) 본 파일의
        # INCLUDE 'mesh.bdf' 는 바뀐 이름을 모른다 — 그 INCLUDE 는 기존 대상 파일을 가리키거나 missing 으로 남는다.
        from ..convert.job import requeue_entry_models  # 순환 import 방지
        requeue_entry_models(db, target.id)
        db.commit()
        refresh_revisions(db, target.id)   # 14 — 새 파일을 판 묶음에(변환이 끝나면 워커가 다시 맞춘다)
        _write_meta_or_queue(db, storage, target)
        return target

    if not (entry.title or "").strip():
        raise HTTPException(status_code=422, detail="title_required")
    # 20 — BDF 자료는 호선(또는 호선 없음(공용))·구역·해석 종류가 있어야 확정한다. 기존 자료에 합치기(위)는 보지 않는다
    missing = quality.missing_required(db, entry)
    if missing:
        raise HTTPException(status_code=409, detail={"code": "required_fields", "missing": missing})
    now = _now()
    entry.vault_rel = f"{now.year}/{entry.entry_id}"
    files_root = entry_dir(storage, entry) / "files"
    undo = move_all(rel_move_pairs(staging_root, files_root, [(f, f.rel_path) for f in files]))
    try:
        for f in files:
            f.location = "vault"
        entry.status, entry.confirmed_by, entry.confirmed_at = "confirmed", user.employee_id, now
        _ensure_hulls(db, entry)
        db.flush()
        from .. import plm_ship   # 30 — 아직 PLM 을 조회하지 않은 호선이 있으면 일괄 조회 작업(설정돼 있을 때만)

        plm_ship.enqueue_fill(db)
        db.flush()
        audit.record(db, storage, actor=user.employee_id, action="ENTRY_CONFIRM", target_type="entry",
                     target_id=entry.entry_id,
                     after=snapshot(db, entry) | {"files": len(files)} | access_snapshot(entry) | extra, ip=ip)
    except Exception:
        db.rollback()
        undo()
        raise
    _finish_batch(db, storage, batch)
    # 파일이 staging → vault 로 옮겨졌다 — INCLUDE 를 못 찾았거나 실패했던 모델을 새 위치에서 다시 변환한다
    from ..convert.job import requeue_entry_models  # 순환 import 방지
    requeue_entry_models(db, entry.id)
    db.commit()
    _write_meta_or_queue(db, storage, entry)
    return entry


def _stamp() -> str:
    return f"{datetime.now():%Y%m%d-%H%M%S}"


_STAMP_RE = re.compile(r"^[0-9]{8}-[0-9]{6}$")


def _resume_trash_rel(storage: StoragePaths, prefix: str, has_moved) -> str | None:
    """중단된 앞선 휴지통 이동이 만든 폴더(`<prefix><시각>`)를 찾는다(리뷰 7) — 새 시각으로 다시 옮기면
    이미 옮겨진 파일을 못 찾아 영영 실패한다. has_moved(폴더 경로)가 참인 가장 최근 폴더, 없으면 None."""
    try:
        with os.scandir(to_long(storage.trash)) as it:
            names = [e.name for e in it if e.is_dir() and e.name.startswith(prefix)
                     and _STAMP_RE.fullmatch(e.name[len(prefix):])]
    except OSError:
        return None
    for name in sorted(names, reverse=True):
        if has_moved(storage.trash / name):
            return name
    return None


def trash(db: Session, storage: StoragePaths, entry: models.Entry, user: models.User,
          ip: str | None = None) -> models.Entry:
    from .files import entry_dir, move_all, rel_move_pairs

    entry = _lock(db, entry)
    access.require_writer(user)
    if entry.status == "trashed":
        raise HTTPException(status_code=409, detail="entry_trashed")
    files = db.query(models.File).filter_by(entry_id=entry.id).all()
    if entry.status == "draft":
        from .draft_attachments import ensure_no_pending
        ensure_no_pending(db, entry)
    if entry.status == "confirmed":
        if not access.can_edit_entry(user, entry):   # 13 — 올린 사람 또는 관리자 이상
            raise HTTPException(status_code=403, detail="not_uploader")
        rel = f"{entry.entry_id}_{_stamp()}"
        if not os.path.exists(to_long(entry_dir(storage, entry))):
            # 앞선 시도가 폴더는 옮겼는데 DB 반영 전에 멈췄다 — 그 폴더로 이어서 끝낸다
            rel = _resume_trash_rel(storage, f"{entry.entry_id}_",
                                    lambda d: os.path.isfile(to_long(d / "entry.json"))
                                    or os.path.isdir(to_long(d / "files"))) or rel
        undo = move_all([(entry_dir(storage, entry), storage.trash / rel)])
        action = "ENTRY_TRASH"
    else:
        if not can_edit_draft(user, entry):
            raise HTTPException(status_code=403, detail="not_uploader")
        batch = db.get(models.Batch, entry.batch_id)
        rel = f"draft_{entry.entry_id}_{_stamp()}"
        src_root = storage.staging / batch.key
        gone = [f for f in files if not os.path.exists(long_join(src_root, f.rel_path))]
        if gone:
            # 앞선 시도가 일부를 휴지통으로 옮기고 멈췄다 — 그 폴더로 이어서 끝낸다
            rel = _resume_trash_rel(storage, f"draft_{entry.entry_id}_",
                                    lambda d: os.path.exists(long_join(d, gone[0].rel_path))) or rel
        undo = move_all(rel_move_pairs(src_root, storage.trash / rel, [(f, f.rel_path) for f in files]))
        action = "DRAFT_DISCARD"
    try:
        before = snapshot(db, entry)
        for f in files:
            f.location = "trash"
        entry.status, entry.trash_rel = "trashed", rel
        entry.version += 1
        db.flush()
        audit.record(db, storage, actor=user.employee_id, action=action, target_type="entry",
                     target_id=entry.entry_id, before=before, after={"trash_rel": rel}, ip=ip)
    except Exception:
        db.rollback()
        undo()
        raise
    if action == "DRAFT_DISCARD":
        _finish_batch(db, storage, db.get(models.Batch, entry.batch_id))
    db.commit()
    return entry


def restore(db: Session, storage: StoragePaths, entry: models.Entry, user: models.User,
            ip: str | None = None) -> models.Entry:
    from .files import entry_dir, move_all

    entry = _lock(db, entry)
    access.ensure_can_edit(user, entry)   # 13 — 올린 사람 또는 관리자 이상
    if entry.status != "trashed" or not entry.vault_rel:
        raise HTTPException(status_code=409, detail="not_restorable")
    dest = entry_dir(storage, entry)
    # 자리에 폴더가 있어도 휴지통 쪽 폴더가 없으면 앞선 복원이 옮기고 멈춘 것이다 — move_all 이 이어서 끝낸다(리뷰 7)
    if os.path.exists(to_long(dest)) and os.path.exists(to_long(storage.trash / entry.trash_rel)):
        raise HTTPException(status_code=409, detail="vault_conflict")
    undo = move_all([(storage.trash / entry.trash_rel, dest)])
    try:
        for f in db.query(models.File).filter_by(entry_id=entry.id):
            f.location = "vault"
        entry.status, entry.trash_rel = "confirmed", None
        entry.version += 1
        db.flush()
        audit.record(db, storage, actor=user.employee_id, action="ENTRY_RESTORE", target_type="entry",
                     target_id=entry.entry_id, ip=ip)
    except Exception:
        db.rollback()
        undo()
        raise
    db.commit()
    _reenqueue_extract(db, entry)
    _reenqueue_convert(db, entry)
    _write_meta_or_queue(db, storage, entry)
    return entry


# ---- 37: 확정 자료에서 파일 하나씩 빼기·되돌리기 ----

def removed_files_of(db: Session, entry: models.Entry) -> list[dict]:
    """이 자료에서 뺀 파일(아직 되돌릴 수 있는 것) — 고칠 수 있는 사람에게만 싣는다."""
    rows = (db.query(models.File).filter(models.File.removed_from_id == entry.id, models.File.location == "trash")
            .order_by(models.File.rel_path).all())
    return [{"id": f.id, "name": f.name, "rel_path": f.rel_path, "kind": f.kind, "size": f.size} for f in rows]


def remove_files(db: Session, storage: StoragePaths, entry: models.Entry, user: models.User, file_ids: list[int],
                 version: int | None, ip: str | None = None) -> models.Entry:
    """확정 자료에서 파일을 뺀다 — 실제 파일은 95_Trash/<자료번호>_files_<시각>/ 로 옮기고 행은 남긴다(되돌리기).

    File.entry_id 를 비우고 removed_from_id 에 원래 자료를 남긴다 — entry_id 로 파일을 고르는 모든 경로
    (검색·판 묶음·문서·관계 지도·같은 BDF)에서 저절로 빠진다. 마지막 파일은 뺄 수 없다(자료를 휴지통으로)."""
    from .files import entry_dir, move_all, rel_move_pairs

    entry = _lock(db, entry)
    ensure_editable(user, entry)
    if entry.status != "confirmed":
        raise HTTPException(status_code=409, detail="entry_not_confirmed")
    if version is not None and version != entry.version:
        raise HTTPException(status_code=409, detail="version_conflict")
    ids = set(file_ids or [])
    if not ids:
        raise HTTPException(status_code=422, detail="no_files")
    files = (db.query(models.File).filter(models.File.entry_id == entry.id, models.File.id.in_(ids))
             .order_by(models.File.rel_path).all())
    if len(files) != len(ids):
        raise HTTPException(status_code=404, detail="file_not_found")
    if any(f.location != "vault" for f in files):
        raise HTTPException(status_code=409, detail="file_not_in_vault")
    left = db.query(models.File.id).filter(models.File.entry_id == entry.id, ~models.File.id.in_(ids)).count()
    if left == 0:
        raise HTTPException(status_code=422, detail="last_file")
    rel = f"{entry.entry_id}_files_{_stamp()}"
    files_root = entry_dir(storage, entry) / "files"
    undo = move_all(rel_move_pairs(files_root, storage.trash / rel, [(f, f.rel_path) for f in files]))
    try:
        for f in files:
            f.entry_id, f.location, f.removed_from_id, f.trash_rel = None, "trash", entry.id, rel
        db.query(models.ModelRevision).filter(models.ModelRevision.file_id.in_(ids)).delete(synchronize_session=False)
        entry.version += 1
        db.flush()
        audit.record(db, storage, actor=user.employee_id, action="ENTRY_FILES_REMOVED", target_type="entry",
                     target_id=entry.entry_id, after={"files": [f.rel_path for f in files], "trash_rel": rel}, ip=ip)
    except Exception:
        db.rollback()
        undo()
        raise
    db.commit()
    refresh_revisions(db, entry.id)   # 14 — 판 묶음에서 빠진 모델을 뺀다
    _write_meta_or_queue(db, storage, entry)
    return entry


def restore_files(db: Session, storage: StoragePaths, entry: models.Entry, user: models.User, file_ids: list[int],
                  ip: str | None = None) -> models.Entry:
    """remove_files 되돌리기 — 원래 자리로(그 사이 같은 이름이 생겼으면 'name (2).ext')."""
    from .files import entry_dir, move_all, unique_rel

    entry = _lock(db, entry)
    ensure_editable(user, entry)
    if entry.status != "confirmed":
        raise HTTPException(status_code=409, detail="entry_not_confirmed")
    ids = set(file_ids or [])
    if not ids:
        raise HTTPException(status_code=422, detail="no_files")
    files = (db.query(models.File).filter(models.File.removed_from_id == entry.id, models.File.id.in_(ids),
                                          models.File.location == "trash").order_by(models.File.rel_path).all())
    if len(files) != len(ids) or any(not f.trash_rel for f in files):
        raise HTTPException(status_code=404, detail="file_not_found")
    files_root = entry_dir(storage, entry) / "files"
    planned = {r.casefold() for (r,) in db.query(models.File.rel_path).filter_by(entry_id=entry.id)}
    plans = [(f, unique_rel(files_root, f.rel_path, planned)) for f in files]
    undo = move_all([(Path(long_join(storage.trash / f.trash_rel, f.rel_path)), Path(long_join(files_root, r)),
                      f.size, f.sha256) for f, r in plans])
    try:
        for f, r in plans:
            f.entry_id, f.rel_path, f.location, f.removed_from_id, f.trash_rel = entry.id, r, "vault", None, None
        entry.version += 1
        db.flush()
        audit.record(db, storage, actor=user.employee_id, action="ENTRY_FILES_RESTORED", target_type="entry",
                     target_id=entry.entry_id, after={"files": [r for _f, r in plans]}, ip=ip)
    except Exception:
        db.rollback()
        undo()
        raise
    db.commit()
    refresh_revisions(db, entry.id)
    _write_meta_or_queue(db, storage, entry)
    return entry


def _reenqueue_extract(db: Session, entry: models.Entry) -> None:
    """복원한 Entry 의 파일 중 본문을 뽑은 적이 없거나 휴지통에 있어 건너뛴 것을 다시
    추출 대기열에 넣는다(이미 뽑아 둔 본문은 휴지통에서도 지우지 않으므로 그대로 둔다)."""
    from ..extract.job import enqueue_extract

    files = db.query(models.File).filter_by(entry_id=entry.id).all()
    if not files:
        return
    rows = {x.file_id: x for x in db.query(models.FileExtract)
            .filter(models.FileExtract.file_id.in_([f.id for f in files]))}
    for f in files:
        x = rows.get(f.id)
        if x is None or (x.state == "skipped" and x.error == "trashed"):
            enqueue_extract(db, f)
    db.commit()


def _reenqueue_convert(db: Session, entry: models.Entry) -> None:
    """복원한 Entry 의 모델 파일 중 변환한 적이 없거나 휴지통에 있어 건너뛴 것을 다시 변환한다
    (이미 끝난 변환 결과는 휴지통에서도 지우지 않으므로 그대로 둔다)."""
    from ..convert.job import enqueue_convert

    files = db.query(models.File).filter_by(entry_id=entry.id, kind="model").all()
    if not files:
        return
    rows = {r.file_id: r for r in db.query(models.ModelSummary)
            .filter(models.ModelSummary.file_id.in_([f.id for f in files]))}
    for f in files:
        r = rows.get(f.id)
        if r is None or (r.state == "skipped" and r.error == "trashed"):
            enqueue_convert(db, f)
    db.commit()


def _require_draft_owner(user: models.User, *entries: models.Entry) -> None:
    access.require_writer(user)
    for e in entries:
        if e.status != "draft":
            raise HTTPException(status_code=409, detail="not_draft")
        if not can_edit_draft(user, e):
            raise HTTPException(status_code=403, detail="not_uploader")


def split(db: Session, entry: models.Entry, user: models.User, file_ids: list[int]) -> models.Entry:
    entry = _lock(db, entry)
    _require_draft_owner(user, entry)
    from .draft_attachments import ensure_no_pending
    ensure_no_pending(db, entry)
    files = db.query(models.File).filter(models.File.id.in_(file_ids or [0])).all()
    if not files or len(files) != len(set(file_ids)) or any(f.entry_id != entry.id for f in files):
        raise HTTPException(status_code=422, detail="file_not_in_entry")
    new = models.Entry(title=entry.title, status="draft", batch_id=entry.batch_id, uploaded_by=entry.uploaded_by,
                       hull_evidence=entry.hull_evidence, merge_into_id=entry.merge_into_id,
                       access=access.access_of(entry), no_hull=bool(entry.no_hull),
                       title_source=entry.title_source)
    db.add(new)
    db.flush()
    new.entry_id = f"E{new.id:06d}"
    for h in hulls_of(db, entry):
        db.add(models.EntryHull(entry_id=new.id, hull_no=h.hull_no, is_primary=h.is_primary))
    for f in files:
        f.entry_id = new.id
    entry.version += 1
    db.commit()
    refresh_revisions(db, entry.id)   # 14 — 판 묶음은 Entry 안에서만
    refresh_revisions(db, new.id)
    return new


def merge(db: Session, entry: models.Entry, other: models.Entry, user: models.User) -> models.Entry:
    # id 오름차순으로 잠근다 — merge(A,B) 와 merge(B,A) 가 동시에 들어오면 반대 순서로
    # 잠가 서로를 기다리는 교착(deadlock)이 날 수 있다.
    if entry.id <= other.id:
        entry, other = _lock(db, entry), _lock(db, other)
    else:
        other, entry = _lock(db, other), _lock(db, entry)
    _require_draft_owner(user, entry, other)
    from .draft_attachments import ensure_no_pending
    ensure_no_pending(db, entry)
    ensure_no_pending(db, other)
    if entry.id == other.id or entry.batch_id != other.batch_id:
        raise HTTPException(status_code=422, detail="different_batch")
    db.query(models.File).filter_by(entry_id=other.id).update({"entry_id": entry.id}, synchronize_session=False)
    _clear_dangling_references(db, other.id)
    db.query(models.ModelRevision).filter_by(entry_id=other.id).delete(synchronize_session=False)
    db.delete(other)
    entry.version += 1
    db.commit()
    refresh_revisions(db, entry.id)
    return entry


def move_file(db: Session, f: models.File, target: models.Entry, user: models.User) -> None:
    source = db.get(models.Entry, f.entry_id)
    source = _lock(db, source)
    target = _lock(db, target)
    _require_draft_owner(user, source, target)
    from .draft_attachments import ensure_no_pending
    ensure_no_pending(db, source)
    ensure_no_pending(db, target)
    if source.batch_id != target.batch_id:
        raise HTTPException(status_code=422, detail="different_batch")
    f.entry_id = target.id
    source.version += 1
    target.version += 1
    db.commit()
    refresh_revisions(db, source.id)
    refresh_revisions(db, target.id)


# ---- 13·15: 공개 단계·열람 허락 ----

def _apply_access(entry: models.Entry, value) -> None:
    if value not in models.ENTRY_ACCESS:
        raise HTTPException(status_code=422, detail="invalid_access")
    entry.access = value


def access_snapshot(entry: models.Entry) -> dict:
    return {"access": access.access_of(entry)}


def _after_access_change(db: Session, storage: StoragePaths, entry: models.Entry) -> None:
    """공개 범위·허락이 바뀌면 registry.json(재구축 원천)과 entry.json 을 다시 쓴다."""
    from ..ops.registry import write_registry  # 순환 import 방지

    write_registry(db, storage)
    if entry.status == "confirmed":
        _write_meta_or_queue(db, storage, entry)


def set_access(db: Session, storage: StoragePaths, entry: models.Entry, user: models.User, value: str,
               version: int | None = None, ip: str | None = None) -> models.Entry:
    """공개 단계 바꾸기 — 공유↔일반은 올린 사람 + LV3, 블록 지정·해제는 LV3 만. 감사 ENTRY_ACCESS(before/after)."""
    entry = _lock(db, entry)
    access.ensure_can_manage_access(user, entry, value)
    if entry.status == "trashed":
        raise HTTPException(status_code=409, detail="entry_trashed")
    if version is not None and version != entry.version:
        raise HTTPException(status_code=409, detail="version_conflict")
    before = access_snapshot(entry)
    _apply_access(entry, value)
    after = access_snapshot(entry)
    if after == before:
        db.rollback()
        return entry
    entry.version += 1
    db.flush()
    audit.record(db, storage, actor=user.employee_id, action="ENTRY_ACCESS", target_type="entry",
                 target_id=entry.entry_id, before=before, after=after, ip=ip)
    _after_access_change(db, storage, entry)
    return entry


def grant(db: Session, storage: StoragePaths, entry: models.Entry, user: models.User, employee_id: str,
          ip: str | None = None) -> models.EntryGrant:
    """개별 열람 허락(15) — 올린 사람 또는 LV3 가(블록 자료는 LV3 만) WorkBench 활성 사용자에게. 감사 ENTRY_GRANT.
    이미 있으면 그대로(여러 번 불러도 같다). LogBook 에 들어온 적 없는 사람에게도 줄 수 있다(사번으로 남는다)."""
    eid = (employee_id or "").strip().upper()
    grant_many(db, storage, entry, user, [eid], ip)
    return db.query(models.EntryGrant).filter_by(entry_id=entry.id, employee_id=eid).one()


GRANT_MANY_LIMIT = 200


def grant_many(db: Session, storage: StoragePaths, entry: models.Entry, user: models.User, employee_ids,
               ip: str | None = None) -> list[str]:
    """여러 사람에게 한 번에 열람 허락(31) — 규칙은 grant 와 같다. 대상을 모두 먼저 확인하고(한 명이라도
    없거나 비활성이면 아무것도 주지 않는다) 새로 준 사람마다 감사 ENTRY_GRANT. registry 는 한 번만 쓴다.
    새로 허락한 사번 목록을 돌려준다(이미 있던 사람은 빠진다)."""
    from .. import wb_users

    access.ensure_can_manage_access(user, entry)
    if entry.status == "trashed":
        raise HTTPException(status_code=409, detail="entry_trashed")
    eids = list(dict.fromkeys(e for e in ((x or "").strip().upper() for x in employee_ids) if e))
    if not eids:
        raise HTTPException(status_code=422, detail="grant_empty")
    if len(eids) > GRANT_MANY_LIMIT:
        raise HTTPException(status_code=422, detail="grant_too_many")
    try:
        targets = wb_users.fetch_many(db, eids)
    except wb_users.WbUnavailable:
        raise HTTPException(status_code=503, detail="wb_unavailable")
    if any(e not in targets for e in eids):
        raise HTTPException(status_code=404, detail="user_not_found")
    if any(not targets[e].is_active for e in eids):
        raise HTTPException(status_code=422, detail="grant_user_inactive")
    have = {e for (e,) in db.query(models.EntryGrant.employee_id)
            .filter(models.EntryGrant.entry_id == entry.id, models.EntryGrant.employee_id.in_(eids))}
    added = [e for e in eids if e not in have]
    if not added:
        return []
    for eid in added:
        db.add(models.EntryGrant(entry_id=entry.id, employee_id=eid, granted_by=user.employee_id))
    db.flush()
    for eid in added:
        audit.record(db, storage, actor=user.employee_id, action="ENTRY_GRANT", target_type="entry",
                     target_id=entry.entry_id, after={"employee_id": eid}, ip=ip)
    _after_access_change(db, storage, entry)
    return added


def revoke(db: Session, storage: StoragePaths, entry: models.Entry, user: models.User, employee_id: str,
           ip: str | None = None) -> None:
    """열람 허락 회수 — 올린 사람 또는 LV3(블록 자료는 LV3 만). 없으면 404. 감사 ENTRY_REVOKE."""
    access.ensure_can_manage_access(user, entry)
    eid = (employee_id or "").strip().upper()
    n = (db.query(models.EntryGrant).filter_by(entry_id=entry.id, employee_id=eid)
         .delete(synchronize_session=False))
    if not n:
        db.rollback()
        raise HTTPException(status_code=404, detail="grant_not_found")
    audit.record(db, storage, actor=user.employee_id, action="ENTRY_REVOKE", target_type="entry",
                 target_id=entry.entry_id, before={"employee_id": eid}, ip=ip)
    _after_access_change(db, storage, entry)
