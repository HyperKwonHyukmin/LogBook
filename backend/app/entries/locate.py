"""File 행 → 공유 폴더 안 실제 경로(긴 경로 접두사 포함)."""
from sqlalchemy.orm import Session

from .. import models
from ..storage.paths import StoragePaths, long_join
from .files import entry_dir


class FileUnavailable(Exception):
    """파일이 휴지통에 있거나 배치·Entry 정보가 없어 경로를 만들 수 없다."""


def file_path(db: Session, storage: StoragePaths, f: models.File) -> str:
    try:
        return _file_path(db, storage, f)
    except ValueError as exc:  # long_join 이 '..'·절대경로 조각을 거부했다 — 잘못된 rel_path
        raise FileUnavailable("bad_rel_path") from exc


def _file_path(db: Session, storage: StoragePaths, f: models.File) -> str:
    if f.location == "staging":
        batch = db.get(models.Batch, f.batch_id)
        if batch is None:
            raise FileUnavailable("batch_missing")
        return long_join(storage.staging / batch.key, f.rel_path)
    if f.location == "vault":
        entry = db.get(models.Entry, f.entry_id) if f.entry_id else None
        if entry is None or not entry.vault_rel:
            raise FileUnavailable("entry_missing")
        return long_join(entry_dir(storage, entry) / "files", f.rel_path)
    raise FileUnavailable(f.location)
