"""WorkBench 사용자 표(15) — **읽기 전용**.

Hi-TESS LogBook 의 사용자는 WorkBench 가입자다. 같은 MySQL 연결(logbook DB 계정)로 WorkBench DB 의 users 표를
SELECT 만 한다. 이 모듈에는 INSERT·UPDATE·DELETE·DDL 이 없고(tests/test_wb_users_15.py 가 실행된 SQL 과 이 파일
글자를 모두 검사한다), 표 정의는 Base 와 다른 MetaData 에 있어 create_all·drop_all 의 대상이 아니다.

- 표 이름: 설정 LOGBOOK_WB_USERS_TABLE(기본 `hitessworkbench.users`, `스키마.표`). 운영에서는 logbook 계정에
  `GRANT SELECT ON hitessworkbench.users` 가 필요하다(docs/plans/2026-10-08-logbook-15-hitess-identity-levels.md §7).
- 연결 실패·권한 없음은 WbUnavailable — 로그인은 503 wb_unavailable 로 분명히 실패한다(조용히 통과 금지).
- 매 요청의 활성 확인은 사번별로 짧게(기본 60초) 캐시한다."""
import re
import threading
import time
from dataclasses import dataclass

from sqlalchemy import Boolean, Column, Integer, MetaData, String, Table, func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from .config import settings

_NAME = re.compile(r"^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$")
LIST_LIMIT = 2000


class WbUnavailable(Exception):
    """WorkBench 사용자 표를 읽을 수 없다(연결·권한·표 없음)."""


@dataclass(frozen=True)
class WbUser:
    employee_id: str
    name: str | None
    department: str | None
    position: str | None
    is_active: bool
    is_admin: bool


def _table() -> Table:
    name = settings.wb_users_table.strip()
    if not _NAME.fullmatch(name):
        raise WbUnavailable(f"LOGBOOK_WB_USERS_TABLE 형식 오류: {name!r}")
    schema, _, table = name.rpartition(".")
    # 별도 MetaData — app.database.Base 에 등록하지 않는다(만들기·지우기 대상이 아니다)
    return Table(table, MetaData(), Column("id", Integer), Column("employee_id", String(50)),
                 Column("name", String(100)), Column("department", String(100)), Column("position", String(100)),
                 Column("is_active", Boolean), Column("is_admin", Boolean), schema=schema or None)


def _row(r) -> WbUser:
    return WbUser(employee_id=str(r.employee_id or "").strip().upper(), name=r.name, department=r.department,
                  position=r.position, is_active=bool(r.is_active), is_admin=bool(r.is_admin))


def _cols(t: Table):
    return (t.c.employee_id, t.c.name, t.c.department, t.c.position, t.c.is_active, t.c.is_admin)


def _run(db: Session, stmt):
    try:
        return db.execute(stmt).all()
    except SQLAlchemyError as exc:
        db.rollback()   # 실패한 문장이 세션 트랜잭션을 깨뜨린 채 남지 않게
        raise WbUnavailable(_reason(exc)) from exc


def _reason(exc: Exception) -> str:
    text = str(getattr(exc, "orig", exc) or exc)
    if "1142" in text or "denied" in text.lower():
        return "권한 없음(GRANT SELECT 필요)"
    if "1146" in text or "doesn't exist" in text:
        return "표 없음"
    return text.splitlines()[0][:200] if text else exc.__class__.__name__


# ---- 읽기 ----

def fetch(db: Session, employee_id: str) -> WbUser | None:
    """사번 하나. 없으면 None. 읽을 수 없으면 WbUnavailable."""
    t = _table()
    rows = _run(db, select(*_cols(t)).where(t.c.employee_id == employee_id.strip().upper()).limit(1))
    return _row(rows[0]) if rows else None


def fetch_many(db: Session, employee_ids) -> dict[str, WbUser]:
    ids = sorted({str(e).strip().upper() for e in employee_ids if e})
    if not ids:
        return {}
    t = _table()
    out: dict[str, WbUser] = {}
    for i in range(0, len(ids), 500):
        for r in _run(db, select(*_cols(t)).where(t.c.employee_id.in_(ids[i:i + 500]))):
            u = _row(r)
            out[u.employee_id] = u
    return out


def list_active(db: Session, q: str = "", limit: int = LIST_LIMIT) -> list[WbUser]:
    """활성 사용자(이름·사번 앞부분으로 거르기). 이름 순."""
    t = _table()
    stmt = select(*_cols(t)).where(t.c.is_active.is_(True))
    q = (q or "").strip()
    if q:
        like = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        stmt = stmt.where(or_(t.c.name.like(like, escape="\\"), t.c.employee_id.like(like.upper(), escape="\\")))
    return [_row(r) for r in _run(db, stmt.order_by(t.c.name, t.c.employee_id).limit(limit))]


def count_active_admins(db: Session) -> int:
    t = _table()
    return int(_run(db, select(func.count()).select_from(t)
                    .where(t.c.is_active.is_(True), t.c.is_admin.is_(True)))[0][0] or 0)


def status(db: Session) -> dict:
    """관리자 운영 화면용 — {table, ok, active, admins, error}."""
    out = {"table": settings.wb_users_table, "ok": False, "active": None, "admins": None, "error": None}
    try:
        t = _table()
        out["active"] = int(_run(db, select(func.count()).select_from(t).where(t.c.is_active.is_(True)))[0][0] or 0)
        out["admins"] = count_active_admins(db)
        out["ok"] = True
    except WbUnavailable as exc:
        out["error"] = str(exc)
    return out


# ---- 매 요청 활성 확인 캐시 ----

_cache: dict[str, tuple[float, WbUser | None]] = {}
_lock = threading.Lock()


def clear_cache() -> None:
    with _lock:
        _cache.clear()


def cached(db: Session, employee_id: str) -> WbUser | None:
    """캐시(settings.wb_cache_seconds)가 살아 있으면 그 값, 아니면 다시 읽는다. 읽을 수 없으면 WbUnavailable."""
    eid = employee_id.strip().upper()
    now = time.monotonic()
    ttl = max(0, settings.wb_cache_seconds)
    with _lock:
        hit = _cache.get(eid)
    if hit is not None and now - hit[0] < ttl:
        return hit[1]
    u = fetch(db, eid)
    with _lock:
        _cache[eid] = (now, u)
    return u


def remember(u: WbUser | None, employee_id: str) -> None:
    """로그인에서 막 읽은 값을 캐시에 넣는다(곧 이어지는 요청이 다시 묻지 않게)."""
    with _lock:
        _cache[employee_id.strip().upper()] = (time.monotonic(), u)
