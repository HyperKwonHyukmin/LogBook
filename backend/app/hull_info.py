"""호선 화면용 조회·수정(설계 §6.1 `/h/{hull}` — 통계·월별 타임라인·구역 분포·참여자)."""
from collections import Counter, defaultdict

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from . import access, audit, jobs, models
from .vocab import Vocab
from .entries.service import HULL_PATTERN
from .storage.paths import StoragePaths


def _month(e: models.Entry) -> str:
    """타임라인 월 = 올린 날짜(확정일)의 달(15 — 해석 시기는 쓰지 않는다)."""
    return f"{(e.confirmed_at or e.created_at):%Y-%m}"


def _confirmed_entries(db: Session, hull_no: str, user=None) -> list[models.Entry]:
    """이 호선의 확정 Entry. user 를 주면 그가 볼 수 있는 것만(13). None 은 내부용(entry.json 갱신 등)."""
    q = (db.query(models.Entry).join(models.EntryHull, models.EntryHull.entry_id == models.Entry.id)
         .filter(models.EntryHull.hull_no == hull_no, models.Entry.status == "confirmed"))
    if user is not None:
        q = q.filter(access.visible_entries_filter(user))
    return q.order_by(models.Entry.confirmed_at.desc(), models.Entry.id.desc()).all()


def list_hulls(db: Session, q: str = "", user=None) -> list[dict]:
    """호선 목록 — 자료 수는 user 가 볼 수 있는 확정 Entry 만 센다(13). 볼 수 있는 자료가 없는 호선은 빠진다."""
    rows = (db.query(models.EntryHull.hull_no, func.count(models.Entry.id), func.max(models.Entry.confirmed_at))
            .join(models.Entry, models.Entry.id == models.EntryHull.entry_id)
            .filter(models.Entry.status == "confirmed",
                    access.visible_entries_filter(user if user is not None else access.SYSTEM))
            .group_by(models.EntryHull.hull_no))
    if q:
        rows = rows.filter(models.EntryHull.hull_no.like(f"{q.strip()}%"))
    ships = dict(db.query(models.Hull.hull_no, models.Hull.ship_type))
    out = [{"hull_no": h, "ship_type": ships.get(h), "entries": n, "last_at": last.isoformat() if last else None}
           for h, n, last in rows]
    return sorted(out, key=lambda r: (r["last_at"] or "", r["hull_no"]), reverse=True)[:500]


def hull_detail(db: Session, hull_no: str, user=None) -> dict:
    """호선 화면 — 통계·타임라인·분포·참여자 모두 user 가 볼 수 있는 Entry 만으로 센다(13).
    호선 행은 확정 때 저절로 생기므로, 볼 수 있는 자료가 없고 선종·메모도 없으면 없는 호선과 같게 404."""
    hull = db.get(models.Hull, hull_no)
    entries = _confirmed_entries(db, hull_no, user if user is not None else access.SYSTEM)
    drafts = (db.query(models.Entry.id).join(models.EntryHull, models.EntryHull.entry_id == models.Entry.id)
              .filter(models.EntryHull.hull_no == hull_no, models.Entry.status == "draft",
                      access.visible_entries_filter(user if user is not None else access.SYSTEM)).count())
    known = hull is not None and (access.is_admin(user) or hull.ship_type or hull.memo)
    if not known and not entries and not drafts:
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
    # 08 — 구역·해석 종류는 분류 목록의 대표 값으로 센다(FEM 해석·FE 해석이 갈라지지 않게)
    zone_v, type_v = Vocab(db, "zone"), Vocab(db, "atype")
    for eid, values in zones_by_entry.items():
        zones_by_entry[eid] = sorted({zone_v.canon(v) for v in values})
    zones, types, people = Counter(), Counter(), Counter()
    months: dict[str, list] = defaultdict(list)
    for e in entries:
        z = zones_by_entry[e.id]
        zones.update(z)
        atype = type_v.canon(e.analysis_type)
        if atype:
            types[atype] += 1
        if e.uploaded_by:
            people[e.uploaded_by] += 1
        months[_month(e)].append({"entry_id": e.entry_id, "title": e.title, "analysis_type": atype,
                                  "zones": z, "uploaded_by": e.uploaded_by,
                                  "confirmed_at": e.confirmed_at.isoformat() if e.confirmed_at else None,
                                  "kinds": sorted(kinds_by_entry[e.id]), **access.access_brief(e)})
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
