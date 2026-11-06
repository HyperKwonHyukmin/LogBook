"""50 — 다른 Unit 의 권상 Wire 배치 찾기(WorkBench Module Unit Studio 가 서버 간 API 로 부른다).

계획: WorkBench 저장소 docs/plans/2026-11-04-mu-studio-logbook-wire-reference.md.

- 대상 = 확정된 자료(보관소)의 Wire 모델 파일(lifting.is_wire_model) 중 `as` 사번이 볼 수 있는 것.
  WorkBench 권상 Wire 모델이면 MU·Side Passage 자료라 대상 태그(Unit)로 다시 거르지 않는다 — 태그가 빠진 자료도 찾게.
- 요약은 변환 때 model_summaries.wires 에 쓰고(convert.job), 없으면(50 이전 변환·이름으로만 판별된 파일) 처음
  요청 때 BDF 를 읽어 채운다. 읽었는데 apex 가 없으면 {"none": true} 를 남겨 다시 읽지 않는다.
- 목록에는 평면·3D 선분(planSegments·segments3d)을 빼고 준다 — 화면이 고른 하나만 상세로 받는다.
- 요약 형식이 바뀌면(wires.SCHEMA_VERSION) 옛 요약을 상세 요청 때(목록은 한 번에 MAX_LAZY_PER_LIST 개까지) 다시 만든다."""
import json
import logging
import os

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import access, lifting, models
from .bdf.deck import DeckReader, DeckTooLarge
from .bdf.model import ModelError, build_model
from .bdf.wires import SCHEMA_VERSION, wire_summary
from .convert.job import DRM_MAGIC, enqueue_convert
from .entries.locate import FileUnavailable, file_path
from .entries.service import target_of
from .search.mysql_backend import _like
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


def is_stale(summary: dict | None) -> bool:
    """요약 형식이 지금 버전보다 옛것인가(예: 3D 선분 이전). apex 없음(none)은 형식과 무관해 다시 읽지 않는다."""
    return bool(summary) and not summary.get("none") and summary.get("schemaVersion") != SCHEMA_VERSION


def ensure_wires(db: Session, storage: StoragePaths, f: models.File) -> dict | None:
    """그 파일의 요약(없거나 옛 형식이면 읽어 저장). 읽지 못했으면(공유 폴더 오류) 옛 요약 또는 None."""
    row = db.get(models.ModelSummary, f.id)
    if row is not None and row.wires is not None and not is_stale(row.wires):
        return row.wires
    old = row.wires if row is not None else None
    try:
        summary = _read_summary(db, storage, f)
    except OSError as exc:
        log.warning("Wire 요약 읽기 실패: file=%s — %s", f.id, exc)
        return old
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
        like = _like(q.strip().lower())   # _·% 는 글자 그대로(검색과 같은 escape)
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


# ---- 59 — 실적의 구조 해석 결과(WorkBench 가 Wire 모델과 함께 보낸 세트) ----
# WorkBench 관리자 보내기가 권상 해석이면 `<stem>_lifting.bdf` 옆에 결과 JSON · 해석에 쓴 모델 JSON · F06 을 함께 권한다
# (WorkBench docs/plans/2026-11-06-mu-lifting-reference-stress-check.md). Studio 는 결과 JSON + 모델 JSON 으로
# 'Unit 구조 해석 결과 화면' 을 그린다(BDF·F06 은 못 읽는다). 짝 = 같은 자료 · 같은 폴더 · 같은 stem(대소문자 무시 —
# Nastran 은 F06 을 소문자로 쓴다). 모델 JSON 은 `<stem>_edited.json`, 없으면 `<stem>.json`(WorkBench 해석과 같은 우선순위).
WIRE_SUFFIX = "_lifting.bdf"
RESULT_SUFFIX = "_lifting_nastranresult.json"
MAX_RESULT_JSON_BYTES = 100 * 1024 ** 2


def _stem(f: models.File) -> str | None:
    name = (f.name or "").lower()
    return name[: -len(WIRE_SUFFIX)] if name.endswith(WIRE_SUFFIX) else None


def _pick_result(f: models.File, siblings: list[models.File]) -> dict | None:
    """같은 자료의 파일들 중 f 와 같은 폴더·같은 stem 의 결과 세트. 결과·모델 JSON 이 없으면 None."""
    stem = _stem(f)
    if stem is None:
        return None
    folder = os.path.dirname((f.rel_path or "").replace("\\", "/")).lower()
    by_name = {}
    for s in siblings:
        rel = (s.rel_path or "").replace("\\", "/").lower()
        if s.location == f.location and os.path.dirname(rel) == folder:
            by_name[os.path.basename(rel)] = s
    result = by_name.get(stem + RESULT_SUFFIX)
    model = by_name.get(stem + "_edited.json") or by_name.get(stem + ".json")
    if result is None or model is None:
        return None
    return {"result": result, "model": model, "f06": by_name.get(stem + "_lifting.f06")}


def result_files(db: Session, f: models.File) -> dict | None:
    """Wire 모델 옆의 결과 세트 → {"result": File, "model": File, "f06": File | None}. 결과·모델 JSON 이 없으면 None."""
    if _stem(f) is None or not f.entry_id:
        return None
    return _pick_result(f, db.query(models.File).filter(models.File.entry_id == f.entry_id).all())


def has_result_map(db: Session, files: list[models.File]) -> dict[int, bool]:
    """목록용 — 여러 Wire 모델의 '결과 있음' 을 자료 파일 한 번 조회로(항목마다 쿼리하지 않게)."""
    entry_ids = {f.entry_id for f in files if f.entry_id and _stem(f) is not None}
    by_entry: dict[int, list[models.File]] = {}
    if entry_ids:
        for s in db.query(models.File).filter(models.File.entry_id.in_(entry_ids)):
            by_entry.setdefault(s.entry_id, []).append(s)
    return {f.id: _pick_result(f, by_entry.get(f.entry_id, [])) is not None for f in files}


class ResultUnavailable(Exception):
    """결과 세트를 읽지 못함 — code 는 화면이 사유를 고를 때 쓴다(file_missing · too_large · drm · bad_json)."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _read_json(db: Session, storage: StoragePaths, f: models.File):
    try:
        path = file_path(db, storage, f)
    except FileUnavailable:
        raise ResultUnavailable("file_missing")
    if os.stat(to_long(path)).st_size > MAX_RESULT_JSON_BYTES:
        raise ResultUnavailable("too_large")
    with open(to_long(path), "rb") as fh:
        data = fh.read()
    if data.startswith(DRM_MAGIC):
        raise ResultUnavailable("drm")
    try:
        body = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError):
        raise ResultUnavailable("bad_json")
    if not isinstance(body, dict):
        raise ResultUnavailable("bad_json")
    return body


def _file_ref(f: models.File | None) -> dict | None:
    return None if f is None else {"fileId": f.id, "name": f.name, "size": f.size, "sha256": f.sha256}


def result_bundle(db: Session, storage: StoragePaths, f: models.File) -> dict | None:
    """Studio 결과 화면용 — 결과 JSON·모델 JSON 내용 + 세 파일 정보. 결과 세트가 없으면 None.
    권한·대상(확정된 Wire 모델)은 부르는 쪽이 detail 과 같은 기준으로 본다. 읽기 실패는 ResultUnavailable·OSError."""
    files = result_files(db, f)
    if files is None:
        return None
    return {"fileId": f.id, "name": f.name,
            "files": {k: _file_ref(v) for k, v in files.items()},
            "result": _read_json(db, storage, files["result"]),
            "model": _read_json(db, storage, files["model"])}


def is_reference(db: Session, f: models.File) -> bool:
    """목록·상세와 같은 대상인가 — 확정된 자료(보관소)의 Wire 모델."""
    e = db.get(models.Entry, f.entry_id) if f.entry_id else None
    return (e is not None and e.status == "confirmed" and f.location == "vault"
            and lifting.is_wire_model(f, db.get(models.ModelSummary, f.id)))


def _item(db: Session, f: models.File, e: models.Entry, summary: dict | None, *, full: bool,
          has_result: bool | None = None) -> dict:
    state = "pending" if summary is None else ("none" if summary.get("none") else "done")
    body = None
    if state == "done":
        body = summary if full else {k: v for k, v in summary.items() if k not in ("planSegments", "segments3d")}
    return {"fileId": f.id, "name": f.name, "entryId": e.entry_id, "title": e.title,
            "hullNos": _hulls(db, e), "target": target_of(db, e),
            "confirmedAt": e.confirmed_at.isoformat() if e.confirmed_at else None,
            "summaryState": state, "summary": body,
            "hasResult": (result_files(db, f) is not None) if has_result is None else has_result}


def list_refs(db: Session, storage: StoragePaths, user, *, q: str | None = None, hull: str | None = None,
              limit: int = 50, offset: int = 0) -> dict:
    """요약을 읽을 수 있는 것만 센다 — apex 를 못 찾은 파일(none)은 목록에서 뺀다."""
    limit = max(1, min(limit, LIST_LIMIT_MAX))
    items, lazy = [], 0
    for f, e, s in _candidates(db, user, q, hull):
        summary = s.wires if s is not None else None
        if (summary is None or is_stale(summary)) and lazy < MAX_LAZY_PER_LIST:
            lazy += 1
            summary = ensure_wires(db, storage, f)
        if summary is not None and summary.get("none"):
            continue
        items.append((f, e, summary))
    page = items[offset:offset + limit]
    flags = has_result_map(db, [f for f, _e, _s in page])
    return {"total": len(items), "items": [_item(db, f, e, s, full=False, has_result=flags[f.id]) for f, e, s in page]}


def detail(db: Session, storage: StoragePaths, f: models.File) -> dict | None:
    """한 파일의 전체 요약(평면 선분 포함) — 권한은 부르는 쪽(files._file)이 본다.
    Wire 모델이 아니거나 apex 가 없으면 None."""
    # 목록과 같은 대상만 — 확정 전(정리 대기) 자료는 id 를 알아도 주지 않는다
    if not is_reference(db, f):
        return None
    e = db.get(models.Entry, f.entry_id)
    summary = ensure_wires(db, storage, f)
    if summary is None or summary.get("none"):
        return None
    return _item(db, f, e, summary, full=True)
