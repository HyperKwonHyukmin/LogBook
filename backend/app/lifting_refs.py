"""50 — 다른 Unit 의 권상 Wire 배치 찾기(WorkBench Module Unit Studio 가 서버 간 API 로 부른다).

계획: WorkBench 저장소 docs/plans/2026-11-04-mu-studio-logbook-wire-reference.md.

- 대상 = 확정된 자료(보관소)의 Wire 모델 파일(lifting.is_wire_model) 중 `as` 사번이 볼 수 있는 것.
  WorkBench 권상 Wire 모델이면 MU·Side Passage 자료라 대상 태그(Unit)로 다시 거르지 않는다 — 태그가 빠진 자료도 찾게.
- 요약은 변환 때 model_summaries.wires 에 쓰고(convert.job), 없으면(50 이전 변환·이름으로만 판별된 파일) 처음
  요청 때 BDF 를 읽어 채운다. 읽었는데 apex 가 없으면 {"none": true} 를 남겨 다시 읽지 않는다.
- 목록에는 평면 선분(planSegments)을 빼고 준다 — 화면이 고른 하나만 상세로 받는다."""
import logging
import os

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import access, lifting, models
from .bdf.deck import DeckReader, DeckTooLarge
from .bdf.model import ModelError, build_model
from .bdf.wires import wire_summary
from .convert.job import DRM_MAGIC, enqueue_convert
from .entries.locate import FileUnavailable, file_path
from .entries.service import target_of
from .storage.paths import StoragePaths, to_long

log = logging.getLogger("logbook.lifting_refs")

MAX_WIRE_BDF_BYTES = 200 * 1024 ** 2   # 권상 BDF 를 요청 중에 읽는 상한(MU 모델은 보통 수 MB)
MAX_LAZY_PER_LIST = 5                  # 목록 한 번에 새로 읽는 BDF 수 — 나머지는 summaryState=pending(다음 요청에 이어 읽음)
LIST_LIMIT_MAX = 200


def _read_summary(db: Session, storage: StoragePaths, f: models.File) -> dict:
    try:
        path = file_path(db, storage, f)
    except FileUnavailable:
        return {"none": True, "reason": "file_missing"}
    try:
        if os.stat(to_long(path)).st_size > MAX_WIRE_BDF_BYTES:
            return {"none": True, "reason": "too_large"}
        with open(to_long(path), "rb") as fh:
            data = fh.read()
    except OSError:
        raise   # 공유 폴더가 잠깐 안 보이는 것 — 남기지 않고 다음에 다시
    if data.startswith(DRM_MAGIC):
        return {"none": True, "reason": "drm"}
    try:
        reader = DeckReader(lambda rel: data, max_bytes=MAX_WIRE_BDF_BYTES)
        cards = reader.read(f.name)
        model = build_model(cards, sol=reader.sol, warnings=reader.warnings)
    except (DeckTooLarge, ModelError) as exc:
        return {"none": True, "reason": type(exc).__name__}
    return wire_summary(model) or {"none": True, "reason": "no_apex"}


def ensure_wires(db: Session, storage: StoragePaths, f: models.File) -> dict | None:
    """그 파일의 요약(없으면 읽어 저장). 읽지 못했으면(공유 폴더 오류) None."""
    row = db.get(models.ModelSummary, f.id)
    if row is not None and row.wires is not None:
        return row.wires
    try:
        summary = _read_summary(db, storage, f)
    except OSError as exc:
        log.warning("Wire 요약 읽기 실패: file=%s — %s", f.id, exc)
        return None
    try:
        if row is None:
            enqueue_convert(db, f)   # 변환된 적 없는 모델 — 행과 변환 작업을 함께 넣는다(행만 두면 queued 로 남는다)
            db.flush()               # 새 행은 flush 해야 get 이 찾는다
            row = db.get(models.ModelSummary, f.id)
        row.wires = summary
        db.commit()
    except IntegrityError:   # 같은 파일을 다른 요청·변환 작업이 먼저 만들었다 — 그쪽 값을 쓴다
        db.rollback()
        row = db.get(models.ModelSummary, f.id)
        return row.wires if row is not None and row.wires is not None else summary
    return summary


def _candidate_ids(db: Session, user, q: str | None, hull: str | None) -> list[tuple[int, int]]:
    """(file id, entry id) — 작은 칸만 골라 정렬한다. JSON·TEXT(요약·지문·설명)를 실은 채 ORDER BY 하면
    MySQL 정렬 버퍼가 넘친다(1038, WorkBench v1.5.8 과 같은 유형)."""
    E, F, S = models.Entry, models.File, models.ModelSummary
    query = (db.query(F.id, E.id).join(E, F.entry_id == E.id).outerjoin(S, S.file_id == F.id)
             .filter(E.status == "confirmed", F.location == "vault", F.kind == "model",
                     access.visible_entries_filter(user),
                     or_(S.lifting.is_(True), func.lower(F.name).like(f"%{lifting.NAME_SUFFIX}.%"))))
    if hull:
        query = query.filter(E.id.in_(db.query(models.EntryHull.entry_id).filter(models.EntryHull.hull_no == hull)))
    if q:
        like = f"%{q.strip().lower()}%"
        query = query.filter(or_(func.lower(F.name).like(like), func.lower(E.title).like(like)))
    return [(fid, eid) for fid, eid in query.order_by(E.confirmed_at.desc(), F.id.desc()).all()]


def _candidates(db: Session, user, q: str | None, hull: str | None):
    ids = _candidate_ids(db, user, q, hull)
    if not ids:
        return []
    fids = [fid for fid, _ in ids]
    files = {f.id: f for f in db.query(models.File).filter(models.File.id.in_(fids))}
    entries = {e.id: e for e in db.query(models.Entry).filter(models.Entry.id.in_({eid for _, eid in ids}))}
    rows = {r.file_id: r for r in db.query(models.ModelSummary).filter(models.ModelSummary.file_id.in_(fids))}
    out = []
    for fid, eid in ids:
        f, s = files[fid], rows.get(fid)
        if lifting.is_wire_model(f, s):
            out.append((f, entries[eid], s))
    return out


def _hulls(db: Session, entry: models.Entry) -> list[str]:
    rows = (db.query(models.EntryHull.hull_no).filter_by(entry_id=entry.id)
            .order_by(models.EntryHull.is_primary.desc(), models.EntryHull.hull_no).all())
    return [h for (h,) in rows]


def _item(db: Session, f: models.File, e: models.Entry, summary: dict | None, *, full: bool) -> dict:
    state = "pending" if summary is None else ("none" if summary.get("none") else "done")
    body = None
    if state == "done":
        body = summary if full else {k: v for k, v in summary.items() if k != "planSegments"}
    return {"fileId": f.id, "name": f.name, "entryId": e.entry_id, "title": e.title,
            "hullNos": _hulls(db, e), "target": target_of(db, e),
            "confirmedAt": e.confirmed_at.isoformat() if e.confirmed_at else None,
            "summaryState": state, "summary": body}


def list_refs(db: Session, storage: StoragePaths, user, *, q: str | None = None, hull: str | None = None,
              limit: int = 50, offset: int = 0) -> dict:
    """요약을 읽을 수 있는 것만 센다 — apex 를 못 찾은 파일(none)은 목록에서 뺀다."""
    limit = max(1, min(limit, LIST_LIMIT_MAX))
    items, lazy = [], 0
    for f, e, s in _candidates(db, user, q, hull):
        summary = s.wires if s is not None else None
        if summary is None and lazy < MAX_LAZY_PER_LIST:
            lazy += 1
            summary = ensure_wires(db, storage, f)
        if summary is not None and summary.get("none"):
            continue
        items.append((f, e, summary))
    page = items[offset:offset + limit]
    return {"total": len(items), "items": [_item(db, f, e, s, full=False) for f, e, s in page]}


def detail(db: Session, storage: StoragePaths, f: models.File) -> dict | None:
    """한 파일의 전체 요약(평면 선분 포함) — 권한은 부르는 쪽(files._file)이 본다.
    Wire 모델이 아니거나 apex 가 없으면 None."""
    e = db.get(models.Entry, f.entry_id) if f.entry_id else None
    s = db.get(models.ModelSummary, f.id)
    # 목록과 같은 대상만 — 확정 전(정리 대기) 자료는 id 를 알아도 주지 않는다
    if e is None or e.status != "confirmed" or f.location != "vault" or not lifting.is_wire_model(f, s):
        return None
    summary = ensure_wires(db, storage, f)
    if summary is None or summary.get("none"):
        return None
    return _item(db, f, e, summary, full=True)
