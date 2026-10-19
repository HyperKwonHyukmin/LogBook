"""21 — 보고서별 정보(문서 분류)와 '보고서에 사용한 모델' 연결. 저장은 DB(report_meta·report_model_links).

- 자료 소속(호선 관련 / 독립 프로젝트 / 공통 참고자료 / 미분류)은 따로 저장하지 않는다 — 자료(Entry)의 호선·프로젝트·
  '호선 없음(공용)'에서 파생한다(scope_of). 29 — 프로젝트 소속은 없앴다.
- 보고서 정보·연결은 파일 id 기준이라 파일이 자료 사이를 옮겨 가도(합치기 확정 등) 그대로 따라간다.
  휴지통: 행을 남기고 화면에서만 숨긴다(복원하면 그대로). 영구 삭제: 행도 지운다(purge_files).
- 재구축 원천: 보고서가 든 자료의 entry.json `reports`(보고서 상대경로+sha256, 연결 모델 = 자료 번호+상대경로+sha256).
  ops/rebuild 가 모든 자료를 되살린 뒤 restore_reports 로 잇는다(다른 자료의 모델도 가리킬 수 있어서).
- 변경은 감사 로그(REPORT_META 문서 분류 · REPORT_LINKS 모델 연결, target = 보고서가 든 자료)로 남긴다.
- 예전 report-catalog.json(공유 폴더 sidecar)은 읽어서 DB 로 옮기는 migrate_sidecars 에서만 읽는다
  (CLI `report-catalog-migrate`, dry-run 기본). sidecar 에 쓰는 경로는 없다.
"""
import json
import logging
import os
from collections import defaultdict
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import access, audit, models
from .storage.paths import StoragePaths, to_long

log = logging.getLogger(__name__)

DOCUMENT_TYPES = models.REPORT_DOCUMENT_TYPES
NONE = "__none__"   # '미분류' 거르기 값(화면과 같다)
# 23 — 화면 상단 빠른 구분. 문서 분류 거르기 값을 묶어서 거는 바로가기다(따로 저장·거르지 않는다).
# 모든 문서 분류 값과 미분류(NONE)가 정확히 한 묶음에 든다(test_document_types_23 이 고정).
DOCUMENT_TYPE_GROUPS = (
    {"key": "report", "label": "보고서", "values": ["해석 보고서", "연구 보고서", "시험 보고서", "기술 검토", "지침"]},
    {"key": "presentation", "label": "발표자료", "values": ["발표자료", "회의자료"]},
    {"key": "other", "label": "기타", "values": ["계산서", "기타", NONE]},
)
# 23 — 문서 분류가 저장되지 않은 보고서 파일의 추정값(확장자). PDF 등은 추정하지 않는다
AUTO_DOCUMENT_TYPES = {".ppt": "발표자료", ".pptx": "발표자료"}
# 자료 소속(파생 값) — 호선이 있으면 호선 관련, 없고 '호선 없음(공용)'이면 공통 참고자료, 그 밖은 미분류
# (29 — '독립 프로젝트' 소속은 없앴다)
SCOPES = {"hull": "호선 관련", "reference": "공통 참고자료", "unclassified": "미분류"}
META_ACTION = "REPORT_META"
LINKS_ACTION = "REPORT_LINKS"
MAX_LINKS = 50
SIDECAR = "report-catalog.json"
SIDECAR_MIGRATED = "report-catalog.migrated.json"


def scope_of(*, hulls, no_hull) -> str:
    if list(hulls or []):
        return "hull"
    if no_hull:
        return "reference"
    return "unclassified"


def auto_document_type(name) -> str | None:
    """23 — 파일 이름(확장자)으로 추정한 문서 분류. 추정하지 않는 형식이면 None."""
    return AUTO_DOCUMENT_TYPES.get(os.path.splitext(str(name or ""))[1].lower())


def effective_document_type(meta, name) -> tuple[str, bool]:
    """23 — 화면·거르기·건수·검색어 적중에 쓰는 문서 분류 (값, 추정 여부). 값이 없으면 ''(미분류).

    report_meta 행이 없을 때만 확장자로 추정한다(.ppt/.pptx → 발표자료). 행이 있으면 저장된 값 그대로다 —
    사용자가 '미분류'로 저장한 발표 파일(document_type NULL)은 다시 추정하지 않는다. 추정값은 DB·entry.json 에 쓰지 않으므로
    재구축 뒤에도 같은 규칙으로 다시 나온다. 저장(PUT)하면 그 값으로 확정된다."""
    if meta is not None:
        return (meta.document_type or "", False)
    auto = auto_document_type(name)
    return (auto or "", auto is not None)


# ---- 읽기 ----

def visible_models(db: Session, user):
    """연결할 수 있는(그리고 화면에 보일) 모델 — 확정 자료의 휴지통 밖 BDF 중 user 가 볼 수 있는 것. (File, Entry) 질의."""
    return (db.query(models.File, models.Entry).join(models.Entry, models.File.entry_id == models.Entry.id)
            .filter(models.File.kind == "model", models.File.location == "vault",
                    models.Entry.status == "confirmed", access.visible_entries_filter(user)))


def meta_of(db: Session, file_ids) -> dict[int, models.ReportMeta]:
    ids = list({i for i in file_ids if i is not None})
    if not ids:
        return {}
    return {m.file_id: m for m in db.query(models.ReportMeta).filter(models.ReportMeta.file_id.in_(ids))}


def linked_ids(db: Session, report_ids) -> dict[int, set[int]]:
    """보고서 id → 연결된 모델 파일 id(볼 수 있는지와 상관없이 저장된 전부)."""
    ids = list({i for i in report_ids if i is not None})
    out: dict[int, set[int]] = defaultdict(set)
    if ids:
        for rid, mid in (db.query(models.ReportModelLink.report_file_id, models.ReportModelLink.model_file_id)
                         .filter(models.ReportModelLink.report_file_id.in_(ids))):
            out[rid].add(mid)
    return out


def model_counts(db: Session, user, reports: list[tuple[int, int]]) -> dict[int, int]:
    """보고서마다 관련 모델 수(목록용) — reports = [(보고서 파일 id, 그 보고서가 든 Entry pk)].
    같은 자료의 모델 + 명시 연결 모델(볼 수 있고 휴지통 밖인 것만, 겹치면 하나). 질의 2번."""
    if not reports:
        return {}
    entry_pks = {pk for _r, pk in reports}
    same: dict[int, set[int]] = defaultdict(set)
    for fid, pk in (db.query(models.File.id, models.File.entry_id)
                    .filter(models.File.entry_id.in_(entry_pks), models.File.kind == "model",
                            models.File.location == "vault")):
        same[pk].add(fid)
    linked: dict[int, set[int]] = defaultdict(set)
    rows = (db.query(models.ReportModelLink.report_file_id, models.ReportModelLink.model_file_id)
            .join(models.File, models.File.id == models.ReportModelLink.model_file_id)
            .join(models.Entry, models.Entry.id == models.File.entry_id)
            .filter(models.ReportModelLink.report_file_id.in_([r for r, _pk in reports]),
                    models.File.kind == "model", models.File.location == "vault",
                    models.Entry.status == "confirmed", access.visible_entries_filter(user)))
    for rid, mid in rows:
        linked[rid].add(mid)
    return {rid: len(same[pk] | linked[rid]) for rid, pk in reports}


def related_models(db: Session, user, report: models.File, entry: models.Entry) -> list[dict]:
    """관련 모델 — 명시 연결('보고서에 사용한 모델')이 먼저, 그다음 같은 자료의 모델. 볼 수 없는·휴지통 모델은 숨긴다."""
    explicit = linked_ids(db, [report.id]).get(report.id, set())
    pairs = visible_models(db, user).filter(
        (models.File.entry_id == entry.id) | models.File.id.in_(explicit or {0})).all()
    out = [{"file_id": f.id, "name": f.name, "entry_id": e.entry_id, "entry_title": e.title,
            "relation": "explicit" if f.id in explicit else "same_entry"} for f, e in pairs]
    return sorted(out, key=lambda r: (r["relation"] != "explicit", r["name"], r["file_id"]))


def report_file(db: Session, user, file_id: int) -> tuple[models.File, models.Entry]:
    """확정 자료의 휴지통 밖 보고서 파일 — 없거나 볼 수 없으면 404(존재를 숨긴다, 13)."""
    f = db.get(models.File, file_id)
    if f is None or f.kind != "report" or f.location != "vault" or f.entry_id is None:
        raise HTTPException(status_code=404, detail="report_not_found")
    entry = access.ensure_visible(db, user, db.get(models.Entry, f.entry_id), detail="report_not_found")
    if entry.status != "confirmed":
        raise HTTPException(status_code=404, detail="report_not_found")
    return f, entry


def catalog(db: Session, user, report: models.File, entry: models.Entry) -> dict:
    """보고서 하나의 분류·관련 모델과 그 자료의 소속(파생)."""
    from .entries.service import hulls_of

    meta = meta_of(db, [report.id]).get(report.id)
    hulls = [h.hull_no for h in hulls_of(db, entry)]
    doc_type, auto = effective_document_type(meta, report.name)
    return {"file_id": report.id, "entry_id": entry.entry_id, "entry_title": entry.title,
            "document_type": doc_type, "document_type_auto": auto,
            "version": meta.version if meta else 0,
            "updated_by": meta.updated_by if meta else None,
            "updated_at": meta.updated_at.isoformat() if meta and meta.updated_at else None,
            "scope": scope_of(hulls=hulls, no_hull=bool(entry.no_hull)),
            "hulls": hulls, "no_hull": bool(entry.no_hull),
            "related_models": related_models(db, user, report, entry),
            "can_edit": access.can_edit_entry(user, entry)}


def _describe(db: Session, model_ids) -> list[str]:
    """감사 기록용 모델 표기 'E000123/files 기준 상대경로' (이름순)."""
    ids = list(model_ids)
    if not ids:
        return []
    rows = (db.query(models.Entry.entry_id, models.File.rel_path)
            .join(models.Entry, models.Entry.id == models.File.entry_id).filter(models.File.id.in_(ids)))
    return sorted(f"{eid}/{rel}" for eid, rel in rows)


# ---- 저장 ----

def save(db: Session, storage: StoragePaths, user, report: models.File, entry: models.Entry, *,
         version: int | None, document_type: str | None, model_ids=None, ip: str | None = None) -> bool:
    """문서 분류·모델 연결 저장(자료를 고칠 수 있는 사람 = 올린 사람·LV3). version 이 다르면 409.
    바뀐 것이 있어 저장했으면 True, 바뀐 것이 없으면 False(감사 기록도 남기지 않는다).

    24 — 여러 문서 분류 한꺼번에 바꾸기(save_document_types)도 이 함수를 그대로 쓴다:
    version=None 이면 판 확인을 건너뛰고(목록에서 고른 값이라 판을 모른다), model_ids=None 이면 모델 연결은 그대로 둔다.

    볼 수 없거나 휴지통에 간 모델로의 기존 연결은 지우지 않는다(편집자가 모른 채 남의 연결을 잃지 않게)."""
    from .entries.service import _lock, _write_meta_or_queue

    access.ensure_can_edit(user, entry)
    document_type = (document_type or "").strip() or None
    if document_type is not None and document_type not in DOCUMENT_TYPES:
        raise HTTPException(status_code=422, detail="invalid_document_type")
    keep_links = model_ids is None
    wanted = set(model_ids or [])
    if len(wanted) > MAX_LINKS:
        raise HTTPException(status_code=422, detail="too_many_links")
    entry = _lock(db, entry)   # 같은 자료의 보고서 저장끼리 줄 세운다(행이 없을 때의 동시 INSERT 포함)
    if entry.status != "confirmed" or report.entry_id != entry.id:
        db.rollback()
        raise HTTPException(status_code=404, detail="report_not_found")
    meta = db.get(models.ReportMeta, report.id, populate_existing=True)
    if version is not None and (meta.version if meta else 0) != version:
        db.rollback()
        raise HTTPException(status_code=409, detail="report_catalog_conflict")
    found = {f.id for f, _e in visible_models(db, user).filter(models.File.id.in_(wanted))} if wanted else set()
    if found != wanted:
        db.rollback()
        raise HTTPException(status_code=404, detail="model_not_found")
    current = linked_ids(db, [report.id]).get(report.id, set())
    if keep_links:
        new_links = current
    else:
        visible_now = ({f.id for f, _e in visible_models(db, user).filter(models.File.id.in_(current))}
                       if current else set())
        keep_hidden = current - visible_now
        new_links = keep_hidden | wanted
    old_type = meta.document_type if meta else None
    # 23 — 저장된 값이 없고 추정값(.ppt/.pptx → 발표자료)이 보이던 보고서는 저장하면 늘 확정한다(같은 값이어도,
    # '미분류'로 바꿔도 — 그때는 NULL 행이 생겨 다시 추정하지 않는다)
    auto = None if meta is not None else auto_document_type(report.name)
    type_changed = old_type != document_type or auto is not None
    links_changed = new_links != current
    if not type_changed and not links_changed:
        db.rollback()
        return False
    if meta is None:
        meta = models.ReportMeta(file_id=report.id, version=0)
        db.add(meta)
    meta.document_type = document_type
    meta.version = (meta.version or 0) + 1
    meta.updated_by = user.employee_id
    meta.updated_at = models._now()
    for mid in new_links - current:
        db.add(models.ReportModelLink(report_file_id=report.id, model_file_id=mid, created_by=user.employee_id))
    if current - new_links:
        db.query(models.ReportModelLink).filter(
            models.ReportModelLink.report_file_id == report.id,
            models.ReportModelLink.model_file_id.in_(current - new_links)).delete(synchronize_session=False)
    db.flush()
    # 감사 — 보고서가 든 자료의 이력에 보인다(target = 자료). 문서 분류와 연결은 동작을 나눠 남긴다
    head = {"report": report.rel_path}
    if type_changed:
        before = head | {"document_type": old_type} | ({"document_type_auto": auto} if auto else {})
        audit.record(db, storage, actor=user.employee_id, action=META_ACTION, target_type="entry",
                     target_id=entry.entry_id, before=before,
                     after=head | {"document_type": document_type}, ip=ip)
    if links_changed:
        audit.record(db, storage, actor=user.employee_id, action=LINKS_ACTION, target_type="entry",
                     target_id=entry.entry_id, before=head | {"models": _describe(db, current)},
                     after=head | {"models": _describe(db, new_links)}, ip=ip)
    db.commit()
    _write_meta_or_queue(db, storage, entry)   # entry.json `reports`(재구축 원천)
    return True


# ---- 24: 여러 문서의 문서 분류 한꺼번에 바꾸기 ----

MAX_BULK = 200


def save_document_types(db: Session, storage: StoragePaths, user, file_ids, document_type: str | None, *,
                        ip: str | None = None) -> dict:
    """고른 문서들의 문서 분류만 한 값으로 바꾼다(모델 연결·다른 값은 그대로). 부분 성공.

    - 건마다 단건 저장과 같은 길(report_file → save)을 거친다 — 권한(올린 사람·LV3)·감사 로그(REPORT_META 건별)·
      entry.json 반영이 단건과 똑같다. 판 확인은 하지 않는다(version=None, 마지막에 저장한 값이 이긴다).
    - 분류 값이 목록에 없거나 건수가 상한(MAX_BULK)을 넘으면 아무것도 바꾸지 않고 422.
    - 볼 수 없거나 없는·휴지통·초안의 문서(404), 고칠 권한이 없는 문서(403)는 건너뛰고 사유를 모은다.
      이미 같은 값이면 'unchanged' 로 건너뛰고 감사 로그를 남기지 않는다. 단 저장된 값 없이 추정(자동)으로 보이던
      .ppt/.pptx 는 같은 값이어도 저장해 확정한다(단건 저장과 같은 규칙 — 화면의 '자동' 표시가 사라진다)."""
    document_type = (document_type or "").strip() or None
    if document_type is not None and document_type not in DOCUMENT_TYPES:
        raise HTTPException(status_code=422, detail="invalid_document_type")
    ids = list(dict.fromkeys(int(i) for i in file_ids or []))   # 중복 제거(처음 순서 유지)
    if not ids:
        raise HTTPException(status_code=422, detail="no_reports_selected")
    if len(ids) > MAX_BULK:
        raise HTTPException(status_code=422, detail="too_many_reports")
    updated, skipped = [], []
    for fid in ids:
        try:
            report, entry = report_file(db, user, fid)
            before, _auto = effective_document_type(meta_of(db, [fid]).get(fid), report.name)
            changed = save(db, storage, user, report, entry, version=None, document_type=document_type,
                           model_ids=None, ip=ip)
        except HTTPException as exc:
            db.rollback()
            skipped.append({"file_id": fid, "reason": str(exc.detail)})
            continue
        if not changed:
            skipped.append({"file_id": fid, "reason": "unchanged"})
            continue
        meta = db.get(models.ReportMeta, fid, populate_existing=True)
        updated.append({"file_id": fid, "before": before, "document_type": document_type or "",
                        "version": meta.version if meta else 0})
    return {"updated": updated, "skipped": skipped}


# ---- 23: 기존 자료 정비 — 저장된 문서 분류가 없는 발표 파일에 추정값을 실제로 저장 ----

FILL_SOURCE = "document-type-fill"


def fill_document_types(db: Session, storage: StoragePaths, *, apply: bool = False) -> dict:
    """확정 자료의 Vault 보고서 중 report_meta 행이 없는 .ppt/.pptx 에 '발표자료'를 저장한다(apply=False 면 목록만).

    - 대상 = 화면에 '자동'으로 보이던 파일과 같다(effective_document_type 의 추정 대상). 행이 있고 문서 분류가 비어 있는
      파일(사용자가 '미분류'로 저장했거나 모델 연결만 저장한 것)은 사람이 정한 상태라 건너뛰고 `kept` 로만 보고한다.
    - 저장은 보고서 화면 저장과 같은 표·감사 동작(REPORT_META, actor system, before 에 추정값)·entry.json 경로를 쓴다.
      자료마다 행 잠금 뒤 다시 확인하므로 그 사이 사용자가 저장한 파일은 덮지 않는다. 다시 돌려도 바뀌는 것이 없다."""
    from .entries.service import _lock, _write_meta_or_queue

    rows = (db.query(models.File, models.Entry, models.ReportMeta)
            .join(models.Entry, models.Entry.id == models.File.entry_id)
            .outerjoin(models.ReportMeta, models.ReportMeta.file_id == models.File.id)
            .filter(models.File.kind == "report", models.File.location == "vault",
                    models.Entry.status == "confirmed")
            .order_by(models.Entry.id, models.File.rel_path).all())
    plan = {"applied": apply, "items": [], "kept": [], "filled": 0}
    todo: dict[int, list[tuple[int, str]]] = defaultdict(list)
    for f, e, meta in rows:
        auto = auto_document_type(f.name)
        if auto is None:
            continue
        if meta is None:
            plan["items"].append({"entry_id": e.entry_id, "report": f.rel_path, "document_type": auto})
            todo[e.id].append((f.id, auto))
        elif not meta.document_type:
            plan["kept"].append({"entry_id": e.entry_id, "report": f.rel_path})
    if not apply:
        return plan
    for entry_pk, files in todo.items():
        entry = _lock(db, db.get(models.Entry, entry_pk))
        if entry.status != "confirmed":
            db.rollback()
            continue
        done = 0
        for fid, auto in files:
            f = db.get(models.File, fid)
            if (f is None or f.entry_id != entry.id or f.location != "vault"
                    or db.get(models.ReportMeta, fid, populate_existing=True) is not None):
                continue   # 그 사이 옮겨졌거나 사람이 저장했다
            db.add(models.ReportMeta(file_id=fid, document_type=auto, version=1, updated_by="system",
                                     updated_at=models._now()))
            db.flush()
            head = {"report": f.rel_path}
            audit.record(db, storage, actor="system", action=META_ACTION, target_type="entry",
                         target_id=entry.entry_id, before=head | {"document_type": None, "document_type_auto": auto},
                         after=head | {"document_type": auto, "source": FILL_SOURCE})
            done += 1
        db.commit()
        if done:
            plan["filled"] += done
            _write_meta_or_queue(db, storage, entry)   # entry.json `reports`(재구축 원천)
    return plan


# ---- entry.json · 재구축 · 영구 삭제 ----

def export_entry(db: Session, entry: models.Entry) -> list[dict]:
    """entry.json `reports` — 이 자료의 보고서 중 문서 분류나 연결이 있는 것. 연결 모델은 자료 번호+상대경로+sha256."""
    reports = db.query(models.File).filter(models.File.entry_id == entry.id, models.File.kind == "report").all()
    if not reports:
        return []
    by_id = {f.id: f for f in reports}
    metas = meta_of(db, by_id)
    links = linked_ids(db, by_id)
    refs: dict[int, dict] = {}
    all_models = {m for v in links.values() for m in v}
    if all_models:
        for fid, rel, sha, eid in (db.query(models.File.id, models.File.rel_path, models.File.sha256,
                                            models.Entry.entry_id)
                                   .join(models.Entry, models.Entry.id == models.File.entry_id)
                                   .filter(models.File.id.in_(all_models))):
            refs[fid] = {"entry_id": eid, "rel_path": rel, "sha256": sha}
    out = []
    for f in sorted(reports, key=lambda x: x.rel_path):
        meta, mids = metas.get(f.id), links.get(f.id, set())
        if meta is None and not mids:
            continue
        out.append({"rel_path": f.rel_path, "sha256": f.sha256,
                    "document_type": meta.document_type if meta else None,
                    "version": meta.version if meta else 1,
                    "updated_by": meta.updated_by if meta else None,
                    "updated_at": meta.updated_at.isoformat() if meta and meta.updated_at else None,
                    "models": sorted((refs[m] for m in mids if m in refs),
                                     key=lambda r: (r["entry_id"], r["rel_path"]))})
    return out


def _find_file(db: Session, entry_code: str, rel_path: str, sha256: str, kind: str | None = None):
    q = (db.query(models.File).join(models.Entry, models.Entry.id == models.File.entry_id)
         .filter(models.Entry.entry_id == entry_code, models.File.rel_path == rel_path,
                 models.File.sha256 == sha256))
    if kind:
        q = q.filter(models.File.kind == kind)
    return q.first()


def restore_reports(db: Session, pending: list[tuple[str, list]]) -> dict:
    """재구축 — 모든 자료를 되살린 뒤 entry.json `reports` 로 보고서 정보·연결을 되살린다.
    pending = [(자료 번호, reports 목록)]. 내용(sha256)이 다른 파일에는 잇지 않는다(대체된 파일이 연결을 물려받지 않게)."""
    out = {"report_meta": 0, "report_links": 0, "report_unresolved": 0}
    for code, reports in pending:
        for r in reports if isinstance(reports, list) else []:
            if not isinstance(r, dict):
                continue
            report = _find_file(db, code, str(r.get("rel_path") or ""), str(r.get("sha256") or ""), "report")
            if report is None:
                out["report_unresolved"] += 1
                continue
            dtype = r.get("document_type") if r.get("document_type") in DOCUMENT_TYPES else None
            if db.get(models.ReportMeta, report.id) is None:
                version = r.get("version") if isinstance(r.get("version"), int) and r["version"] > 0 else 1
                db.add(models.ReportMeta(file_id=report.id, document_type=dtype, version=version,
                                         updated_by=(str(r["updated_by"])[:20] if r.get("updated_by") else None),
                                         updated_at=_dt(r.get("updated_at")) or models._now()))
                out["report_meta"] += 1
            have = linked_ids(db, [report.id]).get(report.id, set())
            for ref in r.get("models") or []:
                if not isinstance(ref, dict):
                    continue
                m = _find_file(db, str(ref.get("entry_id") or ""), str(ref.get("rel_path") or ""),
                               str(ref.get("sha256") or ""), "model")
                if m is None:
                    out["report_unresolved"] += 1
                    continue
                if m.id not in have:
                    db.add(models.ReportModelLink(report_file_id=report.id, model_file_id=m.id))
                    have.add(m.id)
                    out["report_links"] += 1
            db.flush()
    return out


def _dt(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)).replace(microsecond=0)
    except ValueError:
        return None


def purge_files(db: Session, file_ids) -> set[int]:
    """영구 삭제되는 파일들의 보고서 정보·연결을 지운다. 돌려주는 값 = 이 파일(모델)로의 연결을 잃은
    다른 자료의 pk — 호출자가 그 자료의 entry.json 을 다시 써서 재구축 원천을 맞춘다."""
    ids = list(file_ids)
    if not ids:
        return set()
    affected = {pk for (pk,) in (db.query(models.File.entry_id)
                                 .join(models.ReportModelLink,
                                       models.ReportModelLink.report_file_id == models.File.id)
                                 .filter(models.ReportModelLink.model_file_id.in_(ids),
                                         models.File.id.notin_(ids)).distinct())}
    db.query(models.ReportModelLink).filter(
        models.ReportModelLink.report_file_id.in_(ids) | models.ReportModelLink.model_file_id.in_(ids)
    ).delete(synchronize_session=False)
    db.query(models.ReportMeta).filter(models.ReportMeta.file_id.in_(ids)).delete(synchronize_session=False)
    return affected


# ---- 예전 sidecar(report-catalog.json) → DB 이전 ----

def _sidecar_dirs(storage: StoragePaths, entry: models.Entry):
    """자료 폴더 후보 — 확정이면 Vault, 휴지통이면 95_Trash 의 폴더."""
    from .entries.files import entry_dir

    if entry.status == "confirmed" and entry.vault_rel:
        return entry_dir(storage, entry)
    if entry.status == "trashed" and entry.trash_rel:
        return storage.trash / entry.trash_rel
    return None


def _read_sidecar(path) -> dict | None:
    with open(to_long(path), encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict) or not isinstance(data.get("reports"), dict):
        raise ValueError("형식이 다름(reports 없음)")
    return data


def migrate_sidecars(db: Session, storage: StoragePaths, *, apply: bool = False) -> dict:
    """예전 21 초안이 자료 폴더에 남긴 report-catalog.json 을 DB 로 옮긴다(apply=False 면 계획만, 아무것도 바꾸지 않는다).

    - 보고서별 문서 분류·명시 연결 → report_meta·report_model_links(이미 DB 에 정보가 있는 보고서는 건드리지 않는다).
      sha256 이 지금 파일과 다른 행은 옮기지 않는다(그 사이 대체된 파일).
    - 'reference'(공통 참고자료)·'project'(29 — 없앤 독립 프로젝트) 소속만 있는 자료는 호선이 없으면
      '호선 없음(공용)'으로 표시한다(지금은 그 값에서 파생). 프로젝트 이름은 옮기지 않는다.
    - 옮긴 뒤 sidecar 는 지우지 않고 report-catalog.migrated.json 으로 이름만 바꾸고, .lock·임시 파일은 지운다.
    - 감사: 공용은 자료 편집과 같은 경로(update_entry, actor system), 보고서 정보는 REPORT_META/LINKS(system)."""
    from .entries.service import _write_meta_or_queue, update_entry, hulls_of

    plan = {"applied": apply, "entries": [], "conflicts": [], "unreadable": [], "stale": [], "unresolved": [],
            "meta": 0, "links": 0, "no_hull": 0, "renamed": 0}
    entries = (db.query(models.Entry).filter(models.Entry.status.in_(("confirmed", "trashed")))
               .order_by(models.Entry.id).all())
    for e in entries:
        folder = _sidecar_dirs(storage, e)
        if folder is None:
            continue
        path = folder / SIDECAR
        try:
            if not os.path.isfile(to_long(path)):
                continue
        except (OSError, ValueError):
            plan["unreadable"].append({"entry_id": e.entry_id, "reason": "폴더를 읽을 수 없음"})
            continue
        try:
            data = _read_sidecar(path)
        except (OSError, ValueError) as exc:
            plan["unreadable"].append({"entry_id": e.entry_id, "reason": str(exc)[:200]})
            continue
        files = {f.rel_path: f for f in db.query(models.File).filter(models.File.entry_id == e.id,
                                                                    models.File.kind == "report")}
        metas = meta_of(db, [f.id for f in files.values()])
        item = {"entry_id": e.entry_id, "reports": [], "no_hull": False}
        scopes = set()
        for rel, row in sorted(data["reports"].items()):
            if not isinstance(row, dict):
                continue
            f = files.get(rel)
            if f is None or row.get("sha256") != f.sha256:
                plan["stale"].append({"entry_id": e.entry_id, "report": rel})
                continue
            scopes.add(row.get("scope"))
            if f.id in metas or linked_ids(db, [f.id]).get(f.id):
                continue   # 이미 DB 에 정보가 있다(다시 돌린 경우) — 덮지 않는다
            dtype = row.get("document_type") if row.get("document_type") in DOCUMENT_TYPES else None
            model_ids = []
            for ref in row.get("models") or []:
                if not isinstance(ref, dict):
                    continue
                m = _find_file(db, str(ref.get("entry_id") or ""), str(ref.get("rel_path") or ""),
                               str(ref.get("sha256") or ""), "model")
                if m is None:
                    plan["unresolved"].append({"entry_id": e.entry_id, "report": rel, "model": ref})
                else:
                    model_ids.append(m.id)
            if dtype is None and not model_ids:
                continue
            item["reports"].append({"file": f, "rel_path": rel, "document_type": dtype, "model_ids": model_ids,
                                    "row": row})
        if (scopes and scopes <= {"reference", "project"} and not e.no_hull and not hulls_of(db, e)):
            item["no_hull"] = True
        plan["entries"].append({"entry_id": e.entry_id, "no_hull": item["no_hull"],
                                "reports": [{"report": r["rel_path"], "document_type": r["document_type"],
                                             "models": len(r["model_ids"])} for r in item["reports"]]})
        if not apply:
            continue
        patch = {}
        if item["no_hull"]:
            patch["no_hull"] = True
        if patch and e.status == "confirmed":
            update_entry(db, storage, e, None, {"version": e.version, **patch}, system_actor="system")
            plan["no_hull"] += 1 if "no_hull" in patch else 0
            db.expire_all()
            e = db.get(models.Entry, e.id)
        for r in item["reports"]:
            row, f = r["row"], r["file"]
            version = row.get("version") if isinstance(row.get("version"), int) and row["version"] > 0 else 1
            db.add(models.ReportMeta(file_id=f.id, document_type=r["document_type"], version=version,
                                     updated_by=(str(row["updated_by"])[:20] if row.get("updated_by") else None),
                                     updated_at=_dt(row.get("updated_at")) or models._now()))
            for mid in dict.fromkeys(r["model_ids"]):
                db.add(models.ReportModelLink(report_file_id=f.id, model_file_id=mid, created_by="system"))
            db.flush()
            head = {"report": r["rel_path"], "migrated": SIDECAR}
            if r["document_type"]:
                audit.record(db, storage, actor="system", action=META_ACTION, target_type="entry",
                             target_id=e.entry_id, before=head | {"document_type": None},
                             after=head | {"document_type": r["document_type"]})
                plan["meta"] += 1
            if r["model_ids"]:
                audit.record(db, storage, actor="system", action=LINKS_ACTION, target_type="entry",
                             target_id=e.entry_id, before=head | {"models": []},
                             after=head | {"models": _describe(db, r["model_ids"])})
                plan["links"] += len(set(r["model_ids"]))
        db.commit()
        if e.status == "confirmed":
            _write_meta_or_queue(db, storage, e)
        if _retire_sidecar(folder):
            plan["renamed"] += 1
    return plan


def _retire_sidecar(folder) -> bool:
    """sidecar 를 report-catalog.migrated.json 으로 이름만 바꾸고(이미 있으면 시각을 붙인다) .lock·임시 파일을 지운다."""
    src = folder / SIDECAR
    dst = folder / SIDECAR_MIGRATED
    try:
        if os.path.exists(to_long(dst)):
            dst = folder / f"report-catalog.migrated-{datetime.now():%Y%m%d-%H%M%S}.json"
        os.replace(to_long(src), to_long(dst))
    except OSError as exc:
        log.warning("report-catalog.json 이름 바꾸기 실패(DB 이전은 끝남): %s — %s", folder, exc)
        return False
    for name in ("report-catalog.lock",):
        try:
            os.remove(to_long(folder / name))
        except OSError:
            pass
    try:
        for name in os.listdir(to_long(folder)):
            if name.startswith(".report-catalog-") and name.endswith(".tmp"):
                try:
                    os.remove(to_long(folder / name))
                except OSError:
                    pass
    except OSError:
        pass
    return True
