"""32 — 보고서 한 건의 본문 특징(색인 조각에서 계산하는 파생값). 보고서 판(같은 자료 안)과 관계 지도의 문서 관계가 쓴다.

    minhash  본문(정규화·공백 제거) 5글자 조각 집합의 MinHash(64개) — 두 보고서의 본문 겹침(자카드) 추정.
             판(일부 고친 같은 보고서)은 높고, 같은 분야의 다른 보고서는 낮다(글자 단위 겹침이라 주제만 같으면 낮다).
    pages    쪽·슬라이드·시트 위치별 본문 해시 — 인접한 두 판의 '바뀐 쪽' 요약.
    vector   조각 벡터 평균(정규화, 색인의 임베딩 모델 기준) — '본문이 비슷한 보고서'(주제·내용이 가까움).

저장하지 않는다. API 프로세스 안에 파일별로 (색인 행의 sha256·indexed_at·벡터 수·모델) 열쇠와 함께 들고 있다가,
열쇠가 바뀐 파일만 다시 계산한다(색인 워커가 다시 색인하면 indexed_at 이 바뀐다). 서버를 다시 띄운 뒤 첫 요청은 모든 보고서의
조각 본문을 한 번 읽는다(보고서 수천 건이면 수 초).

권한·현재성은 이 모듈이 보지 않는다 — 부르는 쪽이 볼 수 있고 '현재'인(search.current_document) 파일만 넘긴다.
"""
import re
import threading
import zlib
from dataclasses import dataclass

import numpy as np

from .store import GROUP

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
    path = str(store.path.resolve())
    out: dict[int, Feature] = {}
    with store.read() as db:
        docs = {fid: d for fid, d in store.document_rows(ids, db=db).items()
                if d["state"] in ("ready", "partial") and d["chunk_count"]}
        with _lock:
            cached = dict(_cache.get(path, {}))
        todo = []
        for fid, d in docs.items():
            hit = cached.get(fid)
            if hit and hit[0] == _key(d):
                out[fid] = hit[1]
            else:
                todo.append(fid)
        fresh: dict[int, tuple[tuple, Feature]] = {}
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
                out[fid] = feat
    with _lock:
        bucket = _cache.setdefault(path, {})
        bucket.update(fresh)
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
