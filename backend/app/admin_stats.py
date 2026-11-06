"""57 — 관리 › 자료 현황(통계)·자료 목록(빠진 분류 한눈에) — LV3 전용 읽기.

- 통계는 확정 자료만 센다. 정리 대기 초안·휴지통은 건수만 따로 보인다.
- 파일은 확장자로 묶는다(파일 종류 kind 는 검색용이라 .inp 가 '기타' 다 — 통계는 해석 프로그램별로 나눠 보여야 한다).
- 자료 목록은 화면이 한 번에 받아 거르고 고친다(수백 건 규모). 고치기는 54 일괄 분류(공개 범위 포함)를 쓴다."""
from collections import Counter, defaultdict

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import access, models

# (키, 이름, 확장자) — 순서대로 보인다. 어디에도 없으면 '기타'
CATEGORIES = (
    ("nastran", "해석 모델 (Nastran)", {".bdf", ".dat", ".nas", ".blk"}),
    ("abaqus", "해석 모델 (Abaqus)", {".inp"}),
    ("result", "해석 결과", {".f06", ".op2", ".h5", ".xdb", ".pch", ".h3d", ".odb", ".sta", ".msg", ".log", ".mvw",
                          ".hwsession"}),
    ("report", "보고서", {".pdf", ".pptx", ".ppt", ".docx", ".doc", ".hwp", ".hwpx"}),
    ("excel", "엑셀·표", {".xlsx", ".xls", ".xlsm", ".csv"}),
    ("drawing", "도면·그림", {".dwg", ".dxf", ".png", ".jpg", ".jpeg", ".bmp", ".gif", ".tif", ".tiff"}),
)
OTHER = ("other", "기타")
TOP_N = 10
ENTRY_TABLE_LIMIT = 5000


def category_of(ext: str | None) -> str:
    e = (ext or "").lower()
    for key, _label, exts in CATEGORIES:
        if e in exts:
            return key
    return OTHER[0]


def _labels() -> dict[str, str]:
    return {k: label for k, label, _ in CATEGORIES} | {OTHER[0]: OTHER[1]}


def stats(db: Session) -> dict:
    E, F = models.Entry, models.File
    by_status = dict(db.query(E.status, func.count(E.id)).group_by(E.status).all())
    rows = (db.query(F.ext, func.count(F.id), func.coalesce(func.sum(F.size), 0), func.count(func.distinct(F.entry_id)))
            .join(E, E.id == F.entry_id).filter(E.status == "confirmed", F.location != "trash")
            .group_by(F.ext).all())
    # 형식 묶음별 — 자료 수는 묶음 안에서 겹치지 않게 따로 센다
    entry_cat = (db.query(F.entry_id, F.ext).join(E, E.id == F.entry_id)
                 .filter(E.status == "confirmed", F.location != "trash").distinct().all())
    entries_per_cat: dict[str, set] = defaultdict(set)
    for eid, ext in entry_cat:
        entries_per_cat[category_of(ext)].add(eid)
    cats: dict[str, dict] = {}
    labels = _labels()
    for ext, n, size, _ents in rows:
        key = category_of(ext)
        c = cats.setdefault(key, {"key": key, "label": labels[key], "files": 0, "bytes": 0, "exts": []})
        c["files"] += n
        c["bytes"] += int(size or 0)
        c["exts"].append({"ext": (ext or "").lower() or "(없음)", "files": n, "bytes": int(size or 0), "entries": _ents})
    order = [k for k, _l, _e in CATEGORIES] + [OTHER[0]]
    categories = []
    for key in order:
        if key in cats:
            c = cats[key]
            c["entries"] = len(entries_per_cat[key])
            c["exts"].sort(key=lambda x: -x["files"])
            categories.append(c)

    files = sum(c["files"] for c in categories)
    total_bytes = sum(c["bytes"] for c in categories)
    hulls = (db.query(func.count(func.distinct(models.EntryHull.hull_no)))
             .join(E, E.id == models.EntryHull.entry_id).filter(E.status == "confirmed").scalar() or 0)

    month = func.date_format(E.confirmed_at, "%Y-%m")
    monthly_entries = dict(db.query(month, func.count(E.id)).filter(E.status == "confirmed", E.confirmed_at.isnot(None))
                           .group_by(month).all())
    monthly_files = dict(db.query(month, func.count(F.id)).join(F, F.entry_id == E.id)
                         .filter(E.status == "confirmed", E.confirmed_at.isnot(None), F.location != "trash")
                         .group_by(month).all())
    monthly = [{"month": m, "entries": monthly_entries[m], "files": monthly_files.get(m, 0)}
               for m in sorted(monthly_entries)]

    def top_tags(kind: str) -> list[dict]:
        q = (db.query(models.Tag.value, func.count(func.distinct(E.id)))
             .join(models.EntryTag, models.EntryTag.tag_id == models.Tag.id)
             .join(E, E.id == models.EntryTag.entry_id)
             .filter(E.status == "confirmed", models.Tag.kind == kind)
             .group_by(models.Tag.value).order_by(func.count(func.distinct(E.id)).desc(), models.Tag.value)
             .limit(TOP_N))
        return [{"value": v, "entries": n} for v, n in q]

    top_hulls = [{"value": h, "entries": n} for h, n in
                 db.query(models.EntryHull.hull_no, func.count(func.distinct(E.id)))
                 .join(E, E.id == models.EntryHull.entry_id).filter(E.status == "confirmed")
                 .group_by(models.EntryHull.hull_no)
                 .order_by(func.count(func.distinct(E.id)).desc(), models.EntryHull.hull_no).limit(TOP_N)]
    return {
        "summary": {"confirmed": by_status.get("confirmed", 0), "drafts": by_status.get("draft", 0),
                    "trashed": by_status.get("trashed", 0), "files": files, "bytes": total_bytes, "hulls": hulls},
        "categories": categories,
        "monthly": monthly,
        "top": {"zones": top_tags("zone"), "targets": top_tags("target"), "hulls": top_hulls},
    }


def entry_table(db: Session, *, drafts: bool = False) -> dict:
    """모든 확정(drafts 면 정리 대기 초안도) 자료 한 줄씩 — 호선·구역·대상·담당자·공개 범위·파일 묶음별 개수."""
    E = models.Entry
    statuses = ("confirmed", "draft") if drafts else ("confirmed",)
    entries = (db.query(E).filter(E.status.in_(statuses))
               .order_by(E.confirmed_at.desc(), E.id.desc()).limit(ENTRY_TABLE_LIMIT).all())
    ids = [e.id for e in entries]
    hulls: dict[int, list[str]] = defaultdict(list)
    tags: dict[int, dict[str, list[str]]] = defaultdict(lambda: {"zone": [], "target": []})
    people: dict[int, list[dict]] = defaultdict(list)
    counts: dict[int, Counter] = defaultdict(Counter)
    names: dict[str, str] = {}
    if ids:
        for eid, h in (db.query(models.EntryHull.entry_id, models.EntryHull.hull_no)
                       .filter(models.EntryHull.entry_id.in_(ids))
                       .order_by(models.EntryHull.is_primary.desc(), models.EntryHull.hull_no)):
            hulls[eid].append(h)
        for eid, kind, value in (db.query(models.EntryTag.entry_id, models.Tag.kind, models.Tag.value)
                                 .join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
                                 .filter(models.EntryTag.entry_id.in_(ids), models.Tag.kind.in_(("zone", "target")))
                                 .order_by(models.Tag.value)):
            tags[eid][kind].append(value)
        for eid, p in (db.query(models.EntryAssignee.entry_id, models.Person)
                       .join(models.Person, models.Person.id == models.EntryAssignee.person_id)
                       .filter(models.EntryAssignee.entry_id.in_(ids))
                       .order_by(models.EntryAssignee.sort_order, models.Person.id)):
            people[eid].append({"id": p.id, "name": p.name, "employee_id": p.employee_id})
        for eid, ext, n in (db.query(models.File.entry_id, models.File.ext, func.count(models.File.id))
                            .filter(models.File.entry_id.in_(ids), models.File.location != "trash")
                            .group_by(models.File.entry_id, models.File.ext)):
            counts[eid][category_of(ext)] += n
        uploaders = {e.uploaded_by for e in entries if e.uploaded_by}
        if uploaders:
            names = dict(db.query(models.User.employee_id, models.User.name)
                         .filter(models.User.employee_id.in_(uploaders)))
    rows = []
    for e in entries:
        rows.append({
            "entry_id": e.entry_id, "title": e.title, "status": e.status, "version": e.version,
            "hulls": hulls[e.id], "no_hull": bool(e.no_hull),
            "zones": tags[e.id]["zone"], "target": (tags[e.id]["target"] or [None])[0],
            "assignees": people[e.id], "access": access.access_of(e),
            "uploaded_by": e.uploaded_by, "uploader_name": names.get(e.uploaded_by or ""),
            "confirmed_at": e.confirmed_at.isoformat(timespec="minutes") if e.confirmed_at else None,
            "files": dict(counts[e.id]),
        })
    return {"rows": rows, "limit": ENTRY_TABLE_LIMIT, "categories": [{"key": k, "label": l} for k, l in _labels().items()]}
