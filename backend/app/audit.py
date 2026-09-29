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
    db.add(row)
    db.commit()
    db.refresh(row)
    _append_jsonl(storage, row)
    return row


def _append_jsonl(storage: StoragePaths, row: models.AuditLog) -> None:
    line = json.dumps(
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
    )
    try:
        os.makedirs(to_long(storage.audit_dir), exist_ok=True)
        path = storage.audit_dir / f"{row.at:%Y-%m}.jsonl"
        # 단일 uvicorn 워커 가정: append 는 워커가 하나일 때만 원자적으로 안전하다(여러 워커면 줄 섞임 가능).
        with open(to_long(path), "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError as exc:
        log.warning("감사 로그 파일 기록 실패(DB 기록은 유지): %s", exc)
