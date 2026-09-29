"""extract_file 작업 — 파일 본문을 뽑아 file_texts·file_extracts 에 넣는다(설계 §5.2)."""
import logging
import re

from sqlalchemy.orm import Session

from .. import jobs, models
from ..entries.locate import file_path
from ..storage.paths import StoragePaths
from . import can_extract, extract_bytes
from .store import load_cached, save_cached

log = logging.getLogger(__name__)

MAX_FILE_BYTES = 200 * 1024 * 1024
DRM_MAGIC = b"HHIDRMC"
DOC_HULL_SCORE = 5
DOC_HULL_CHUNKS = 3  # 표지·첫 장 근처에서만 찾는다(본문 깊숙한 숫자는 호선이 아닐 가능성이 크다)

# "HULL NO. 9999", "Hull No 9999", "호선: 9999", "호선번호 9999", "9999 호선"
# 뒤에 '년' 이 붙은 숫자는 연도다("호선 2026년 검토") — 호선으로 보지 않는다.
_HULL_BEFORE = re.compile(r"(?:HULL\s*(?:NO\.?|NUMBER)?|호선\s*(?:번호)?)\s*[:：.]?\s*(\d{4})(?!\d)(?!\s*년)",
                          re.IGNORECASE)
_HULL_AFTER = re.compile(r"(?<!\d)(\d{4})\s*호선")


def enqueue_extract(db: Session, f: models.File) -> bool:
    """추출할 수 있는 파일이면 대기 행과 작업을 만든다(커밋은 호출자)."""
    if not can_extract(f.ext):
        return False
    row = db.get(models.FileExtract, f.id)
    if row is None:
        db.add(models.FileExtract(file_id=f.id, state="queued"))
    else:
        row.state, row.error = "queued", None
    jobs.enqueue(db, "extract_file", f.id)
    return True


def _row(db: Session, f: models.File) -> models.FileExtract:
    row = db.get(models.FileExtract, f.id)
    if row is None:
        row = models.FileExtract(file_id=f.id)
        db.add(row)
    return row


def _finish(db: Session, row: models.FileExtract, state: str, error: str | None = None) -> None:
    row.state, row.error = state, (error or None) and error[:500]
    if state != "done":
        db.query(models.FileText).filter_by(file_id=row.file_id).delete(synchronize_session=False)
        row.chars = 0
    db.commit()


def mark_failed(db: Session, file_id: int, error: str) -> None:
    """추출 작업이 재시도 끝에 최종 실패했을 때 상태를 failed 로 남긴다(워커가 부른다)."""
    if db.get(models.File, file_id) is None:
        return
    row = db.get(models.FileExtract, file_id)
    if row is None:
        row = models.FileExtract(file_id=file_id)
        db.add(row)
    _finish(db, row, "failed", error)


def find_doc_hull(chunks: list[tuple[str, str]]) -> str | None:
    for _loc, text in chunks[:DOC_HULL_CHUNKS]:
        m = _HULL_BEFORE.search(text) or _HULL_AFTER.search(text)
        if m:
            return m.group(1)
    return None


def _apply_doc_hull(db: Session, f: models.File, hull_no: str) -> None:
    if not f.entry_id:
        return
    # 확정·사용자 수정(PATCH)과 겹치지 않게 Entry 행을 잠그고, 잠근 뒤의 최신 상태로 다시 본다
    # (populate_existing 이 없으면 이 세션에 먼저 올라온 오래된 status 를 그대로 쓴다).
    entry = db.get(models.Entry, f.entry_id, with_for_update=True, populate_existing=True)
    if entry is None or entry.status != "draft":
        return
    reason = f"보고서 본문: {f.name}"
    evidence = [dict(c) for c in (entry.hull_evidence or [])]
    cand = next((c for c in evidence if c.get("hull_no") == hull_no), None)
    if cand is None:
        cand = {"hull_no": hull_no, "score": 0, "reasons": []}
        evidence.append(cand)
    if reason not in cand["reasons"]:
        cand["score"] += DOC_HULL_SCORE
        cand["reasons"] = [*cand["reasons"], reason]
    evidence.sort(key=lambda c: (-c["score"], c["hull_no"]))
    entry.hull_evidence = evidence  # 새 리스트를 대입해야 JSON 열 변경이 잡힌다
    if db.query(models.EntryHull).filter_by(entry_id=entry.id).count() == 0:
        db.add(models.EntryHull(entry_id=entry.id, hull_no=hull_no, is_primary=True))


def run_extract(db: Session, storage: StoragePaths, f: models.File) -> None:
    row = _row(db, f)
    if f.location == "trash":
        # 휴지통에 간 파일은 복원될 수 있다 — 이미 뽑아 둔 본문은 지우지 않고 그대로 둔다
        # (지우면 복원 뒤 검색에서 영영 빠진다). 뽑은 적이 없으면 건너뜀으로만 기록한다.
        if row.state != "done":
            row.state, row.error = "skipped", "trashed"
        db.commit()
        return
    if f.drm_encrypted:
        return _finish(db, row, "skipped", "drm")
    if f.size > MAX_FILE_BYTES:
        return _finish(db, row, "skipped", "too_large")

    result = load_cached(storage, f.sha256)
    if result is None:
        with open(file_path(db, storage, f), "rb") as fh:  # OSError·FileUnavailable → 작업 재시도
            data = fh.read()
        if data.startswith(DRM_MAGIC):
            f.drm_encrypted = True
            return _finish(db, row, "skipped", "drm")
        try:
            result = extract_bytes(f.ext, data)
        except Exception as exc:  # 문서가 깨졌다 — 다시 돌려도 같으니 실패로 기록하고 끝낸다
            log.warning("본문 추출 실패: file=%s %s — %s", f.id, f.name, exc)
            return _finish(db, row, "failed", f"{type(exc).__name__}: {exc}")
        save_cached(storage, f.sha256, result)

    db.query(models.FileText).filter_by(file_id=f.id).delete(synchronize_session=False)
    for seq, (loc, text) in enumerate(result.chunks):
        db.add(models.FileText(file_id=f.id, seq=seq, locator=loc[:120], text=text))
    row.state, row.error = "done", None
    row.summary = {**result.summary, "truncated": result.truncated}
    row.chars = result.chars
    hull_no = find_doc_hull(result.chunks)
    if hull_no:
        _apply_doc_hull(db, f, hull_no)
    db.commit()
