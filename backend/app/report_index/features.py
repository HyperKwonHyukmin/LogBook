"""32 — 보고서 한 건의 본문 특징(색인 조각에서 계산하는 파생값). 보고서 판(같은 자료 안)과 관계 지도의 문서 관계가 쓴다.

    minhash  본문(정규화·공백 제거) 5글자 조각 집합의 MinHash(64개) — 두 보고서의 본문 겹침(자카드) 추정.
             판(일부 고친 같은 보고서)은 높고, 같은 분야의 다른 보고서는 낮다(글자 단위 겹침이라 주제만 같으면 낮다).
    pages    쪽·슬라이드·시트 위치별 본문 해시 — 인접한 두 판의 '바뀐 쪽' 요약.
    vector   조각 벡터 평균(정규화, 색인의 임베딩 모델 기준) — '본문이 비슷한 보고서'(주제·내용이 가까움).

저장하지 않는다. API 프로세스 안에 파일별로 (색인 행의 sha256·indexed_at·벡터 수·모델) 열쇠와 함께 들고 있다가,
열쇠가 바뀐 파일만 다시 계산한다(색인 워커가 다시 색인하면 indexed_at 이 바뀐다). 서버를 다시 띄운 뒤에는 모든 보고서의
조각 본문을 한 번 읽어야 해서(보고서 232건에 약 30초) 서버 시작 때 미리 계산한다(warm, main.lifespan).
많이 계산할 때는 별도 프로세스에서 한다(CHILD_MIN — API 프로세스 안에서 돌면 같은 프로세스의 요청이 수십 배 느려졌다, 2026-11-23).

권한·현재성은 이 모듈이 보지 않는다 — 부르는 쪽이 볼 수 있고 '현재'인(search.current_document) 파일만 넘긴다.
"""
import logging
import re
import threading
import zlib
from dataclasses import dataclass

import numpy as np

from .store import GROUP

log = logging.getLogger(__name__)

SHINGLE = 5            # 글자 조각 길이 — 한국어 낱말 2~3개 정도
PERMS = 64             # MinHash 개수(자카드 추정 오차 약 ±0.06)
BAND_GROUP = 60        # 띠 하나에 같은 값이 몰린 보고서(같은 양식 사본 등) — 쌍 수가 제곱으로 늘지 않게
_SPACE = re.compile(r"\s+")
_PART = re.compile(r":part:\d+$")
_rng = np.random.default_rng(20261019)
_A = (_rng.integers(1, 2 ** 32, PERMS, dtype=np.uint64) | np.uint64(1))
_B = _rng.integers(0, 2 ** 32, PERMS, dtype=np.uint64)
_MASK = np.uint64(0xFFFFFFFF)


@dataclass(frozen=True)
class Feature:
    minhash: np.ndarray | None     # uint32[PERMS], 본문이 없으면 None
    pages: dict                    # 위치 → 본문 crc32
    vector: np.ndarray | None      # float32 정규화 평균 벡터
    model: str | None              # 벡터의 임베딩 모델(이름:digest)


def page_key(locator: str) -> str:
    """'page:3:part:2' → 'page:3', 'page:3:ocr' → 'page:3', 'sheet:요약' → 'sheet:요약'."""
    loc = _PART.sub("", locator or "")
    head, _, rest = loc.partition(":")
    if head in ("page", "slide", "notes"):
        return f"{head}:{rest.split(':', 1)[0]}"
    return loc or "body"


def minhash_of(text: str) -> np.ndarray | None:
    s = _SPACE.sub("", text)
    if len(s) < SHINGLE:
        return None
    hashes = np.unique(np.fromiter((zlib.crc32(s[i:i + SHINGLE].encode("utf-8")) for i in range(len(s) - SHINGLE + 1)),
                                   dtype=np.uint64))
    out = np.empty(PERMS, dtype=np.uint32)
    for start in range(0, hashes.size, 65536):   # 큰 보고서도 (64 × 조각) 행렬이 너무 커지지 않게 나눠 계산
        part = ((hashes[start:start + 65536][None, :] * _A[:, None] + _B[:, None]) & _MASK).min(axis=1)
        out = part.astype(np.uint32) if start == 0 else np.minimum(out, part.astype(np.uint32))
    return out


def jaccard(a: Feature | None, b: Feature | None) -> float | None:
    """두 보고서 본문 겹침 추정(0~1). 어느 한쪽이라도 본문이 없으면 None."""
    if a is None or b is None or a.minhash is None or b.minhash is None:
        return None
    return float(np.count_nonzero(a.minhash == b.minhash)) / PERMS


def page_changes(a: Feature | None, b: Feature | None) -> dict | None:
    """앞 판 a → 뒤 판 b: {pages_a, pages_b, changed, added, removed, overlap}. 특징이 없으면 None."""
    if a is None or b is None:
        return None
    ka, kb = set(a.pages), set(b.pages)
    return {"pages_a": len(ka), "pages_b": len(kb),
            "changed": sum(1 for k in ka & kb if a.pages[k] != b.pages[k]),
            "added": len(kb - ka), "removed": len(ka - kb), "overlap": jaccard(a, b)}


def _build(chunks: list[dict], vector: np.ndarray | None, model: str | None) -> Feature:
    pages: dict[str, list[str]] = {}
    for c in chunks:
        pages.setdefault(page_key(c["locator"]), []).append(_SPACE.sub(" ", c["norm"]).strip())
    return Feature(minhash=minhash_of(" ".join(c["norm"] for c in chunks)),
                   pages={k: zlib.crc32("\n".join(v).encode("utf-8")) for k, v in pages.items()},
                   vector=vector, model=model)


_lock = threading.Lock()
# 계산은 한 번에 하나만 — 서버 시작 때의 미리 계산(warm)과 첫 관계 지도 요청이 겹치면 같은 보고서를 두 번 계산하지 않고
# 뒤 요청이 기다렸다가 캐시를 쓴다. 캐시에 다 있으면 잠금 안에서도 금방 끝난다.
_compute_lock = threading.Lock()
_cache: dict[str, dict[int, tuple[tuple, Feature]]] = {}   # 색인 경로 → {file_id: (열쇠, 특징)}


def clear_cache():
    with _lock:
        _cache.clear()


def _key(doc) -> tuple:
    return (doc["sha256"], doc["indexed_at"], doc["vector_count"], doc["embedding_model"])


def features(store, file_ids) -> dict[int, Feature]:
    """file_id → 특징. 색인되지 않았거나(ready·partial 아님) 조각이 없는 파일은 결과에 없다."""
    ids = sorted(set(file_ids))
    if store is None or not ids:
        return {}
    with _compute_lock:
        return _features(store, ids)


# 2026-11-23 — 새로 계산할 보고서가 이만큼 이상이면 별도 프로세스에서 계산한다. 계산은 파이썬 반복(본문 글자마다 crc32)이라
# API 프로세스 안의 스레드에서 돌면 파이썬 잠금(GIL)을 거의 놓지 않고, 그동안 같은 프로세스의 요청은 DB 를 한 번 오갈 때마다
# 잠금을 다시 기다린다. 145 측정: Update 60초 뒤 미리 계산이 돈 35초 동안 검색 0.25 → 27.8초, 화면 JS 0.1 → 3.0초(흰 화면).
# 적게(색인 워커가 한두 건 다시 색인) 바뀐 것은 프로세스를 띄우는 비용(약 1~2초)이 더 커서 이 프로세스에서 바로 계산한다.
CHILD_MIN = 8
CHILD_TIMEOUT = 180   # 145 보고서 232건 약 30초. 넘기면 자식을 끝내고 이 프로세스에서 계산한다


def warm(store) -> int:
    """색인된 모든 보고서의 특징을 미리 계산해 캐시에 넣는다(서버 시작 때 백그라운드에서 한 번). 넣은 수를 돌려준다.
    이것이 없으면 서버를 다시 띄운 뒤 관계 지도를 처음 연 사람이 모든 보고서 본문을 읽는 시간을 기다린다(145 보고서 232건에서 약 30초,
    2026-11-18 사용자 신고 — 본문 글자당 약 1.2µs). 2026-11-23 — 한 번에 넘겨 별도 프로세스가 계산한다(CHILD_MIN).
    예전(11-19)의 '4건씩 끊고 쉬기'로는 잠금 문제가 풀리지 않았다."""
    if store is None:
        return 0
    with store.read() as db:
        ids = [row["file_id"] for row in db.execute(
            "SELECT file_id FROM documents WHERE active=1 AND state IN ('ready', 'partial') AND chunk_count > 0")]
    return len(features(store, ids))


def _docs(store, ids, db=None) -> dict:
    """색인 행 중 특징을 계산할 수 있는 것(ready·partial 이고 조각이 있음)."""
    return {fid: d for fid, d in store.document_rows(ids, db=db).items()
            if d["state"] in ("ready", "partial") and d["chunk_count"]}


def _compute(store, ids: list[int]) -> dict[int, tuple[tuple, Feature]]:
    """ids 의 특징을 색인 조각에서 새로 계산한다(캐시를 보지도 채우지도 않는다). file_id → (열쇠, 특징)."""
    fresh: dict[int, tuple[tuple, Feature]] = {}
    with store.read() as db:
        docs = _docs(store, ids, db=db)
        todo = [fid for fid in ids if fid in docs]
        for i in range(0, len(todo), GROUP):
            group = todo[i:i + GROUP]
            marks = ",".join("?" * len(group))
            chunks: dict[int, list[dict]] = {fid: [] for fid in group}
            for row in db.execute(f"SELECT file_id, locator, norm FROM chunks WHERE file_id IN ({marks}) "
                                  "ORDER BY file_id, seq", group):
                chunks[row["file_id"]].append({"locator": row["locator"], "norm": row["norm"]})
            sums: dict[int, np.ndarray] = {}
            for fid, data in db.execute(
                    f"SELECT v.file_id, v.data FROM vectors v JOIN documents d ON d.file_id = v.file_id "
                    f"WHERE v.file_id IN ({marks}) AND v.model = d.embedding_model", group):
                vec = np.frombuffer(data, dtype="<f4")
                if fid in sums and sums[fid].shape == vec.shape:
                    sums[fid] = sums[fid] + vec
                elif fid not in sums:
                    sums[fid] = vec.astype(np.float32)
            for fid in group:
                vec = sums.get(fid)
                if vec is not None:
                    norm = float(np.linalg.norm(vec))
                    vec = (vec / norm).astype(np.float32) if norm > 0 else None
                feat = _build(chunks[fid], vec, docs[fid]["embedding_model"] if vec is not None else None)
                fresh[fid] = (_key(docs[fid]), feat)
    return fresh


def _compute_child(index_path: str, ids: list[int]) -> dict[int, tuple[tuple, Feature]]:
    """별도 프로세스(spawn)에서 돈다 — 색인을 경로로 다시 열어 계산하고 결과만 돌려준다."""
    from .store import open_store
    return _compute(open_store(index_path), ids)


def _run_child(fn, args: tuple, timeout: float):
    """fn(*args) 를 새 프로세스(spawn) 하나에서 돌려 결과를 돌려준다. 기다리는 동안 이 프로세스는 잠금(GIL)을 놓고 있어 다른 요청이 그대로 돈다.
    timeout 을 넘기면 자식을 끝내고 TimeoutError — `with ProcessPoolExecutor` 는 빠져나갈 때 자식이 끝날 때까지 기다려
    타임아웃이 무의미했다(Codex 검토 2026-11-23). 3.11 에는 실행 중인 작업을 끝내는 공개 API 가 없어 풀의 프로세스를 직접 끝낸다.
    API 프로세스가 강제로 꺼지면(Server Manager Update/Stop) 자식은 남아 계산을 마치고(최대 약 30초) 부모가 없어 스스로 끝난다."""
    import multiprocessing
    from concurrent.futures import ProcessPoolExecutor

    pool = ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context("spawn"))
    try:
        return pool.submit(fn, *args).result(timeout=timeout)
    except TimeoutError:
        for proc in list((getattr(pool, "_processes", None) or {}).values()):
            proc.terminate()
        raise
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


def _compute_out_of_process(store, ids: list[int]) -> dict[int, tuple[tuple, Feature]]:
    """새로 계산할 것을 별도 프로세스에서 계산한다(CHILD_MIN)."""
    return _run_child(_compute_child, (str(store.path), ids), CHILD_TIMEOUT)


def _features(store, ids: list[int]) -> dict[int, Feature]:
    path = str(store.path.resolve())
    out: dict[int, Feature] = {}
    with store.read() as db:
        docs = _docs(store, ids, db=db)
    with _lock:
        cached = dict(_cache.get(path, {}))
    todo = []
    for fid, d in docs.items():
        hit = cached.get(fid)
        if hit and hit[0] == _key(d):
            out[fid] = hit[1]
        else:
            todo.append(fid)
    if not todo:
        return out
    fresh = None
    if len(todo) >= CHILD_MIN:
        try:
            fresh = _compute_out_of_process(store, todo)
        except Exception:  # noqa: BLE001 — 프로세스를 못 띄우면(권한, 보안 프로그램 등) 예전처럼 이 프로세스에서
            log.warning("보고서 특징을 별도 프로세스에서 계산하지 못해 이 프로세스에서 계산합니다", exc_info=True)
    if fresh is None:
        fresh = _compute(store, todo)
    fresh = {fid: v for fid, v in fresh.items() if fid in docs}
    for fid, (_k, feat) in fresh.items():
        out[fid] = feat
    with _lock:
        _cache.setdefault(path, {}).update(fresh)
    return out


def similar_pairs(feats: dict[int, Feature], threshold: float, top: int = 3) -> dict[frozenset, float]:
    """평균 벡터 코사인 ≥ threshold 인 쌍 — 보고서마다 가장 가까운 top 개까지만(지도가 실타래가 되지 않게).
    모델이 다른 벡터끼리는 비교하지 않는다."""
    out: dict[frozenset, float] = {}
    by_model: dict[tuple, list[tuple[int, np.ndarray]]] = {}
    for fid, f in feats.items():
        if f.vector is not None:
            by_model.setdefault((f.model, f.vector.size), []).append((fid, f.vector))
    for rows in by_model.values():
        if len(rows) < 2:
            continue
        fids = [fid for fid, _v in rows]
        ids = np.array(fids)
        mat = np.stack([v for _fid, v in rows]).astype(np.float32)
        for start in range(0, len(fids), 1024):
            sims = mat[start:start + 1024] @ mat.T
            for r in range(sims.shape[0]):
                i = start + r
                sims[r, i] = -1.0
                k = min(top, len(fids) - 1)
                best = np.argpartition(-sims[r], k - 1)[:k] if k > 0 else []
                for j in best:
                    s = float(sims[r, j])
                    if s >= threshold:
                        key = frozenset((int(ids[i]), int(ids[j])))
                        out[key] = max(out.get(key, 0.0), s)
    return out


def text_pairs(feats: dict[int, Feature], threshold: float) -> dict[frozenset, float]:
    """MinHash 띠 나누기(16띠 × 4개)로 후보를 뽑아 본문 겹침 ≥ threshold 인 쌍 — 모든 쌍을 비교하지 않는다."""
    bands: dict[tuple, list[int]] = {}
    for fid, f in feats.items():
        if f.minhash is None:
            continue
        for b in range(PERMS // 4):
            bands.setdefault((b, f.minhash[b * 4:(b + 1) * 4].tobytes()), []).append(fid)
    out: dict[frozenset, float] = {}
    seen: set[frozenset] = set()
    for fids in bands.values():
        if len(fids) < 2:
            continue
        fids = fids[:BAND_GROUP]
        for i in range(len(fids)):
            for j in range(i + 1, len(fids)):
                key = frozenset((fids[i], fids[j]))
                if key in seen:
                    continue
                seen.add(key)
                score = jaccard(feats[fids[i]], feats[fids[j]])
                if score is not None and score >= threshold:
                    out[key] = score
    return out
