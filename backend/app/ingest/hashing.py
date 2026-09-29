"""SHA-256. WorkBench app/services/model_registry_storage.py 의 sha256_of 를 이식(긴 경로 대응 추가)."""
import hashlib
import os

from ..storage.paths import to_long


def sha256_of(path: str | os.PathLike) -> str:
    h = hashlib.sha256()
    with open(to_long(path), "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()
