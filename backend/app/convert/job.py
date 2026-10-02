"""convert_model 작업 — BDF 를 읽어 model.lbm·썸네일·지문을 만든다(설계 §7)."""
import logging
import os
from pathlib import Path

from sqlalchemy.orm import Session

from .. import jobs, models
from ..bdf.deck import DeckReader, DeckTooLarge
from ..bdf.fingerprint import fingerprint
from ..bdf.lbm import write_lbm
from ..bdf.model import ModelError, build_model
from ..bdf.thumbnail import render_thumbnail
from ..entries.files import entry_dir
from ..entries.locate import FileUnavailable
from ..storage.paths import StoragePaths, long_join, to_long

log = logging.getLogger(__name__)
# 본 파일 + INCLUDE 바이트 합의 상한 — 워커 한 프로세스가 파싱 중 드는 메모리(바이트의 수 배)를 묶는다
MAX_MODEL_BYTES = 600 * 1024 ** 2
DRM_MAGIC = b"HHIDRMC"
MAX_WARNINGS = 50
MAX_SOL_CHARS = 20          # ModelSummary.sol 칸 길이
RETRY_ERRORS = ("no_elements",)
# 이전 변환 결과(key 와 파생물)를 계속 보여 줄 수 있는 상태 — 재변환 대기 중이거나 재변환이 실패했을 때
SERVABLE_STATES = ("done", "queued", "failed")


class EncryptedFile(OSError):
    """DRM 암호문 — INCLUDE 쪽에서는 '찾지 못함'으로, 본 파일이면 skipped(drm)으로 다룬다."""


class FileMoved(OSError):
    """읽는 동안 파일이 옮겨졌다(확정 staging → vault 등) — 작업 큐가 재시도해 새 위치에서 다시 읽는다."""


def model_paths(storage: StoragePaths, key: str) -> tuple[Path, Path]:
    base = storage.derived / "_model" / key[:2]
    return base / f"{key}.lbm", base / f"{key}.png"


def enqueue_convert(db: Session, f: models.File) -> bool:
    """변환 작업을 넣는다. 이전 결과(key·지문 FileText)는 지우지 않는다 — 재변환이 끝날 때까지 뷰어·검색이
    이전 결과를 계속 쓴다."""
    if f.kind != "model":
        return False
    row = db.get(models.ModelSummary, f.id)
    if row is None:
        db.add(models.ModelSummary(file_id=f.id, state="queued"))
    else:
        row.state, row.error = "queued", None
    jobs.enqueue(db, "convert_model", f.id)
    return True


def _row(db: Session, f: models.File) -> models.ModelSummary:
    row = db.get(models.ModelSummary, f.id)
    if row is None:
        row = models.ModelSummary(file_id=f.id)
        db.add(row)
    return row


def _finish(db: Session, row: models.ModelSummary, state: str, error: str | None = None) -> None:
    row.state, row.error = state, (error or None) and error[:500]
    # 실패해도 이전 결과(key)가 있으면 지문은 남긴다 — 뷰어가 이전 결과를 계속 보여 주는 것과 맞춘다
    keep_text = state == "done" or (state == "failed" and row.key)
    if not keep_text:
        db.query(models.FileText).filter_by(file_id=row.file_id, locator="model").delete(synchronize_session=False)
    db.commit()


def _root(db: Session, storage: StoragePaths, f: models.File) -> Path:
    if f.location == "staging":
        batch = db.get(models.Batch, f.batch_id)
        if batch is None:
            raise FileUnavailable("batch_missing")
        return storage.staging / batch.key
    if f.location == "vault":
        entry = db.get(models.Entry, f.entry_id) if f.entry_id else None
        if entry is None or not entry.vault_rel:
            raise FileUnavailable("entry_missing")
        return entry_dir(storage, entry) / "files"
    raise FileUnavailable(f.location)


def _siblings(db: Session, f: models.File) -> list[models.File]:
    q = db.query(models.File).filter(models.File.kind == "model", models.File.id != f.id,
                                     models.File.location == f.location)
    q = q.filter(models.File.batch_id == f.batch_id) if f.location == "staging" \
        else q.filter(models.File.entry_id == f.entry_id)
    return q.all()


def _included_by_sibling(db: Session, f: models.File, siblings: list[models.File]) -> bool:
    if not siblings:
        return False
    me = f.rel_path.casefold()
    rows = db.query(models.ModelSummary).filter(
        models.ModelSummary.file_id.in_([s.id for s in siblings]), models.ModelSummary.state == "done").all()
    return any(me in {r.casefold() for r in (row.includes or [])} for row in rows)


def _mark_included(db: Session, siblings: list[models.File], includes: list[str]) -> None:
    wanted = {r.casefold() for r in includes}
    for s in siblings:
        if s.rel_path.casefold() in wanted:
            row = _row(db, s)
            row.state, row.error = "include", None
            row.warnings = []  # 단독 변환 때 남은 경고(missing_node 등)는 include 파일에 의미가 없다
            db.query(models.FileText).filter_by(file_id=s.id, locator="model").delete(synchronize_session=False)


def _requeue_dropped(db: Session, siblings: list[models.File], before: list[str], after: list[str]) -> None:
    """예전에는 INCLUDE 해서 include 로 표시했지만 이제는 하지 않는 형제를 다시 변환 대기열에 넣는다.
    (다른 본 파일이 여전히 INCLUDE 하면 그 형제의 변환이 _included_by_sibling 으로 다시 include 가 된다.)"""
    dropped = {r.casefold() for r in before} - {r.casefold() for r in after}
    if not dropped:
        return
    for s in siblings:
        if s.rel_path.casefold() in dropped:
            r = db.get(models.ModelSummary, s.id)
            if r is not None and r.state == "include":
                enqueue_convert(db, s)


def _opener(root: Path):
    def read(rel: str) -> bytes:
        with open(long_join(root, rel), "rb") as fh:
            # 파일 하나가 상한을 넘으면 읽기 전에 멈춘다(누적 상한은 DeckReader 가 본다)
            if os.fstat(fh.fileno()).st_size > MAX_MODEL_BYTES:
                raise DeckTooLarge(rel)
            data = fh.read()
        if data.startswith(DRM_MAGIC):
            raise EncryptedFile(rel)
        return data
    return read


def mark_failed(db: Session, file_id: int, error: str) -> None:
    """변환 작업이 재시도 끝에 최종 실패했을 때 상태를 failed 로 남긴다(워커가 부른다).
    이전 결과(key·지문)는 남겨 뷰어가 계속 쓴다."""
    f = db.get(models.File, file_id)
    if f is None:
        return
    _finish(db, _row(db, f), "failed", error)


def _write(path: Path, data: bytes) -> None:
    os.makedirs(to_long(path.parent), exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(to_long(tmp), "wb") as fh:
        fh.write(data)
    os.replace(to_long(tmp), to_long(path))


def run_convert(db: Session, storage: StoragePaths, f: models.File) -> None:
    row = _row(db, f)
    previous_includes = list(row.includes or [])
    if f.location == "trash":
        if row.state == "done":
            return
        return _finish(db, row, "skipped", "trashed")
    if f.drm_encrypted:
        return _finish(db, row, "skipped", "drm")
    if f.size > MAX_MODEL_BYTES:
        return _finish(db, row, "skipped", "too_large")

    root = _root(db, storage, f)
    siblings = _siblings(db, f)
    if _included_by_sibling(db, f, siblings):
        _requeue_dropped(db, siblings, previous_includes, [])
        row.includes = []
        return _finish(db, row, "include")

    where = (f.location, f.rel_path, f.entry_id)
    reader = DeckReader(_opener(root), max_bytes=MAX_MODEL_BYTES)
    try:
        cards = reader.read(f.rel_path)
    except EncryptedFile:
        f.drm_encrypted = True
        return _finish(db, row, "skipped", "drm")
    except DeckTooLarge:
        reader = None
        return _finish(db, row, "skipped", "too_large")
    except MemoryError:
        reader = None           # 붙잡은 카드를 먼저 놓아 준다
        log.warning("BDF 변환 메모리 부족: file=%s %s", f.id, f.name)
        return _finish(db, row, "failed", "memory_error")
    # 그 밖의 OSError(파일 없음·잠김)는 위로 — 작업 큐가 재시도한다

    # 읽는 동안 확정 등으로 파일이 옮겨졌으면 결과를 옛 위치 기준으로 남기지 않고 다시 돈다.
    # 커밋으로 트랜잭션을 끝내야(MySQL REPEATABLE READ) 다른 세션이 커밋한 이동이 보인다.
    db.commit()
    db.refresh(f)
    if (f.location, f.rel_path, f.entry_id) != where:
        raise FileMoved(f"변환 중 파일이 옮겨짐: {where[1]} → {f.rel_path}")

    row.includes, row.missing = reader.includes, reader.missing
    _requeue_dropped(db, siblings, previous_includes, reader.includes)
    try:
        model = build_model(cards, sol=reader.sol, warnings=reader.warnings,
                            includes=reader.includes, missing=reader.missing)
        if model.element_total() == 0:
            row.warnings = model.warnings[:MAX_WARNINGS]
            _mark_included(db, siblings, reader.includes)
            return _finish(db, row, "skipped", "no_elements")
        lbm = write_lbm(model)
        png = render_thumbnail(model)
        fp = fingerprint(model)
    except ModelError as exc:   # 모델이 표시 규칙을 벗어났다(예: int32 를 넘는 ID)
        log.warning("BDF 변환 실패: file=%s %s — %s", f.id, f.name, exc.code)
        return _finish(db, row, "failed", exc.code)
    except MemoryError:
        cards = model = reader.cards = None
        log.warning("BDF 변환 메모리 부족: file=%s %s", f.id, f.name)
        return _finish(db, row, "failed", "memory_error")
    except Exception as exc:  # 모델이 깨졌다 — 다시 돌려도 같으니 실패로 기록하고 끝낸다
        log.warning("BDF 변환 실패: file=%s %s — %s", f.id, f.name, exc)
        return _finish(db, row, "failed", f"{type(exc).__name__}: {exc}")
    del cards

    key = reader.digest
    lbm_path, png_path = model_paths(storage, key)
    _write(lbm_path, lbm)       # 실패(OSError)는 위로 — 재시도
    _write(png_path, png)

    row.state, row.error, row.key = "done", None, key
    row.counts, row.bbox = model.counts(), model.bbox()
    row.sol = model.sol[:MAX_SOL_CHARS] if model.sol else None
    row.fingerprint, row.warnings = fp, model.warnings[:MAX_WARNINGS]
    db.query(models.FileText).filter_by(file_id=f.id, locator="model").delete(synchronize_session=False)
    db.add(models.FileText(file_id=f.id, seq=0, locator="model", text=fp))
    _mark_included(db, siblings, reader.includes)
    db.commit()


def requeue_entry_models(db: Session, entry_id: int) -> int:
    """파일이 더해진 Entry 에서 INCLUDE 를 못 찾았던·실패했던 모델을 다시 변환한다(설계 §7.7)."""
    n = 0
    files = db.query(models.File).filter_by(entry_id=entry_id, kind="model").all()
    rows = {r.file_id: r for r in db.query(models.ModelSummary)
            .filter(models.ModelSummary.file_id.in_([x.id for x in files] or [0]))}
    for f in files:
        r = rows.get(f.id)
        if r is None or r.missing or r.state == "failed" or (r.state == "skipped" and r.error in RETRY_ERRORS):
            n += enqueue_convert(db, f)
    return n
