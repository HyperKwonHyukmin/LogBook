"""solve_check 작업 — 원본 BDF 가 Nastran 에서 실제로 도는지 확인해 solve_checks 에 남긴다(06).

원본 불변: 원본(Vault·staging)은 'rb' 로 읽기만 한다. 해석용 BDF 는 워커 PC 의 로컬 임시 폴더
(tempfile.mkdtemp — 공유 폴더 아님)에만 만들고 끝나면 폴더째 지운다. 남기는 것은 f06 하나뿐이고
파생 폴더 `20_Derived/_solve/<key[:2]>/<key>.f06` 에 둔다(.lbm·썸네일과 같은 취급, key = 읽은 원본 바이트의 sha256).
"""
import logging
import os
import shutil
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Callable

from sqlalchemy.orm import Session

from .. import jobs, models
from ..bdf.deck import DeckTooLarge
from ..bdf.model import ModelError, build_model
from ..config import settings
from ..convert.job import MAX_MODEL_BYTES, EncryptedFile, _opener, _root, _write
from ..entries.locate import FileUnavailable
from ..storage.paths import StoragePaths, to_long
from .deck import IncludeMissing, fixed_nodes, pick_sid, read_bulk, used_sids, write_deck
from .f06 import error_result, judge
from .runner import NastranMissing, run_nastran

log = logging.getLogger(__name__)
JOB_TYPE = "solve_check"
ACTIVE_STATES = ("queued", "running")
MAX_FIXED_IDS = 20_000          # fixed_node_ids 에 남기는 최대 개수(spc_nodes 는 전체 수)
DECK_NAME = "deck.bdf"
RESULT_FIELDS = ("error_types", "fatals", "warning_count", "message", "spc_nodes", "groups", "fixed_node_ids",
                 "elapsed", "model_key", "finished_at")


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def f06_path(storage: StoragePaths, key: str) -> Path:
    return storage.derived / "_solve" / key[:2] / f"{key}.f06"


# ── 대기열 ────────────────────────────────────────────────────────────────

def enqueue_solve(db: Session, f: models.File, requested_by: str | None) -> models.SolveCheck:
    """검증 작업을 넣는다(커밋은 호출자). 이미 queued/running 이면 그대로 둔다.
    이전 결과는 지운다 — 다시 검증하면 덮어쓰는 값이다."""
    row = db.get(models.SolveCheck, f.id)
    if row is not None and row.state in ACTIVE_STATES:
        return row
    if row is None:
        row = models.SolveCheck(file_id=f.id)
        db.add(row)
    row.state = "queued"
    for name in RESULT_FIELDS:
        setattr(row, name, None)
    row.has_f06 = False
    row.requested_by, row.requested_at = requested_by, _now()
    jobs.enqueue(db, JOB_TYPE, f.id)
    return row


def enqueue_solve_all(db: Session, *, force: bool = False, requested_by: str | None = None) -> int:
    """변환이 끝난(done) 휴지통 밖 모델 중 검증 기록이 없는 것을 넣는다(force: queued/running 이 아닌 것 전부)."""
    q = (db.query(models.File).join(models.ModelSummary, models.ModelSummary.file_id == models.File.id)
         .filter(models.File.kind == "model", models.File.location != "trash", models.ModelSummary.state == "done")
         .order_by(models.File.id))
    files = q.all()
    rows = {r.file_id: r.state for r in db.query(models.SolveCheck)
            .filter(models.SolveCheck.file_id.in_([f.id for f in files] or [0]))}
    n = 0
    for f in files:
        state = rows.get(f.id)
        if state in ACTIVE_STATES or (state is not None and not force):
            continue
        enqueue_solve(db, f, requested_by)
        n += 1
    db.commit()
    return n


# ── 응답 모양 ──────────────────────────────────────────────────────────────

def is_stale(row: models.SolveCheck | None, summary: models.ModelSummary | None) -> bool:
    """검증한 원본(model_key)과 지금 변환 결과(ModelSummary.key)가 다르면 '다시 검증 필요'."""
    return bool(row is not None and row.model_key is not None
                and (summary is None or summary.key != row.model_key))


def brief(row: models.SolveCheck | None, summary: models.ModelSummary | None) -> dict:
    """GET /model 에 붙이는 요약."""
    return {"state": row.state if row else None, "error_types": (row.error_types or []) if row else [],
            "stale": is_stale(row, summary)}


def describe(db: Session, row: models.SolveCheck | None, summary: models.ModelSummary | None) -> dict:
    """GET /solve-check 응답(프런트가 이 모양에 기댄다)."""
    if row is None:
        return {"state": None, "error_types": [], "fatals": [], "warning_count": None, "message": None,
                "spc_nodes": None, "groups": None, "fixed_node_ids": [], "elapsed": None, "stale": False,
                "has_f06": False, "requested_by": None, "requested_by_name": None, "requested_at": None,
                "finished_at": None}
    user = (db.query(models.User).filter_by(employee_id=row.requested_by).first()
            if row.requested_by else None)
    return {"state": row.state, "error_types": row.error_types or [], "fatals": row.fatals or [],
            "warning_count": row.warning_count, "message": row.message, "spc_nodes": row.spc_nodes,
            "groups": row.groups, "fixed_node_ids": row.fixed_node_ids or [],
            "elapsed": row.elapsed, "stale": is_stale(row, summary), "has_f06": bool(row.has_f06),
            "requested_by": row.requested_by, "requested_by_name": user.name if user else None,
            "requested_at": row.requested_at.isoformat() if row.requested_at else None,
            "finished_at": row.finished_at.isoformat() if row.finished_at else None}


# ── 실행 ──────────────────────────────────────────────────────────────────

def _finish(db: Session, row: models.SolveCheck, verdict: dict, started: float, **extra) -> None:
    row.state = verdict["state"]
    row.error_types = verdict["error_types"]
    row.fatals = verdict["fatals"]
    row.warning_count = verdict["warning_count"]
    row.message = verdict["message"]
    for name, value in extra.items():
        setattr(row, name, value)
    row.elapsed = round(time.monotonic() - started, 2)
    row.finished_at = _now()
    db.commit()


def mark_failed(db: Session, file_id: int, error: str) -> None:
    """작업이 재시도 끝에 최종 실패했을 때(워커가 부른다) — queued/running 으로 영영 남지 않게."""
    row = db.get(models.SolveCheck, file_id)
    if row is None:
        return
    row.state, row.error_types = "error", ["other"]
    row.message = f"검증 작업 실패: {error}"[:500]
    row.finished_at = _now()
    db.commit()


def _rmtree(path: str) -> None:
    """임시 폴더 지우기 — 막 끝난 Nastran 이 파일을 잠깐 쥐고 있을 수 있어 몇 번 다시 해 본다."""
    for _ in range(5):
        shutil.rmtree(path, ignore_errors=True)
        if not os.path.exists(path):
            return
        time.sleep(1)
    log.warning("해석 검증 임시 폴더를 지우지 못했습니다: %s", path)


def run_solve_check(db: Session, storage: StoragePaths, file_id: int, *,
                    runner: Callable = run_nastran, heartbeat: Callable[[], None] | None = None,
                    nastran_exe: str | None = None, timeout: float | None = None) -> None:
    f = db.get(models.File, file_id)
    if f is None:
        return
    row = db.get(models.SolveCheck, file_id)
    if row is None:
        row = models.SolveCheck(file_id=file_id)
        db.add(row)
    started = time.monotonic()
    summary = db.get(models.ModelSummary, file_id)
    if f.location == "trash" or summary is None or summary.state != "done":
        return _finish(db, row, error_result("model_not_ready", "모델 변환이 끝나지 않아 검증하지 않았습니다"),
                       started)
    row.state = "running"
    db.commit()

    exe = nastran_exe or settings.nastran_exe
    tmp = tempfile.mkdtemp(prefix="logbook_solve_")      # 워커 PC 로컬 임시 폴더
    try:
        try:
            root = _root(db, storage, f)
        except FileUnavailable as exc:
            return _finish(db, row, error_result("file_missing", f"원본을 찾을 수 없습니다: {exc}"), started)
        body = os.path.join(tmp, "_bulk.txt")
        try:
            with open(body, "w", encoding="utf-8", newline="\n") as fh:
                reader = read_bulk(_opener(root), f.rel_path, lambda line: fh.write(line + "\n"),
                                   max_bytes=MAX_MODEL_BYTES)
        except IncludeMissing as exc:
            return _finish(db, row, error_result("include_missing", f"INCLUDE 누락: {exc}"), started)
        except EncryptedFile:
            return _finish(db, row, error_result("drm", "DRM 으로 암호화된 파일이라 읽을 수 없습니다"), started)
        except DeckTooLarge:
            return _finish(db, row, error_result("too_large", "모델이 너무 큽니다"), started)
        # 그 밖의 OSError(파일 없음·잠김)는 위로 — 작업 큐가 재시도한다

        key = reader.digest
        try:
            model = build_model(reader.cards, sol=reader.sol)
        except ModelError as exc:
            return _finish(db, row, error_result("model_error", f"모델을 읽지 못했습니다: {exc.code}"), started,
                           model_key=key)
        nodes, groups = fixed_nodes(model)
        sid = pick_sid(used_sids(reader.cards))
        del reader, model
        common = {"model_key": key, "spc_nodes": len(nodes), "groups": groups,
                  "fixed_node_ids": nodes[:MAX_FIXED_IDS]}

        with open(os.path.join(tmp, DECK_NAME), "w", encoding="utf-8", newline="\n") as out:
            write_deck(out, body, sid, nodes)
        os.remove(body)

        try:
            res = runner(exe, tmp, DECK_NAME, timeout=timeout or settings.solve_timeout, heartbeat=heartbeat)
        except NastranMissing:
            return _finish(db, row, error_result("nastran_missing", f"Nastran 실행 파일이 없습니다: {exe}"),
                           started, **common)
        data = None
        if res.f06_path:
            with open(res.f06_path, "rb") as fh:
                data = fh.read()
        verdict = judge(data.decode("latin-1") if data else None, log_text=res.log_text, timed_out=res.timed_out)
        has_f06 = False
        if data:
            _write(f06_path(storage, key), data)      # 실패(OSError)는 위로 — 재시도
            has_f06 = True
        _finish(db, row, verdict, started, has_f06=has_f06, **common)
        log.info("해석 검증: file=%s %s → %s %s (%.1fs)", f.id, f.name, row.state, row.error_types or "", row.elapsed)
    finally:
        _rmtree(tmp)


def read_f06(storage: StoragePaths, row: models.SolveCheck) -> bytes | None:
    """보관한 f06 바이트(없으면 None). DRM 환경에서도 read() 로 받은 바이트를 그대로 준다."""
    if not row.has_f06 or not row.model_key:
        return None
    try:
        with open(to_long(f06_path(storage, row.model_key)), "rb") as fh:
            return fh.read()
    except FileNotFoundError:
        return None
