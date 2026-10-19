"""관계 지도(25) — 확정 자료를 호선·구역·프로젝트·태그와 모델 관계로 잇는 그래프 한 벌.

관계를 따로 저장하지 않는다. 화면을 열 때 이미 있는 값으로 묶는다.
    호선      entry_hulls (주 호선 먼저)
    구역·태그·프로젝트  entry_tags → tags. 분류 목록의 대표 값으로 센다(Vocab.root — 동의어가 갈라지지 않게)
    모델 관계  model_summaries 의 내용 서명(12). geometry 서명이 같은 두 자료의 BDF 를 한 쌍으로 묶는다.
              네 서명이 모두 같으면 'dup'(똑같은 BDF — 17 이 업로드에서 막으므로 예외로만 생긴다),
              아니면 'geom'(형상만 같음)과 다른 범주(differing — property·material·load).
    판        model_revisions — 자료 안 파일끼리의 순서라 자료 사이 선이 아니다. 계열마다 판 수만 싣는다.

권한(13·15): 보는 사람이 볼 수 있는 확정 Entry 만(visible_entries_filter). 숨은 자료와의 모델 관계도
드러나지 않는다 — 쌍의 두 끝이 모두 보이는 자료일 때만 싣는다.
"""
from collections import defaultdict

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from . import access, models
from .bdf.signature import VERSION as SIG_VERSION, differing
from .vocab import Vocab

MAX_ENTRIES = 3000        # 최근 확정 순으로 이만큼 — 넘으면 truncated
MAX_GROUP = 60            # 같은 형상 묶음 하나에서 쌍을 만들 파일 수 상한(쌍 수가 제곱으로 늘지 않게)
MAX_PAIRS = 6000
TAG_KINDS = ("zone", "free")   # 29 — 프로젝트 기준은 없앴다
_SIG = ("geometry", "property", "material", "load")


def _sig(row) -> dict:
    return {c: getattr(row, f"sig_{c}") for c in _SIG}


def build_graph(db: Session, user) -> dict:
    E = models.Entry
    rows = (db.query(E.id, E.entry_id, E.title, E.analysis_type, E.confirmed_at)
            .filter(E.status == "confirmed", access.visible_entries_filter(user))
            .order_by(E.confirmed_at.desc(), E.id.desc())
            .limit(MAX_ENTRIES + 1).all())
    truncated = len(rows) > MAX_ENTRIES
    rows = rows[:MAX_ENTRIES]
    pks = [r.id for r in rows]
    if not pks:
        return {"entries": [], "hulls": {}, "pairs": [], "unsigned_models": 0, "truncated": False}

    hulls: dict[int, list[str]] = defaultdict(list)
    for eid, hull_no, primary in (db.query(models.EntryHull.entry_id, models.EntryHull.hull_no, models.EntryHull.is_primary)
                                  .filter(models.EntryHull.entry_id.in_(pks))
                                  .order_by(models.EntryHull.is_primary.desc(), models.EntryHull.hull_no)):
        hulls[eid].append(hull_no)
    ships = dict(db.query(models.Hull.hull_no, models.Hull.ship_type)
                 .filter(models.Hull.hull_no.in_({h for hs in hulls.values() for h in hs} or {""})))

    # 태그는 대표 값으로(동의어를 하나로). 해석 종류도 분류 목록의 대표 값으로
    vocabs = {k: Vocab(db, k) for k in TAG_KINDS}
    tags: dict[int, dict[str, list[str]]] = defaultdict(lambda: {k: [] for k in TAG_KINDS})
    for eid, tag in (db.query(models.EntryTag.entry_id, models.Tag)
                     .join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
                     .filter(models.EntryTag.entry_id.in_(pks), models.Tag.kind.in_(TAG_KINDS))):
        v = vocabs[tag.kind].root(tag).value
        bucket = tags[eid][tag.kind]
        if v not in bucket:
            bucket.append(v)
    atype = Vocab(db, "atype")

    F, S = models.File, models.ModelSummary
    file_counts = dict(db.query(F.entry_id, func.count(F.id))
                       .filter(F.entry_id.in_(pks), F.location != "trash").group_by(F.entry_id))

    # 판 — 계열(series_key)마다 판 수와 최신판 파일 이름. 판이 둘 이상인 계열만
    series: dict[tuple, dict] = {}
    for eid, key, latest, name in (db.query(models.ModelRevision.entry_id, models.ModelRevision.series_key,
                                            models.ModelRevision.is_latest, F.name)
                                   .join(F, F.id == models.ModelRevision.file_id)
                                   .filter(models.ModelRevision.entry_id.in_(pks),
                                           models.ModelRevision.series_key.isnot(None), F.location != "trash")):
        s = series.setdefault((eid, key), {"count": 0, "name": name})
        s["count"] += 1
        if latest:
            s["name"] = name
    revisions: dict[int, list[dict]] = defaultdict(list)
    for (eid, _), s in series.items():
        if s["count"] > 1:
            revisions[eid].append(s)

    # 모델 관계 — 보이는 확정 자료의 서명 있는 BDF 만으로 묶는다
    sigs = (db.query(S.file_id, S.sig_geometry, S.sig_property, S.sig_material, S.sig_load, F.entry_id, F.name)
            .join(F, F.id == S.file_id)
            .filter(F.entry_id.in_(pks), F.location != "trash", S.sig_version == SIG_VERSION,
                    S.sig_geometry.isnot(None))
            .order_by(S.file_id).all())
    by_geom: dict[str, list] = defaultdict(list)
    for r in sigs:
        by_geom[r.sig_geometry].append(r)
    pairs: dict[tuple[int, int], dict] = {}
    for group in by_geom.values():
        group = group[:MAX_GROUP]
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                a, b = group[i], group[j]
                if a.entry_id == b.entry_id:
                    continue
                if (a.entry_id, b.entry_id) > (b.entry_id, a.entry_id):
                    a, b = b, a
                diff = differing(_sig(a), _sig(b))
                p = pairs.get((a.entry_id, b.entry_id))
                if p is None:
                    if len(pairs) >= MAX_PAIRS:
                        continue
                    p = pairs[(a.entry_id, b.entry_id)] = {"count": 0, "type": None}
                p["count"] += 1
                # 한 자료 쌍에 파일 쌍이 여럿이면 '똑같은 BDF' 가 우선, 다음은 다른 범주가 적은 쪽
                if p["type"] is None or (not diff and p["type"] != "dup") or \
                        (diff and p["type"] == "geom" and len(diff) < len(p["differs"])):
                    p.update(type="dup" if not diff else "geom", differs=diff, files=[a.name, b.name])

    unsigned = (db.query(S.file_id).join(F, F.id == S.file_id)
                .filter(F.entry_id.in_(pks), F.location != "trash", S.state == "done",
                        or_(S.sig_geometry.is_(None), S.sig_version.is_(None), S.sig_version != SIG_VERSION))
                .count())

    code = {r.id: r.entry_id for r in rows}
    out_entries = []
    for r in rows:
        t = tags.get(r.id) or {k: [] for k in TAG_KINDS}
        out_entries.append({
            "id": r.entry_id, "title": r.title,
            "analysis_type": atype.canon(r.analysis_type) if r.analysis_type else None,
            "confirmed_at": r.confirmed_at.strftime("%Y-%m") if r.confirmed_at else None,
            "hulls": hulls.get(r.id, []), "zones": t["zone"], "free": t["free"],
            "files": file_counts.get(r.id, 0), "revisions": revisions.get(r.id, []),
        })
    out_pairs = [{"a": code[a], "b": code[b], "type": p["type"], "differs": p["differs"],
                  "files": p["files"], "count": p["count"]}
                 for (a, b), p in sorted(pairs.items())]
    used = {h for hs in hulls.values() for h in hs}
    return {"entries": out_entries, "hulls": {h: ships.get(h) for h in sorted(used)},
            "pairs": out_pairs, "unsigned_models": unsigned, "truncated": truncated}
