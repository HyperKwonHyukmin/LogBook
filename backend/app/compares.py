"""최근 비교(11) — 사용자별로 /compare 를 연 기록. 비교 화면이 2개 이상 모델로 열릴 때 남긴다."""
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import access, models

KEEP = 20          # 사용자당 남기는 최근 비교 수
MAX_IDS = 4        # 비교 화면 최대 칸 수(화면 BASKET_MAX 와 같다)


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def ids_key(ids: list[int]) -> str:
    return ",".join(str(i) for i in sorted(ids))


def clean_ids(raw) -> list[int]:
    """[12, '34', 12, -1, 'x'] → [12, 34] — 양의 정수만, 중복 없이, 순서 유지, 최대 MAX_IDS 개."""
    out: list[int] = []
    for v in raw if isinstance(raw, list) else []:
        if isinstance(v, bool):
            continue
        try:
            n = int(v)
        except (TypeError, ValueError):
            continue
        if n > 0 and n not in out:
            out.append(n)
        if len(out) >= MAX_IDS:
            break
    return out


def _visible_files(db: Session, viewer, ids) -> set[int]:
    """파일 id 중 viewer 가 볼 수 있는 것(그 파일이 든 Entry 를 볼 수 있음, 13). viewer 가 None 이면 거르지 않는다."""
    ids = list(ids)
    if not ids or viewer is None or access.is_admin(viewer):
        return set(ids)
    F, E = models.File, models.Entry
    return {i for (i,) in db.query(F.id).join(E, E.id == F.entry_id)
            .filter(F.id.in_(ids), access.visible_entries_filter(viewer))}


def record(db: Session, employee_id: str, raw_ids, viewer=None) -> models.CompareHistory:
    """비교를 열었다고 남긴다. 같은 묶음(순서 무관)이면 그 행을 고치고, 아니면 새로 넣는다.

    지금 있는 BDF(모델) 파일 중 viewer 가 볼 수 있는 것만 센다(13) — 둘보다 적으면 422 too_few_models."""
    ids = clean_ids(raw_ids)
    found = {i for (i,) in db.query(models.File.id).filter(models.File.id.in_(ids or [0]), models.File.kind == "model")}
    found &= _visible_files(db, viewer, found)
    ids = [i for i in ids if i in found]
    if len(ids) < 2:
        raise HTTPException(status_code=422, detail="too_few_models")
    key = ids_key(ids)
    now = _now()
    row = db.query(models.CompareHistory).filter_by(employee_id=employee_id, ids_key=key).first()
    if row is None:
        row = models.CompareHistory(employee_id=employee_id, file_ids=ids, ids_key=key, open_count=1,
                                    created_at=now, last_opened_at=now)
        db.add(row)
        try:
            db.commit()
        except IntegrityError:   # 두 탭이 같은 묶음을 동시에 열었다 — 먼저 들어간 행을 고친다
            db.rollback()
            row = db.query(models.CompareHistory).filter_by(employee_id=employee_id, ids_key=key).one()
            _touch(row, ids, now)
            db.commit()
    else:
        _touch(row, ids, now)
        db.commit()
    _trim(db, employee_id)
    return row


def _touch(row: models.CompareHistory, ids: list[int], now: datetime) -> None:
    row.file_ids = ids                        # 순서는 마지막에 연 순서로
    row.open_count = (row.open_count or 0) + 1
    row.last_opened_at = now


def _trim(db: Session, employee_id: str) -> None:
    """최근 KEEP 개만 남긴다."""
    old = [i for (i,) in db.query(models.CompareHistory.id).filter_by(employee_id=employee_id)
           .order_by(models.CompareHistory.last_opened_at.desc(), models.CompareHistory.id.desc()).offset(KEEP)]
    if old:
        db.query(models.CompareHistory).filter(models.CompareHistory.id.in_(old)).delete(synchronize_session=False)
        db.commit()


def _note(kind: str, location: str, entry_status: str | None, state: str | None, key: str | None) -> str | None:
    """모델을 지금 열 수 있는가 — 열 수 있으면 None, 아니면 사유(화면이 짧은 안내로 바꾼다)."""
    if location == "trash" or entry_status == "trashed":
        return "trashed"            # 휴지통 — 복원하기 전에는 열 수 없다
    if kind != "model":
        return "not_model"
    if state == "done" or (key and state != "failed"):
        return None
    if state == "failed":
        return "failed"             # 변환 실패 — 그 칸은 오류를 보인다
    return "pending"                # 아직 변환 전(또는 변환 중)


def _file_infos(db: Session, ids: set[int]) -> dict[int, dict]:
    """파일 id → 화면에 보일 정보(이름·Entry·대표 호선·모델 상태·썸네일 key). 질의 2번으로 묶어 읽는다."""
    if not ids:
        return {}
    F, E, M = models.File, models.Entry, models.ModelSummary
    rows = (db.query(F.id, F.name, F.kind, F.location, E.id, E.entry_id, E.title, E.status, M.state, M.key)
            .outerjoin(E, E.id == F.entry_id).outerjoin(M, M.file_id == F.id).filter(F.id.in_(list(ids))))
    out: dict[int, dict] = {}
    entry_of: dict[int, int] = {}
    for fid, name, kind, loc, epk, eid, title, estatus, mstate, mkey in rows:
        note = _note(kind, loc, estatus, mstate, mkey)
        out[fid] = {"id": fid, "name": name, "entry_id": eid, "entry_title": title, "entry_status": estatus,
                    "hull": "", "model_state": mstate, "model_key": mkey, "available": note is None, "note": note}
        if epk:
            entry_of[fid] = epk
    if entry_of:
        hulls: dict[int, str] = {}
        for epk, hull in (db.query(models.EntryHull.entry_id, models.EntryHull.hull_no)
                          .filter(models.EntryHull.entry_id.in_(set(entry_of.values())))
                          .order_by(models.EntryHull.is_primary.desc(), models.EntryHull.hull_no)):
            hulls.setdefault(epk, hull)
        for fid, epk in entry_of.items():
            out[fid]["hull"] = hulls.get(epk, "")
    return out


def list_recent(db: Session, employee_id: str, limit: int = KEEP, viewer=None) -> list[dict]:
    """내 최근 비교 — 마지막에 연 순서. 영구 삭제된 파일은 빼고(행도 고친다), 둘보다 적게 남으면 행을 지운다.

    13 — viewer 가 지금 볼 수 없는 파일은 응답에서만 뺀다(행은 고치지 않는다 — 다시 볼 수 있게 되면 돌아온다).
    보이는 모델이 둘보다 적으면 그 기록은 목록에서 뺀다. dropped 는 영구 삭제로 빠진 수만 센다(숨은 수는 알리지 않는다)."""
    rows = (db.query(models.CompareHistory).filter_by(employee_id=employee_id)
            .order_by(models.CompareHistory.last_opened_at.desc(), models.CompareHistory.id.desc()).limit(limit).all())
    infos = _file_infos(db, {i for r in rows for i in clean_ids(r.file_ids)})
    seen = _visible_files(db, viewer, infos)
    out, changed = [], False
    for r in rows:
        ids = clean_ids(r.file_ids)
        alive = [i for i in ids if i in infos]
        if len(alive) < 2:
            db.delete(r)
            changed = True
            continue
        if alive != ids:
            r.file_ids = alive
            r.ids_key = ids_key(alive)
            changed = True
        shown = [i for i in alive if i in seen]
        if len(shown) < 2:
            continue
        out.append({"id": r.id, "file_ids": shown, "open_count": r.open_count,
                    "created_at": r.created_at.isoformat(), "last_opened_at": r.last_opened_at.isoformat(),
                    "dropped": len(ids) - len(alive), "files": [infos[i] for i in shown]})
    if changed:
        try:
            db.commit()
        except IntegrityError:
            # 빠진 뒤의 묶음이 이미 다른 행으로 있다(같은 묶음 두 행) — 이번에는 고치지 않는다
            db.rollback()
    return out


def remove(db: Session, employee_id: str, history_id: int) -> None:
    n = (db.query(models.CompareHistory).filter_by(id=history_id, employee_id=employee_id)
         .delete(synchronize_session=False))
    db.commit()
    if not n:
        raise HTTPException(status_code=404, detail="compare_not_found")


def clear(db: Session, employee_id: str) -> int:
    n = db.query(models.CompareHistory).filter_by(employee_id=employee_id).delete(synchronize_session=False)
    db.commit()
    return n
