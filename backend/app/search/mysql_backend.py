"""MySQL 검색 구현 — LIKE(메타데이터·파일명) + FULLTEXT ngram(본문).

Entry 수가 수만 건을 넘지 않는다는 전제로, 후보 Entry 의 필터용 속성을 한 번에 읽어
파이썬에서 거르고 센다(필터 건수를 "자기 필터만 뺀" 방식으로 세기 쉽다). 규모가 커지면
이 모듈만 Meilisearch 구현으로 바꾼다(base.SearchBackend).

08: 구역·대상은 통제 어휘의 대표 값으로 세고 거른다(vocab.Vocab.canon). 42 — 해석 종류는 없앴다.
15: 해석 시기·해석 연도는 없앴다. 정렬은 관련도·최신순(올린 날짜 = 확정일, 초안은 등록일)·즐겨찾기한 순.
19: 한 칸에 여러 값(같은 칸 안은 OR, 칸끼리는 AND) · 필터 건수 개수 제한을 크게(수백 호선) · 숫자 검색어의
    호선 앞부분 일치 · 호선순·제목순 정렬 · 태그별 묶기.
21: 보고서 문서 분류(report_meta)의 파일 적중 · 파일 보기 행에 공용 여부(보고서 화면이 '자료 소속'을 파생한다).
29: 프로젝트(21) 필터·묶기·검색어 적중은 없앴다."""
import re
from collections import Counter, defaultdict
from datetime import datetime

from sqlalchemy import func
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from .. import access
from .. import favorites as fav
from ..revisions.series import counts as revision_counts
from .. import models
from ..tags import group_ids
from ..vocab import Vocab
from ..entries.quality import missing_fields
from ..plm_ship import series_keys, series_members
from .base import FILTER_KEYS, GROUP_KEYS, GROUP_NONE, GROUP_SHARED, GROUP_SORTS, SORT_ALIASES, SORTS, SearchQuery, filter_values
from . import insight
from .. import wb_origin
from ..config import settings
from .snippets import make_snippet

MAX_TERMS = 8
MAX_SNIPPETS = 3
# 19 — 필터 칸마다 돌려주는 값 수 상한. 예전 30 은 호선 수백 개 중 일부만 고를 수 있었다.
# 값 하나가 ~40B 라 칸 7개 × 1000 이어도 응답은 수백 KB 를 넘지 않는다(실제로는 칸마다 수백 개 이하)
FACET_LIMIT = 1000
HULL_TERM = re.compile(r"^[0-9]{4}$")
# 19 — 숫자만 2자리 이상인 검색어는 호선 앞부분으로도 맞춘다('349' → 3496·3497). 정확 일치보다 낮은 점수
HULL_PREFIX_TERM = re.compile(r"^[0-9]{2,}$")
S_ID, S_HULL, S_TITLE_EXACT, S_TITLE, S_TAG, S_TYPE, S_DESC, S_FILE, S_BODY = 100, 100, 90, 70, 50, 50, 40, 30, 10
S_HULL_PREFIX = 60
S_HULL_SERIES = 95   # 45 — 같은 시리즈 다른 호선(정확 일치 바로 아래)
_EPOCH = datetime(1970, 1, 1)
# 결과 행의 종류별 파일 수(08) — 화면은 BDF·보고서·도면·결과를 0 이어도, 기타는 있을 때만 보인다
ROW_KINDS = ("model", "report", "drawing", "result", "other")


def _like(term: str) -> str:
    return "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _phrase(term: str) -> str | None:
    cleaned = term.replace('"', " ").strip()
    return f'"{cleaned}"' if len(cleaned) >= 2 else None


def _hull_key(hull: str | None) -> tuple:
    """호선순(19) — 대표 호선 번호 오름차순, 숫자는 수로 비교(999 < 1000), 호선 없는 자료는 맨 뒤."""
    if not hull:
        return (2, 0, "")
    return (0, int(hull), hull) if hull.isdigit() else (1, 0, hull.casefold())


def _title_key(title: str | None) -> tuple:
    """제목순(19) — 대소문자·연속 공백 무시, 같으면 원래 글자. 한글은 유니코드 순(가나다순과 같다). 빈 제목은 뒤."""
    t = " ".join(str(title or "").split())
    return (t == "", t.casefold(), t)


def _ts(r: dict) -> float:
    return (r["sort_at"] - _EPOCH).total_seconds()


def _fav_ts(r: dict) -> float:
    return (r["fav_at"] - _EPOCH).total_seconds() if r.get("fav_at") else 0.0


def hull_labels(db: Session, keys) -> dict[str, str]:
    """45 — 호선 거르기 · 묶음의 보조 이름. 시리즈(같은 시리즈 호선 둘 이상)면 '3370·3371 시리즈 · 174K LNG', 아니면 선종."""
    keys = [k for k in keys if k and k != GROUP_SHARED]
    if not keys:
        return {}
    members = series_members(db, keys)
    ships = dict(db.query(models.Hull.hull_no, models.Hull.ship_type)
                 .filter(models.Hull.hull_no.in_({h for k in keys for h in members[k]}), models.Hull.ship_type.isnot(None)))
    out = {}
    for k in keys:
        ship = ships.get(k) or next((ships[h] for h in members[k] if ships.get(h)), None)
        series = f"{'·'.join(members[k])} 시리즈" if len(members[k]) > 1 else None
        label = " · ".join(x for x in (series, ship) if x)
        if label:
            out[k] = label
    return out


def hull_known(db: Session, hull_no: str, user=None) -> bool:
    """호선 화면이 있는 호선인가(13) — 호선 행이 있고, 볼 수 있는 Entry 가 있거나 선종·메모가 적혀 있다.
    호선 행은 확정 때 저절로 생기므로, 비공개 자료만 가진 호선을 '있음' 으로 알리지 않는다."""
    h = db.get(models.Hull, hull_no)
    if h is None:
        return False
    if access.is_admin(user) or h.ship_type or h.memo:
        return True
    E = models.Entry
    return (db.query(models.EntryHull.entry_id).join(E, E.id == models.EntryHull.entry_id)
            .filter(models.EntryHull.hull_no == hull_no, E.status.in_(("confirmed", "draft")),
                    access.visible_entries_filter(user)).first()) is not None


class _FreeTags:
    """자유 태그 값 → 동의어 묶음의 대표 값(태그 필터·건수용)."""

    def __init__(self, db: Session, kind: str = "free"):
        tags = db.query(models.Tag).filter(models.Tag.kind == kind).all()
        by_id = {t.id: t for t in tags}
        self._root = {t.value.casefold(): (by_id[t.alias_of_id].value if t.alias_of_id in by_id else t.value)
                      for t in tags}
        self._aliases: dict[str, list[str]] = defaultdict(list)
        for t in tags:
            if t.alias_of_id in by_id:
                self._aliases[by_id[t.alias_of_id].value].append(t.value)

    def aliases(self, value: str) -> list[str]:
        """대표 값의 동의어들(분류 화면에서 동의어로도 거를 수 있게)."""
        return sorted(self._aliases.get(value, []))

    def canon(self, value: str | None) -> str | None:
        v = " ".join(str(value or "").split())
        return self._root.get(v.casefold(), v) if v else None


_MATCH = "MATCH(file_texts.text) AGAINST (:p IN BOOLEAN MODE)"


def _vocabs(db: Session) -> dict:
    """요청 하나 동안 쓰는 값 정규화 스냅숏 — 구역·대상(통제 어휘)·자유 태그."""
    return {"zone": Vocab(db, "zone"), "target": Vocab(db, "target"),
            "free": _FreeTags(db)}


class _Hits:
    """낱말 하나의 적중 — Entry pk → (점수, 맞은 곳), 파일 id → (점수, 맞은 곳).

    - entries: 파일 이름·본문 적중까지 포함한 Entry 적중(Entry 보기 순위용).
    - meta: Entry 메타데이터(번호·호선·제목·태그·설명)에서만 온 적중. 파일 보기에서
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
        # 10 — 즐겨찾기만 볼 때는 미확정도 보인다(내가 넣은 것이니 '미확정 포함' 을 따로 켜지 않아도 되게)
        fav_at = fav.favorite_times(db, query.favorites_of) if query.favorites_of else None
        if fav_at is not None:
            statuses = fav.LIVE_STATUSES
        terms = [t for t in query.q.split()][:MAX_TERMS]
        # 19 — 칸마다 값 목록(옛 호출의 문자열 하나도 받는다)
        raw = {k: vs for k, vs in ((k, filter_values(v)) for k, v in (query.filters or {}).items()
                                   if k in FILTER_KEYS) if vs}
        sort = SORT_ALIASES.get(query.sort, query.sort)
        sort = sort if sort in SORTS else ("relevance" if terms else "recent")
        if sort == "favorited" and fav_at is None:
            sort = "relevance" if terms else "recent"

        vocab = _vocabs(db)
        # 서버가 실제로 적용한 필터 — 구역·대상·태그는 대표 값으로 바꿔 준다(zone=ER → 기관실).
        # 화면이 공유 URL 의 동의어 값으로도 필터 항목을 올바르게 강조할 수 있게 한다.
        # 19 — 값마다 대표 값으로 바꾸고, 같은 대표 값으로 모이는 값(ER·기관실)은 하나로 — {칸: [값, …]}
        filters = {k: list(dict.fromkeys(self._canon_filter(vocab, k, v) for v in vs)) for k, vs in raw.items()}
        if filters.get("hull"):   # 45 — 호선 거르기는 시리즈 단위(3371 → 3370 시리즈)
            keys = series_keys(db, filters["hull"])
            filters["hull"] = list(dict.fromkeys(keys.get(v, v) for v in filters["hull"]))

        # 13 — 볼 수 없는 Entry 는 모든 적중 질의의 SQL 조건에서 뺀다(건수·묶음·요약이 그 뒤에 계산된다)
        vis = access.visible_entries_filter(query.user)
        hits = [self._term_hits(db, t, statuses, vocab, vis) for t in terms]
        # 39 — 검색어 전체가 'WB #123' 꼴이면 그 WorkBench 해석에서 온 자료(Core 01 표기). 키가 꺼져 있으면 글자 검색 그대로
        wb_id = wb_origin.parse_term(query.q) if settings.wb_origin_show else None
        if wb_id is not None:
            terms = [query.q.strip()]
            hits = [self._wb_hits(db, wb_id, statuses, vis)]
        if terms:
            ids = set(hits[0].entries)
            for h in hits[1:]:
                ids &= set(h.entries)
        else:
            ids = {i for (i,) in db.query(models.Entry.id).filter(models.Entry.status.in_(statuses), vis)}
        if fav_at is not None:
            ids &= set(fav_at)

        rows = self._rows(db, ids, vocab)
        for r in rows.values():
            r["fav_at"] = (fav_at or {}).get(r["id"])
        passed = [r for r in rows.values() if self._passes(r, filters)]
        facets = self._facets(db, rows.values(), filters, vocab)
        suggestion = self._hull_suggestion(db, terms, filters, query.user)
        # 09 — 대표 모델은 맞은 Entry 전체에 대해 한 번 읽어 요약 띠와 이 쪽 행이 함께 쓴다
        reps = insight.rep_models(db, [r["id"] for r in passed])
        summary = insight.summarize(passed, reps)

        group = query.group if query.group in GROUP_KEYS and query.unit == "entry" else None
        grouped = None
        if query.unit == "file":
            items, total = self._file_items(db, passed, terms, hits, filters, query, sort)
        else:
            for r in passed:
                r["score"] = sum(h.entries[r["id"]][0] for h in hits)
                r["matched"] = sorted({h.entries[r["id"]][1] for h in hits})
            passed.sort(key=lambda r: self._entry_order(r, sort))
            total = len(passed)
            if group and query.group_value is None:
                # 11 — 묶음마다 처음 몇 행. 행 모양은 한 번에 만든다(여러 묶음에 든 Entry 도 한 번만)
                grouped = self._groups(db, passed, group, query)
                shown = {r["id"]: r for g in grouped["groups"] for r in g.pop("_rows")}
                built = {it["_pk"]: it for it in self._entry_items(db, list(shown.values()), terms, hits, reps,
                                                                   user=query.user)}
                for g in grouped["groups"]:
                    g["items"] = [built[i] for i in g.pop("_ids")]
                items = list(built.values())
            else:
                if group:
                    # 11 — 묶음 하나의 '더 보기' — 같은 정렬로 그 값을 가진 행만
                    want = self._group_value(vocab, group, query.group_value)
                    if group == "hull" and want is not None and want != GROUP_SHARED:   # 45 — 시리즈 묶음
                        want = series_keys(db, [want])[want]
                    passed = [r for r in passed
                              if ((want in self._group_values(r, group)) if want is not None
                                  else not self._group_values(r, group))]
                    total = len(passed)
                page = passed[query.offset: query.offset + query.limit]
                items = self._entry_items(db, page, terms, hits, reps, user=query.user)
        # 10 — 행마다 '내 즐겨찾기인가'(문서 보기는 그 Entry, 파일 보기는 파일이 든 Entry). 한 번의 질의
        if fav_at is not None:
            mine = set(fav_at)
        else:
            mine = fav.favorite_pks(db, query.viewer, {it["_pk"] for it in items})
        for it in items:
            it["favorite"] = it.pop("_pk") in mine
        out = {"unit": query.unit, "total": total, "items": items, "facets": facets,
               "hull_suggestion": suggestion, "terms": terms, "applied_filters": filters, "sort": sort,
               "summary": summary, "favorites_only": fav_at is not None, "group": group}
        if grouped is not None:
            out.update(grouped)
            out["items"] = []   # 묶어 보기는 groups[].items 로만 — 같은 행을 두 번 싣지 않는다
        elif group:
            out["group_value"] = query.group_value
        return out

    def browse(self, db: Session, include_drafts: bool = False, user=None) -> dict:
        """분류 화면(09) — 속성마다 모든 값과 Entry 수(검색 필터 건수와 같은 셈법, 개수 제한 없음).

        구역·대상은 대표 값으로 세고, 아직 쓰인 적 없는 목록 용어도 0건으로 보탠다(무엇을 고를 수 있는지
        보이게). 값마다 동의어(aliases)를 실어 화면의 '값으로 거르기'가 동의어로도 찾게 한다."""
        statuses = ("confirmed", "draft") if include_drafts else ("confirmed",)
        vocab = _vocabs(db)
        ids = {i for (i,) in db.query(models.Entry.id).filter(models.Entry.status.in_(statuses),
                                                             access.visible_entries_filter(user))}
        rows = self._rows(db, ids, vocab)
        out: dict[str, list[dict]] = {}
        for key in FILTER_KEYS:
            c = Counter()
            for r in rows.values():
                # 45 — 분류 화면의 호선 목록은 실제 호선(호선 화면으로 간다). 검색 거르기 · 묶기만 시리즈 단위
                c.update(r["hulls"] if key == "hull" else self._values(r, key))
            out[key] = [{"value": v, "count": n} for v, n in c.items()]
        for key, kind in (("zone", "zone"), ("target", "target")):
            v = vocab[kind]
            seen = {f["value"] for f in out[key]}
            out[key] += [{"value": t.value, "count": 0} for t in v.terms
                         if t.value not in seen and t.active is not False]
            for f in out[key]:
                t = v.term(f["value"])
                f["listed"] = t is not None
                f["aliases"] = [x.value for x in v.synonyms(t)] if t is not None else []
        for f in out["tag"]:
            f["aliases"] = vocab["free"].aliases(f["value"])
        ships = dict(db.query(models.Hull.hull_no, models.Hull.ship_type)
                     .filter(models.Hull.hull_no.in_([f["value"] for f in out["hull"]] or [""])))
        for f in out["hull"]:
            f["label"] = ships.get(f["value"])
        names = dict(db.query(models.User.employee_id, models.User.name)
                     .filter(models.User.employee_id.in_([f["value"] for f in out["uploaded_by"]] or [""])))
        for f in out["uploaded_by"]:
            f["label"] = names.get(f["value"])
        for key in FILTER_KEYS:
            out[key].sort(key=lambda f: (-f["count"], f["value"]))
        return {"total": len(rows), "facets": out}

    def _group_value(self, vocab: dict, key: str, value: str | None) -> str | None:
        """'더 보기' 로 받은 묶음 값 — GROUP_NONE 이면 None(값 없는 묶음), 아니면 대표 값."""
        if value is None or value == GROUP_NONE or value == "":
            return None
        return self._canon_filter(vocab, key, value)

    def _groups(self, db: Session, passed: list[dict], key: str, query: SearchQuery) -> dict:
        """맞은 Entry 전체(쪽이 아니라)를 key 값으로 묶는다(11).

        값이 여럿인 Entry(호선 2개·구역 2개)는 값마다 그 묶음에 들어간다 — 묶음 건수의 합이 결과 수보다
        클 수 있다(multi_valued 로 알린다). 값 없는 Entry 는 맨 뒤 '없음' 묶음(value=None)."""
        buckets: dict[str, list[dict]] = defaultdict(list)
        none: list[dict] = []
        multi = 0
        for r in passed:   # 이미 정렬된 순서 — 묶음 안 순서도 같은 정렬을 따른다
            values = self._group_values(r, key)
            if not values:
                none.append(r)
                continue
            if len(set(values)) > 1:
                multi += 1
            for v in dict.fromkeys(values):
                buckets[v].append(r)
        if query.group_sort == "name":
            order = sorted(buckets, key=lambda v: (v.casefold(), v))
        else:
            order = sorted(buckets, key=lambda v: (-len(buckets[v]), v.casefold(), v))
        if GROUP_SHARED in buckets:   # 20 — '공용' 묶음은 값 있는 묶음 뒤, '호선 없음' 앞
            order = [v for v in order if v != GROUP_SHARED] + [GROUP_SHARED]
        labels = self._group_labels(db, key, order)
        if GROUP_SHARED in buckets:
            labels[GROUP_SHARED] = "공용"
        rows_n = max(1, min(int(query.group_rows or 5), 50))
        all_groups = [(v, buckets[v]) for v in order] + ([(None, none)] if none else [])
        page = all_groups[query.group_offset: query.group_offset + max(1, min(int(query.group_limit or 30), 200))]
        groups = [{"value": v, "label": labels.get(v) if v is not None else None, "count": len(rows),
                   "_rows": rows[:rows_n], "_ids": [r["id"] for r in rows[:rows_n]]} for v, rows in page]
        return {"groups": groups, "group_total": len(all_groups), "group_offset": query.group_offset,
                "group_sort": query.group_sort if query.group_sort in GROUP_SORTS else "count",
                "multi_valued": multi}

    @staticmethod
    def _group_labels(db: Session, key: str, values: list[str]) -> dict[str, str | None]:
        """묶음 머리의 보조 이름 — 호선은 선종, 올린 사람은 이름(필터 건수의 label 과 같다)."""
        if not values:
            return {}
        if key == "hull":
            return hull_labels(db, values)
        if key == "uploaded_by":
            return dict(db.query(models.User.employee_id, models.User.name).filter(models.User.employee_id.in_(values)))
        return {}

    @staticmethod
    def _canon_filter(vocab: dict, key: str, value: str) -> str:
        if key in ("zone", "target"):
            return vocab[key].canon(value) or value
        if key == "tag":
            return vocab["free"].canon(value) or value
        return value

    @staticmethod
    def _entry_order(r: dict, sort: str):
        if sort == "recent":
            return (-_ts(r), -r["id"])
        if sort == "hull":
            return (_hull_key(r["hulls"][0] if r["hulls"] else None), -_ts(r), -r["id"])
        if sort == "title":
            return (_title_key(r["entry"].title), -_ts(r), -r["id"])
        if sort == "favorited":
            return (-_fav_ts(r), -_ts(r), -r["id"])
        return (-r.get("score", 0), -_ts(r), -r["id"])

    # ---- 낱말 적중 ----
    @staticmethod
    def _wb_hits(db: Session, analysis_id: int, statuses, vis=None) -> _Hits:
        """39 — 그 WorkBench 해석에서 온 파일(묶음 wb_analysis_id)과 그 파일이 든 자료."""
        h = _Hits()
        E, F, B = models.Entry, models.File, models.Batch
        live = E.status.in_(statuses) if vis is None else (E.status.in_(statuses) & vis)
        for fid, eid in (db.query(F.id, E.id).join(E, E.id == F.entry_id).join(B, B.id == F.batch_id)
                         .filter(live, B.wb_analysis_id == analysis_id, F.location != "trash")):
            h.entry(eid, S_ID, "wb_origin")
            h.file(fid, S_ID, "wb_origin")
        return h

    def _term_hits(self, db: Session, term: str, statuses, vocab: dict | None = None, vis=None) -> _Hits:
        h = _Hits()
        E, F = models.Entry, models.File
        like = _like(term)
        # 13 — 볼 수 있는 Entry 만(vis). live 는 아래 모든 적중 질의(속성 값 적중 포함)에 쓰인다
        live = E.status.in_(statuses) if vis is None else (E.status.in_(statuses) & vis)
        for (eid,) in db.query(E.id).filter(live, E.entry_id == term.upper()):
            h.entry(eid, S_ID, "entry_id")
        for (eid,) in (db.query(models.EntryHull.entry_id).join(E, E.id == models.EntryHull.entry_id)
                       .filter(live, models.EntryHull.hull_no == term)):
            h.entry(eid, S_HULL, "hull")
        # 45 — 같은 시리즈 다른 호선의 자료도(3371 → 3370 자료). 정확 일치가 이미 맞은 자료는 점수가 높아 그대로다
        key = series_keys(db, [term])[term] if len(term) <= 8 and term.isalnum() else None
        others = [m for m in series_members(db, [key])[key] if m != term] if key else []
        if others:
            for (eid,) in (db.query(models.EntryHull.entry_id).join(E, E.id == models.EntryHull.entry_id)
                           .filter(live, models.EntryHull.hull_no.in_(others)).distinct()):
                h.entry(eid, S_HULL_SERIES, "hull_series")
        if HULL_PREFIX_TERM.fullmatch(term):
            # 19 — 호선 앞부분 일치('349' → 3496). 정확 일치(위)가 이미 맞은 Entry 는 점수가 높아 그대로다.
            # 숫자만 받으므로 LIKE 특수 문자가 끼어들 수 없다
            for (eid,) in (db.query(models.EntryHull.entry_id).join(E, E.id == models.EntryHull.entry_id)
                           .filter(live, models.EntryHull.hull_no.like(term + "%"),
                                   models.EntryHull.hull_no != term).distinct()):
                h.entry(eid, S_HULL_PREFIX, "hull")
        for eid, title in db.query(E.id, E.title).filter(live, E.title.like(like, escape="\\")):
            h.entry(eid, S_TITLE_EXACT if title.lower() == term.lower() else S_TITLE, "title")
        tag_rows = db.query(models.Tag.id, models.Tag.kind).filter(models.Tag.value.like(like, escape="\\")).all()
        tag_ids = [i for i, kind in tag_rows if kind not in ("atype", "project")]   # 29·42 — 없앤 종류의 남은 행
        if tag_ids:
            for (eid,) in (db.query(models.EntryTag.entry_id).join(E, E.id == models.EntryTag.entry_id)
                           .filter(live, models.EntryTag.tag_id.in_(group_ids(db, tag_ids)))):
                h.entry(eid, S_TAG, "tag")
        if vocab is not None:
            self._property_hits(db, h, term, live, vocab)
        for (eid,) in db.query(E.id).filter(live, E.description.like(like, escape="\\")):
            h.entry(eid, S_DESC, "description")
        for fid, eid in (db.query(F.id, F.entry_id).join(E, E.id == F.entry_id)
                         .filter(live, F.location != "trash", F.name.like(like, escape="\\"))):
            h.entry(eid, S_FILE, "file", meta=False)
            h.file(fid, S_FILE, "file")
        # 21 — 보고서 문서 분류(파일 하나의 값이라 그 파일만 맞는다 — 같은 자료의 다른 파일은 물려받지 않는다)
        for fid, eid in (db.query(F.id, F.entry_id).join(E, E.id == F.entry_id)
                         .join(models.ReportMeta, models.ReportMeta.file_id == F.id)
                         .filter(live, F.location != "trash",
                                 models.ReportMeta.document_type.like(like, escape="\\"))):
            h.entry(eid, S_TYPE, "document_type", meta=False)
            h.file(fid, S_TYPE, "document_type")
        # 23 — 문서 분류가 저장되지 않은 발표 파일(.ppt/.pptx)은 추정값(발표자료)으로도 맞는다(보고서 화면과 같은 규칙)
        from ..report_catalog import AUTO_DOCUMENT_TYPES
        exts = sorted(ext for ext, value in AUTO_DOCUMENT_TYPES.items() if term.casefold() in value.casefold())
        if exts:
            for fid, eid in (db.query(F.id, F.entry_id).join(E, E.id == F.entry_id)
                             .outerjoin(models.ReportMeta, models.ReportMeta.file_id == F.id)
                             .filter(live, F.location != "trash", F.kind == "report",
                                     models.ReportMeta.file_id.is_(None),
                                     F.ext.in_(exts))):
                h.entry(eid, S_TYPE, "document_type", meta=False)
                h.file(fid, S_TYPE, "document_type")
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

    @staticmethod
    def _property_hits(db: Session, h: _Hits, term: str, live, vocab: dict) -> None:
        """속성 값으로 찾기(09) — 본문에 그 낱말이 없어도 그 속성을 가진 Entry 가 맞는다.

        - 구역·대상: 표기 변형(공백·대소문자, '선미 부' = '선미부')까지 목록 용어로 맞춘다.
          LIKE 로 이미 맞은 값·동의어는 위에서 처리되고, 여기는 그 밖의 표기를 보탠다.
        - 선종: 호선 정보의 선종(LIKE) — 그 선종 호선을 가진 Entry.
        - 올린 사람: 이름·사번이 낱말과 정확히 같을 때만(한 글자 성으로 너무 많이 맞지 않게)."""
        E = models.Entry
        for kind in ("zone", "target"):
            t = vocab[kind].target(term)
            if t is None:
                continue
            # 묶인 동의어뿐 아니라 아직 묶이지 않은 표기 변형('선미 부')도 — 필터·건수와 같은 canon 기준
            ids = [x.id for x in vocab[kind].by_id.values() if vocab[kind].canon(x.value) == t.value]
            for (eid,) in (db.query(models.EntryTag.entry_id).join(E, E.id == models.EntryTag.entry_id)
                           .filter(live, models.EntryTag.tag_id.in_(ids))):
                h.entry(eid, S_TAG, kind)
        like = _like(term)
        for (eid,) in (db.query(models.EntryHull.entry_id).join(E, E.id == models.EntryHull.entry_id)
                       .join(models.Hull, models.Hull.hull_no == models.EntryHull.hull_no)
                       .filter(live, models.Hull.ship_type.like(like, escape="\\")).distinct()):
            h.entry(eid, S_TYPE, "ship_type")
        users = [u for (u,) in db.query(models.User.employee_id)
                 .filter((models.User.name == term) | (models.User.employee_id == term))]
        if users:
            for (eid,) in db.query(E.id).filter(live, E.uploaded_by.in_(users)):
                h.entry(eid, S_DESC, "uploaded_by")
        # 46 — 담당자: 명부의 이름·사번이 낱말과 정확히 같을 때(올린 사람과 같은 규칙)
        pids = [p for (p,) in db.query(models.Person.id)
                .filter((models.Person.name == term) | (models.Person.employee_id == term.upper()))]
        if pids:
            for (eid,) in (db.query(models.EntryAssignee.entry_id).join(E, E.id == models.EntryAssignee.entry_id)
                           .filter(live, models.EntryAssignee.person_id.in_(pids)).distinct()):
                h.entry(eid, S_DESC, "assignee")

    # ---- 필터용 속성 ----
    def _rows(self, db: Session, ids: set[int], vocab: dict) -> dict[int, dict]:
        if not ids:
            return {}
        rows: dict[int, dict] = {}
        id_list = list(ids)
        for e in db.query(models.Entry).filter(models.Entry.id.in_(id_list)):
            rows[e.id] = {"id": e.id, "entry": e, "hulls": [], "ship_types": set(), "zones": set(), "targets": set(), "tags": set(),
                          "kinds": set(), "kind_counts": Counter(), "file_count": 0,
                          "uploaded_by": e.uploaded_by,
                          "no_hull": bool(e.no_hull),
                          "sort_at": e.confirmed_at or e.created_at}
        hull_rows = (db.query(models.EntryHull.entry_id, models.EntryHull.hull_no, models.Hull.ship_type)
                     .outerjoin(models.Hull, models.Hull.hull_no == models.EntryHull.hull_no)
                     .filter(models.EntryHull.entry_id.in_(id_list))
                     .order_by(models.EntryHull.is_primary.desc(), models.EntryHull.hull_no))
        for eid, hull_no, ship in hull_rows:
            rows[eid]["hulls"].append(hull_no)
            if ship:
                rows[eid]["ship_types"].add(ship)
        # 45 — 거르기 · 묶기용 시리즈 묶음 키(같은 시리즈 호선 둘이면 하나로). 결과 행에는 실제 호선(hulls)이 간다
        keys = series_keys(db, {h for r in rows.values() for h in r["hulls"]})
        for r in rows.values():
            r["series"] = list(dict.fromkeys(keys[h] for h in r["hulls"]))
        tag_rows = (db.query(models.EntryTag.entry_id, models.Tag.kind, models.Tag.value)
                    .join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
                    .filter(models.EntryTag.entry_id.in_(id_list), models.Tag.kind.in_(("zone", "target", "free")))
                    .order_by(models.Tag.value))
        for eid, kind, value in tag_rows:
            if kind == "zone":
                rows[eid]["zones"].add(vocab["zone"].canon(value))
            elif kind == "target":
                rows[eid]["targets"].add(vocab["target"].canon(value))
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

    @classmethod
    def _group_values(cls, r: dict, key: str) -> list[str]:
        """묶기용 값 — 20: 호선 없이 '공용' 을 고른 자료는 GROUP_SHARED 묶음(필터 값에는 넣지 않는다)."""
        if key == "hull" and not r["hulls"] and r.get("no_hull"):
            return [GROUP_SHARED]
        return cls._values(r, key)

    @staticmethod
    def _values(r: dict, key: str) -> list[str]:
        if key == "hull":
            return r["series"]   # 45 — 시리즈 묶음 키
        if key == "ship_type":
            return sorted(r["ship_types"])
        if key == "zone":
            return sorted(r["zones"])
        if key == "target":
            return sorted(r["targets"])
        if key == "kind":
            return sorted(r["kinds"])
        if key == "tag":
            return sorted(r["tags"])
        v = r[key]   # uploaded_by — 값 하나
        return [v] if v else []

    def _passes(self, r: dict, filters: dict, skip: str | None = None) -> bool:
        """19 — filters = {칸: [값, …]}. 같은 칸의 값 중 하나라도 있으면 그 칸 통과(OR), 모든 칸을 통과해야 한다(AND)."""
        for key, want in filters.items():
            if key == skip:
                continue
            have = self._values(r, key)
            if not any(w in have for w in want):
                return False
        return True

    def _facets(self, db: Session, rows, filters: dict, vocab: dict | None = None) -> dict:
        """칸마다 값과 건수 — 자기 칸의 필터만 빼고 센다(같은 칸 안 다른 값을 더 고를 때의 건수).

        19 — 칸 안 찾기용으로 구역·대상·태그 값에는 동의어(aliases, 있을 때만), 호선에는 선종(label)을 싣는다.
        상한(FACET_LIMIT)에 잘려도 고른 값은 늘 싣는다(화면에서 해제할 수 있게)."""
        rows = list(rows)
        out = {}
        for key in FILTER_KEYS:
            c = Counter()
            for r in rows:
                if self._passes(r, filters, skip=key):
                    c.update(self._values(r, key))
            ranked = sorted(c.items(), key=lambda x: (-x[1], x[0]))
            kept = ranked[:FACET_LIMIT]
            have = {v for v, _n in kept}
            kept += [(v, n) for v, n in ranked[FACET_LIMIT:] if v in filters.get(key, ()) and v not in have]
            out[key] = [{"value": v, "count": n} for v, n in kept]
        names = dict(db.query(models.User.employee_id, models.User.name)
                     .filter(models.User.employee_id.in_([f["value"] for f in out["uploaded_by"]] or [""])))
        for f in out["uploaded_by"]:
            f["label"] = names.get(f["value"])
        if out["hull"]:
            labels = hull_labels(db, [f["value"] for f in out["hull"]])   # 45 — 시리즈면 '3370·3371 시리즈 · 선종'
            for f in out["hull"]:
                if labels.get(f["value"]):
                    f["label"] = labels[f["value"]]
        if vocab is not None:
            for key, kind in (("zone", "zone"), ("target", "target")):
                for f in out[key]:
                    t = vocab[kind].term(f["value"])
                    aliases = [x.value for x in vocab[kind].synonyms(t)] if t is not None else []
                    if aliases:
                        f["aliases"] = aliases
            for f in out["tag"]:   # 자유 태그 동의어
                aliases = vocab["free"].aliases(f["value"])
                if aliases:
                    f["aliases"] = aliases
        return out

    def _hull_suggestion(self, db: Session, terms: list[str], filters: dict, user=None) -> dict | None:
        for t in terms:
            if HULL_TERM.fullmatch(t) and series_keys(db, [t])[t] not in filters.get("hull", ()):
                return {"hull_no": t, "known": hull_known(db, t, user)}
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

    def _entry_items(self, db: Session, page: list[dict], terms: list[str], hits: list[_Hits],
                     reps: dict[int, dict] | None = None, user=None) -> list[dict]:
        ids = [r["id"] for r in page]
        free: dict[int, list[str]] = defaultdict(list)
        if ids:  # 자유 태그는 페이지 전체를 한 번에 읽는다(화면에는 입력한 값 그대로)
            for eid, value in (db.query(models.EntryTag.entry_id, models.Tag.value)
                               .join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
                               .filter(models.EntryTag.entry_id.in_(ids), models.Tag.kind == "free")
                               .order_by(models.Tag.value)):
                free[eid].append(value)
        if reps is None:
            reps = insight.rep_models(db, ids)
        reports = insight.report_lines(db, ids)
        revs = revision_counts(db, ids)   # 14 — '판 3개 · 최신 R2'(페이지당 한 번의 질의)
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
                "_pk": e.id, "entry_id": e.entry_id, "title": e.title, "status": e.status,
                # 15 — 결과 행의 날짜 = 올린 날짜(확정일, 초안은 등록일)
                "posted_at": r["sort_at"].isoformat() if r["sort_at"] else None, "hulls": r["hulls"], "ship_types": sorted(r["ship_types"]),
                "zones": sorted(r["zones"]), "target": min(r["targets"]) if r["targets"] else None,
                "tags": free[e.id],
                "uploaded_by": e.uploaded_by,
                "confirmed_at": e.confirmed_at.isoformat() if e.confirmed_at else None,
                "file_count": r["file_count"], "kinds": sorted(r["kinds"]),
                "kind_counts": {k: r["kind_counts"].get(k, 0) for k in ROW_KINDS},
                "thumb": ({"file_id": reps[e.id]["file_id"], "model_key": reps[e.id]["model_key"]}
                          if e.id in reps else None),
                # 09 — 대표 모델·보고서 한 줄
                "model": insight.model_brief(reps.get(e.id)),
                "report": reports.get(e.id),
                "revisions": revs.get(e.id),
                "score": r.get("score", 0), "matched": r.get("matched", []),
                "snippets": snippets.get(e.id, []),
                # 13·15 — 공개 단계(공유·블록이면 배지). 볼 수 있는 사람에게만 실린다
                **access.access_brief(e),
                "no_hull": r["no_hull"],
                # 20 — '보완 필요'(확정 BDF 자료의 빠진 필수 칸) — 고칠 수 있는 사람(올린 사람·LV3)에게만
                "needs_fix": (missing_fields(has_bdf=r["kind_counts"].get("model", 0) > 0, hulls=r["hulls"],
                                             no_hull=r["no_hull"], zones=r["zones"], target=min(r["targets"]) if r["targets"] else None)
                              if e.status == "confirmed" and user is not None and access.can_edit_entry(user, e)
                              else []),
            })
        return items

    def _file_items(self, db: Session, passed: list[dict], terms: list[str], hits: list[_Hits],
                    filters: dict, query: SearchQuery, sort: str) -> tuple[list[dict], int]:
        by_entry = {r["id"]: r for r in passed}
        if not by_entry:
            return [], 0
        F = models.File
        # 순위·거르기에는 가벼운 열만 쓴다 — 파일 행 전체는 이 페이지 몫만 읽는다
        q = db.query(F.id, F.entry_id, F.name).filter(F.entry_id.in_(list(by_entry)), F.location != "trash")
        if filters.get("kind"):
            q = q.filter(F.kind.in_(filters["kind"]))   # 19 — 종류 여러 개(OR)
        scored = []
        names: dict[int, str] = {}
        for fid, eid, fname in q:
            names[fid] = fname or ""
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
            if sort == "favorited":
                return (-_fav_ts(r), -_ts(r), x[1])
            # 19 — 호선순은 파일이 든 Entry 의 대표 호선, 제목순은 파일 보기의 행 제목인 파일 이름
            if sort == "hull":
                return (_hull_key(r["hulls"][0] if r["hulls"] else None), -_ts(r), x[1])
            if sort == "title":
                return (_title_key(names.get(x[1])), -_ts(r), x[1])
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
            items.append({"_pk": eid, "file_id": f.id, "name": f.name, "rel_path": f.rel_path, "kind": f.kind, "size": f.size,
                          "entry_id": r["entry"].entry_id, "entry_title": r["entry"].title,
                          "entry_status": r["entry"].status, "hulls": r["hulls"], "score": score,
                          # 21 — 파일이 든 자료의 소속(보고서 화면이 '자료 소속'을 파생한다)
                          "no_hull": r["no_hull"],
                          "posted_at": r["sort_at"].isoformat() if r["sort_at"] else None,
                          "matched": matched, "snippets": snippets.get(fid, []),
                          "model_state": model_rows.get(fid, (None, None))[0],
                          "model_key": model_rows.get(fid, (None, None))[1],
                          **access.access_brief(r["entry"])})
        return items, total
