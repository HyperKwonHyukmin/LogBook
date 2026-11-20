"""66 — '올리고 바로 확정'(폴더 올리기 창의 체크 칸). 정리(process_batch)가 끝난 묶음에서 사람이 볼 것이 없는 초안을
올린 사람 이름으로 곧바로 확정한다. 나머지는 '올리기와 확정'에 남기고 이유를 묶음에 적는다.

건너뛰는 초안(화면 '이 묶음 모두 확정' 52 의 규칙 + 더 조심스럽게 두 가지):
- 제목 없음
- 똑같은 BDF 가 이미 있어 받지 않은 모델이 있음(blocked_models)
- 권상 Wire 모델 요청(MU 자료인데 Wire 모델이 없음, 49)
- 같은 파일이 다른 자료나 초안에 이미 있음(두 번 올린 것일 수 있다, 62)
- 기존 자료에 추가하라는 제안이 있음(suggested_entry — 새 판일 수 있다)
호선 없음은 막지 않는다(확정 뒤 '보완 필요', 43).

결과는 batch.preset['auto_result'] = {confirmed: [E…], kept: [{entry_id, reason}]} 로 남겨 화면이 단계 표시에 쓴다."""
import logging

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..storage.paths import StoragePaths

logger = logging.getLogger(__name__)

KEY = "auto_confirm"
RESULT_KEY = "auto_result"


def wanted(batch: models.Batch) -> bool:
    return isinstance(batch.preset, dict) and bool(batch.preset.get(KEY)) and batch.target_entry_id is None


def skip_reason(d: dict) -> str:
    """entry_to_dict(viewer=올린 사람) 결과로 사람이 볼 것이 있는지. 없으면 ''."""
    if not (d.get("title") or "").strip():
        return "제목 없음"
    if d.get("blocked_models"):
        return "똑같은 BDF 가 이미 있음"
    files = [f for f in d.get("files") or [] if f.get("location") != "trash"]
    lift = d.get("lifting") or {}
    blocked_wire = any(b.get("lifting") for b in d.get("blocked_models") or [])
    if lift.get("needed") and not lift.get("has_wire") and not any(f.get("lifting") for f in files) and not blocked_wire:
        return "권상 Wire 모델 확인"
    if any(f.get("duplicate_of_entry") for f in files):
        return "같은 파일이 이미 있음"
    if d.get("suggested_entry"):
        return "기존 자료에 추가할지 확인"
    return ""


def run(db: Session, storage: StoragePaths, batch: models.Batch) -> dict | None:
    """process_batch 끝(묶음 processed 커밋 뒤)에서 부른다. 초안마다 따로 확정해 하나가 실패해도 나머지는 간다."""
    from ..entries import service

    if not wanted(batch) or batch.state != "processed":
        return None
    user = db.query(models.User).filter_by(employee_id=batch.uploader).first() if batch.uploader else None
    drafts = (db.query(models.Entry).filter_by(batch_id=batch.id, status="draft")
              .order_by(models.Entry.id).all())
    confirmed, kept = [], []
    for e in drafts:
        if user is None:
            kept.append({"entry_id": e.entry_id, "reason": "올린 사람을 찾지 못함"})
            continue
        reason = skip_reason(service.entry_to_dict(db, e, viewer=user))
        if reason:
            kept.append({"entry_id": e.entry_id, "reason": reason})
            continue
        try:
            service.confirm(db, storage, e, user)
            confirmed.append(e.entry_id)
        except HTTPException as exc:
            db.rollback()
            kept.append({"entry_id": e.entry_id, "reason": _reason_of(exc.detail)})
        except Exception:   # noqa: BLE001 — 하나가 실패해도 나머지 초안과 묶음은 그대로 둔다
            db.rollback()
            logger.exception("묶음 %s 초안 %s 자동 확정 실패", batch.key, e.entry_id)
            kept.append({"entry_id": e.entry_id, "reason": "확정하다 오류"})
    result = {"confirmed": confirmed, "kept": kept}
    batch = db.get(models.Batch, batch.id)
    batch.preset = {**(batch.preset or {}), RESULT_KEY: result}
    db.commit()
    return result


def _reason_of(detail) -> str:
    code = detail.get("code") if isinstance(detail, dict) else detail
    return {"duplicate_model": "똑같은 BDF 가 이미 있음", "title_required": "제목 없음"}.get(code, "확정하지 못함")
