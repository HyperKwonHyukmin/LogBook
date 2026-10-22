"""상태 확인(로그인 불필요)과 감사 로그 조회(로그인 사용자 누구나 — 설계 §8 '활동 로그')."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import access, models
from ..config import APP_VERSION
from ..database import get_db
from ..dependencies import get_storage, require_auth
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/system/health")
def health(storage: StoragePaths = Depends(get_storage)):
    return {
        "ok": True,
        "version": APP_VERSION,
        # 죽은 공유 폴더에 요청이 물리지 않도록 timeout+캐시가 있는 check_reachable() 사용.
        "storage": {"root": str(storage.root), "reachable": storage.check_reachable()},
    }


@router.get("/audit")
def list_audit(
    limit: int = Query(default=100, ge=1, le=500),
    action: str | None = None,
    employee_id: str | None = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_auth),
):
    q = db.query(models.AuditLog)
    if not access.is_admin(user):
        # 13 — 볼 수 없는 Entry(와 그 파일)에 대한 기록은 SQL 조건으로 뺀다(limit 건수가 맞게).
        # 숨은 번호·파일 id 는 먼저 읽어 값 목록으로 넘긴다 — 표끼리 문자열을 직접 비교하면 정렬 규칙(collation)이 섞인다
        E, F = models.Entry, models.File
        hidden = ~access.visible_entries_filter(user)
        hidden_entries = [e for (e,) in db.query(E.entry_id).filter(E.entry_id.isnot(None), hidden)]
        hidden_files = [str(i) for (i,) in db.query(F.id).join(E, E.id == F.entry_id).filter(hidden)]
        if hidden_entries:
            q = q.filter(~((models.AuditLog.target_type == "entry") & models.AuditLog.target_id.in_(hidden_entries)))
        if hidden_files:
            q = q.filter(~((models.AuditLog.target_type == "file") & models.AuditLog.target_id.in_(hidden_files)))
    if action:
        q = q.filter_by(action=action)
    if employee_id:
        q = q.filter_by(employee_id=employee_id.upper())
    rows = q.order_by(models.AuditLog.at.desc(), models.AuditLog.id.desc()).limit(limit)
    # 47 — 바뀐 내용(before/after)은 관리자만. 위 거르개는 '지금 있는' Entry 만 가려서, 영구 삭제·합치기로
    # 사라진 비공개 자료의 제목·설명이나 다른 기록 안에 적힌 자료 번호가 새어 나간다. 활동 로그 화면은 내용을 쓰지 않는다
    detail = access.is_admin(user)
    return [
        {
            "id": r.id,
            "at": r.at.isoformat(timespec="seconds"),
            "employee_id": r.employee_id,
            "action": r.action,
            "target": {"type": r.target_type, "id": r.target_id},
            "before": r.before if detail else None,
            "after": r.after if detail else None,
        }
        for r in rows
    ]
