"""검색 결과 통찰(09) — 결과 행의 대표 모델·보고서 한 줄과 결과 전체 요약 띠.

- 대표 모델 = 썸네일과 같은 고르기: 변환 결과(key)가 있는 BDF 중 노드(GRID)가 가장 많은 것.
  INCLUDE 전용 파일(state=include)은 뺀다. 요소 수·종류 묶음·노드·크기·SOL·해석 검증(06)을 싣는다.
- 대표 보고서 = 보고서 종류 중 PDF > PPTX > DOCX > 그 밖, 같은 형식이면 큰 파일. 추출 요약 카드의
  제목·쪽수(슬라이드·시트)·작성자.
- 요약 띠 = 검색에 맞은 Entry 전체(쪽이 아니라)의 해석 종류·호선·해석 연도 분포와 해석 검증·모델 규모.

모두 Entry id 묶음 단위로 한 번에 읽는다(행마다 묻지 않는다). lbm 은 읽지 않는다 — 연결 그룹 수는
해석 검증이 이미 세어 둔 값(solve_checks.groups)만 쓴다."""
from collections import Counter

from sqlalchemy.orm import Session

from .. import models

CHUNK = 1000
SUMMARY_TOP = 6
# 요소 카드 → 묶음. 화면의 작은 막대가 이 순서로 쌓인다
FAMILIES = (
    ("beam", ("CBAR", "CBEAM", "CROD", "CONROD", "CBUSH")),
    ("shell", ("CQUAD4", "CQUAD8", "CQUADR", "CTRIA3", "CTRIA6", "CTRIAR")),
    ("rigid", ("RBE2", "RBE3")),
    ("mass", ("CONM2",)),
)
_FAMILY_OF = {card: fam for fam, cards in FAMILIES for card in cards}
# 모델 규모 구간(요소 수) — [하한, 상한)
SIZE_BUCKETS = ((0, 1_000), (1_000, 10_000), (10_000, 50_000), (50_000, None))
REPORT_EXT_RANK = {".pdf": 0, ".pptx": 1, ".docx": 2}


def _chunks(ids):
    ids = list(ids)
    for i in range(0, len(ids), CHUNK):
        yield ids[i:i + CHUNK]


def family_counts(counts: dict | None) -> dict[str, int]:
    """카드별 개수 → 묶음별 개수(beam·shell·rigid·mass·other). GRID 는 요소가 아니라 뺀다."""
    out = {fam: 0 for fam, _ in FAMILIES}
    out["other"] = 0
    for card, n in (counts or {}).items():
        if card == "GRID":
            continue
        out[_FAMILY_OF.get(card, "other")] += int(n or 0)
    return out


def solve_status(state: str | None, stale: bool) -> str:
    """대표 모델의 해석 검증 상태 한 낱말 — pass | fail | error | stale | pending | none(미검증)."""
    if state in ("queued", "running"):
        return "pending"
    if state and stale:
        return "stale"
    return state if state in ("pass", "fail", "error") else "none"


def rep_models(db: Session, entry_ids) -> dict[int, dict]:
    """Entry → 대표 모델(썸네일 고르기와 같음). 해석 검증 행도 함께 읽는다(outer join)."""
    MS, F, SC = models.ModelSummary, models.File, models.SolveCheck
    best: dict[int, tuple] = {}
    for part in _chunks(entry_ids):
        q = (db.query(F.entry_id, F.id, F.size, MS.key, MS.counts, MS.bbox, MS.sol,
                      SC.state, SC.model_key, SC.error_types, SC.groups)
             .join(MS, MS.file_id == F.id)
             .outerjoin(SC, SC.file_id == F.id)
             .filter(F.entry_id.in_(part), F.kind == "model", F.location != "trash",
                     MS.key.isnot(None), MS.state != "include"))
        for eid, fid, size, key, counts, bbox, sol, s_state, s_key, s_types, s_groups in q:
            rank = (int((counts or {}).get("GRID") or 0), size or 0, -fid)
            if eid in best and rank <= best[eid][0]:
                continue
            stale = bool(s_state and s_key is not None and s_key != key)
            best[eid] = (rank, {"file_id": fid, "model_key": key, "counts": counts or {}, "bbox": bbox, "sol": sol,
                                "solve_state": s_state, "solve_status": solve_status(s_state, stale),
                                "error_types": s_types or [], "groups": s_groups})
    return {eid: v[1] for eid, v in best.items()}


def _size(bbox) -> list[float] | None:
    try:
        return [round(float(bbox["max"][k]) - float(bbox["min"][k]), 1) for k in range(3)]
    except (TypeError, KeyError, IndexError, ValueError):
        return None


def model_brief(rep: dict | None) -> dict | None:
    """결과 행의 모델 한 줄 — 요소 수·묶음·노드·크기(모델 단위 그대로)·SOL·검증·그룹."""
    if rep is None:
        return None
    fams = family_counts(rep["counts"])
    return {"file_id": rep["file_id"], "elements": sum(fams.values()), "families": fams,
            "nodes": int(rep["counts"].get("GRID") or 0), "size": _size(rep["bbox"]), "sol": rep["sol"],
            "solve": {"state": rep["solve_state"], "status": rep["solve_status"],
                      "error_types": rep["error_types"], "stale": rep["solve_status"] == "stale"},
            "groups": rep["groups"]}


def report_lines(db: Session, entry_ids) -> dict[int, dict]:
    """Entry → 대표 보고서(제목·단위·개수·작성자). 추출 요약이 없으면 이름만."""
    F, FE = models.File, models.FileExtract
    best: dict[int, tuple] = {}
    for part in _chunks(entry_ids):
        q = (db.query(F.entry_id, F.id, F.name, F.ext, F.size, FE.summary)
             .outerjoin(FE, FE.file_id == F.id)
             .filter(F.entry_id.in_(part), F.kind == "report", F.location != "trash"))
        for eid, fid, name, ext, size, summary in q:
            s = summary if isinstance(summary, dict) else {}
            # 요약이 있는 것이 먼저, 그다음 형식(PDF > PPTX > DOCX), 큰 파일, 낮은 id
            rank = (0 if s else 1, REPORT_EXT_RANK.get((ext or "").lower(), 9), -(size or 0), fid)
            if eid in best and rank >= best[eid][0]:
                continue
            best[eid] = (rank, {"file_id": fid, "name": name, "title": s.get("title"), "unit": s.get("unit"),
                                "count": s.get("count"), "author": s.get("author")})
    return {eid: v[1] for eid, v in best.items()}


def _top(counter: Counter, n: int = SUMMARY_TOP) -> list[dict]:
    items = sorted(counter.items(), key=lambda x: (-x[1], x[0]))
    return [{"value": v, "count": c} for v, c in items[:n]]


def summarize(rows: list[dict], reps: dict[int, dict]) -> dict:
    """검색에 맞은 Entry 전체의 요약(요약 띠). rows = 필터를 통과한 행(mysql_backend._rows 모양)."""
    atype, hull = Counter(), Counter()
    solve = Counter()
    sizes: list[int] = []
    for r in rows:
        if r["analysis_type"]:
            atype[r["analysis_type"]] += 1
        hull.update(r["hulls"])
        rep = reps.get(r["id"])
        if rep is None:
            solve["no_model"] += 1
            continue
        solve[rep["solve_status"]] += 1
        sizes.append(sum(family_counts(rep["counts"]).values()))
    buckets = []
    for lo, hi in SIZE_BUCKETS:
        buckets.append({"min": lo, "max": hi, "count": sum(1 for s in sizes if s >= lo and (hi is None or s < hi))})
    return {
        "total": len(rows),
        "analysis_type": _top(atype), "analysis_type_values": len(atype),
        "hull": _top(hull), "hull_values": len(hull),
        "solve": {k: solve.get(k, 0) for k in ("pass", "fail", "error", "stale", "pending", "none", "no_model")},
        "model_size": {"min": min(sizes) if sizes else None, "max": max(sizes) if sizes else None,
                       "models": len(sizes), "buckets": buckets},
    }
