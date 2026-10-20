"""레지스트리 — DB 에만 있던 운영 정보를 공유 폴더(90_System\\registry.json)에도 남긴다.

entry.json 이 Entry 를 되살린다면, 이 파일은 사용자·호선 메모·선종·태그 동의어·분류 목록(08)을 되살린다(재구축 원천).
15 — 사용자 등급(level·wb_admin), 일반이 아닌 Entry 의 공개 단계(entry_access), 열람 허락(grants)도 여기 남긴다.
열람 허락 명단은 Entry 폴더의 entry.json 에는 넣지 않는다(공유 폴더 탐색기로 보이는 자리라서).
18-b — WorkBench 앱별 보내기 제한 규칙(wb_target_rules)도 남긴다(비워 둔 규칙도 빈 목록으로 — 다시 넣지 않게).
쓰기 실패는 요청을 실패시키지 않는다(DB 가 먼저다) — 다음 변경이나 매일 작업에서 다시 쓴다."""
import json
import logging
import os
import tempfile
import threading
from datetime import datetime

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from .. import models
from ..storage.paths import StoragePaths, to_long

log = logging.getLogger(__name__)
REGISTRY_FILE = "registry.json"
EMPTY = {"version": 1, "users": [], "hulls": [], "tags": [], "vocab": [], "entry_access": [], "grants": [],
         "wb_target_rules": []}
LIST_KEYS = ("users", "hulls", "tags", "vocab", "entry_access", "grants", "wb_target_rules")
_write_lock = threading.Lock()


def build_registry(db: Session) -> dict:
    # 15 — level 은 LogBook 저장값(WorkBench 관리자 자동 LV3 는 wb_admin 으로 따로). 13 의 role·is_admin 은 쓰지 않는다
    users = [{"employee_id": u.employee_id, "name": u.name, "department": u.department, "position": u.position,
              "status": u.status, "level": u.level or 1, "wb_admin": bool(u.wb_admin),
              "created_at": u.created_at.isoformat() if u.created_at else None}
             for u in db.query(models.User).order_by(models.User.employee_id)]
    from ..hull_info import PLM_FIELDS   # 30 — PLM 선박 정보(조회한 호선만)

    hulls = [{"hull_no": h.hull_no, "ship_type": h.ship_type, "memo": h.memo}
             | ({"plm": {"status": h.plm_status,
                         "checked_at": h.plm_checked_at.isoformat() if h.plm_checked_at else None,
                         **{k: getattr(h, k) for k in PLM_FIELDS}}} if h.plm_status else {})
             for h in db.query(models.Hull).order_by(models.Hull.hull_no) if h.ship_type or h.memo or h.plm_status]
    roots = {t.id: t.value for t in db.query(models.Tag).filter(models.Tag.alias_of_id.is_(None))}
    tags = [{"kind": t.kind, "value": t.value, "alias_of": roots.get(t.alias_of_id)}
            for t in db.query(models.Tag).filter(models.Tag.alias_of_id.isnot(None), models.Tag.kind != "atype")
            .order_by(models.Tag.kind, models.Tag.value)]
    # 08 — 구역·대상 목록 용어(순서·사용 여부). 동의어는 위 tags 에 함께 들어 있다. 42 — 남은 atype 행은 쓰지 않는다
    vocab = [{"kind": t.kind, "value": t.value, "sort_order": t.sort_order, "active": bool(t.active)}
             for t in db.query(models.Tag).filter(models.Tag.listed.is_(True), models.Tag.alias_of_id.is_(None),
                                                  models.Tag.kind != "atype")
             .order_by(models.Tag.kind, models.Tag.sort_order, models.Tag.value)]
    # 15 — 일반이 아닌 Entry(공유·블록 — 일반은 기본값이라 적지 않는다)와 열람 허락
    entry_access = [{"entry_id": eid, "access": acc}
                    for eid, acc in db.query(models.Entry.entry_id, models.Entry.access)
                    .filter(models.Entry.access.in_(("shared", "blocked")), models.Entry.entry_id.isnot(None))
                    .order_by(models.Entry.entry_id)]
    grants = [{"entry_id": eid, "employee_id": g.employee_id, "granted_by": g.granted_by,
               "granted_at": g.granted_at.isoformat() if g.granted_at else None}
              for g, eid in db.query(models.EntryGrant, models.Entry.entry_id)
              .join(models.Entry, models.Entry.id == models.EntryGrant.entry_id)
              .order_by(models.Entry.entry_id, models.EntryGrant.employee_id)]
    # 18-b — WorkBench 앱별 보내기 제한(행이 있는 대상만 — 비워 둔 규칙도 남긴다)
    wb_rules = [{"target": r.target, "zones": list(r.zones or []), "targets": list(r.targets or []),
                 "tags": list(r.tags or []),
                 "updated_by": r.updated_by, "updated_at": r.updated_at.isoformat() if r.updated_at else None}
                for r in db.query(models.WbTargetRule).order_by(models.WbTargetRule.target)]
    return {"version": 1, "written_at": datetime.now().replace(microsecond=0).isoformat(),
            "users": users, "hulls": hulls, "tags": tags, "vocab": vocab,
            "entry_access": entry_access, "grants": grants, "wb_target_rules": wb_rules}


def write_registry(db: Session, storage: StoragePaths) -> bool:
    """registry.json 을 고유한 임시 파일에 쓴 뒤 바꿔 끼운다. 실패하면 경고만 남기고 False.

    같은 프로세스 안의 동시 쓰기(API 요청 여러 개)는 락으로 줄 세우고, 스냅숏은 락을 잡은 뒤 쓰기 직전에
    만든다 — 먼저 만든 옛 스냅숏이 나중에 덮어쓰지 않게. 다른 프로세스(API·워커)와는 임시 파일 이름이
    겹치지 않고(mkstemp) os.replace 가 원자적이라 파일이 깨지지 않는다(마지막에 쓴 쪽이 남는다, 리뷰 I5)."""
    path = storage.system / REGISTRY_FILE
    with _write_lock:
        try:
            data = build_registry(db)
        except SQLAlchemyError as exc:
            # 읽기 실패로 요청을 깨뜨리지 않는다(이미 커밋된 변경이다) — 다음 기회에 다시 쓴다
            db.rollback()
            log.warning("registry.json 만들기 실패(DB 는 유지): %s", exc)
            return False
        tmp = None
        try:
            os.makedirs(to_long(path.parent), exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=to_long(path.parent), prefix="registry.", suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False, indent=1)
            os.replace(tmp, to_long(path))
            return True
        except OSError as exc:
            log.warning("registry.json 쓰기 실패(DB 는 유지): %s", exc)
            if tmp:
                try:
                    os.remove(tmp)
                except OSError:
                    pass
            return False


def read_registry(storage: StoragePaths) -> dict:
    try:
        with open(to_long(storage.system / REGISTRY_FILE), encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return {k: (list(v) if isinstance(v, list) else v) for k, v in EMPTY.items()}
    if not isinstance(data, dict):
        return {k: (list(v) if isinstance(v, list) else v) for k, v in EMPTY.items()}
    return {**EMPTY, **{k: data.get(k) or [] for k in LIST_KEYS}, "version": data.get("version", 1)}
