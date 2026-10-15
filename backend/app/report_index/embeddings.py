"""22 — 로컬 Ollama 임베딩(의미 추천용, 선택 기능). 프로토콜: https://docs.ollama.com/api/embed

외부(클라우드) 대체 경로는 없다. 실패해도 키워드 검색은 그대로 동작해야 하므로 호출하는 쪽이 EmbeddingUnavailable 을 처리한다.
⚠ Ollama 는 WorkBench AI(qwen2.5:7b·BGE-M3)와 같은 서버(127.0.0.1:11434)를 함께 쓴다.
"""
import os
import threading
import time

import httpx
import numpy as np

BATCH = 16                 # 한 번에 보내는 문장 수
IDENTITY_TTL = 60.0        # 모델 확인(/api/tags) 결과를 들고 있는 시간(초) — 상태 요청마다 HTTP 를 부르지 않게


class EmbeddingUnavailable(RuntimeError):
    pass


def endpoint():
    return os.getenv("LOGBOOK_REPORT_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")


def model_name():
    return os.getenv("LOGBOOK_REPORT_EMBED_MODEL", "bge-m3:latest")


_identity_lock = threading.Lock()
_identity_cache: dict = {}   # (endpoint, model) → (확인 시각, 결과 또는 예외 코드)


def clear_identity_cache():
    with _identity_lock:
        _identity_cache.clear()


def _fetch_identity():
    try:
        response = httpx.get(endpoint() + "/api/tags", timeout=3)
        response.raise_for_status()
        for model in response.json().get("models", []):
            if model.get("name") == model_name() or model.get("model") == model_name():
                # 모델 digest 를 붙여, 같은 이름이라도 다시 받은 모델의 벡터를 섞지 않는다
                return model_name() + ":" + model["digest"]
        raise EmbeddingUnavailable("embedding_model_not_installed")
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        raise EmbeddingUnavailable("embedding_server_unavailable") from exc


def embedding_identity(max_age=IDENTITY_TTL):
    """설치된 임베딩 모델의 '이름:digest'. max_age 초 안의 확인 결과(성공·실패 모두)는 다시 쓴다(0 = 늘 새로 확인)."""
    key = (endpoint(), model_name())
    now = time.monotonic()
    if max_age > 0:
        with _identity_lock:
            hit = _identity_cache.get(key)
        if hit and now - hit[0] < max_age:
            if isinstance(hit[1], EmbeddingUnavailable):
                raise EmbeddingUnavailable(str(hit[1]))
            return hit[1]
    try:
        value = _fetch_identity()
    except EmbeddingUnavailable as exc:
        with _identity_lock:
            _identity_cache[key] = (now, exc)
        raise
    with _identity_lock:
        _identity_cache[key] = (now, value)
    return value


def embed_texts(texts):
    """문장들을 단위 길이 float32 벡터로. 수·차원·유한값을 확인하고, 하나라도 어긋나면 전체를 실패로 본다."""
    values = list(texts)
    if not values:
        return []
    try:
        output = []
        for start in range(0, len(values), BATCH):
            batch = values[start:start + BATCH]
            response = httpx.post(endpoint() + "/api/embed", json={
                "model": model_name(), "input": batch, "truncate": False,
            }, timeout=60)
            response.raise_for_status()
            vectors = response.json()["embeddings"]
            if len(vectors) != len(batch):
                raise ValueError("incomplete_vectors")
            for vector in vectors:
                array = np.asarray(vector, dtype=np.float64)
                norm = float(np.sqrt(np.dot(array, array))) if array.ndim == 1 and array.size else 0.0
                if not norm or not np.isfinite(norm) or not np.all(np.isfinite(array)):
                    raise ValueError("invalid_vector")
                output.append((array / norm).astype(np.float32))
        if len({v.shape[0] for v in output}) != 1:
            raise ValueError("inconsistent_vector_dimensions")
        return output
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        raise EmbeddingUnavailable("embedding_request_failed") from exc


def to_blob(vector) -> bytes:
    """float32 리틀 엔디언 바이트(SQLite BLOB 저장용)."""
    return np.asarray(vector, dtype="<f4").tobytes()


def from_blob(data: bytes):
    return np.frombuffer(data, dtype="<f4")
