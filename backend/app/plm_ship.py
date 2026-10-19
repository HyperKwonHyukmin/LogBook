"""30 — 사내 PLM(Oracle `HIPLM`, 시노님 `VT_PLM_SHIP`)에서 호선의 선박 정보를 조회한다.

WorkBench 계획서 `docs/superpowers/plans/2026-10-16-plm-ship-lookup.md`(WorkBench 저장소)의 조사 결과를 따르되,
LogBook 은 WorkBench 없이도 동작해야 하므로 **직접 접속**한다(접속 정보는 WorkBench 와 같은 이름의 .env 키).

- 접속 정보: `.env` 의 `PLM_ORACLE_DSN` · `PLM_ORACLE_USER` · `PLM_ORACLE_PASSWORD`(모두 있어야 켜진다).
  145 의 PLM 은 10G password verifier 라 thin mode 가 DPY-3015 로 막힌다 → `PLM_ORACLE_LIB_DIR`(Oracle Client
  폴더)를 주면 thick mode 로 연다(프로세스당 한 번).
- 드라이버(`oracledb`)는 호출할 때 import 한다 — 없어도 서버가 뜬다(조회만 'unavailable').
- 조회는 번호 여러 개를 한 번의 질의로(일괄 채우기·자동 조회). 키 `SHIP_NO` 는 VARCHAR2(4) 정확 일치.
- 선종(선형)은 `SHIP_KIND_NAME`('MEMB LNG')이 아니라 `SHIP_TYPE_NAME`('174K-LNG')에서 뽑는다.
- 상태: found · not_found · invalid · unavailable(설정·드라이버 없음) · error(접속·질의 실패). 찾음은 6시간,
  없음은 10분 캐시하고 장애는 캐시하지 않는다(일시 장애가 굳지 않게).
"""
from __future__ import annotations

import logging
import os
import re
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime
from typing import Callable, Optional

from sqlalchemy.orm import Session

from . import models

log = logging.getLogger(__name__)

CONNECT_TIMEOUT_SEC = 3.0
QUERY_TIMEOUT_SEC = 10.0          # 일괄 조회(IN 목록)는 한 번에 여러 행이라 조금 넉넉히
CHUNK = 500                       # IN 목록 한 번에 넣는 번호 수(Oracle 상한 1000)
FOUND_TTL = 6 * 3600
NOT_FOUND_TTL = 10 * 60
JOB_TYPE = "plm_fill"

_SHIP_NO = re.compile(r"[A-Z0-9]{1,4}")
# 실측 598종(3,634행) 기준 — 계획서 30 의 표. 용량은 'nnnK'(소수 허용) 또는 단위 없는 3자리 이상,
# 구분자는 하이픈 하나, 선종은 greedy(뒤 공백 단어 'LNG BV' 를 잃지 않게), 괄호는 닫히지 않아도(20자에서 잘린 값)
_SHIP_TYPE = re.compile(
    r"(?P<cap>\d+(?:\.\d+)?K|\d{3,})"
    r"-"
    r"(?P<kind>[A-Za-z0-9/]+(?: [A-Za-z0-9/#]+)*)"
    r"\s*(?:\((?P<var>[^)]*)\)?)?"
    r"(?P<rest>.*)",
    re.IGNORECASE,
)
_COLUMNS = ("SHIP_NO", "SHIP_TYPE_NAME", "MAIN_ENGINE", "SHIP_CLASS1", "RESULT_DELIVERY_DATE", "RESULT_DELIVERY_YN")


class PlmUnavailable(Exception):
    """PLM 을 쓸 수 없는 설정 상태 — 사유: 'not_configured' | 'driver_missing'."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass
class ShipLookup:
    status: str                    # found | not_found | invalid | unavailable | error
    ship: Optional[dict] = None
    reason: Optional[str] = None


# ---- 순수 함수 ----

def normalize_ship_no(value) -> Optional[str]:
    """앞뒤 공백·대문자. SHIP_NO 는 VARCHAR2(4) — 그보다 길거나 다른 글자가 있으면 None. 앞 0 은 건드리지 않는다."""
    if value is None:
        return None
    v = str(value).strip().upper()
    return v if _SHIP_NO.fullmatch(v) else None


def parse_ship_type(name) -> dict:
    """'174K-LNG' → {capacity '174K', shipKind 'LNG', variant None, label '174K LNG'}.
    규칙 밖(FPSO·함정·과제명)은 원문을 label 로 그대로, 빈 값은 모두 None. label 에 괄호 부가정보는 넣지 않는다."""
    raw = (str(name).strip() if name is not None else "")
    if not raw:
        return {"capacity": None, "shipKind": None, "variant": None, "label": None}
    m = _SHIP_TYPE.fullmatch(raw)
    if not m:
        return {"capacity": None, "shipKind": None, "variant": None, "label": raw}
    capacity, kind = m["cap"].upper(), m["kind"].strip()
    return {"capacity": capacity, "shipKind": kind, "variant": (m["var"] or "").strip() or None,
            "label": f"{capacity} {kind}"}


def _text(v) -> Optional[str]:
    s = str(v).strip() if v is not None else ""
    return s or None


def to_ship(row: dict) -> dict:
    """PLM 원시 행 → 응답 모양(camelCase)."""
    raw_type = _text(row.get("SHIP_TYPE_NAME"))
    d = row.get("RESULT_DELIVERY_DATE")
    if isinstance(d, (datetime, date)):
        delivery = d.strftime("%Y-%m-%d")
    else:
        delivery = _text(d)
        delivery = delivery[:10] if delivery else None
    return {"shipNo": _text(row.get("SHIP_NO")), "shipType": raw_type, **parse_ship_type(raw_type),
            "mainEngine": _text(row.get("MAIN_ENGINE")), "shipClass": _text(row.get("SHIP_CLASS1")),
            "deliveryDate": delivery,
            "delivered": (_text(row.get("RESULT_DELIVERY_YN")) or "").upper() == "Y"}


# ---- 접속 ----

def plm_settings() -> Optional[dict]:
    dsn = (os.getenv("PLM_ORACLE_DSN") or "").strip()
    user = (os.getenv("PLM_ORACLE_USER") or "").strip()
    password = os.getenv("PLM_ORACLE_PASSWORD") or ""
    if not dsn or not user or not password:
        return None
    return {"dsn": dsn, "user": user, "password": password}


def is_configured() -> bool:
    return plm_settings() is not None


_thick_lock = threading.Lock()
_thick_tried = False


def _ensure_thick_mode(oracledb) -> None:
    """PLM_ORACLE_LIB_DIR 가 있으면 Oracle Client 를 한 번만 로드한다(oracledb 가 두 번째 호출을 거부한다)."""
    global _thick_tried
    with _thick_lock:
        if _thick_tried:
            return
        _thick_tried = True
        lib_dir = (os.getenv("PLM_ORACLE_LIB_DIR") or "").strip()
        if not lib_dir:
            return
        try:
            oracledb.init_oracle_client(lib_dir=lib_dir)
            log.info("PLM thick mode 활성화 (lib_dir=%s)", lib_dir)
        except Exception as exc:   # thin 으로 계속(그래도 막히면 접속 단계에서 error 로 보인다)
            log.warning("PLM thick mode 초기화 실패 (lib_dir=%s): %s", lib_dir, exc)


def _default_fetcher(ship_nos: list[str]) -> dict[str, dict]:
    """운영용 — 번호들을 한 번 접속해 IN 목록으로 읽는다. {번호: 원시 행}. 설정·드라이버가 없으면 PlmUnavailable,
    접속·질의 오류는 그대로 올린다(분류는 lookup·fill 이 한다)."""
    settings = plm_settings()
    if settings is None:
        raise PlmUnavailable("not_configured")
    try:
        import oracledb  # type: ignore[import-not-found]
    except ImportError as exc:
        raise PlmUnavailable("driver_missing") from exc
    _ensure_thick_mode(oracledb)
    out: dict[str, dict] = {}
    conn = oracledb.connect(user=settings["user"], password=settings["password"], dsn=settings["dsn"],
                            tcp_connect_timeout=CONNECT_TIMEOUT_SEC)
    try:
        try:
            conn.call_timeout = int(QUERY_TIMEOUT_SEC * 1000)
        except Exception:
            pass
        cur = conn.cursor()
        for i in range(0, len(ship_nos), CHUNK):
            part = ship_nos[i:i + CHUNK]
            binds = {f"n{k}": v for k, v in enumerate(part)}
            sql = (f"SELECT {', '.join(_COLUMNS)} FROM VT_PLM_SHIP WHERE SHIP_NO IN "
                   f"({', '.join(':' + k for k in binds)})")
            cur.execute(sql, binds)
            names = [c[0] for c in cur.description]
            for values in cur.fetchall():
                row = dict(zip(names, values))
                no = _text(row.get("SHIP_NO"))
                if not no:
                    continue
                if no in out:
                    log.warning("PLM 에 같은 호선 번호가 여러 행입니다: %s — 첫 행을 씁니다", no)
                    continue
                out[no] = row
        cur.close()
    finally:
        conn.close()
    return out


_fetcher: Callable[[list[str]], dict[str, dict]] = _default_fetcher
_cache: dict[str, tuple[float, ShipLookup]] = {}
_cache_lock = threading.Lock()


def set_fetcher(fn: Optional[Callable[[list[str]], dict[str, dict]]]) -> None:
    """시험용 — 가짜 PLM 을 끼운다(None 이면 운영 fetcher). 캐시도 비운다."""
    global _fetcher
    _fetcher = fn or _default_fetcher
    clear_cache()


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def _remember(no: str, result: ShipLookup) -> ShipLookup:
    ttl = FOUND_TTL if result.status == "found" else NOT_FOUND_TTL if result.status == "not_found" else 0
    if ttl:
        with _cache_lock:
            _cache[no] = (time.monotonic() + ttl, result)
    return result


def lookup_many(values) -> dict[str, ShipLookup]:
    """번호 여러 개 → {정규화한 번호: 결과}. 캐시에 없는 번호만 한 번에 조회한다. 장애는 모든 번호에 같은 결과."""
    nos = []
    out: dict[str, ShipLookup] = {}
    now = time.monotonic()
    for v in values:
        no = normalize_ship_no(v)
        if no is None:
            out[str(v)] = ShipLookup("invalid")
            continue
        with _cache_lock:
            hit = _cache.get(no)
        if hit and hit[0] > now:
            out[no] = hit[1]
        elif no not in nos:
            nos.append(no)
    if not nos:
        return out
    try:
        rows = _fetcher(nos)
    except PlmUnavailable as exc:
        return {**out, **{no: ShipLookup("unavailable", reason=exc.reason) for no in nos}}
    except Exception as exc:
        log.warning("PLM 호선 조회 실패(%d건): %s", len(nos), exc)
        return {**out, **{no: ShipLookup("error", reason=str(exc)[:200]) for no in nos}}
    for no in nos:
        row = rows.get(no)
        out[no] = _remember(no, ShipLookup("found", ship=to_ship(row)) if row else ShipLookup("not_found"))
    return out


def lookup(value) -> ShipLookup:
    no = normalize_ship_no(value)
    if no is None:
        return ShipLookup("invalid")
    return lookup_many([no])[no]


# ---- 작업 ----

def enqueue_fill(db: Session) -> Optional[models.Job]:
    """확정 때 — PLM 이 설정돼 있고 아직 조회하지 않은 호선이 있으면 일괄 조회 작업을 하나 넣는다(이미 대기 중이면 넣지 않는다)."""
    if not is_configured():
        return None
    pending = db.query(models.Hull.hull_no).filter(models.Hull.plm_status.is_(None)).first()
    if pending is None:
        return None
    if db.query(models.Job.id).filter(models.Job.type == JOB_TYPE, models.Job.state == "queued").first():
        return None
    from . import jobs
    return jobs.enqueue(db, JOB_TYPE, 0)
