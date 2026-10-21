"""호선 화면용 조회·수정(설계 §6.1 `/h/{hull}` — 통계·월별 타임라인·구역 분포·참여자)."""
from collections import Counter, defaultdict
from datetime import datetime

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
    ships = {h.hull_no: h for h in db.query(models.Hull)}
    out = [{"hull_no": h, "ship_type": ships[h].ship_type if h in ships else None,
            "plm_status": ships[h].plm_status if h in ships else None,   # 30 — PLM 조회 여부(일괄 채우기 대상)
            "entries": n, "last_at": last.isoformat() if last else None}
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
    # 08 — 구역은 분류 목록의 대표 값으로 센다(FWD·선수부가 갈라지지 않게). 42 — 해석 종류는 없앴다
    zone_v = Vocab(db, "zone")
    for eid, values in zones_by_entry.items():
        zones_by_entry[eid] = sorted({zone_v.canon(v) for v in values})
    zones, people = Counter(), Counter()
    months: dict[str, list] = defaultdict(list)
    for e in entries:
        z = zones_by_entry[e.id]
        zones.update(z)
        if e.uploaded_by:
            people[e.uploaded_by] += 1
        months[_month(e)].append({"entry_id": e.entry_id, "title": e.title,
                                  "zones": z, "uploaded_by": e.uploaded_by,
                                  "confirmed_at": e.confirmed_at.isoformat() if e.confirmed_at else None,
                                  "kinds": sorted(kinds_by_entry[e.id]), **access.access_brief(e)})
    names = dict(db.query(models.User.employee_id, models.User.name)
                 .filter(models.User.employee_id.in_(list(people) or [""])))

    def ranked(c: Counter) -> list[dict]:
        return [{"value": v, "count": n} for v, n in sorted(c.items(), key=lambda x: (-x[1], x[0]))]

    return {
        "hull_no": hull_no, "ship_type": hull.ship_type if hull else None, "memo": hull.memo if hull else None,
        "plm": plm_of(hull),   # 30 — PLM 선박 정보(조회 안 했으면 None)
        "series": series_of(db, hull, hull_no, user),   # 45 — 같은 시리즈 호선
        "drafts": drafts,
        "stats": {"entries": len(entries), "files": files, "kinds": dict(kinds),
                  "zones": ranked(zones),
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
    before = {"ship_type": hull.ship_type, "memo": hull.memo, "series_lead": hull.series_lead}
    for key in ("ship_type", "memo"):
        if key in patch:
            setattr(hull, key, (patch[key] or "").strip() or None)
    if "series_lead" in patch:   # 45 — 사람이 정한 시리즈 대표(빈 값 = 시리즈 아님). PLM 일괄 채우기가 덮지 않는다
        lead = (patch["series_lead"] or "").strip().upper() or None
        if lead is not None and not HULL_PATTERN.fullmatch(lead):
            raise HTTPException(status_code=422, detail="invalid_series_lead")
        if lead != hull.series_lead:
            hull.series_lead, hull.series_seq = lead, None
        hull.series_manual = True
    for e in _confirmed_entries(db, hull_no):
        jobs.enqueue(db, "write_meta", e.id)  # entry.json 의 호선 선종을 맞춘다
    db.flush()
    audit.record(db, storage, actor=actor, action="HULL_UPDATE", target_type="hull", target_id=hull_no,
                 before=before, after={"ship_type": hull.ship_type, "memo": hull.memo,
                                       "series_lead": hull.series_lead}, ip=ip)
    from .ops.registry import write_registry  # 순환 import 방지

    write_registry(db, storage)  # 선종·메모를 registry.json 에도 남긴다(05 — 재구축 원천)
    return hull


# ---- 30 — 사내 PLM 선박 정보 ----

PLM_FIELDS = ("plm_ship_type", "ship_capacity", "ship_kind", "ship_variant", "main_engine", "ship_class",
              "delivery_date", "delivered")


def plm_of(hull: models.Hull | None) -> dict | None:
    """호선 화면·API 에 싣는 PLM 정보. 한 번도 조회하지 않았으면 None."""
    if hull is None or hull.plm_status is None:
        return None
    return {"status": hull.plm_status, "ship_type_raw": hull.plm_ship_type, "capacity": hull.ship_capacity,
            "ship_kind": hull.ship_kind, "variant": hull.ship_variant, "main_engine": hull.main_engine,
            "ship_class": hull.ship_class, "delivery_date": hull.delivery_date,
            "delivered": hull.delivered, "checked_at": hull.plm_checked_at.isoformat() if hull.plm_checked_at else None}


SERIES_FIELDS = ("series_lead", "series_seq", "series_manual")   # 45


def _snapshot(hull: models.Hull) -> dict:
    return {"ship_type": hull.ship_type, **{k: getattr(hull, k) for k in PLM_FIELDS + SERIES_FIELDS}}


def series_of(db: Session, hull: models.Hull | None, hull_no: str, user=None) -> dict | None:
    """45 — 호선 화면의 시리즈: 대표 호선 · 이 호선 순번 · 같은 시리즈 호선(볼 수 있는 확정 자료 수와 함께).
    시리즈 대표가 없으면 None. 시리즈가 자기 혼자면 members 가 하나."""
    from .plm_ship import series_members

    if hull is None or not hull.series_lead:
        return None
    lead = hull.series_lead
    members = series_members(db, [lead])[lead]
    if hull_no not in members:
        members = sorted({*members, hull_no})
    seqs = dict(db.query(models.Hull.hull_no, models.Hull.series_seq).filter(models.Hull.hull_no.in_(members)))
    counts = dict(db.query(models.EntryHull.hull_no, func.count(models.Entry.id))
                  .join(models.Entry, models.Entry.id == models.EntryHull.entry_id)
                  .filter(models.EntryHull.hull_no.in_(members), models.Entry.status == "confirmed",
                          access.visible_entries_filter(user if user is not None else access.SYSTEM))
                  .group_by(models.EntryHull.hull_no))
    return {"lead": lead, "seq": hull.series_seq, "manual": bool(hull.series_manual),
            "members": [{"hull_no": m, "seq": seqs.get(m), "entries": counts.get(m, 0)} for m in members]}


def _apply(db: Session, hull: models.Hull, result, *, replace_ship_type: bool) -> bool:
    """조회 결과 하나를 호선 행에 옮긴다. 선종을 바꿨으면 True.
    PLM 칸은 찾으면 늘 PLM 값으로, 선종(사람이 고칠 수 있는 값)은 replace_ship_type 이거나 비어 있을 때만 선형으로.
    45 — 시리즈도 같다: 사람이 고친 시리즈(series_manual)는 replace_ship_type(호선 화면 단추)일 때만 PLM 값으로 되돌린다."""
    hull.plm_checked_at = datetime.now().replace(microsecond=0)
    if result.status != "found":
        hull.plm_status = "not_found"   # 이전에 찾은 값은 지우지 않는다(PLM 에서 사라진 호선도 기록은 남긴다)
        if hull.plm_ship_type is None:
            for k in PLM_FIELDS:
                setattr(hull, k, None)
        return False
    s = result.ship
    hull.plm_status = "found"
    hull.plm_ship_type, hull.ship_capacity, hull.ship_kind, hull.ship_variant = (
        s["shipType"], s["capacity"], s["shipKind"], s["variant"])
    hull.main_engine, hull.ship_class = s["mainEngine"], s["shipClass"]
    hull.delivery_date, hull.delivered = s["deliveryDate"], s["delivered"]
    if replace_ship_type or not hull.series_manual:
        hull.series_lead, hull.series_seq, hull.series_manual = s.get("seriesLead"), s.get("seriesSeq"), None
    label = (s["label"] or "")[:50] or None
    if label and (replace_ship_type or not hull.ship_type) and hull.ship_type != label:
        hull.ship_type = label
        for e in _confirmed_entries(db, hull.hull_no):
            jobs.enqueue(db, "write_meta", e.id)  # entry.json 의 호선 선종을 맞춘다
        return True
    return False


_PLM_ERRORS = {"invalid": (422, "invalid_ship_no"), "not_found": (404, "ship_not_found"),
               "error": (502, "plm_fetch_error")}


def plm_http_error(result) -> HTTPException:
    if result.status == "unavailable":
        return HTTPException(status_code=503, detail=f"plm_{result.reason}")
    code, detail = _PLM_ERRORS[result.status]
    return HTTPException(status_code=code, detail=detail)


def add_series_siblings(db: Session, storage: StoragePaths, actor: str, leads, ip: str | None = None) -> int:
    """45 — 시리즈 대표들의 같은 시리즈 호선 전체를 PLM 에서 읽어, LogBook 에 없는 호선은 호선 행(PLM 정보 · 시리즈)으로 만든다.
    자료가 없는 호선이라 호선 목록에는 나오지 않고, 호선 화면의 '시리즈' 줄과 검색(3371 → 3370 자료)에 쓰인다.
    이미 있는 호선 행은 건드리지 않는다(그 호선은 자기 조회로 채운다). PLM 장애면 0 — 부가 정보라 채우기를 막지 않는다.
    만든 호선 수를 돌려준다(commit 은 부르는 쪽)."""
    from . import plm_ship

    leads = sorted({x for x in (leads or []) if x})
    if not leads:
        return 0
    try:
        ships = plm_ship.lookup_series(leads)
    except Exception as exc:   # PlmUnavailable · 접속 · 질의 오류
        import logging
        logging.getLogger(__name__).warning("PLM 같은 시리즈 조회 실패(%d개): %s", len(leads), exc)
        return 0
    have = {h for (h,) in db.query(models.Hull.hull_no).filter(models.Hull.hull_no.in_(list(ships) or [""]))}
    added = 0
    for no in sorted(ships):
        if no in have or not HULL_PATTERN.fullmatch(no):
            continue
        hull = models.Hull(hull_no=no)
        db.add(hull)
        db.flush()
        before = _snapshot(hull)
        _apply(db, hull, plm_ship.ShipLookup("found", ship=ships[no]), replace_ship_type=False)
        audit.record(db, storage, actor=actor, action="HULL_PLM", target_type="hull", target_id=no,
                     before=before, after=_snapshot(hull), ip=ip)
        added += 1
    db.flush()
    return added


def lookup_and_apply(db: Session, storage: StoragePaths, actor: str, hull_no: str, ip: str | None = None) -> models.Hull:
    """호선 화면 [선박 정보 검색] — PLM 을 조회해 선종(선형)·PLM 칸을 채운다. 사람이 누른 것이라 선종을 바꾼다.
    없음은 기록하고 404, 형식 오류 422, 설정·드라이버 없음 503, 조회 실패 502."""
    from . import plm_ship

    if not HULL_PATTERN.fullmatch(hull_no):
        raise HTTPException(status_code=422, detail="invalid_ship_no")
    result = plm_ship.lookup(hull_no)
    if result.status not in ("found", "not_found"):
        raise plm_http_error(result)
    hull = db.get(models.Hull, hull_no)
    if hull is None:
        hull = models.Hull(hull_no=hull_no)
        db.add(hull)
        db.flush()
    before = _snapshot(hull)
    _apply(db, hull, result, replace_ship_type=True)
    db.flush()
    after = _snapshot(hull)
    if before != after:
        audit.record(db, storage, actor=actor, action="HULL_PLM", target_type="hull", target_id=hull_no,
                     before=before, after=after, ip=ip)
    add_series_siblings(db, storage, actor, [hull.series_lead], ip)   # 45 — 같은 시리즈 호선도
    db.commit()
    from .ops.registry import write_registry  # 순환 import 방지

    write_registry(db, storage)
    if result.status == "not_found":
        raise plm_http_error(result)
    return hull


def preview_plm(db: Session, storage: StoragePaths, actor: str, hull_no: str, ip: str | None = None) -> dict:
    """자료 수정 화면 [선박 정보 검색] — 아무 로그인 사용자나.
    한 번 찾은 호선은 저장된 값을 그대로 돌려준다(PLM 에 다시 묻지 않는다 — 새로 받으려면 호선 화면의 같은 단추).
    처음 찾으면 호선 행에 PLM 칸을 저장한다. 선종은 비어 있을 때만 채운다(확정 뒤 자동 조회와 같은 규칙 —
    찾음으로 기록되면 자동 조회가 이 호선을 건너뛰므로 여기서 채워 둔다). 못 찾은 번호는 기록하지 않는다(오타가 쌓이지 않게).
    오류 코드는 lookup_and_apply 와 같다(없음 404 · 형식 422 · 설정 없음 503 · 조회 실패 502)."""
    from . import plm_ship

    if not HULL_PATTERN.fullmatch(hull_no):
        raise HTTPException(status_code=422, detail="invalid_ship_no")
    hull = db.get(models.Hull, hull_no)
    if hull is None or hull.plm_status != "found":
        result = plm_ship.lookup(hull_no)
        if result.status != "found":
            raise plm_http_error(result)
        if hull is None:
            hull = models.Hull(hull_no=hull_no)
            db.add(hull)
            db.flush()
        before = _snapshot(hull)
        _apply(db, hull, result, replace_ship_type=False)
        db.flush()
        audit.record(db, storage, actor=actor, action="HULL_PLM", target_type="hull", target_id=hull_no,
                     before=before, after=_snapshot(hull), ip=ip)
        db.commit()
        from .ops.registry import write_registry  # 순환 import 방지

        write_registry(db, storage)
    label = plm_ship.parse_ship_type(hull.plm_ship_type)["label"]
    return {"hull_no": hull_no, "ship_type": (label or "")[:50] or None, "plm": plm_of(hull)}


def _ensure_confirmed_hull_rows(db: Session) -> int:
    """확정 자료에 쓰였는데 호선 행이 없는 번호에 행을 만든다(만든 수). 예전에는 확정 자료를 수정해 더한 호선에
    행이 생기지 않아 일괄 채우기 대상에서 빠졌다. 형식 밖 번호는 PLM 에 물을 수 없으니 두지 않는다."""
    missing = (db.query(models.EntryHull.hull_no).distinct()
               .join(models.Entry, models.Entry.id == models.EntryHull.entry_id)
               .outerjoin(models.Hull, models.Hull.hull_no == models.EntryHull.hull_no)
               .filter(models.Entry.status == "confirmed", models.Hull.hull_no.is_(None)))
    added = 0
    for (no,) in missing:
        if HULL_PATTERN.fullmatch(no):
            db.add(models.Hull(hull_no=no))
            added += 1
    if added:
        db.flush()
    return added


def _known_leads(db: Session) -> set[str]:
    return {x for (x,) in db.query(models.Hull.series_lead).distinct() if x}


def fill_from_plm(db: Session, storage: StoragePaths, actor: str, *, only_unchecked: bool = False,
                  series: bool = False, ip: str | None = None) -> dict:
    """호선 목록 [선종 채우기]·확정 뒤 작업·CLI — 한 번의 조회로 여러 호선을 채운다. 선종은 비어 있을 때만 채운다.
    대상: only_unchecked 면 아직 조회하지 않은 호선(자동), 아니면 찾지 못했거나 안 본 호선 + 선종이 빈 호선.
    45 — series 면 이미 찾은 호선 중 시리즈가 빈 것(사람이 고친 것 빼고)도 다시 본다(시리즈를 읽기 전에 찾은 호선).
    PLM 장애면 PlmUnavailable·예외를 그대로 올린다(아무것도 바꾸지 않는다)."""
    from . import plm_ship

    _ensure_confirmed_hull_rows(db)
    hulls = [h for h in db.query(models.Hull).order_by(models.Hull.hull_no) if HULL_PATTERN.fullmatch(h.hull_no)]
    if only_unchecked:
        hulls = [h for h in hulls if h.plm_status is None]
    else:
        hulls = [h for h in hulls if h.plm_status != "found" or not h.ship_type
                 or (series and not h.series_lead and not h.series_manual)]
    out = {"checked": len(hulls), "found": 0, "not_found": 0, "filled": 0, "series_added": 0}
    if not hulls:
        if series:   # 45 — 조회할 호선이 없어도 이미 아는 시리즈의 같은 시리즈 호선은 채운다
            out["series_added"] = add_series_siblings(db, storage, actor, _known_leads(db), ip)
            if out["series_added"]:
                db.commit()
                from .ops.registry import write_registry

                write_registry(db, storage)
        return out
    results = plm_ship.lookup_many([h.hull_no for h in hulls])
    bad = next((r for r in results.values() if r.status in ("unavailable", "error")), None)
    if bad is not None:
        raise plm_http_error(bad)
    for h in hulls:
        r = results[h.hull_no]
        before = _snapshot(h)
        filled = _apply(db, h, r, replace_ship_type=False)
        out["found" if r.status == "found" else "not_found"] += 1
        out["filled"] += int(filled)
        after = _snapshot(h)
        if before != after:
            audit.record(db, storage, actor=actor, action="HULL_PLM", target_type="hull", target_id=h.hull_no,
                         before=before, after=after, ip=ip)
    # 45 — 같은 시리즈 호선(LogBook 에 없는 것). series 면 이미 아는 시리즈 전체, 아니면 이번에 찾은 호선의 시리즈만
    leads = _known_leads(db) if series else {h.series_lead for h in hulls if h.series_lead}
    out["series_added"] = add_series_siblings(db, storage, actor, leads, ip)
    db.commit()
    from .ops.registry import write_registry

    write_registry(db, storage)
    return out
