"""관계 지도(25) — 확정 자료를 호선·구역·태그(30 — 선종·크기급)와 모델 관계로 잇는 그래프 한 벌.

관계를 따로 저장하지 않는다. 화면을 열 때 이미 있는 값으로 묶는다.
    호선      entry_hulls (주 호선 먼저)
    선종·크기급  hulls.ship_kind('LNG') · 크기급 = 용량 + 선종('174K급 LNG', 30 PLM). 용량만으로는 묶지 않는다 —
              단위가 선종마다 다르다(LNG m³ · VLCC/B·C DWT · CNTR TEU). 같은 174K 라도 선종이 다르면 다른 크기급.
              자료 쪽 값은 화면이 호선에서 모은다
    구역·태그·프로젝트  entry_tags → tags. 분류 목록의 대표 값으로 센다(Vocab.root — 동의어가 갈라지지 않게)
    모델 관계  model_summaries 의 내용 서명(12). geometry 서명이 같은 두 자료의 BDF 를 한 쌍으로 묶는다.
              네 서명이 모두 같으면 'dup'(똑같은 BDF — 17 이 업로드에서 막으므로 예외로만 생긴다),
              아니면 'geom'(형상만 같음)과 다른 범주(differing — property·material·load).
    판        model_revisions — 자료 안 파일끼리의 순서라 자료 사이 선이 아니다. 계열마다 판 수만 싣는다.
    보고서 판  revisions.reports.entry_series(32) — 보고서 이름 규칙 + 본문 겹침. 모델 판처럼 자료 안 순서라 선이 아니다.
    문서 관계(32, doc_pairs) — 모델이 없는 보고서 자료도 이어지게 한다. 한 자료 쌍에 하나(uses > rrev > text 우선).
              uses  보고서에 사용한 모델(21 report_model_links)이 다른 자료에 있다(사용자가 명시로 연결 — 확실)
              rrev  같은 보고서의 다른 판이 다른 자료에 있다(이름 계열 + 본문 겹침, 또는 본문 겹침만 CROSS_TEXT_MIN 이상)
              text  본문이 비슷하다(22 색인 벡터의 보고서 평균 코사인 ≥ 임계값, 보고서마다 가까운 3개까지 — 추천 수준)

권한(13·15): 보는 사람이 볼 수 있는 확정 Entry 만(visible_entries_filter). 숨은 자료와의 모델 관계도
드러나지 않는다 — 쌍의 두 끝이 모두 보이는 자료일 때만 싣는다.
"""
import os
from collections import defaultdict

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, aliased

from . import access, models
from .bdf.signature import VERSION as SIG_VERSION, differing
from .plm_ship import series_view, ship_facets
from .report_index import features as report_features
from .revisions import reports as report_revs
from .vocab import Vocab

MAX_ENTRIES = 3000        # 최근 확정 순으로 이만큼 — 넘으면 truncated
MAX_GROUP = 60            # 같은 형상 묶음 하나에서 쌍을 만들 파일 수 상한(쌍 수가 제곱으로 늘지 않게)
MAX_PAIRS = 6000
TAG_KINDS = ("zone", "target", "free")   # 29 — 프로젝트 기준은 없앴다 · 44 — 대상(38) 기준
_SIG = ("geometry", "property", "material", "load")
TEXT_TOP = 3              # 보고서마다 '본문이 비슷함' 으로 잇는 가장 가까운 보고서 수
_DOC_RANK = {"uses": 3, "rrev": 2, "text": 1}


def text_threshold() -> float:
    try:
        return float(os.getenv("LOGBOOK_GRAPH_TEXT_SIM", "0.85"))
    except ValueError:
        return 0.85


def _sig(row) -> dict:
    return {c: getattr(row, f"sig_{c}") for c in _SIG}


def build_graph(db: Session, user, store=None) -> dict:
    """store = 22 보고서 본문 색인(없거나 열 수 없으면 None — 문서 관계는 '사용한 모델'·이름 규칙만으로)."""
    E = models.Entry
    rows = (db.query(E.id, E.entry_id, E.title, E.confirmed_at, E.vault_rel)
            .filter(E.status == "confirmed", access.visible_entries_filter(user))
            .order_by(E.confirmed_at.desc(), E.id.desc())
            .limit(MAX_ENTRIES + 1).all())
    truncated = len(rows) > MAX_ENTRIES
    rows = rows[:MAX_ENTRIES]
    pks = [r.id for r in rows]
    if not pks:
        return {"entries": [], "hulls": {}, "pairs": [], "doc_pairs": [], "unsigned_models": 0, "truncated": False,
                "doc_index": {"reports": 0, "indexed": 0, "vectors": 0, "available": store is not None}}

    hulls: dict[int, list[str]] = defaultdict(list)
    for eid, hull_no, primary in (db.query(models.EntryHull.entry_id, models.EntryHull.hull_no, models.EntryHull.is_primary)
                                  .filter(models.EntryHull.entry_id.in_(pks))
                                  .order_by(models.EntryHull.is_primary.desc(), models.EntryHull.hull_no)):
        hulls[eid].append(hull_no)
    # 30 — 선종·크기급: PLM 분해 값, 없으면 선종 칸 글자를 같은 규칙으로(plm_ship.ship_facets — 갖춤 현황 44 와 같은 규칙)
    ships, kinds, sizes = ship_facets(db, {h for hs in hulls.values() for h in hs})

    # 태그는 대표 값으로(동의어를 하나로)
    vocabs = {k: Vocab(db, k) for k in TAG_KINDS}
    tags: dict[int, dict[str, list[str]]] = defaultdict(lambda: {k: [] for k in TAG_KINDS})
    for eid, tag in (db.query(models.EntryTag.entry_id, models.Tag)
                     .join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
                     .filter(models.EntryTag.entry_id.in_(pks), models.Tag.kind.in_(TAG_KINDS))):
        v = vocabs[tag.kind].root(tag).value
        bucket = tags[eid][tag.kind]
        if v not in bucket:
            bucket.append(v)

    F, S = models.File, models.ModelSummary
    file_counts: dict[int, int] = defaultdict(int)
    kind_counts: dict[int, dict[str, int]] = defaultdict(lambda: {"model": 0, "report": 0})
    for eid, kind, n in (db.query(F.entry_id, F.kind, func.count(F.id))
                         .filter(F.entry_id.in_(pks), F.location != "trash").group_by(F.entry_id, F.kind)):
        file_counts[eid] += n
        if kind in ("model", "report"):
            kind_counts[eid][kind] = n

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

    doc_pairs, report_series, doc_index = _documents(db, store, rows, pks)

    code = {r.id: r.entry_id for r in rows}
    out_entries = []
    for r in rows:
        t = tags.get(r.id) or {k: [] for k in TAG_KINDS}
        out_entries.append({
            "id": r.entry_id, "title": r.title,
            "confirmed_at": r.confirmed_at.strftime("%Y-%m") if r.confirmed_at else None,
            "hulls": hulls.get(r.id, []), "zones": t["zone"], "targets": t["target"], "free": t["free"],
            "files": file_counts.get(r.id, 0), "revisions": revisions.get(r.id, []),
            "models": kind_counts[r.id]["model"] if r.id in kind_counts else 0,
            "reports": kind_counts[r.id]["report"] if r.id in kind_counts else 0,
            "report_revisions": report_series.get(r.id, []),
        })
    out_pairs = [{"a": code[a], "b": code[b], "type": p["type"], "differs": p["differs"],
                  "files": p["files"], "count": p["count"]}
                 for (a, b), p in sorted(pairs.items())]
    used = {h for hs in hulls.values() for h in hs}
    out_doc = [{**p, "a": code[a], "b": code[b], **({"from": code[p["from"]]} if p.get("from") else {})}
               for (a, b), p in sorted(doc_pairs.items())]
    hull_series, series_members = series_view(db, used)   # 45 — '호선' 기준은 시리즈로 묶는다
    return {"entries": out_entries, "hulls": {h: ships.get(h) for h in sorted(used)},
            "hull_kinds": {h: kinds.get(h) for h in sorted(used)},
            "hull_sizes": {h: sizes.get(h) for h in sorted(used)},
            "hull_series": hull_series, "series_members": series_members,
            "pairs": out_pairs, "doc_pairs": out_doc, "unsigned_models": unsigned, "truncated": truncated,
            "doc_index": doc_index}


def _documents(db: Session, store, rows, pks) -> tuple[dict, dict, dict]:
    """문서 관계(32) — (자료 쌍 → 관계, 자료 pk → 보고서 판 계열, 색인 현황)."""
    F = models.File
    files = report_revs.report_files(db, pks)
    entries = {r.id: r for r in rows}
    feats = report_revs.current_features(store, files, entries)
    series = {}
    for pk, fs in files.items():
        ss = report_revs.entry_series(fs, feats)
        if ss:
            series[pk] = [{"count": len(s["items"]), "name": s["items"][-1]["name"], "items": s["items"],
                           "steps": s["steps"]} for s in ss]
    pairs: dict[tuple[int, int], dict] = {}

    def put(a, b, kind, files_, score=None, origin=None):
        if a == b:
            return
        key = (a, b) if a < b else (b, a)
        p = pairs.get(key)
        if p is None:
            if len(pairs) >= MAX_PAIRS:
                return
            p = pairs[key] = {"type": kind, "files": files_, "score": score, "count": 0,
                              "kinds": {"uses": 0, "rrev": 0, "text": 0}}
            if origin:
                p["from"] = origin
        p["count"] += 1
        p["kinds"][kind] += 1
        if _DOC_RANK[kind] > _DOC_RANK[p["type"]]:
            p.update(type=kind, files=files_, score=score)
            p.pop("from", None)
            if origin:
                p["from"] = origin

    # uses — 보고서(자료 a)가 사용한 모델이 다른 자료 b 에 있다. 두 끝이 모두 보이는 확정 자료일 때만
    R, M = models.ReportModelLink, aliased(F)
    for rep_entry, rep_name, mod_entry, mod_name in (
            db.query(F.entry_id, F.name, M.entry_id, M.name)
            .join(R, R.report_file_id == F.id).join(M, M.id == R.model_file_id)
            .filter(F.entry_id.in_(pks), M.entry_id.in_(pks), F.location != "trash", M.location != "trash")
            .order_by(R.id)):
        put(rep_entry, mod_entry, "uses", [rep_name, mod_name], origin=rep_entry)
    for (a, b), p in report_revs.cross_pairs(files, feats).items():
        for _ in range(p["count"]):
            put(a, b, "rrev", p["files"], p["score"])
    by_file = {f.id: f for fs in files.values() for f in fs}
    for key, score in report_features.similar_pairs(feats, text_threshold(), TEXT_TOP).items():
        x, y = (by_file[i] for i in sorted(key))
        if x.entry_id != y.entry_id:
            a, b = (x, y) if x.entry_id < y.entry_id else (y, x)
            put(a.entry_id, b.entry_id, "text", [a.name, b.name], round(score, 3))
    total = sum(len(fs) for fs in files.values())
    index = {"reports": total, "indexed": len(feats), "vectors": sum(1 for f in feats.values() if f.vector is not None),
             "available": store is not None}
    return pairs, series, index
