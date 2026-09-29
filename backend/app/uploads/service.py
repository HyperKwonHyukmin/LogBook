"""크롬 업로드 — 배치를 'uploading' 으로 만들고 조각을 00_Inbox\\_web\\<key> 에 이어 쓴 뒤
마치면 폴더째 _staging 으로 옮겨 02a 의 process_batch 흐름에 태운다(설계 §5.1)."""
import logging
import os
import re
import shutil
import time
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import audit, jobs, models
from ..ingest.inbox import new_batch_key
from ..ingest.process import MAX_NAME, MAX_REL_PATH
from ..storage.paths import StoragePaths, long_join, to_long

log = logging.getLogger("logbook.uploads")

# 윈도우 파일 이름에 쓸 수 없는 글자 + 제어 문자
_BAD_CHARS = re.compile(r'[<>:"|?*\x00-\x1f]')
# 윈도우 예약 장치 이름 — 확장자가 붙어도(nul.txt) 장치로 열린다
_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}


def _bad_part(p: str) -> bool:
    return (p in ("", ".", "..") or len(p) > MAX_NAME or _BAD_CHARS.search(p) is not None
            # 끝의 점·공백은 윈도우가 조용히 잘라 버려 다른 이름과 겹칠 수 있다
            or p != p.rstrip(". ")
            or p.split(".", 1)[0].upper() in _RESERVED)


def clean_rel(rel: str) -> str:
    """브라우저가 보낸 상대경로(webkitRelativePath 등)를 posix 로 정규화하고 검증한다.
    절대경로·드라이브·`..`·`.`·빈 조각·금지 문자·끝 점/공백·예약 장치 이름·길이 초과는
    422 invalid_path."""
    # 앞 공백만 걷는다 — 끝 공백은 잘라 이름을 바꾸지 않고 아래 검사에서 거부한다
    value = (rel or "").lstrip().replace("\\", "/")
    parts = value.split("/")
    if not value or len(value) > MAX_REL_PATH or any(_bad_part(p) for p in parts):
        raise HTTPException(status_code=422, detail="invalid_path")
    return value


def begin(db: Session, storage: StoragePaths, user: models.User, *, name: str,
          target_entry_id: str | None) -> models.Batch:
    if not storage.check_reachable():
        raise HTTPException(status_code=503, detail="storage_unreachable")
    target = None
    if target_entry_id:
        target = db.query(models.Entry).filter_by(entry_id=target_entry_id.strip().upper()).first()
        if target is None or target.status != "confirmed":
            raise HTTPException(status_code=422, detail="target_not_confirmed")
    key = new_batch_key()
    os.makedirs(to_long(storage.web_inbox / key), exist_ok=True)
    batch = models.Batch(key=key, source="web", original_name=(name or "").strip()[:255] or key,
                         uploader=user.employee_id, uploader_guess=user.employee_id, state="uploading",
                         target_entry_id=target.id if target else None)
    db.add(batch)
    db.commit()
    return batch


MAX_CHUNK = 8 * 1024 * 1024 + 1024  # 브라우저 조각 8MB + 여유
DRM_MAGIC = b"HHIDRMC"
RENAME_ATTEMPTS = 3        # 백신·색인기가 핸들을 잠깐 잡고 있으면 rename 이 PermissionError 로 실패한다
RENAME_RETRY_DELAY = 0.5   # 초


def _uploading(db: Session, user: models.User, key: str) -> models.Batch:
    batch = db.query(models.Batch).filter_by(key=key, source="web").first()
    if batch is None:
        raise HTTPException(status_code=404, detail="upload_not_found")
    if batch.uploader != user.employee_id:
        raise HTTPException(status_code=403, detail="not_uploader")
    if batch.state != "uploading":
        raise HTTPException(status_code=409, detail="not_uploading")
    return batch


def write_chunk(db: Session, storage: StoragePaths, user: models.User, key: str, rel: str,
                offset: int, data: bytes) -> int:
    """조각을 이어 쓰고 쓴 뒤의 파일 크기를 돌려준다. offset 0 은 처음부터 다시 쓴다(재시도).
    첫 조각이 회사 DRM 머리(HHIDRMC)로 시작하면 그 파일은 받지 않는다(설계 §5.1)."""
    _uploading(db, user, key)
    rel = clean_rel(rel)
    if len(data) > MAX_CHUNK:
        raise HTTPException(status_code=413, detail="chunk_too_large")
    path = long_join(storage.web_inbox / key, rel)
    if offset == 0:
        if data.startswith(DRM_MAGIC):
            if os.path.exists(path):
                os.remove(path)
            raise HTTPException(status_code=422, detail="drm_encrypted")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(data)
        return len(data)
    size = os.path.getsize(path) if os.path.exists(path) else 0
    if offset != size:
        raise HTTPException(status_code=409, detail={"code": "offset_mismatch", "size": size})
    with open(path, "ab") as fh:
        fh.write(data)
    return size + len(data)


def _remove_undeclared(root: str, declared: set[str]) -> None:
    """선언되지 않은 파일을 지우고, 그 때문에 빈 폴더가 남으면 아래에서부터 지운다.
    윈도우 파일 시스템은 대소문자를 가리지 않으므로 casefold 로 비교한다(declared 도 casefold)."""
    for dirpath, _dirs, names in os.walk(root):
        for name in names:
            full = os.path.join(dirpath, name)
            rel = full[len(root) + 1:].replace("\\", "/")
            if rel.casefold() not in declared:
                os.remove(full)
    for dirpath, _dirs, _names in os.walk(root, topdown=False):
        if dirpath != root and not os.listdir(dirpath):
            os.rmdir(dirpath)


def _rename_with_retry(src: str, dst: str) -> None:
    for attempt in range(1, RENAME_ATTEMPTS + 1):
        try:
            os.rename(src, dst)
            return
        except PermissionError:
            if attempt == RENAME_ATTEMPTS:
                raise
            log.warning("폴더 옮기기가 잠겨 있어 다시 시도합니다(%d/%d): %s", attempt, RENAME_ATTEMPTS, src)
            time.sleep(RENAME_RETRY_DELAY)


def finish(db: Session, storage: StoragePaths, user: models.User, key: str, *,
           files: list[dict], rejected: list[dict]) -> models.Batch:
    batch = _uploading(db, user, key)
    if not files:
        raise HTTPException(status_code=422, detail="no_files")
    # 입력 검증은 전부 폴더를 옮기기 전에 끝낸다(옮긴 뒤 실패하면 되돌리기가 필요해진다).
    excluded = [{"name": clean_rel(r["rel_path"]), "size": 0, "reason": r.get("reason") or "drm"}
                for r in rejected]
    root = to_long(storage.web_inbox / key)
    declared: set[str] = set()
    for f in files:
        rel = clean_rel(f["rel_path"])
        if rel.casefold() in declared:
            raise HTTPException(status_code=422, detail={"code": "duplicate_path", "rel_path": rel})
        path = long_join(storage.web_inbox / key, rel)
        if not os.path.exists(path) or os.path.getsize(path) != int(f["size"]):
            raise HTTPException(status_code=422, detail={"code": "incomplete", "rel_path": rel})
        declared.add(rel.casefold())
    _remove_undeclared(root, declared)
    dest = to_long(storage.staging / key)
    _rename_with_retry(root, dest)  # 같은 공유 폴더 안 rename — 평문 유지(PoC 실험 2)
    try:
        batch.excluded = excluded
        batch.state = "staged"
        db.flush()
        jobs.enqueue(db, "process_batch", batch.id)
        db.commit()
    except Exception:
        db.rollback()
        try:
            os.rename(dest, root)  # DB 가 실패하면 폴더를 되돌려 다시 마칠 수 있게 한다
        except OSError:
            log.exception("업로드 %s 폴더를 되돌리지 못했습니다(_staging 에 남음) — 원래 오류를 그대로 올립니다", key)
        raise
    # 감사 기록 실패가 이미 끝난 업로드를 되돌리면 안 된다 — 로그만 남긴다.
    try:
        audit.record(db, storage, actor=user.employee_id, action="BATCH_RECEIVED", target_type="batch",
                     target_id=key, after={"name": batch.original_name, "files": len(declared),
                                           "source": "web", "rejected": len(excluded)})
    except Exception:
        db.rollback()
        log.exception("업로드 %s 의 감사 기록 실패(업로드는 완료됨)", key)
    return batch


def _remove_folder(path: str, parent: str) -> bool:
    """폴더를 지운다. 이미 없으면 성공, 공유 폴더 끊김 등으로 못 지우면 False.
    ⚠ 끊긴 UNC 경로의 rmtree 도 FileNotFoundError(WinError 53/67)를 낸다 — 부모(`_web`)가
    보일 때만 '이미 지워짐'으로 본다."""
    try:
        shutil.rmtree(path)
    except FileNotFoundError:
        if not os.path.isdir(parent):
            log.warning("업로드 폴더의 부모가 보이지 않습니다(공유 끊김?): %s", parent)
            return False
    except OSError as exc:
        log.warning("업로드 폴더를 지우지 못했습니다: %s — %s", path, exc)
        return False
    return not os.path.exists(path)


def cancel(db: Session, storage: StoragePaths, user: models.User, key: str) -> None:
    batch = _uploading(db, user, key)
    # 폴더를 못 지웠는데 행을 지우면 _web 에 영원히 고아로 남는다 — 행을 두고 503.
    # 실패한 업로드 직후 브라우저가 곧바로 취소를 보내므로 공유 끊김과 자주 겹친다.
    if not storage.check_reachable():
        raise HTTPException(status_code=503, detail="storage_unreachable")
    if not _remove_folder(to_long(storage.web_inbox / key), to_long(storage.web_inbox)):
        raise HTTPException(status_code=503, detail="storage_unreachable")
    db.delete(batch)
    db.commit()


STALE_AFTER = timedelta(hours=24)


def cleanup_stale(db: Session, storage: StoragePaths, older_than: timedelta = STALE_AFTER) -> int:
    """브라우저를 닫아 끝나지 못한 업로드(uploading 으로 24시간 넘게 멈춤)를 지운다.
    폴더를 실제로 지운 배치만 행을 지운다(공유 폴더가 끊겼으면 다음 주기에 다시 본다)."""
    if not storage.check_reachable():
        return 0
    cutoff = datetime.now() - older_than
    rows = db.query(models.Batch).filter(models.Batch.source == "web", models.Batch.state == "uploading",
                                         models.Batch.received_at < cutoff).all()
    removed = 0
    for batch in rows:
        if not _remove_folder(to_long(storage.web_inbox / batch.key), to_long(storage.web_inbox)):
            continue
        db.delete(batch)
        removed += 1
    db.commit()
    return removed
