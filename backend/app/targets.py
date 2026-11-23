"""69 — 업무별 모음(대상 화면). 검색 백엔드로 보이는 확정 자료를 읽어 대상 기준으로 다시 모은다(새 표 없음, 1단계).

- 숫자와 목록은 보는 사람의 열람 권한대로(검색과 같은 규칙 — SearchQuery.user).
- 대상 값은 분류 목록의 대표 값(동의어는 대표 값으로 모인다 — 검색 행의 target 이 이미 canon 값).
- '기타' 대상은 화면을 만들지 않는다(목록 맨 뒤에 건수만, 화면은 검색으로 보낸다).
"""
from collections import Counter, defaultdict

from sqlalchemy.orm import Session

from . import models, vocab
from .search import SearchQuery, get_search

ALL_LIMIT = 5000      # 확정 자료가 수천 건을 넘지 않는다는 전제(검색 한 번으로 읽는다)
START_N = 5
GAP_N = 20


def _items(db: Session, user, target: str | None = None) -> list[dict]:
    q = SearchQuery(filters={"target": [target]} if target else {}, limit=ALL_LIMIT, sort="recent",
                    viewer=user.employee_id, user=user)
    return get_search().search(db, q).get("items", [])


def _thumb(it: dict) -> dict | None:
    return it.get("thumb") or None


def list_targets(db: Session, user) -> dict:
    """대상 카드 목록 — 자료 수 순, '기타'는 맨 뒤. 카드: 자료 수, 호선 수, 최근 날짜, 대표 3D 썸네일(가장 최근 것)."""
    groups: dict[str, list[dict]] = defaultdict(list)
    for it in _items(db, user):
        if it.get("target"):
            groups[it["target"]].append(it)
    other = vocab.OTHER
    cards = []
    for value, its in groups.items():
        hulls = {h for it in its for h in it.get("hulls") or []}
        thumb = next((_thumb(it) for it in its if _thumb(it)), None)
        cards.append({"value": value, "entries": len(its), "hulls": len(hulls),
                      "latest": max((it.get("posted_at") or "" for it in its), default="") or None,
                      "thumb": thumb, "other": value == other})
    cards.sort(key=lambda c: (c["other"], -c["entries"], c["value"]))
    return {"targets": cards}


def _row(it: dict) -> dict:
    """화면 한 줄 — 검색 행에서 이 화면이 쓰는 칸만."""
    return {k: it.get(k) for k in ("entry_id", "title", "posted_at", "hulls", "ship_types", "assignees", "conclusion",
                                   "reviewed", "kind_counts", "thumb", "cover", "no_hull", "report", "label")} | {
        "elements": (it.get("model") or {}).get("elements"),
        "solve": ((it.get("model") or {}).get("solve") or {}).get("status")}


def target_page(db: Session, user, value: str) -> dict:
    """대상 화면 데이터. 값은 분류 목록의 대표 값으로 맞춘다(동의어로 들어와도 같은 화면)."""
    v = vocab.Vocab(db, "target")
    canon = v.canon(value) or value
    term = v.target(canon)
    synonyms = [s.value for s in v.synonyms(term)] if term is not None else []
    its = _items(db, user, canon)
    rows = [_row(it) for it in its]
    kc = lambda r, k: (r.get("kind_counts") or {}).get(k, 0)   # noqa: E731
    with_hull = [r for r in rows if not r["no_hull"]]
    # 처음이면 여기부터(자동) — 호선 자료 중 모델과 보고서가 다 있는 것, 결론이 있는 것 먼저, 그다음 최근
    full = [r for r in with_hull if kc(r, "model") and kc(r, "report")]
    start = sorted(full, key=lambda r: (not r["conclusion"], not r["reviewed"]))[:START_N]
    if len(start) < START_N:
        start += [r for r in with_hull if r not in start][:START_N - len(start)]
    # 모델 모음 — 3D 썸네일이 있는 자료, 내용이 같은 모델(같은 변환 열쇠)은 한 칸으로
    models_seen: dict[str, dict] = {}
    for r in rows:
        t = r.get("thumb")
        if not t:
            continue
        key = t.get("model_key")
        if key in models_seen:
            models_seen[key]["same"] += 1
            continue
        models_seen[key] = {"entry_id": r["entry_id"], "title": r["title"], "file_id": t["file_id"], "model_key": key,
                            "hulls": r["hulls"], "elements": r["elements"], "same": 0}
    # 누구에게 물을까 — 담당자 명부 번호로 센다(검색 행에는 이름만 있어 따로 읽는다)
    ids = [r["entry_id"] for r in rows]
    people = Counter()
    info = {}
    if ids:
        q = (db.query(models.Person.id, models.Person.name, models.Person.employee_id, models.Person.department,
                      models.Person.employed)
             .join(models.EntryAssignee, models.EntryAssignee.person_id == models.Person.id)
             .join(models.Entry, models.Entry.id == models.EntryAssignee.entry_id)
             .filter(models.Entry.entry_id.in_(ids)))
        for pid, name, eid, dept, employed in q:
            people[pid] += 1
            info[pid] = {"id": pid, "name": name, "employee_id": eid, "department": dept, "employed": bool(employed)}
    hulls = {h for r in rows for h in r["hulls"] or []}
    gaps = {
        "no_conclusion": [r["entry_id"] for r in rows if not r["conclusion"]],
        "no_report": [r["entry_id"] for r in with_hull if kc(r, "model") and not kc(r, "report")],
        "no_model": [r["entry_id"] for r in with_hull if kc(r, "report") and not kc(r, "model")],
    }
    titles = {r["entry_id"]: r["title"] for r in rows}
    return {
        "value": canon, "synonyms": synonyms, "other": canon == vocab.OTHER,
        "counts": {"entries": len(rows), "hulls": len(hulls), "assignees": len(people),
                   "latest": max((r["posted_at"] or "" for r in rows), default="") or None},
        "start": start,
        "base_docs": [r for r in rows if r["no_hull"]],
        "conclusions": [r for r in rows if r["conclusion"]],
        "records": with_hull,
        "models": list(models_seen.values()),
        "people": [{**info[pid], "count": n} for pid, n in people.most_common()],
        "gaps": {k: {"count": len(v), "items": [{"entry_id": e, "title": titles.get(e)} for e in v[:GAP_N]]}
                 for k, v in gaps.items()},
    }
