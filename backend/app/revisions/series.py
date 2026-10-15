"""판 묶음(14 A) — 자동 추정, 다시 추정(sync), 사용자 정리 저장, 화면·검색·entry.json 용 모양.

자동 추정(auto_groups):
    1) 이름 규칙(naming.name_info) — 표시 뗀 줄기(+폴더)가 같은 파일끼리.
    2) 이름으로 짝이 없는 파일은 형상 서명(12 sig_geometry)이 같은 파일, 또는 이미 비교한 결과(B)의 절점·요소 ID
       자카드가 JACCARD_MIN 이상인 파일의 계열에 붙인다. 하중 경우 낱말(LC1·case2…)이 있는 이름은 붙이지 않는다.
    3) 계열 안 순서 = 판 표시 → 올라온 시각 → id. 최신판 = 마지막.

다시 추정(sync): 대상이 아닌 행은 지우고, manual 이 아닌 행만 다시 정한다. 정리된 계열과 이어지는 새 파일은 그 계열 끝에 붙는다.
"""
import hashlib
import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import models
from ..bdf.signature import VERSION as SIG_VERSION
from .naming import NameInfo, is_load_case, name_info

log = logging.getLogger(__name__)

JACCARD_MIN = 0.5
LABEL_MAX = 20
# 판 묶음 대상이 아닌 변환 상태 — INCLUDE 조각과 요소 없는 조각
_FRAGMENT_STATES = ("include",)
_FRAGMENT_ERRORS = ("no_elements",)


@dataclass
class Item:
    id: int
    rel_path: str
    name: str
    created_at: datetime | None
    sig: str | None
    info: NameInfo

    def order_key(self) -> tuple:
        return (*self.info.marks.order(), self.created_at or datetime.min, self.id)


def _hash(text: str, n: int = 16) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:n]


# ── 대상 파일 ────────────────────────────────────────────────────────────

def eligible_files(db: Session, entry_pk: int) -> list[tuple[models.File, models.ModelSummary | None]]:
    """판 묶음 대상 — 휴지통 밖 모델 파일 중 INCLUDE 조각·요소 없는 조각을 뺀 것(변환 전 파일은 대상)."""
    S = models.ModelSummary
    rows = (db.query(models.File, S).outerjoin(S, S.file_id == models.File.id)
            .filter(models.File.entry_id == entry_pk, models.File.kind == "model", models.File.location != "trash")
            .order_by(models.File.id).all())
    out = []
    for f, s in rows:
        if s is not None and (s.state in _FRAGMENT_STATES or (s.state == "skipped" and s.error in _FRAGMENT_ERRORS)):
            continue
        out.append((f, s))
    return out


def _items(pairs) -> list[Item]:
    return [Item(id=f.id, rel_path=f.rel_path, name=f.name, created_at=f.created_at,
                 sig=(s.sig_geometry if s is not None and s.sig_version == SIG_VERSION else None),
                 info=name_info(f.rel_path)) for f, s in pairs]


def _overlaps(db: Session, ids: list[int]) -> dict[frozenset, float]:
    """이미 비교한(B) 쌍의 절점·요소 ID 자카드 중 작은 값 — 내용 규칙 2."""
    if len(ids) < 2:
        return {}
    D = models.RevisionDiff
    out: dict[frozenset, float] = {}
    for a, b, summary in (db.query(D.file_a, D.file_b, D.summary)
                          .filter(D.state == "done", D.file_a.in_(ids), D.file_b.in_(ids))):
        ov = (summary or {}).get("overlap") or {}
        vals = [v for v in (ov.get("nodes"), ov.get("elements")) if isinstance(v, (int, float))]
        if vals:
            out[frozenset((a, b))] = min(vals)
    return out


# ── 자동 추정 ────────────────────────────────────────────────────────────

def auto_groups(items: list[Item], overlaps: dict[frozenset, float] | None = None) -> list[tuple[str | None, list[Item]]]:
    """[(계열 열쇠, 순서대로 파일)] — 계열이 없는(혼자인) 파일은 (None, [파일])."""
    overlaps = overlaps or {}
    groups: dict[str, list[Item]] = {}
    for it in sorted(items, key=lambda x: x.id):
        groups.setdefault("n:" + _hash(it.info.key), []).append(it)
    gid = {it.id: k for k, its in groups.items() for it in its}
    joined: set[int] = set()       # 이름이 아니라 내용으로 이름 계열에 붙은 파일
    by_id = sorted(items, key=lambda x: x.id)
    for it in by_id:
        k = gid[it.id]
        if len(groups.get(k, ())) != 1 or is_load_case(it.info.base):
            continue
        for other in by_id:
            if other.id == it.id or is_load_case(other.info.base):
                continue
            same_geo = bool(it.sig) and it.sig == other.sig
            jac = overlaps.get(frozenset((it.id, other.id)), 0.0)
            if not (same_geo or jac >= JACCARD_MIN):
                continue
            target = gid[other.id]
            if len(groups[target]) == 1:
                # 혼자인 둘을 합친다 — 내용 규칙 열쇠
                new = ("g:" + it.sig[:16]) if same_geo else f"j:{min(it.id, other.id)}"
                groups[new] = groups.pop(target) + groups.pop(k)
                for x in groups[new]:
                    gid[x.id] = new
            else:
                groups[target].append(groups.pop(k)[0])
                gid[it.id] = target
                joined.add(it.id)
            break
    out: list[tuple[str | None, list[Item]]] = []
    for k, its in groups.items():
        its = _ordered(its, joined)
        if len(its) >= 2:
            out.append((k, its))
        else:
            out.append((None, its))
    return out


def _ordered(its: list[Item], joined: set[int]) -> list[Item]:
    """계열 안 순서 — 이름 계열은 판 표시 순서, 내용으로 붙은 파일은 올라온 시각으로 그 사이에 끼운다
    (이름에 판 표시가 없으니 '그 시각에 있던 판들 다음' 으로 본다)."""
    base = sorted((x for x in its if x.id not in joined), key=Item.order_key)
    for x in sorted((x for x in its if x.id in joined), key=lambda x: (x.created_at or datetime.min, x.id)):
        t = x.created_at or datetime.min
        pos = max((i + 1 for i, y in enumerate(base) if (y.created_at or datetime.min) <= t), default=0)
        base.insert(pos, x)
    return base


def auto_labels(items: list[Item]) -> list[str]:
    """계열 안 자동 판 이름 — 모두 서로 다른 판 번호면 R<번호>, 모두 서로 다른 판 글자면 Rev.<글자>, 아니면 R0, R1…"""
    marks = [it.info.marks for it in items]
    letters = [m.letter for m in marks]
    if all(letters) and len(set(letters)) == len(letters):
        return [f"Rev.{x}" for x in letters]
    revs = [m.rev for m in marks]
    if all(r is not None and m.letter is None for r, m in zip(revs, marks)) and len(set(revs)) == len(revs):
        return [f"R{r}" for r in revs]
    return [f"R{i}" for i in range(len(items))]


# ── 다시 추정 ────────────────────────────────────────────────────────────

def sync(db: Session, entry_pk: int, *, commit: bool = True) -> bool:
    """이 Entry 의 판 행을 대상 파일에 맞춘다. 바뀐 것이 있으면 True."""
    pairs = eligible_files(db, entry_pk)
    items = _items(pairs)
    ids = {it.id for it in items}
    R = models.ModelRevision
    rows = {r.file_id: r for r in db.query(R).filter(or_(R.entry_id == entry_pk, R.file_id.in_(ids or {0})))}
    changed = False
    for fid, r in list(rows.items()):
        if fid not in ids or r.entry_id != entry_pk:
            db.delete(r)
            del rows[fid]
            changed = True
    manual = {fid: r for fid, r in rows.items() if r.manual}

    # 정리된 계열의 지금 순서(빠진 파일 뒤의 빈자리는 아래에서 다시 센다)
    layout: dict[str, list[int]] = defaultdict(list)
    for r in sorted(manual.values(), key=lambda r: (r.rev_order, r.file_id)):
        if r.series_key:
            layout[r.series_key].append(r.file_id)
    pinned = {k: next((fid for fid in fids if manual[fid].is_latest), None) for k, fids in layout.items()}
    latest_was_last = {k: (p is None or p == fids[-1]) for (k, fids), p in zip(layout.items(), pinned.values())}

    want: dict[int, tuple[str | None, int, bool]] = {}
    for key, its in auto_groups(items, _overlaps(db, sorted(ids))):
        free = [it.id for it in its if it.id not in manual]
        if not free:
            continue
        anchor = next((manual[it.id].series_key for it in its if it.id in manual and manual[it.id].series_key), None)
        if anchor is not None:
            layout[anchor].extend(free)        # 정리된 계열 끝에 붙는다
            continue
        if key is None or len(free) < 2:
            for fid in free:
                want[fid] = (None, 0, False)
            continue
        for i, fid in enumerate(free):
            want[fid] = (key, i, i == len(free) - 1)
    for k, fids in layout.items():
        if len(fids) < 2:
            for fid in fids:
                want[fid] = (None, 0, False)
            continue
        latest = fids[-1] if latest_was_last.get(k, True) else pinned[k]
        for i, fid in enumerate(fids):
            want[fid] = (k, i, fid == latest)
    for fid in manual:
        want.setdefault(fid, (None, 0, False))

    entry_of = {f.id: f.entry_id for f, _s in pairs}
    for fid, (key, order, latest) in want.items():
        r = rows.get(fid)
        if r is None:
            db.add(R(file_id=fid, entry_id=entry_of[fid], series_key=key, rev_order=order, is_latest=latest,
                     manual=False))
            changed = True
        elif (r.series_key, r.rev_order, bool(r.is_latest)) != (key, order, latest):
            r.series_key, r.rev_order, r.is_latest = key, order, latest
            changed = True
    if changed and commit:
        db.commit()
    return changed


def refresh(db: Session, entry_pk: int | None) -> None:
    """파일이 들어오고 나간 뒤 부른다 — 실패해도 원래 동작을 깨뜨리지 않는다(읽을 때 자가 복구된다)."""
    if not entry_pk:
        return
    try:
        sync(db, entry_pk)
    except Exception:  # noqa: BLE001
        db.rollback()
        log.warning("판 묶음 다시 추정 실패: entry=%s", entry_pk, exc_info=True)


# ── 읽기 모양 ────────────────────────────────────────────────────────────

def _series_rows(db: Session, entry_pk: int) -> tuple[dict[str, list[models.ModelRevision]], list[models.ModelRevision]]:
    rows = (db.query(models.ModelRevision).filter_by(entry_id=entry_pk)
            .order_by(models.ModelRevision.rev_order, models.ModelRevision.file_id).all())
    series: dict[str, list] = defaultdict(list)
    others = []
    for r in rows:
        (series[r.series_key] if r.series_key else others).append(r)
    return series, others


def token_of(db: Session, entry_pk: int) -> str:
    rows = (db.query(models.ModelRevision).filter_by(entry_id=entry_pk).order_by(models.ModelRevision.file_id).all())
    text = ";".join(f"{r.file_id},{r.series_key},{r.rev_order},{int(bool(r.is_latest))},{r.label or ''},"
                    f"{int(bool(r.manual))}" for r in rows)
    return _hash(text, 20)


def labeled(rows: list[models.ModelRevision], files: dict[int, models.File]) -> list[dict]:
    """계열 행 → [{file_id, name, rel_path, order, label, auto_label, display, mark, is_latest, manual}]."""
    items = [Item(id=r.file_id, rel_path=files[r.file_id].rel_path, name=files[r.file_id].name,
                  created_at=files[r.file_id].created_at, sig=None, info=name_info(files[r.file_id].rel_path))
             for r in rows]
    autos = auto_labels(items)
    return [{"file_id": r.file_id, "name": it.name, "rel_path": it.rel_path, "order": r.rev_order,
             "label": r.label, "auto_label": auto, "display": r.label or auto, "mark": it.info.marks.text or None,
             "is_latest": bool(r.is_latest), "manual": bool(r.manual)}
            for r, it, auto in zip(rows, items, autos)]


def _files(db: Session, ids) -> dict[int, models.File]:
    ids = list(ids)
    return {f.id: f for f in db.query(models.File).filter(models.File.id.in_(ids or [0]))}


def series_brief(db: Session, entry_pk: int) -> list[dict]:
    """entry_to_dict 용 짧은 모양(정리 대기 카드) — 저장된 행만 읽는다(다시 추정하지 않는다)."""
    series, _ = _series_rows(db, entry_pk)
    if not series:
        return []
    files = _files(db, {r.file_id for rows in series.values() for r in rows})
    out = []
    for key, rows in series.items():
        items = labeled(rows, files)
        out.append({"key": key, "items": [{"file_id": x["file_id"], "name": x["name"], "display": x["display"],
                                           "is_latest": x["is_latest"]} for x in items]})
    return sorted(out, key=lambda s: s["items"][0]["name"].casefold())


def counts(db: Session, entry_pks) -> dict[int, dict]:
    """검색 결과 행용 — {entry pk: {series, files, latest}}. files·latest 는 판이 가장 많은 계열 기준."""
    pks = [p for p in set(entry_pks) if p]
    if not pks:
        return {}
    R = models.ModelRevision
    rows = (db.query(R).filter(R.entry_id.in_(pks), R.series_key.isnot(None))
            .order_by(R.entry_id, R.series_key, R.rev_order, R.file_id).all())
    if not rows:
        return {}
    files = _files(db, {r.file_id for r in rows})
    grouped: dict[int, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    for r in rows:
        grouped[r.entry_id][r.series_key].append(r)
    out = {}
    for pk, series in grouped.items():
        big = max(series.values(), key=len)
        items = labeled(big, files)
        latest = next((x["display"] for x in items if x["is_latest"]), items[-1]["display"])
        out[pk] = {"series": len(series), "files": len(big), "latest": latest}
    return out


# ── 사용자 정리 ──────────────────────────────────────────────────────────

def snapshot(db: Session, entry_pk: int) -> list[dict]:
    """감사용 — 계열별 파일 이름(순서대로)과 최신판."""
    series, _ = _series_rows(db, entry_pk)
    files = _files(db, {r.file_id for rows in series.values() for r in rows})
    out = []
    for rows in series.values():
        items = labeled(rows, files)
        out.append({"files": [f"{x['display']} {x['name']}" for x in items],
                    "latest": next((x["name"] for x in items if x["is_latest"]), None)})
    return sorted(out, key=lambda s: s["files"][0])


def save_layout(db: Session, entry_pk: int, series: list[dict], actor: str) -> None:
    """판 정리 저장 — series = [{file_ids, latest, labels}]. 대상 파일 전체가 manual 이 된다(커밋은 호출자).

    대상이 아닌 파일·중복 파일은 422. 파일 하나뿐인 계열은 계열 없음으로 둔다."""
    sync(db, entry_pk, commit=False)
    db.flush()
    ids = {f.id for f, _s in eligible_files(db, entry_pk)}
    seen: set[int] = set()
    want: dict[int, tuple[str | None, int, bool, str | None]] = {}
    for s in series:
        fids = [int(x) for x in s.get("file_ids") or []]
        if any(fid not in ids for fid in fids):
            raise HTTPException(status_code=422, detail="revision_file_not_in_entry")
        if seen & set(fids) or len(set(fids)) != len(fids):
            raise HTTPException(status_code=422, detail="revision_file_duplicated")
        seen.update(fids)
        labels = {int(k): (str(v).strip()[:LABEL_MAX] or None) for k, v in (s.get("labels") or {}).items()
                  if v is not None}
        if len(fids) < 2:
            for fid in fids:
                want[fid] = (None, 0, False, None)
            continue
        latest = s.get("latest")
        latest = int(latest) if latest is not None and int(latest) in fids else fids[-1]
        key = f"u:{entry_pk}:{min(fids)}"
        for i, fid in enumerate(fids):
            want[fid] = (key, i, fid == latest, labels.get(fid))
    for fid in ids - seen:
        want[fid] = (None, 0, False, None)
    R = models.ModelRevision
    rows = {r.file_id: r for r in db.query(R).filter(R.entry_id == entry_pk)}
    for fid, (key, order, latest, label) in want.items():
        r = rows.get(fid)
        if r is None:
            r = R(file_id=fid, entry_id=entry_pk)
            db.add(r)
        r.series_key, r.rev_order, r.is_latest, r.label = key, order, latest, label
        r.manual, r.updated_by = True, actor


def reset_layout(db: Session, entry_pk: int) -> None:
    """자동 추정으로 되돌리기 — manual·사용자 이름을 풀고 다시 추정한다(커밋까지)."""
    db.query(models.ModelRevision).filter_by(entry_id=entry_pk).update(
        {"manual": False, "label": None}, synchronize_session=False)
    db.flush()
    sync(db, entry_pk, commit=False)
    db.commit()


# ── entry.json(재구축 원천) ──────────────────────────────────────────────

def export_manual(db: Session, entry_pk: int) -> list[dict] | None:
    """사용자가 정리한 판 배치 — entry.json 의 revisions. 정리한 것이 없으면 None(키를 쓰지 않는다)."""
    rows = (db.query(models.ModelRevision).filter_by(entry_id=entry_pk, manual=True)
            .order_by(models.ModelRevision.series_key, models.ModelRevision.rev_order).all())
    if not rows:
        return None
    files = _files(db, {r.file_id for r in rows})
    index: dict[str, int] = {}
    out = []
    for r in rows:
        f = files.get(r.file_id)
        if f is None:
            continue
        series = index.setdefault(r.series_key, len(index)) if r.series_key else None
        out.append({"rel_path": f.rel_path, "series": series, "order": r.rev_order, "latest": bool(r.is_latest),
                    "label": r.label})
    return out


def restore_manual(db: Session, entry: models.Entry, files: list[models.File], data) -> int:
    """재구축 — entry.json 의 revisions 를 manual 행으로 되살린다. 되살린 행 수."""
    if not isinstance(data, list):
        return 0
    by_rel = {f.rel_path: f for f in files if f.kind == "model"}
    n = 0
    for d in data:
        if not isinstance(d, dict):
            continue
        f = by_rel.get(str(d.get("rel_path") or ""))
        if f is None or f.id is None:
            continue
        s = d.get("series")
        db.add(models.ModelRevision(
            file_id=f.id, entry_id=entry.id, series_key=(f"u:{entry.id}:r{int(s)}" if isinstance(s, int) else None),
            rev_order=int(d.get("order") or 0), is_latest=bool(d.get("latest")),
            label=(str(d["label"])[:LABEL_MAX] if d.get("label") else None), manual=True))
        n += 1
    return n
