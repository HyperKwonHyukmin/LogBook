"""호선 화면용 조회·수정(설계 §6.1 `/h/{hull}` — 통계·월별 타임라인·구역 분포·참여자)."""
from collections import Counter, defaultdict

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from . import audit, jobs, models
from .entries.service import HULL_PATTERN
from .storage.paths import StoragePaths


def _month(e: models.Entry) -> str:
    if e.analysis_period:
        return e.analysis_period
    return f"{(e.confirmed_at or e.created_at):%Y-%m}"


def _confirmed_entries(db: Session, hull_no: str) -> list[models.Entry]:
    return (db.query(models.Entry).join(models.EntryHull, models.EntryHull.entry_id == models.Entry.id)
            .filter(models.EntryHull.hull_no == hull_no, models.Entry.status == "confirmed")
            .order_by(models.Entry.confirmed_at.desc(), models.Entry.id.desc()).all())


def list_hulls(db: Session, q: str = "") -> list[dict]:
    rows = (db.query(models.EntryHull.hull_no, func.count(models.Entry.id), func.max(models.Entry.confirmed_at))
            .join(models.Entry, models.Entry.id == models.EntryHull.entry_id)
            .filter(models.Entry.status == "confirmed")
            .group_by(models.EntryHull.hull_no))
    if q:
        rows = rows.filter(models.EntryHull.hull_no.like(f"{q.strip()}%"))
    ships = dict(db.query(models.Hull.hull_no, models.Hull.ship_type))
    out = [{"hull_no": h, "ship_type": ships.get(h), "entries": n, "last_at": last.isoformat() if last else None}
           for h, n, last in rows]
    return sorted(out, key=lambda r: (r["last_at"] or "", r["hull_no"]), reverse=True)[:500]


def hull_detail(db: Session, hull_no: str) -> dict:
    hull = db.get(models.Hull, hull_no)
    entries = _confirmed_entries(db, hull_no)
    drafts = (db.query(models.Entry.id).join(models.EntryHull, models.EntryHull.entry_id == models.Entry.id)
              .filter(models.EntryHull.hull_no == hull_no, models.Entry.status == "draft").count())
    if hull is None and not entries and not drafts:
        raise HTTPException(status_code=404, detail="hull_not_found")

    ids = [e.id for e in entries]
    kinds_by_entry: dict[int, set] = defaultdict(set)
    kinds = Counter()
    files = 0
    if ids:
        for eid, kind in (db.query(models.File.entry_id, models.File.kind)
                          .filter(models.File.entry_id.in_(ids), models.File.location != "trash")):
            kinds_by_entry[eid].add(kind)
            kinds[kind] += 1
            files += 1
    # 구역 태그는 Entry 마다 묻지 않고 한 번에 읽는다(N+1 방지). 값 순서는 tags_of 와 같다.
    zones_by_entry: dict[int, list[str]] = defaultdict(list)
    if ids:
        for eid, value in (db.query(models.EntryTag.entry_id, models.Tag.value)
                           .join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
                           .filter(models.EntryTag.entry_id.in_(ids), models.Tag.kind == "zone")
                           .order_by(models.Tag.value)):
            zones_by_entry[eid].append(value)
    zones, types, people = Counter(), Counter(), Counter()
    months: dict[str, list] = defaultdict(list)
    for e in entries:
        z = zones_by_entry[e.id]
        zones.update(z)
        if e.analysis_type:
            types[e.analysis_type] += 1
        if e.uploaded_by:
            people[e.uploaded_by] += 1
        months[_month(e)].append({"entry_id": e.entry_id, "title": e.title, "analysis_type": e.analysis_type,
                                  "zones": z, "uploaded_by": e.uploaded_by,
                                  "confirmed_at": e.confirmed_at.isoformat() if e.confirmed_at else None,
                                  "kinds": sorted(kinds_by_entry[e.id])})
    names = dict(db.query(models.User.employee_id, models.User.name)
                 .filter(models.User.employee_id.in_(list(people) or [""])))

    def ranked(c: Counter) -> list[dict]:
        return [{"value": v, "count": n} for v, n in sorted(c.items(), key=lambda x: (-x[1], x[0]))]

    return {
        "hull_no": hull_no, "ship_type": hull.ship_type if hull else None, "memo": hull.memo if hull else None,
        "drafts": drafts,
        "stats": {"entries": len(entries), "files": files, "kinds": dict(kinds),
                  "analysis_types": ranked(types), "zones": ranked(zones),
                  "people": [{"employee_id": p, "name": names.get(p), "count": n}
                             for p, n in sorted(people.items(), key=lambda x: (-x[1], x[0]))]},
        "timeline": [{"month": m, "entries": months[m]} for m in sorted(months, reverse=True)],
    }


def update_hull(db: Session, storage: StoragePaths, actor: str, hull_no: str, patch: dict,
                ip: str | None = None) -> models.Hull:
    if not HULL_PATTERN.fullmatch(hull_no):
        raise HTTPException(status_code=422, detail="invalid_hull")
    hull = db.get(models.Hull, hull_no)
    if hull is None:
        hull = models.Hull(hull_no=hull_no)
        db.add(hull)
        db.flush()
    before = {"ship_type": hull.ship_type, "memo": hull.memo}
    for key in ("ship_type", "memo"):
        if key in patch:
            setattr(hull, key, (patch[key] or "").strip() or None)
    for e in _confirmed_entries(db, hull_no):
        jobs.enqueue(db, "write_meta", e.id)  # entry.json 의 호선 선종을 맞춘다
    db.flush()
    audit.record(db, storage, actor=actor, action="HULL_UPDATE", target_type="hull", target_id=hull_no,
                 before=before, after={"ship_type": hull.ship_type, "memo": hull.memo}, ip=ip)
    from .ops.registry import write_registry  # 순환 import 방지

    write_registry(db, storage)  # 선종·메모를 registry.json 에도 남긴다(05 — 재구축 원천)
    return hull
