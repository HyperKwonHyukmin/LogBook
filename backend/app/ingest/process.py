"""배치 처리: 제외·해시·분류·DRM·중복 → 묶음 제안 → 초안 Entry (설계 §5.2~5.4)."""
import logging
import os
import re
from datetime import datetime

from sqlalchemy.orm import Session

from .. import models
from ..entries.files import remove_empty_dirs
from ..storage.paths import StoragePaths, to_long
from .hashing import sha256_of
from .proposal import FileInfo, propose
from .rules import classify, is_excluded, safe_ext

MAX_REL_PATH = 1024  # models.File.rel_path 컬럼 길이
MAX_NAME = 255       # models.File.name 컬럼 길이

logger = logging.getLogger(__name__)

DRM_MAGIC = b"HHIDRMC"
WORD = re.compile(r"[0-9A-Za-z가-힣]+")


def _words(title: str) -> set[str]:
    return {w.lower() for w in WORD.findall(title or "")}


def _find_similar(db: Session, hull_no: str | None, title: str) -> int | None:
    if not hull_no:
        return None
    mine = _words(title)
    rows = (
        db.query(models.Entry)
        .join(models.EntryHull, models.EntryHull.entry_id == models.Entry.id)
        .filter(models.Entry.status == "confirmed", models.EntryHull.hull_no == hull_no)
        .all()
    )
    for e in rows:
        theirs = _words(e.title)
        if mine and theirs and len(mine & theirs) / len(mine | theirs) >= 0.5:
            return e.id
    return None


def process_batch(db: Session, storage: StoragePaths, batch: models.Batch) -> None:
    if batch.state != "staged":
        # 이미 처리됐거나(재시도로 큐에 중복 등록 등) 다른 상태면 아무것도 하지 않는다 —
        # 그대로 다시 돌면 File 행이 중복 생성된다(I4, 멱등성).
        logger.info("배치 %s 는 이미 %s 상태 — process_batch 를 건너뜀", batch.key, batch.state)
        return

    root = storage.staging / batch.key
    long_root = to_long(root)
    excluded: list[dict] = []
    infos: list[FileInfo] = []
    rows: dict[int, models.File] = {}

    def _onerror(exc: OSError) -> None:
        # os.walk 가 하위 폴더 하나를 못 읽어도(권한 등) 배치 전체를 실패시키지 않는다 —
        # 그 폴더 안 파일은 이번엔 못 건너뛰고 남지만, 나머지는 정상 처리된다.
        logger.warning("배치 %s 처리 중 하위 폴더를 읽지 못함(건너뜀): %s", batch.key, exc)

    for dirpath, _dirs, files in os.walk(long_root, onerror=_onerror):
        for name in files:
            full = os.path.join(dirpath, name)
            # rel 은 문자열을 직접 잘라 만든다(os.path.relpath 는 abspath 를 다시 타서
            # 끝 공백·점을 지워 버린다 — I1). dirpath 는 os.walk(long_root) 가 준 것이라
            # 항상 long_root 로 시작한다.
            rel = full[len(long_root) + 1:].replace("\\", "/")
            size = 0
            if len(rel) > MAX_REL_PATH or len(name) > MAX_NAME:
                excluded.append({"name": rel, "size": 0, "reason": "path_too_long"})
                continue
            try:
                size = os.path.getsize(full)
                if is_excluded(name):
                    os.remove(full)
                    excluded.append({"name": rel, "size": size})
                    continue
                with open(full, "rb") as fh:
                    head = fh.read(16)
                digest = sha256_of(full)
            except OSError as exc:
                # 파일 하나가 못 읽혀도(권한·레이스로 사라짐 등) 배치 전체는 계속 진행한다 —
                # 사유를 남겨 사람이 나중에 batches.excluded 화면에서 알 수 있게 한다.
                excluded.append({"name": rel, "size": size, "reason": str(exc)})
                logger.warning("배치 %s 처리 중 파일을 건너뜀: %s (%s)", batch.key, rel, exc)
                continue

            dup = (
                db.query(models.File.id)
                .filter(models.File.sha256 == digest, models.File.location == "vault")
                .first()
            )
            f = models.File(batch_id=batch.id, rel_path=rel, name=name, ext=safe_ext(name),
                            kind=classify(name), size=size, sha256=digest,
                            duplicate_of_id=dup[0] if dup else None,
                            drm_encrypted=head.startswith(DRM_MAGIC), location="staging")
            db.add(f)
            db.flush()
            rows[f.id] = f
            infos.append(FileInfo(key=f.id, rel_path=rel))

    known = {h for (h,) in db.query(models.Hull.hull_no)}
    created = 0
    for p in propose(infos, known):
        entry = models.Entry(title=p.title, status="draft", batch_id=batch.id, uploaded_by=batch.uploader,
                             hull_evidence=p.hull_candidates, merge_into_id=batch.target_entry_id)
        db.add(entry)
        db.flush()
        entry.entry_id = f"E{entry.id:06d}"
        if p.best_hull:
            db.add(models.EntryHull(entry_id=entry.id, hull_no=p.best_hull, is_primary=True))
        if batch.target_entry_id is None:
            entry.suggested_entry_id = _find_similar(db, p.best_hull, p.title)
        for key in p.file_keys:
            rows[key].entry_id = entry.id
        created += 1

    batch.excluded = excluded
    batch.processed_at = datetime.now().replace(microsecond=0)
    if created == 0:
        # 초안이 하나도 안 생겼다(전부 제외됨 등) — 확정할 것이 없으니 곧장 done 으로
        # 두고 staging 을 정리한다(M4). 그대로 'processed' 로 두면 아무도 확정하지
        # 않을 초안 없는 배치가 목록에 영원히 남는다.
        batch.state = "done"
        remove_empty_dirs(root)
    else:
        batch.state = "processed"
    db.commit()
