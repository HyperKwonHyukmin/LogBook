"""21·22 — 보고서 목록·본문 검색 한 곳(`GET /api/reports`).

- 목록·권한·메타데이터는 늘 MySQL 이 원본이다: 기존 검색(파일 보기, 종류=보고서)을 검색어 없이 한 번 불러 볼 수 있는
  확정·Vault 보고서 전체와 소속·프로젝트·호선을 얻는다(권한 = SQL visible_entries_filter). 색인(SQLite)은 권한의 근거가 아니다.
- 검색어가 있으면:
  ① 본문 색인이 '현재'인 보고서(등록 SHA·경로·자료가 색인과 같고 상태 ready/partial)는 22 색인으로 판정한다 —
     FTS5 trigram(1~2글자는 instr)으로 후보 파일만 뽑고, 그 파일의 조각 본문으로 기존 규칙 그대로 다시 판정
     (AND 는 서로 다른 조각·메타데이터 조합 허용, OR, 정확 구문, 숫자 경계, `:part:` 조각 이어붙이기). 벡터는 읽지 않는다.
  ② 색인이 없거나 오래된 보고서는 기존 검색(03a 본문 추출, MySQL ngram)으로 찾는다 — 색인 전이라도 21 수준의 검색은 된다.
  ③ '의미 추천 포함'(retrieval=hybrid)이면 키워드에 걸리지 않은 색인 보고서 중 유사도 임계값 이상을 상한 개수까지 덧붙인다.
- 거르기(소속·프로젝트·문서 분류·관련 모델)와 건수는 맞은 보고서 전체에서 계산한 뒤 쪽을 자른다.
"""
import logging
import re
from collections import Counter, defaultdict

from .. import access, models, report_catalog
from ..search import SearchQuery, get_search
from ..search.snippets import make_snippet
from .config import semantic_limit, semantic_threshold
from .store import normalize

log = logging.getLogger(__name__)

NONE = report_catalog.NONE   # '미분류' 거르기 값(화면과 같다)
LIST_CAP = 100_000       # 검색 한 번에 받는 보고서 상한(보고서 수만 개 전제)
MAX_SNIPPETS = 5         # 행마다 돌려주는 발췌(화면은 3개) — 후보 수는 줄이지 않는다
FALLBACK_OR_TERMS = 8    # OR 검색을 기존 검색으로 대신할 때 낱말별로 부르는 최대 횟수
INDEXED = ("ready", "partial")


def query_terms(q, mode="and"):
    q = normalize(q).strip()
    if mode == "phrase":
        return [q] if q else []
    return [a or b for a, b in re.findall(r'"([^"\n]+)"|([^\s"]+)', q)]


def contains(text, term):
    # 숫자(호선·하중 번호 등)는 다른 숫자 안의 부분으로 맞히지 않는다
    if term.isdigit():
        return re.search(r"(?<!\d)" + re.escape(term) + r"(?!\d)", text) is not None
    return term in text


def keyword_chunks(chunks):
    """긴 쪽·셀을 나눈 `:part:` 조각을 겹침을 빼고 다시 이어, 구문이 나눈 경계에 걸려도 놓치지 않게 한다."""
    output = []
    for chunk in chunks:
        locator = chunk.get("locator", "")
        base = re.sub(r":part:\d+$", "", locator)
        if base != locator and output and output[-1]["locator"] == base:
            previous = output[-1]["text"]
            overlap = min(256, len(previous), len(chunk["text"]))
            if previous[-overlap:] == chunk["text"][:overlap]:
                output[-1]["text"] += chunk["text"][overlap:]
            else:
                output[-1]["text"] += "\n" + chunk["text"]
        else:
            output.append({**chunk, "locator": base})
    return output


def keyword_match(metadata, chunks, terms, mode):
    """(맞았나, 맞은 조각들, 맞은 검색어 수). AND 는 검색어마다 메타데이터나 아무 조각에 있으면 된다."""
    chunks = keyword_chunks(chunks)
    fields = [normalize(metadata)] + [normalize(c["text"]) for c in chunks]
    hit = [any(contains(field, term) for field in fields) for term in terms]
    ok = not terms or (any(hit) if mode == "or" else all(hit))
    matched = [c for c, field in zip(chunks, fields[1:]) if any(contains(field, t) for t in terms)]
    return ok, matched, sum(hit)


def is_current(document, *, sha256, rel_path, entry_pk, vault_rel):
    """색인 문서가 지금 등록된 그 파일인가(삭제·이동·교체된 자료의 옛 본문을 쓰지 않는다)."""
    if not document or not document.get("active", True):
        return False
    meta = document.get("metadata") or {}
    return (meta.get("registered_sha256", document.get("sha256")) == sha256
            and meta.get("entry_id", document.get("entry_id")) == entry_pk
            and meta.get("rel_path") == rel_path
            and meta.get("vault_rel") == vault_rel)


def current_document(document, file, entry):
    return is_current(document, sha256=file.sha256, rel_path=file.rel_path, entry_pk=entry.id, vault_rel=entry.vault_rel)


def visible_reports(db, user):
    """볼 수 있는 확정·Vault 보고서 (File, Entry) — 요약(RAG)이 쓴다."""
    return (db.query(models.File, models.Entry).join(models.Entry, models.File.entry_id == models.Entry.id)
            .filter(models.File.kind == "report", models.File.location == "vault",
                    models.Entry.status == "confirmed", access.visible_entries_filter(user)).all())


def index_state(document, current):
    if not document:
        return "pending"
    if not current:
        return "stale"
    return document.get("state") or "pending"


# ---- MySQL 쪽 ----

def _search_items(db, user, q, sort):
    query = SearchQuery(q=q, unit="file", filters={"kind": ["report"]}, user=user, viewer=user.employee_id,
                        limit=LIST_CAP, sort=sort)
    items = get_search().search(db, query)["items"]
    if not items:
        return []
    # 보관된(Vault) 보고서만 — 확정 자료에 아직 옮겨지지 않은 파일이 섞여 있어도 목록에 내지 않는다
    ids = [it["file_id"] for it in items]
    in_vault = set()
    for i in range(0, len(ids), 1000):
        in_vault |= {fid for (fid,) in db.query(models.File.id).filter(
            models.File.id.in_(ids[i:i + 1000]), models.File.location == "vault")}
    return [it for it in items if it["file_id"] in in_vault]


def _details(db, items):
    """색인 현재성 확인용 파일 정체(sha·경로·자료 pk·Vault 경로)와 메타데이터 검색 글(설명·해석 종류·태그)."""
    ids = [it["file_id"] for it in items]
    ident, entry_of = {}, {}
    for i in range(0, len(ids), 1000):
        for fid, sha, rel, pk, vault_rel in (db.query(models.File.id, models.File.sha256, models.File.rel_path,
                                                      models.Entry.id, models.Entry.vault_rel)
                                             .join(models.Entry, models.File.entry_id == models.Entry.id)
                                             .filter(models.File.id.in_(ids[i:i + 1000]))):
            ident[fid] = {"sha256": sha, "rel_path": rel, "entry_pk": pk, "vault_rel": vault_rel}
            entry_of[fid] = pk
    pks = sorted(set(entry_of.values()))
    extra, tags = {}, defaultdict(list)
    for i in range(0, len(pks), 1000):
        group = pks[i:i + 1000]
        for pk, desc, analysis in (db.query(models.Entry.id, models.Entry.description, models.Entry.analysis_type)
                                   .filter(models.Entry.id.in_(group))):
            extra[pk] = (desc, analysis)
        for pk, value in (db.query(models.EntryTag.entry_id, models.Tag.value)
                          .join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
                          .filter(models.EntryTag.entry_id.in_(group))):
            tags[pk].append(value)
    return ident, entry_of, extra, tags


def _fallback_hits(db, user, terms, mode, restrict):
    """색인이 없는(대기·오래됨·실패) 보고서를 기존 검색으로 찾는다: {file_id: (맞은 검색어 수, 발췌)}.
    기존 검색은 낱말 AND 규칙이라, OR 는 낱말마다 부르고 구문은 낱말 AND 로 근사한다(색인되면 정확해진다)."""
    if not restrict or not terms:
        return {}
    queries = terms[:FALLBACK_OR_TERMS] if mode == "or" else [" ".join(terms)]
    hits = {}
    for qq in queries:
        for it in _search_items(db, user, qq, "relevance"):
            fid = it["file_id"]
            if fid not in restrict:
                continue
            count, snippets = hits.get(fid, (0, []))
            hits[fid] = (count + (1 if mode == "or" else len(terms)), snippets + (it.get("snippets") or []))
    return hits


# ---- 목록·검색 ----

def list_reports(db, user, store, *, q="", mode="and", retrieval="keyword", filters=None, sort="recent",
                 limit=50, offset=0):
    terms = query_terms(q, mode)
    base_sort = sort if sort in ("recent", "title") else "recent"
    items = _search_items(db, user, "", base_sort)
    ids = [it["file_id"] for it in items]
    ident, entry_of, extra, tags = _details(db, items)
    metas = report_catalog.meta_of(db, ids)
    counts = report_catalog.model_counts(db, user, [(fid, entry_of[fid]) for fid in ids if fid in entry_of])

    docs, index_available = {}, store is not None
    if store is not None:
        try:
            docs = store.document_rows(ids)
        except Exception:   # 색인 파일이 깨졌거나 잠겼어도 목록·기존 검색은 계속 된다
            log.exception("보고서 색인을 읽지 못했습니다 — 기존 검색으로 대신합니다")
            docs, index_available, store = {}, False, None

    rows, indexed = {}, set()
    for it in items:
        fid = it["file_id"]
        meta = metas.get(fid)
        # 23 — 저장된 값이 없으면 확장자 추정값(.ppt/.pptx → 발표자료)으로 거르고 세고 검색어를 맞춘다(document_type_auto)
        doc_type, doc_auto = report_catalog.effective_document_type(meta, it["name"])
        n = counts.get(fid, 0)
        doc = docs.get(fid)
        current = fid in ident and is_current(doc, **ident[fid])
        if current and doc.get("state") in INDEXED:
            indexed.add(fid)
        desc, analysis = extra.get(entry_of.get(fid), (None, None))
        rows[fid] = {
            "item": {**it, "scope": report_catalog.scope_of(hulls=it["hulls"], no_hull=it.get("no_hull")),
                     "document_type": doc_type, "document_type_auto": doc_auto, "model_count": n, "snippets": [],
                     "index_state": index_state(doc, current) if index_available else None,
                     "match_type": None},
            "doc": doc,
            "metadata": " ".join(str(v or "") for v in [it["name"], it.get("entry_title"), desc, analysis,
                                                        doc_type, *it.get("hulls", []),
                                                        *tags.get(entry_of.get(fid), [])]),
            "facet": {"scope": None, "document_type": doc_type or NONE,
                      "model": "yes" if n else "no"},
        }
        rows[fid]["facet"]["scope"] = rows[fid]["item"]["scope"]

    semantic_available, semantic_error = False, None
    if not terms:
        source = [rows[fid] for fid in ids]
        for r in source:
            r["item"]["score"] = 0
    else:
        matched = set(_keyword(db, user, store, rows, indexed, terms, mode))
        source = [rows[fid] for fid in ids if fid in matched]   # 목록 순서(최신순·이름순)를 유지한다
        semantic = []
        if retrieval == "hybrid" and store is not None:
            try:
                semantic = _semantic(store, rows, indexed - matched, q)
                semantic_available = True
            except Exception as exc:   # 의미 검색 서버 장애 — 키워드 결과는 그대로
                from .embeddings import EmbeddingUnavailable
                if not isinstance(exc, EmbeddingUnavailable):
                    log.exception("의미 추천 계산 실패")
                semantic_error = str(exc) if isinstance(exc, EmbeddingUnavailable) else "semantic_failed"
        want_semantic = [r for r in semantic if _passes(r, filters or {})]
        want_semantic.sort(key=lambda r: (-r["item"]["score"], r["item"]["file_id"]))
        source += want_semantic[:semantic_limit()]

    want = filters or {}
    passed = [r for r in source if _passes(r, want)]
    if terms:
        if sort == "title":
            passed.sort(key=lambda r: (normalize(r["item"]["name"]), r["item"]["file_id"]))
        elif sort == "recent":
            passed.sort(key=lambda r: (r["item"].get("posted_at") or "", r["item"]["file_id"]), reverse=True)
        else:
            # 키워드 일치 먼저(맞은 검색어 수가 많은 순), 그다음 의미 추천(유사도 순). 같으면 최신순(목록이 이미 최신순 — 안정 정렬)
            passed.sort(key=lambda r: (r["item"]["match_type"] != "keyword", -r["item"]["score"]))

    def facet(key):
        return Counter(r["facet"][key] for r in source if _passes(r, want, skip=key))

    page = passed[offset: offset + limit]
    # 24 — 이 쪽 문서마다 문서 분류를 고칠 수 있는지(올린 사람·LV3) — 여러 문서 한꺼번에 바꾸기 체크박스에 쓴다
    page_entries = {e.id: e for e in db.query(models.Entry).filter(
        models.Entry.id.in_({entry_of[r["item"]["file_id"]] for r in page if r["item"]["file_id"] in entry_of} or {0}))}
    for r in page:
        e = page_entries.get(entry_of.get(r["item"]["file_id"]))
        r["item"]["can_edit"] = bool(e is not None and access.can_edit_entry(user, e))
    result = {
        "total": len(passed),
        "items": [r["item"] for r in page],
        # 거르기 칸의 값과 건수 — 자기 칸만 빼고 센다(검색 필터 건수와 같은 셈법)
        "scopes": dict(facet("scope")),
        "document_types": {("" if k == NONE else k): v for k, v in facet("document_type").items()},
        "applied": {k: sorted(v) for k, v in want.items() if v},
        "index_available": index_available,
        # 23 — 문서 분류 목록과 빠른 구분 묶음은 서버 한 곳(models·report_catalog)에서 내려준다(프런트에 사본 없음)
        "document_type_options": list(report_catalog.DOCUMENT_TYPES),
        "document_type_groups": [dict(g, values=list(g["values"])) for g in report_catalog.DOCUMENT_TYPE_GROUPS],
    }
    if terms:
        result.update(keyword_total=sum(r["item"]["match_type"] == "keyword" for r in passed),
                      semantic_total=sum(r["item"]["match_type"] == "semantic" for r in passed),
                      semantic_available=semantic_available, semantic_error=semantic_error,
                      semantic_limit=semantic_limit(), semantic_exhaustive=False)
    return result


def _passes(row, want, skip=None):
    for key, values in want.items():
        if key != skip and values and row["facet"][key] not in values:
            return False
    return True


def _keyword(db, user, store, rows, indexed, terms, mode):
    """키워드에 맞은 file_id 목록(순서 무관). 맞은 행의 item 에 match_type·score·snippets 를 채운다."""
    meta_norm = {fid: normalize(r["metadata"]) for fid, r in rows.items()}
    all_ids = set(rows)
    found = {}   # file_id → (점수, 발췌 목록)
    if store is not None and indexed:
        with store.read() as sdb:
            per_term = [(store.keyword_files(t, db=sdb) & indexed) | {f for f in all_ids if contains(meta_norm[f], t)}
                        for t in terms]
            candidates = set.intersection(*per_term) if mode != "or" else set.union(*per_term)
            texts = store.chunk_texts(candidates & indexed, db=sdb)
        for fid in candidates & indexed:
            ok, hits, score = keyword_match(rows[fid]["metadata"], texts.get(fid, []), terms, mode)
            if ok:
                found[fid] = (score, [{"file_id": fid, "name": rows[fid]["item"]["name"], "locator": c.get("locator"),
                                       **make_snippet(c["text"], terms)} for c in hits[:MAX_SNIPPETS]])
    # 색인되지 않은 보고서: 메타데이터(설명·태그 포함) + 기존 검색(03a 본문)
    rest = all_ids - indexed
    for fid in rest:
        ok, _, score = keyword_match(rows[fid]["metadata"], [], terms, mode)
        if ok:
            found[fid] = (score, [])
    for fid, (score, snippets) in _fallback_hits(db, user, terms, mode, rest).items():
        old = found.get(fid, (0, []))
        found[fid] = (max(old[0], score), (old[1] + snippets)[:MAX_SNIPPETS])
    for fid, (score, snippets) in found.items():
        rows[fid]["item"].update(match_type="keyword", score=score, snippets=snippets)
    return list(found)


def _semantic(store, rows, candidates, q):
    """의미 추천 후보 행(임계값 이상, 상한 전). 같은 모델(digest)로 만든 벡터만 쓴다."""
    from .embeddings import embed_texts, embedding_identity

    identity = embedding_identity()
    allowed = [fid for fid in candidates
               if (rows[fid]["doc"] or {}).get("embedding_model") == identity and (rows[fid]["doc"] or {}).get("vector_count")]
    if not allowed:
        return []
    query = embed_texts([q])[0]
    best = store.semantic_best(identity, query, allowed, semantic_threshold())
    chunks = store.chunks_by_id([cid for _, cid in best.values()])
    out = []
    for fid, (score, cid) in best.items():
        chunk = chunks.get(cid)
        if not chunk or chunk["file_id"] != fid:
            continue
        item = rows[fid]["item"]
        item.update(match_type="semantic", score=score, snippets=[{
            "file_id": fid, "name": item["name"], "locator": chunk["locator"], **make_snippet(chunk["text"], [])}])
        out.append(rows[fid])
    return out
