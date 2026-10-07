"""MySQL 검색 구현 — LIKE(메타데이터·파일명) + FULLTEXT ngram(본문).

Entry 수가 수만 건을 넘지 않는다는 전제로, 후보 Entry 의 필터용 속성을 한 번에 읽어
파이썬에서 거르고 센다(필터 건수를 "자기 필터만 뺀" 방식으로 세기 쉽다). 규모가 커지면
이 모듈만 Meilisearch 구현으로 바꾼다(base.SearchBackend).

08: 해석 종류·구역은 통제 어휘의 대표 값으로 세고 거른다(vocab.Vocab.canon). '연도'는 해석 시기의
연도만(없으면 YEAR_UNKNOWN). 정렬은 관련도·해석 시기·최근 등록 중 하나."""
import re
from collections import Counter, defaultdict
from datetime import datetime

from sqlalchemy import func
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from .. import models
from ..tags import group_ids
from ..vocab import Vocab
from .base import FILTER_KEYS, SORTS, YEAR_UNKNOWN, SearchQuery
from .snippets import make_snippet

MAX_TERMS = 8
MAX_SNIPPETS = 3
FACET_LIMIT = 30
HULL_TERM = re.compile(r"^[0-9]{4}$")
S_ID, S_HULL, S_TITLE_EXACT, S_TITLE, S_TAG, S_TYPE, S_DESC, S_FILE, S_BODY = 100, 100, 90, 70, 50, 50, 40, 30, 10
_EPOCH = datetime(1970, 1, 1)
# 결과 행의 종류별 파일 수(08) — 화면은 BDF·보고서·도면·결과를 0 이어도, 기타는 있을 때만 보인다
ROW_KINDS = ("model", "report", "drawing", "result", "other")


def _like(term: str) -> str:
    return "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _phrase(term: str) -> str | None:
    cleaned = term.replace('"', " ").strip()
    return f'"{cleaned}"' if len(cleaned) >= 2 else None


def _period_num(p: str | None) -> int | None:
    """'2025-11' → 202511. 형식이 아니면 None(시기 미상)."""
    try:
        return int(p[:4]) * 100 + int(p[5:7]) if p and len(p) >= 7 else None
    except ValueError:
        return None


def _ts(r: dict) -> float:
    return (r["sort_at"] - _EPOCH).total_seconds()


class _FreeTags:
    """자유 태그 값 → 동의어 묶음의 대표 값(태그 필터·건수용)."""

    def __init__(self, db: Session):
        tags = db.query(models.Tag).filter(models.Tag.kind == "free").all()
        by_id = {t.id: t for t in tags}
        self._root = {t.value.casefold(): (by_id[t.alias_of_id].value if t.alias_of_id in by_id else t.value)
                      for t in tags}

    def canon(self, value: str | None) -> str | None:
        v = " ".join(str(value or "").split())
        return self._root.get(v.casefold(), v) if v else None


_MATCH = "MATCH(file_texts.text) AGAINST (:p IN BOOLEAN MODE)"


class _Hits:
    """낱말 하나의 적중 — Entry pk → (점수, 맞은 곳), 파일 id → (점수, 맞은 곳).

    - entries: 파일 이름·본문 적중까지 포함한 Entry 적중(Entry 보기 순위용).
    - meta: Entry 메타데이터(번호·호선·제목·태그·해석 종류·설명)에서만 온 적중. 파일 보기에서
      파일이 물려받을 수 있는 것은 이것뿐이다 — 같은 Entry 의 다른 파일 적중을 물려받지 않게.
    - body_files: 본문이 맞은 파일 id → Entry pk. 발췌문 대상을 고를 때 DB 를 다시 묻지 않게."""

    def __init__(self):
        self.entries: dict[int, tuple[int, str]] = {}
        self.meta: dict[int, tuple[int, str]] = {}
        self.files: dict[int, tuple[int, str]] = {}
        self.body_files: dict[int, int] = {}

    def entry(self, eid: int, score: int, where: str, *, meta: bool = True) -> None:
        if score > self.entries.get(eid, (0, ""))[0]:
            self.entries[eid] = (score, where)
        if meta and score > self.meta.get(eid, (0, ""))[0]:
            self.meta[eid] = (score, where)

    def file(self, fid: int, score: int, where: str) -> None:
        if score > self.files.get(fid, (0, ""))[0]:
            self.files[fid] = (score, where)


class MySqlSearch:
    def search(self, db: Session, query: SearchQuery) -> dict:
        statuses = ("confirmed", "draft") if query.include_drafts else ("confirmed",)
        terms = [t for t in query.q.split()][:MAX_TERMS]
        raw = {k: str(v) for k, v in (query.filters or {}).items() if k in FILTER_KEYS and v}
        sort = query.sort if query.sort in SORTS else ("relevance" if terms else "period")

        vocab = {"atype": Vocab(db, "atype"), "zone": Vocab(db, "zone"), "free": _FreeTags(db)}
        # 서버가 실제로 적용한 필터 — 해석 종류·구역·태그는 대표 값으로 바꿔 준다(zone=ER → 기관실).
        # 화면이 공유 URL 의 동의어 값으로도 필터 항목을 올바르게 강조할 수 있게 한다.
        filters = {k: self._canon_filter(vocab, k, v) for k, v in raw.items()}

        hits = [self._term_hits(db, t, statuses) for t in terms]
        if terms:
            ids = set(hits[0].entries)
            for h in hits[1:]:
                ids &= set(h.entries)
        else:
            ids = {i for (i,) in db.query(models.Entry.id).filter(models.Entry.status.in_(statuses))}

        rows = self._rows(db, ids, vocab)
        passed = [r for r in rows.values() if self._passes(r, filters)]
        facets = self._facets(db, rows.values(), filters)
        suggestion = self._hull_suggestion(db, terms, filters)

        if query.unit == "file":
            items, total = self._file_items(db, passed, terms, hits, filters, query, sort)
        else:
            for r in passed:
                r["score"] = sum(h.entries[r["id"]][0] for h in hits)
                r["matched"] = sorted({h.entries[r["id"]][1] for h in hits})
            passed.sort(key=lambda r: self._entry_order(r, sort))
            total = len(passed)
            page = passed[query.offset: query.offset + query.limit]
            items = self._entry_items(db, page, terms, hits)
        return {"unit": query.unit, "total": total, "items": items, "facets": facets,
                "hull_suggestion": suggestion, "terms": terms, "applied_filters": filters, "sort": sort}

    @staticmethod
    def _canon_filter(vocab: dict, key: str, value: str) -> str:
        if key == "analysis_type":
            return vocab["atype"].canon(value) or value
        if key == "zone":
            return vocab["zone"].canon(value) or value
        if key == "tag":
            return vocab["free"].canon(value) or value
        return value

    @staticmethod
    def _entry_order(r: dict, sort: str):
        if sort == "recent":
            return (-_ts(r), -r["id"])
        if sort == "period":
            pn = r["period_num"]
            return (pn is None, -(pn or 0), -_ts(r), -r["id"])
        return (-r.get("score", 0), -_ts(r), -r["id"])

    # ---- 낱말 적중 ----
    def _term_hits(self, db: Session, term: str, statuses) -> _Hits:
        h = _Hits()
        E, F = models.Entry, models.File
        like = _like(term)
        live = E.status.in_(statuses)
        for (eid,) in db.query(E.id).filter(live, E.entry_id == term.upper()):
            h.entry(eid, S_ID, "entry_id")
        for (eid,) in (db.query(models.EntryHull.entry_id).join(E, E.id == models.EntryHull.entry_id)
                       .filter(live, models.EntryHull.hull_no == term)):
            h.entry(eid, S_HULL, "hull")
        for eid, title in db.query(E.id, E.title).filter(live, E.title.like(like, escape="\\")):
            h.entry(eid, S_TITLE_EXACT if title.lower() == term.lower() else S_TITLE, "title")
        tag_rows = db.query(models.Tag.id, models.Tag.kind).filter(models.Tag.value.like(like, escape="\\")).all()
        tag_ids = [i for i, kind in tag_rows if kind != "atype"]
        if tag_ids:
            for (eid,) in (db.query(models.EntryTag.entry_id).join(E, E.id == models.EntryTag.entry_id)
                           .filter(live, models.EntryTag.tag_id.in_(group_ids(db, tag_ids)))):
                h.entry(eid, S_TAG, "tag")
        for (eid,) in db.query(E.id).filter(live, E.analysis_type.like(like, escape="\\")):
            h.entry(eid, S_TYPE, "analysis_type")
        # 해석 종류 사전(08) — 동의어(FEM)로 찾아도 그 용어(FE 해석)를 쓴 Entry 가 맞는다
        atype_ids = [i for i, kind in tag_rows if kind == "atype"]
        if atype_ids:
            values = [v for (v,) in db.query(models.Tag.value).filter(models.Tag.id.in_(group_ids(db, atype_ids)))]
            for (eid,) in db.query(E.id).filter(live, E.analysis_type.in_(values)):
                h.entry(eid, S_TYPE, "analysis_type")
        for (eid,) in db.query(E.id).filter(live, E.description.like(like, escape="\\")):
            h.entry(eid, S_DESC, "description")
        for fid, eid in (db.query(F.id, F.entry_id).join(E, E.id == F.entry_id)
                         .filter(live, F.location != "trash", F.name.like(like, escape="\\"))):
            h.entry(eid, S_FILE, "file", meta=False)
            h.file(fid, S_FILE, "file")
        phrase = _phrase(term)
        if phrase:
            q = (db.query(models.FileText.file_id, F.entry_id).join(F, F.id == models.FileText.file_id)
                 .join(E, E.id == F.entry_id)
                 .filter(live, F.location != "trash", sql_text(_MATCH).bindparams(p=phrase)).distinct())
            for fid, eid in q:
                h.entry(eid, S_BODY, "body", meta=False)
                h.file(fid, S_BODY, "body")
                h.body_files[fid] = eid
        return h

    # ---- 필터용 속성 ----
    def _rows(self, db: Session, ids: set[int], vocab: dict) -> dict[int, dict]:
        if not ids:
            return {}
        rows: dict[int, dict] = {}
        id_list = list(ids)
        atype = vocab["atype"]
        for e in db.query(models.Entry).filter(models.Entry.id.in_(id_list)):
            pn = _period_num(e.analysis_period)
            rows[e.id] = {"id": e.id, "entry": e, "hulls": [], "ship_types": set(), "zones": set(), "tags": set(),
                          "kinds": set(), "kind_counts": Counter(), "file_count": 0,
                          # 08 — '해석 연도'는 해석 시기만 본다(확정일로 대신하지 않는다)
                          "year": e.analysis_period[:4] if pn else YEAR_UNKNOWN, "period_num": pn,
                          "analysis_type": atype.canon(e.analysis_type), "uploaded_by": e.uploaded_by,
                          "sort_at": e.confirmed_at or e.created_at}
        hull_rows = (db.query(models.EntryHull.entry_id, models.EntryHull.hull_no, models.Hull.ship_type)
                     .outerjoin(models.Hull, models.Hull.hull_no == models.EntryHull.hull_no)
                     .filter(models.EntryHull.entry_id.in_(id_list))
                     .order_by(models.EntryHull.is_primary.desc(), models.EntryHull.hull_no))
        for eid, hull_no, ship in hull_rows:
            rows[eid]["hulls"].append(hull_no)
            if ship:
                rows[eid]["ship_types"].add(ship)
        tag_rows = (db.query(models.EntryTag.entry_id, models.Tag.kind, models.Tag.value)
                    .join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
                    .filter(models.EntryTag.entry_id.in_(id_list), models.Tag.kind.in_(("zone", "free"))))
        for eid, kind, value in tag_rows:
            if kind == "zone":
                rows[eid]["zones"].add(vocab["zone"].canon(value))
            else:
                rows[eid]["tags"].add(vocab["free"].canon(value))
        # 파일 행을 다 읽지 않고 (Entry, 종류) 별 개수만 센다
        for eid, kind, n in (db.query(models.File.entry_id, models.File.kind, func.count(models.File.id))
                             .filter(models.File.entry_id.in_(id_list), models.File.location != "trash")
                             .group_by(models.File.entry_id, models.File.kind)):
            rows[eid]["kinds"].add(kind)
            rows[eid]["kind_counts"][kind] += n
            rows[eid]["file_count"] += n
        return rows

    @staticmethod
    def _values(r: dict, key: str) -> list[str]:
        if key == "hull":
            return r["hulls"]
        if key == "ship_type":
            return sorted(r["ship_types"])
        if key == "zone":
            return sorted(r["zones"])
        if key == "kind":
            return sorted(r["kinds"])
        if key == "tag":
            return sorted(r["tags"])
        v = r[key]
        return [v] if v else []

    def _passes(self, r: dict, filters: dict, skip: str | None = None) -> bool:
        for key, want in filters.items():
            if key == skip:
                continue
            if want not in self._values(r, key):
                return False
        return True

    def _facets(self, db: Session, rows, filters: dict) -> dict:
        rows = list(rows)
        out = {}
        for key in FILTER_KEYS:
            c = Counter()
            for r in rows:
                if self._passes(r, filters, skip=key):
                    c.update(self._values(r, key))
            out[key] = [{"value": v, "count": n} for v, n in sorted(c.items(), key=lambda x: (-x[1], x[0]))][:FACET_LIMIT]
        # 해석 연도는 최근 해부터(시기 미상은 맨 끝) — 건수 순이면 연도를 찾기 어렵다
        out["year"] = (sorted((f for f in out["year"] if f["value"] != YEAR_UNKNOWN), key=lambda f: f["value"], reverse=True)
                       + [f for f in out["year"] if f["value"] == YEAR_UNKNOWN])
        names = dict(db.query(models.User.employee_id, models.User.name)
                     .filter(models.User.employee_id.in_([f["value"] for f in out["uploaded_by"]] or [""])))
        for f in out["uploaded_by"]:
            f["label"] = names.get(f["value"])
        return out

    def _hull_suggestion(self, db: Session, terms: list[str], filters: dict) -> dict | None:
        for t in terms:
            if HULL_TERM.fullmatch(t) and filters.get("hull") != t:
                return {"hull_no": t, "known": db.get(models.Hull, t) is not None}
        return None

    # ---- 결과 항목 ----
    def _snippets(self, db: Session, groups: dict, terms: list[str]) -> dict:
        """발췌문을 페이지 전체에 대해 한꺼번에 만든다(쿼리 2번).

        groups: 결과 항목 키(Entry pk 또는 파일 id) → 본문이 맞은 파일 id 들.
        항목마다 (파일 id, 쪽 순서) 앞에서부터 최대 MAX_SNIPPETS 조각을 고른다."""
        fids = sorted({fid for v in groups.values() for fid in v})
        phrases = [p for p in (_phrase(t) for t in terms) if p]
        if not fids or not phrases:
            return {}
        # 1) 맞은 조각의 id 만 가볍게 읽는다(본문은 읽지 않는다)
        by_file: dict[int, list[int]] = defaultdict(list)
        for tid, fid in (db.query(models.FileText.id, models.FileText.file_id)
                         .filter(models.FileText.file_id.in_(fids),
                                 sql_text(_MATCH).bindparams(p=" ".join(phrases)))
                         .order_by(models.FileText.file_id, models.FileText.seq)):
            by_file[fid].append(tid)
        picked: dict = {}
        for key, key_fids in groups.items():
            ids: list[int] = []
            for fid in sorted(key_fids):
                ids.extend(by_file.get(fid, [])[:MAX_SNIPPETS - len(ids)])
                if len(ids) >= MAX_SNIPPETS:
                    break
            if ids:
                picked[key] = ids
        want = {i for v in picked.values() for i in v}
        if not want:
            return {}
        # 2) 고른 조각만 본문·파일명과 함께 읽는다
        texts = {ft.id: (ft, name) for ft, name in
                 db.query(models.FileText, models.File.name).join(models.File, models.File.id == models.FileText.file_id)
                 .filter(models.FileText.id.in_(want))}
        return {key: [{"file_id": texts[i][0].file_id, "name": texts[i][1], "locator": texts[i][0].locator,
                       **make_snippet(texts[i][0].text, terms)} for i in ids]
                for key, ids in picked.items()}

    @staticmethod
    def _thumbs(db: Session, ids: list[int]) -> dict[int, dict]:
        """Entry 마다 대표 BDF 썸네일 — 변환 결과(key)가 있는 모델 중 노드(GRID)가 가장 많은 것.
        INCLUDE 전용 파일(state=include)은 그림이 없어 뺀다. 페이지 전체를 한 번에 읽는다."""
        if not ids:
            return {}
        best: dict[int, tuple] = {}
        q = (db.query(models.File.entry_id, models.File.id, models.File.size, models.ModelSummary.key,
                      models.ModelSummary.counts)
             .join(models.ModelSummary, models.ModelSummary.file_id == models.File.id)
             .filter(models.File.entry_id.in_(ids), models.File.kind == "model", models.File.location != "trash",
                     models.ModelSummary.key.isnot(None), models.ModelSummary.state != "include"))
        for eid, fid, size, key, counts in q:
            rank = (int((counts or {}).get("GRID") or 0), size or 0, -fid)
            if eid not in best or rank > best[eid][0]:
                best[eid] = (rank, {"file_id": fid, "model_key": key})
        return {eid: v[1] for eid, v in best.items()}

    def _entry_items(self, db: Session, page: list[dict], terms: list[str], hits: list[_Hits]) -> list[dict]:
        ids = [r["id"] for r in page]
        free: dict[int, list[str]] = defaultdict(list)
        if ids:  # 자유 태그는 페이지 전체를 한 번에 읽는다(화면에는 입력한 값 그대로)
            for eid, value in (db.query(models.EntryTag.entry_id, models.Tag.value)
                               .join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
                               .filter(models.EntryTag.entry_id.in_(ids), models.Tag.kind == "free")
                               .order_by(models.Tag.value)):
                free[eid].append(value)
        thumbs = self._thumbs(db, ids)
        wanted = set(ids)
        groups: dict[int, set[int]] = defaultdict(set)
        for h in hits:
            for fid, eid in h.body_files.items():
                if eid in wanted:
                    groups[eid].add(fid)
        snippets = self._snippets(db, groups, terms)
        items = []
        for r in page:
            e = r["entry"]
            items.append({
                "entry_id": e.entry_id, "title": e.title, "status": e.status, "analysis_type": r["analysis_type"],
                "analysis_period": e.analysis_period, "hulls": r["hulls"], "ship_types": sorted(r["ship_types"]),
                "zones": sorted(r["zones"]), "tags": free[e.id],
                "uploaded_by": e.uploaded_by,
                "confirmed_at": e.confirmed_at.isoformat() if e.confirmed_at else None,
                "file_count": r["file_count"], "kinds": sorted(r["kinds"]),
                "kind_counts": {k: r["kind_counts"].get(k, 0) for k in ROW_KINDS},
                "thumb": thumbs.get(e.id),
                "score": r.get("score", 0), "matched": r.get("matched", []),
                "snippets": snippets.get(e.id, []),
            })
        return items

    def _file_items(self, db: Session, passed: list[dict], terms: list[str], hits: list[_Hits],
                    filters: dict, query: SearchQuery, sort: str) -> tuple[list[dict], int]:
        by_entry = {r["id"]: r for r in passed}
        if not by_entry:
            return [], 0
        F = models.File
        # 순위·거르기에는 가벼운 열만 쓴다 — 파일 행 전체는 이 페이지 몫만 읽는다
        q = db.query(F.id, F.entry_id).filter(F.entry_id.in_(list(by_entry)), F.location != "trash")
        if filters.get("kind"):
            q = q.filter(F.kind == filters["kind"])
        scored = []
        for fid, eid in q:
            score, matched, own = 0, set(), False
            ok = True
            for h in hits:
                fs = h.files.get(fid)
                es = h.meta.get(eid)  # 형제 파일의 이름·본문 적중은 물려받지 않는다
                best = max((fs or (0, ""))[0], (es or (0, ""))[0])
                if best == 0:
                    ok = False
                    break
                if fs:
                    own = True
                    matched.add(fs[1])
                score += best
            if not ok or (terms and not own):
                continue
            scored.append((score, fid, eid, sorted(matched)))

        def order(x):
            r = by_entry[x[2]]
            if sort == "recent":
                return (-_ts(r), x[1])
            if sort == "period":
                return (r["period_num"] is None, -(r["period_num"] or 0), -_ts(r), x[1])
            return (-x[0], -_ts(r), x[1])

        scored.sort(key=order)
        total = len(scored)
        page = scored[query.offset: query.offset + query.limit]
        rows = {f.id: f for f in db.query(F).filter(F.id.in_([x[1] for x in page]))} if page else {}
        body = {fid for h in hits for fid in h.body_files}
        snippets = self._snippets(db, {fid: [fid] for _s, fid, _e, _m in page if fid in body}, terms)
        # 모델 변환 상태·key — 화면이 썸네일이 있는 모델만 요청하고 key 로 캐시하게 한다(페이지당 한 번 조회)
        model_rows = {fid: (state, key) for fid, state, key in
                      db.query(models.ModelSummary.file_id, models.ModelSummary.state, models.ModelSummary.key)
                      .filter(models.ModelSummary.file_id.in_([x[1] for x in page]))} if page else {}
        items = []
        for score, fid, eid, matched in page:
            f, r = rows[fid], by_entry[eid]
            items.append({"file_id": f.id, "name": f.name, "rel_path": f.rel_path, "kind": f.kind, "size": f.size,
                          "entry_id": r["entry"].entry_id, "entry_title": r["entry"].title,
                          "entry_status": r["entry"].status, "hulls": r["hulls"], "score": score,
                          "analysis_period": r["entry"].analysis_period,
                          "matched": matched, "snippets": snippets.get(fid, []),
                          "model_state": model_rows.get(fid, (None, None))[0],
                          "model_key": model_rows.get(fid, (None, None))[1]})
        return items, total
