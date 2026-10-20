# backend/app/audit.py
"""감사 로그 — DB(audit_log) + 999_LogBook/90_System/audit/YYYY-MM.jsonl 이중 기록.

호출자는 데이터를 바꾼 뒤 커밋하지 않고 record() 를 부른다. record() 가 감사 행과 함께
한 번에 커밋하므로 "변경은 됐는데 기록이 없는" 상태가 생기지 않는다.
파일 기록은 공유 폴더가 끊겨도 요청을 실패시키지 않는다(DB 가 우선, 경고만 남김).
"""
import json
import logging
import os
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from . import models
from .storage.paths import StoragePaths, to_long

log = logging.getLogger("logbook.audit")

# 남기지 않기로 한 기록(2026-10-20) — 열람 허락·회수. 예전 기록은 purge_not_kept() 로 DB·파일에서 지운다
NOT_KEPT = ("ENTRY_GRANT", "ENTRY_REVOKE")


def record(
    db: Session,
    storage: StoragePaths,
    *,
    actor: str | None,
    action: str,
    target_type: str,
    target_id: str,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    ip: str | None = None,
) -> models.AuditLog:
    row = models.AuditLog(
        at=datetime.now().replace(microsecond=0),
        employee_id=actor,
        action=action,
        target_type=target_type,
        target_id=str(target_id),
        before=before,
        after=after,
        ip=ip,
    )
    line, at = _jsonl_line(row), row.at   # 커밋 전에 만든다 — 커밋 뒤 refresh 가 실패해도 쓸 수 있게
    db.add(row)
    db.commit()
    # 여기부터는 이미 커밋된 뒤다 — 예외를 올리지 않는다(리뷰 M3). 호출자는 record() 의 예외를 '커밋 안 됨'으로
    # 보고 파일 이동을 되돌리는데, 커밋 뒤에 되돌리면 DB 는 vault/trash 인데 파일은 옛 자리로 간다
    try:
        db.refresh(row)
    except Exception:  # noqa: BLE001
        log.warning("감사 행 다시 읽기 실패(커밋은 됨): %s %s", action, target_id, exc_info=True)
    try:
        _append_jsonl(storage, line, at)
    except Exception:  # noqa: BLE001
        log.warning("감사 로그 파일 기록 실패(DB 기록은 유지): %s %s", action, target_id, exc_info=True)
    return row


def _jsonl_line(row: models.AuditLog) -> str:
    return json.dumps(
        {
            "at": row.at.isoformat(timespec="seconds"),
            "employee_id": row.employee_id,
            "action": row.action,
            "target": {"type": row.target_type, "id": row.target_id},
            "before": row.before,
            "after": row.after,
            "ip": row.ip,
        },
        ensure_ascii=False,
        default=str,
    )


def _append_jsonl(storage: StoragePaths, line: str, at: datetime) -> None:
    try:
        os.makedirs(to_long(storage.audit_dir), exist_ok=True)
        path = storage.audit_dir / f"{at:%Y-%m}.jsonl"
        # 단일 uvicorn 워커 가정: append 는 워커가 하나일 때만 원자적으로 안전하다(여러 워커면 줄 섞임 가능).
        with open(to_long(path), "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError as exc:
        log.warning("감사 로그 파일 기록 실패(DB 기록은 유지): %s", exc)


def purge_not_kept(db: Session, storage: StoragePaths, *, apply: bool = False) -> dict:
    """NOT_KEPT 기록을 DB(audit_log)와 감사 파일(*.jsonl)에서 지운다. apply=False 면 건수만 센다.

    재구축(rebuild)이 jsonl 을 다시 읽으므로 파일에서도 빼야 돌아오지 않는다. 파일은 남길 줄만 임시 파일에 쓰고
    바꿔 끼운다(읽을 수 없는 줄은 그대로 둔다). 돌려주는 값: {"db": 건수, "files": {파일명: 건수}, "applied": bool}."""
    q = db.query(models.AuditLog).filter(models.AuditLog.action.in_(NOT_KEPT))
    n_db = q.count()
    files: dict[str, int] = {}
    try:
        names = sorted(n for n in os.listdir(to_long(storage.audit_dir)) if n.endswith(".jsonl"))
    except OSError:
        names = []
    for name in names:
        path = storage.audit_dir / name
        with open(to_long(path), encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
        keep = [ln for ln in lines if not _not_kept_line(ln)]
        if len(keep) == len(lines):
            continue
        files[name] = len(lines) - len(keep)
        if apply:
            tmp = storage.audit_dir / (name + ".tmp")
            with open(to_long(tmp), "w", encoding="utf-8", newline="") as fh:
                fh.writelines(keep)
            os.replace(to_long(tmp), to_long(path))
    if apply and n_db:
        q.delete(synchronize_session=False)
        db.commit()
    return {"db": n_db, "files": files, "applied": apply}


def _not_kept_line(line: str) -> bool:
    if not any(a in line for a in NOT_KEPT):   # 빠른 거르기 — 대부분의 줄은 json 을 풀지 않는다
        return False
    try:
        return json.loads(line).get("action") in NOT_KEPT
    except (ValueError, AttributeError):
        return False
