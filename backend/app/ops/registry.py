"""레지스트리 — DB 에만 있던 운영 정보를 공유 폴더(90_System\\registry.json)에도 남긴다.

entry.json 이 Entry 를 되살린다면, 이 파일은 사용자·호선 메모·선종·태그 동의어·분류 목록(08)을 되살린다(재구축 원천).
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
EMPTY = {"version": 1, "users": [], "hulls": [], "tags": [], "vocab": []}
_write_lock = threading.Lock()


def build_registry(db: Session) -> dict:
    users = [{"employee_id": u.employee_id, "name": u.name, "department": u.department, "position": u.position,
              "status": u.status, "is_admin": bool(u.is_admin),
              "created_at": u.created_at.isoformat() if u.created_at else None}
             for u in db.query(models.User).order_by(models.User.employee_id)]
    hulls = [{"hull_no": h.hull_no, "ship_type": h.ship_type, "memo": h.memo}
             for h in db.query(models.Hull).order_by(models.Hull.hull_no) if h.ship_type or h.memo]
    roots = {t.id: t.value for t in db.query(models.Tag).filter(models.Tag.alias_of_id.is_(None))}
    tags = [{"kind": t.kind, "value": t.value, "alias_of": roots.get(t.alias_of_id)}
            for t in db.query(models.Tag).filter(models.Tag.alias_of_id.isnot(None))
            .order_by(models.Tag.kind, models.Tag.value)]
    # 08 — 해석 종류·구역 목록 용어(순서·사용 여부). 동의어는 위 tags 에 함께 들어 있다
    vocab = [{"kind": t.kind, "value": t.value, "sort_order": t.sort_order, "active": bool(t.active)}
             for t in db.query(models.Tag).filter(models.Tag.listed.is_(True), models.Tag.alias_of_id.is_(None))
             .order_by(models.Tag.kind, models.Tag.sort_order, models.Tag.value)]
    return {"version": 1, "written_at": datetime.now().replace(microsecond=0).isoformat(),
            "users": users, "hulls": hulls, "tags": tags, "vocab": vocab}


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
    return {**EMPTY, **{k: data.get(k) or [] for k in ("users", "hulls", "tags", "vocab")}, "version": data.get("version", 1)}
