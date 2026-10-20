"""갖춤 현황(26) — 확정 자료를 호선(·공용) × 구역 칸으로 놓고, 칸마다 무엇을 갖췄는지 볼 재료 한 벌.

관계 지도(25)처럼 따로 저장하지 않고 화면을 열 때 이미 있는 값으로 묶는다. 칸 상태는 프런트(lib/coverage.js)가
자료 목록에서 계산한다 — 해석 종류 거르기를 바꿀 때마다 다시 부르지 않게 하려는 것이다.

자료 하나에 싣는 사실
    rows        자료가 놓일 행 — 호선(entry_hulls, 주 호선 먼저) · 공용(no_hull)
    zones       구역(entry_tags kind=zone, 분류 목록의 대표 값 — 동의어가 갈라지지 않게)
    models      BDF 파일 수(휴지통 제외)
    reports     문서(kind=report) 파일 수
    doc_linked  문서가 없더라도 다른 자료의 문서가 이 자료의 모델을 '보고서에 사용한 모델'로 연결함(21)
    model_linked  모델이 없더라도 이 자료의 문서가 다른 자료의 모델과 연결됨(21) — '모델 없음'으로 세지 않는다
    solve       해석 검증(06) 요약 — pass(하나라도 통과) | fail(검증한 모델이 모두 실패이고 검증 안 한 모델 없음) | none
    needs_fix   필수 분류(호선·구역·해석 종류)가 빠진 BDF 자료(20)
    unsigned    서명이 없거나 옛 규칙 서명인 BDF 가 있음(12)

권한(13·15): 보는 사람이 볼 수 있는 확정 자료만. 연결(doc_linked·model_linked)도 상대 자료가 보일 때만 센다.
"""
from collections import defaultdict

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import access, models
from .bdf.signature import VERSION as SIG_VERSION
from .entries import quality
from .vocab import Vocab

MAX_ENTRIES = 3000        # 최근 확정 순으로 이만큼 — 넘으면 truncated(관계 지도와 같은 상한)
COMMON_ROW = "공용"


def _names(db: Session, ids) -> dict[str, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return dict(db.query(models.User.employee_id, models.User.name).filter(models.User.employee_id.in_(ids)))


def build_coverage(db: Session, user) -> dict:
    E, F = models.Entry, models.File
    rows = (db.query(E).filter(E.status == "confirmed", access.visible_entries_filter(user))
            .order_by(E.confirmed_at.desc(), E.id.desc()).limit(MAX_ENTRIES + 1).all())
    truncated = len(rows) > MAX_ENTRIES
    rows = rows[:MAX_ENTRIES]
    if not rows:
        return {"entries": [], "hulls": {}, "zones": [], "truncated": False}
    pks = [e.id for e in rows]
    visible = set(pks)

    hulls: dict[int, list[str]] = defaultdict(list)
    for eid, h in (db.query(models.EntryHull.entry_id, models.EntryHull.hull_no)
                   .filter(models.EntryHull.entry_id.in_(pks))
                   .order_by(models.EntryHull.is_primary.desc(), models.EntryHull.hull_no)):
        hulls[eid].append(h)
    ships = dict(db.query(models.Hull.hull_no, models.Hull.ship_type)
                 .filter(models.Hull.hull_no.in_({h for hs in hulls.values() for h in hs} or {""})))

    vocabs = {"zone": Vocab(db, "zone"), "target": Vocab(db, "target")}   # 대상은 필수 분류(40)에만 쓴다
    tags: dict[int, dict[str, list[str]]] = defaultdict(lambda: {"zone": [], "target": []})
    for eid, tag in (db.query(models.EntryTag.entry_id, models.Tag)
                     .join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
                     .filter(models.EntryTag.entry_id.in_(pks), models.Tag.kind.in_(("zone", "target")))):
        v = vocabs[tag.kind].root(tag).value
        if v not in tags[eid][tag.kind]:
            tags[eid][tag.kind].append(v)
    atype = Vocab(db, "atype")

    # 파일 종류별 수(휴지통 제외)
    kinds: dict[int, dict[str, int]] = defaultdict(dict)
    for eid, kind, n in (db.query(F.entry_id, F.kind, func.count(F.id))
                         .filter(F.entry_id.in_(pks), F.location != "trash").group_by(F.entry_id, F.kind)):
        kinds[eid][kind] = n

    # 21 — 보고서 ↔ 모델 연결. 자료 사이 연결만 본다(같은 자료 안 연결은 이미 '모델+문서')
    R, M = F.__table__.alias("rf"), F.__table__.alias("mf")
    doc_linked, model_linked = set(), set()
    for r_entry, m_entry in (db.query(R.c.entry_id, M.c.entry_id)
                             .select_from(models.ReportModelLink)
                             .join(R, R.c.id == models.ReportModelLink.report_file_id)
                             .join(M, M.c.id == models.ReportModelLink.model_file_id)
                             .filter(R.c.location != "trash", M.c.location != "trash")):
        if r_entry == m_entry or r_entry not in visible or m_entry not in visible:
            continue
        doc_linked.add(m_entry)
        model_linked.add(r_entry)

    # 06 — 해석 검증. 모델 파일마다 상태, 자료마다 요약
    solve_states: dict[int, list[str]] = defaultdict(list)
    model_files: dict[int, int] = defaultdict(int)
    S, SC = models.ModelSummary, models.SolveCheck
    unsigned: set[int] = set()
    for eid, state, sig_geometry, sig_version, sc_state in (
            db.query(F.entry_id, S.state, S.sig_geometry, S.sig_version, SC.state)
            .select_from(F).outerjoin(S, S.file_id == F.id).outerjoin(SC, SC.file_id == F.id)
            .filter(F.entry_id.in_(pks), F.kind == "model", F.location != "trash")):
        if state == "include":       # 다른 BDF 가 INCLUDE 하는 조각 — 모델로 세지 않는다
            continue
        model_files[eid] += 1
        solve_states[eid].append(sc_state or "")
        if state == "done" and (not sig_geometry or sig_version != SIG_VERSION):
            unsigned.add(eid)

    def solve_of(eid: int) -> str:
        st = solve_states.get(eid) or []
        if "pass" in st:
            return "pass"
        if st and all(s == "fail" for s in st):
            return "fail"
        return "none"

    names = _names(db, {e.uploaded_by for e in rows})
    zone_count: dict[str, int] = defaultdict(int)
    out = []
    for e in rows:
        t = tags.get(e.id) or {"zone": [], "target": []}
        n_models = model_files.get(e.id, 0)
        row_keys = [f"h:{h}" for h in hulls.get(e.id, [])]
        if e.no_hull:
            row_keys.append(f"c:{COMMON_ROW}")
        for z in t["zone"]:
            zone_count[z] += 1
        missing = quality.missing_fields(has_bdf=n_models > 0, hulls=hulls.get(e.id, []), no_hull=bool(e.no_hull),
                                         zones=t["zone"], target=(t["target"] or [None])[0],
                                         analysis_type=e.analysis_type)
        out.append({
            "id": e.entry_id, "title": e.title,
            "analysis_type": atype.canon(e.analysis_type) if e.analysis_type else None,
            "rows": row_keys, "zones": t["zone"],
            "models": n_models, "reports": kinds.get(e.id, {}).get("report", 0),
            "doc_linked": e.id in doc_linked, "model_linked": e.id in model_linked,
            "solve": solve_of(e.id) if n_models else None,
            "needs_fix": bool(missing), "unsigned": e.id in unsigned,
            "uploaded_by": e.uploaded_by, "uploader_name": names.get(e.uploaded_by or ""),
            "confirmed_at": e.confirmed_at.strftime("%Y-%m") if e.confirmed_at else None,
        })
    used = sorted({h for hs in hulls.values() for h in hs})
    zones = sorted(zone_count, key=lambda z: (-zone_count[z], z))
    return {"entries": out, "hulls": {h: ships.get(h) for h in used}, "zones": zones, "truncated": truncated}
