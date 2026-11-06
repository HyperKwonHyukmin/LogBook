"""58 — 파일명이 같은 보고서·엑셀·모델 찾기와 정리(관리 › 자료 정비 › 중복 파일).

이름(대소문자 무시)이 같은 파일이 서로 다른 자료 2건 이상에 있으면 한 묶음으로 보인다.
- 대상 자료: 확정(confirmed)·정리 대기(draft). 휴지통·뺀 파일은 보지 않는다.
- 종류: 보고서(pdf·ppt·doc 등) · 엑셀(xls·xlsx·xlsm·csv) · 모델(BDF 류 + Abaqus .inp).
- 묶음마다 내용까지 같은지(sha256 모두 같음)를 표시한다 — 이름만 같고 내용이 다르면 판이 다른 자료일 수 있다.
- 남길 것 추천: 확정 자료 먼저, 그다음 먼저 올린 것.
- 모델 묶음은 변환 때 저장한 서명(12)·카드 개수로 '남길 것' 과 비교한다(model_compare) — 형상·속성·재료·하중이
  모두 같으면 '모델 내용 같음'(주석·줄 형식만 다름, 17 의 완전 동일 BDF 와 같은 기준). 보고서·엑셀은 비교하지 않는다.

정리(resolve)는 기존 경로만 쓴다(감사 기록·entry.json·되돌리기가 그대로 남는다):
    자료에 다른 파일이 있으면 그 파일만 뺀다(service.remove_files, 37 — 휴지통 폴더, 확정 자료는 되돌리기 가능).
    그 파일이 자료의 마지막 파일이면 자료를 휴지통으로(service.trash — 복원 가능).
영구 삭제는 하지 않는다."""
import os
from collections import defaultdict

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..bdf.signature import VERSION as SIG_VERSION
from ..storage.paths import StoragePaths
from . import naming

CATEGORY_EXTS = {
    "report": (".pdf", ".ppt", ".pptx", ".doc", ".docx", ".hwp", ".hwpx"),
    "excel": (".xls", ".xlsx", ".xlsm", ".csv"),
    "model": (".bdf", ".dat", ".nas", ".blk", ".inp"),
}
CATEGORY_LABELS = {"report": "보고서", "excel": "엑셀", "model": "모델"}
MAX_LIMIT = 500
MAX_RESOLVE = 200
_STATES = ("confirmed", "draft")
SIG_KINDS = ("geometry", "property", "material", "load")
SIG_LABELS = {"geometry": "형상", "property": "속성", "material": "재료", "load": "하중"}


def _sig(row) -> dict | None:
    """비교할 수 있는 서명(현재 규칙 버전, 요소 있음)만. 없으면 None."""
    if row is None or row.sig_version != SIG_VERSION or not row.sig_geometry:
        return None
    return {k: getattr(row, f"sig_{k}") for k in SIG_KINDS}


def model_compare(base, other) -> dict | None:
    """모델 파일 둘(ModelSummary)을 비교 — 범주별 같음/다름과 카드 개수 차(other - base). 서명이 없으면 None."""
    a, b = _sig(base), _sig(other)
    if a is None or b is None:
        return None
    ca, cb = base.counts or {}, other.counts or {}
    counts = {k: (cb.get(k) or 0) - (ca.get(k) or 0) for k in sorted(set(ca) | set(cb))
              if (cb.get(k) or 0) != (ca.get(k) or 0)}
    diff = [k for k in SIG_KINDS if a[k] != b[k]]
    return {"same_model": not diff, "diff": diff, "same": [k for k in SIG_KINDS if k not in diff],
            "counts": counts}


def category_of(name: str) -> str | None:
    ext = os.path.splitext(name or "")[1].lower()
    for cat, exts in CATEGORY_EXTS.items():
        if ext in exts:
            return cat
    return None


def _groups(db: Session) -> list[dict]:
    """파일명별 묶음(서로 다른 자료 2건 이상). 질의 3번 — 파일·자료·사람 이름."""
    rows = (db.query(models.File, models.Entry)
            .join(models.Entry, models.Entry.id == models.File.entry_id)
            .filter(models.Entry.status.in_(_STATES), models.File.location != "trash")
            .order_by(models.File.id).all())
    by_name: dict[str, list] = defaultdict(list)
    for f, e in rows:
        if category_of(f.name):
            by_name[f.name.strip().lower()].append((f, e))
    # 자료마다 남은 파일 수(마지막 파일이면 자료째 휴지통)
    counts: dict[int, int] = defaultdict(int, db.query(models.File.entry_id, func.count(models.File.id))
                                         .filter(models.File.entry_id.isnot(None))
                                         .group_by(models.File.entry_id).all())
    model_ids = [f.id for items in by_name.values() for f, _ in items if category_of(f.name) == "model"]
    summaries = {r.file_id: r for r in db.query(models.ModelSummary)
                 .filter(models.ModelSummary.file_id.in_(model_ids or [0]))} if model_ids else {}
    groups = []
    for key, items in by_name.items():
        if len({e.id for _, e in items}) < 2:
            continue
        # 남길 것 추천 — 확정 먼저, 그다음 먼저 올린 자료
        items.sort(key=lambda x: (x[1].status != "confirmed", x[1].created_at, x[1].id, x[0].id))
        shas = {f.sha256 for f, _ in items}
        cat = category_of(items[0][0].name)
        base = summaries.get(items[0][0].id)
        compares = [None] + [model_compare(base, summaries.get(f.id)) if cat == "model" else None
                             for f, _ in items[1:]]
        same_content = len(shas) == 1
        # 바이트는 다르지만 모델 서명이 모두 같다 — 주석·줄 형식만 다른 같은 모델
        same_model = (not same_content and cat == "model"
                      and all(c is not None and c["same_model"] for c in compares[1:]))
        groups.append({
            "key": key, "name": items[0][0].name, "category": cat,
            "same_content": same_content, "same_model": same_model,
            "files": [{"file_id": f.id, "name": f.name, "rel_path": f.rel_path, "size": f.size, "sha256": f.sha256,
                       "entry_id": e.entry_id, "title": e.title, "status": e.status, "version": e.version,
                       "uploaded_by": e.uploaded_by,
                       "created_at": e.created_at.isoformat() if e.created_at else None,
                       "entry_file_count": counts[e.id], "keep": i == 0, "compare": compares[i],
                       "counts": (summaries[f.id].counts if f.id in summaries else None)}
                      for i, (f, e) in enumerate(items)],
        })
    groups.sort(key=lambda g: (not _same(g), -len(g["files"]), g["key"]))
    return groups


def _same(g: dict) -> bool:
    """정리해도 되는 묶음 — 바이트가 같거나, 모델 서명이 모두 같다('내용도 같음' 거르기에 함께 든다)."""
    return g["same_content"] or g["same_model"]


def duplicate_list(db: Session, *, category: str | None = None, same: str | None = None,
                   q: str | None = None, offset: int = 0, limit: int = 100) -> dict:
    """파일명이 같은 묶음 — category(report|excel|model)·same(content: 내용도 같음(모델 서명 같음 포함) | name: 이름만 같음)·q."""
    groups = _groups(db)
    counts = {c: sum(1 for g in groups if g["category"] == c) for c in CATEGORY_EXTS}
    all_count = len(groups)
    if category in CATEGORY_EXTS:
        groups = [g for g in groups if g["category"] == category]
    same_counts = {"content": sum(1 for g in groups if _same(g)),
                   "name": sum(1 for g in groups if not _same(g))}
    if same == "content":
        groups = [g for g in groups if _same(g)]
    elif same == "name":
        groups = [g for g in groups if not _same(g)]
    if q and q.strip():
        k = naming.key(q)
        groups = [g for g in groups if k in naming.key(g["name"])
                  or any(k in naming.key(f["entry_id"]) or k in naming.key(f["title"]) for f in g["files"])]
    total = len(groups)
    page = groups[max(0, offset): max(0, offset) + max(1, min(limit, MAX_LIMIT))]
    ids = {f["uploaded_by"] for g in page for f in g["files"] if f["uploaded_by"]}
    names = dict(db.query(models.User.employee_id, models.User.name)
                 .filter(models.User.employee_id.in_(ids))) if ids else {}
    for g in page:
        for f in g["files"]:
            f["uploader_name"] = names.get(f["uploaded_by"])
    return {"total": total, "all": all_count, "counts": counts, "same_counts": same_counts, "items": page}


def resolve(db: Session, storage: StoragePaths, file_ids: list[int], *, user: models.User,
            ip: str | None = None) -> dict:
    """고른 파일을 정리한다 — 자료에 다른 파일이 남으면 그 파일만 빼고, 마지막 파일이면 자료를 휴지통으로.
    같은 자료의 파일은 한 번에 뺀다. 자료별로 따로 처리해 하나가 실패해도 나머지는 진행한다."""
    from . import service

    ids = list(dict.fromkeys(int(i) for i in file_ids))[:MAX_RESOLVE]
    files = db.query(models.File).filter(models.File.id.in_(ids or [0])).all()
    found = {f.id for f in files}
    results = [{"file_id": i, "status": "skipped", "reason": "file_not_found"} for i in ids if i not in found]
    by_entry: dict[int, list[models.File]] = defaultdict(list)
    for f in files:
        if f.entry_id is None or f.location == "trash":
            results.append({"file_id": f.id, "status": "skipped", "reason": "already_removed"})
        else:
            by_entry[f.entry_id].append(f)
    for eid, fs in by_entry.items():
        entry = db.get(models.Entry, eid)
        fids = [f.id for f in fs]
        try:
            if entry is None or entry.status not in _STATES:
                raise HTTPException(status_code=409, detail="entry_not_active")
            left = db.query(models.File.id).filter(models.File.entry_id == eid, ~models.File.id.in_(fids)).count()
            if left == 0:
                service.trash(db, storage, entry, user, ip)
                action = "entry_trashed"
            else:
                service.remove_files(db, storage, entry, user, fids, None, ip)
                action = "file_removed"
            results += [{"file_id": i, "status": action, "entry_id": entry.entry_id} for i in fids]
        except HTTPException as exc:
            db.rollback()
            results += [{"file_id": i, "status": "skipped", "reason": str(exc.detail),
                         "entry_id": entry.entry_id if entry else None} for i in fids]
    done = sum(1 for r in results if r["status"] != "skipped")
    return {"done": done, "skipped": len(results) - done, "results": results}
