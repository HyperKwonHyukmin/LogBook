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
_COLUMNS = ("SHIP_NO", "SHIP_TYPE_NAME", "MAIN_ENGINE", "SHIP_CLASS1", "RESULT_DELIVERY_DATE", "RESULT_DELIVERY_YN",
            "SHIP_PRE", "SHIP_SEQ")   # 45 — 선행호선(시리즈 첫 호선, 첫 호선은 자기 번호) · 시리즈 순번


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
            "delivered": (_text(row.get("RESULT_DELIVERY_YN")) or "").upper() == "Y",
            "seriesLead": normalize_ship_no(row.get("SHIP_PRE")),
            "seriesSeq": (_text(row.get("SHIP_SEQ")) or "")[:10] or None}


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


def _tns_entry(alias: str, lib_dir: str) -> tuple[Optional[str], Optional[str]]:
    """별칭이 적힌 tnsnames.ora 와 그 항목 원문. thick 모드 탐색 순서대로 TNS_ADMIN → lib_dir/network/admin → ORACLE_HOME."""
    import re
    from pathlib import Path

    dirs = [os.getenv("TNS_ADMIN") or ""]
    if lib_dir:
        dirs.append(str(Path(lib_dir) / "network" / "admin"))
    if os.getenv("ORACLE_HOME"):
        dirs.append(str(Path(os.environ["ORACLE_HOME"]) / "network" / "admin"))
    for d in filter(None, dirs):
        f = Path(d) / "tnsnames.ora"
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        m = re.search(rf"^\s*{re.escape(alias)}(\.[\w.]+)?\s*=", text, re.I | re.M)
        if m:
            nxt = re.search(r"^[A-Za-z_][\w.]*\s*=", text[m.end():], re.M)
            return str(f), text[m.start(): m.end() + (nxt.start() if nxt else len(text))].strip()
    return None, None


def diagnose(ship_no: str = "3370") -> list[str]:
    """CLI plm-check — WorkBench 조사 스크립트와 견줄 수 있게 접속 환경과 한 번의 조회 결과를 줄로 돌려준다(비밀번호는 빼고)."""
    lines: list[str] = []
    settings = plm_settings()
    lib_dir = (os.getenv("PLM_ORACLE_LIB_DIR") or "").strip()
    if settings is None:
        return ["PLM_ORACLE_DSN/USER/PASSWORD 중 비어 있는 값이 있습니다(.env)."]
    lines += [f"DSN={settings['dsn']}  USER={settings['user']}  LIB_DIR={lib_dir or '(없음 — thin)'}",
              f"TNS_ADMIN={os.getenv('TNS_ADMIN') or '(없음)'}  ORACLE_HOME={os.getenv('ORACLE_HOME') or '(없음)'}"]
    try:
        import oracledb  # type: ignore[import-not-found]
    except ImportError:
        return lines + ["oracledb 가 설치되지 않았습니다(pip install -r requirements.txt)."]
    _ensure_thick_mode(oracledb)
    thin = oracledb.is_thin_mode()
    client = "" if thin else " client=" + ".".join(map(str, oracledb.clientversion()))
    lines.append(f"oracledb {oracledb.__version__}  mode={'thin' if thin else 'thick'}{client}")
    if "/" not in settings["dsn"] and ":" not in settings["dsn"]:
        path, entry = _tns_entry(settings["dsn"], lib_dir)
        lines.append(f"tnsnames: {path or '(이 별칭이 적힌 tnsnames.ora 를 찾지 못함)'}")
        if entry:
            lines += ["  " + ln for ln in entry.splitlines()]
    set_fetcher(None)   # 캐시를 비우고 실제로 묻는다
    r = lookup(ship_no)
    if r.status == "found":
        lines.append(f"조회 성공: {ship_no} → {r.ship['shipType']} · {r.ship['mainEngine']} · {r.ship['shipClass']}")
    else:
        lines.append(f"조회 결과: {r.status}{(' — ' + str(r.reason)) if r.reason else ''}")
    return lines


def _default_fetcher(ship_nos: list[str]) -> dict[str, dict]:
    """운영용 — 번호들을 한 번 접속해 IN 목록으로 읽는다. {번호: 원시 행}. 설정·드라이버가 없으면 PlmUnavailable,
    접속·질의 오류는 그대로 올린다(분류는 lookup·fill 이 한다)."""
    return _query_ships("SHIP_NO", ship_nos)


def _default_series_fetcher(leads: list[str]) -> dict[str, dict]:
    """45 — 시리즈 대표 번호들로 같은 시리즈 호선 전체를 읽는다(WHERE SHIP_PRE IN …). {호선 번호: 원시 행}."""
    return _query_ships("SHIP_PRE", leads)


def _query_ships(column: str, values: list[str]) -> dict[str, dict]:
    """VT_PLM_SHIP 에서 column IN values 인 행을 읽는다. {SHIP_NO: 원시 행}. column 은 코드 안 상수만 넘긴다."""
    assert column in ("SHIP_NO", "SHIP_PRE")
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
        for i in range(0, len(values), CHUNK):
            part = values[i:i + CHUNK]
            binds = {f"n{k}": v for k, v in enumerate(part)}
            sql = (f"SELECT {', '.join(_COLUMNS)} FROM VT_PLM_SHIP WHERE {column} IN "
                   f"({', '.join(':' + k for k in binds)})")
            cur.execute(sql, binds)
            names = [c[0] for c in cur.description]
            for vals in cur.fetchall():
                row = dict(zip(names, vals))
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


_series_fetcher: Callable[[list[str]], dict[str, dict]] = _default_series_fetcher


def set_fetcher(fn: Optional[Callable[[list[str]], dict[str, dict]]],
                series_fn: Optional[Callable[[list[str]], dict[str, dict]]] = None) -> None:
    """시험용 — 가짜 PLM 을 끼운다(None 이면 운영 fetcher). 캐시도 비운다.
    45 — series_fn 은 같은 시리즈 조회(SHIP_PRE IN). 가짜 PLM 만 주고 series_fn 을 안 주면 시리즈 조회는 빈 결과."""
    global _fetcher, _series_fetcher
    _fetcher = fn or _default_fetcher
    _series_fetcher = series_fn or (_default_series_fetcher if fn is None else (lambda leads: {}))
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


def lookup_series(leads) -> dict[str, dict]:
    """45 — 시리즈 대표 번호들 → 같은 시리즈 호선 전체 {호선 번호: 응답 모양(to_ship)}. 캐시하지 않는다(채우기 때 한 번).
    설정·드라이버가 없으면 PlmUnavailable, 접속·질의 오류는 그대로 올린다(부르는 쪽이 건너뛴다)."""
    nos = sorted({n for n in (normalize_ship_no(v) for v in leads or []) if n})
    if not nos:
        return {}
    return {no: to_ship(row) for no, row in _series_fetcher(nos).items() if normalize_ship_no(no)}


def lookup(value) -> ShipLookup:
    no = normalize_ship_no(value)
    if no is None:
        return ShipLookup("invalid")
    return lookup_many([no])[no]


# ---- 작업 ----

def ship_facets(db: Session, hull_nos) -> tuple[dict, dict, dict]:
    """호선 → (선종 칸 글자, 선종, 크기급). 관계 지도(35)와 갖춤 현황(44)이 같은 규칙을 쓴다.
    PLM 분해 값(ship_kind · ship_capacity)이 없으면 선종 칸 글자('300K-VLCC')를 같은 규칙으로 풀고,
    크기급은 용량과 선종이 둘 다 있을 때만('174K급 LNG') — 용량만으로는 묶지 않는다(단위가 선종마다 다름)."""
    ships: dict[str, Optional[str]] = {}
    kinds: dict[str, Optional[str]] = {}
    sizes: dict[str, Optional[str]] = {}
    for no, ship_type, ship_kind, capacity in (
            db.query(models.Hull.hull_no, models.Hull.ship_type, models.Hull.ship_kind, models.Hull.ship_capacity)
            .filter(models.Hull.hull_no.in_(set(hull_nos) or {""}))):
        ships[no] = ship_type
        parsed = parse_ship_type(ship_type) if ship_type and not (ship_kind and capacity) else {}
        kind = ship_kind or parsed.get("shipKind")
        cap = capacity or parsed.get("capacity")
        kinds[no] = kind
        sizes[no] = f"{cap}급 {kind}" if cap and kind else None
    return ships, kinds, sizes


def series_keys(db: Session, hull_nos) -> dict[str, str]:
    """45 — 호선 → 시리즈 묶음 키(시리즈 대표 호선, 없으면 자기 번호). 검색 · 관계 지도 · 갖춤 현황이 같은 규칙을 쓴다.
    호선 행이 없는 번호도 자기 번호로 돌려준다."""
    nos = {h for h in (hull_nos or []) if h}
    out = {h: h for h in nos}
    if nos:
        for no, lead in (db.query(models.Hull.hull_no, models.Hull.series_lead)
                         .filter(models.Hull.hull_no.in_(nos), models.Hull.series_lead.isnot(None))):
            out[no] = lead
    return out


def series_members(db: Session, keys) -> dict[str, list[str]]:
    """45 — 시리즈 키 → 그 시리즈에 드는 호선(호선 행이 있는 것, 번호순). 대표 호선 자신은 행이 없어도 넣는다."""
    keys = {k for k in (keys or []) if k}
    out: dict[str, set] = {k: {k} for k in keys}
    if keys:
        for no, lead in (db.query(models.Hull.hull_no, models.Hull.series_lead)
                         .filter(models.Hull.series_lead.in_(keys))):
            out[lead].add(no)
        # 키 번호의 호선 행이 다른 시리즈를 가리키면(사람이 고침) 그 번호 자신은 이 묶음에 들지 않는다
        for no, lead in (db.query(models.Hull.hull_no, models.Hull.series_lead)
                         .filter(models.Hull.hull_no.in_(keys), models.Hull.series_lead.isnot(None))):
            if lead != no:
                out[no].discard(no)
    return {k: sorted(v, key=lambda h: (not h.isdigit(), h.zfill(8))) for k, v in out.items()}


def series_view(db: Session, hull_nos) -> tuple[dict, dict]:
    """45 — 관계 지도 · 갖춤 현황 응답용: (호선 → 묶음 키 — 자기 번호와 다른 것만, 키 → 이 응답에 나온 호선들 — 둘 이상인 것만).
    프런트는 '호선' 기준에서 호선을 묶음 키로 바꿔 묶고, 둘 이상이면 '3370 시리즈'로 이름 붙인다."""
    keys = series_keys(db, hull_nos)
    members: dict[str, list[str]] = {}
    for no in sorted(keys, key=lambda h: (not h.isdigit(), h.zfill(8))):
        members.setdefault(keys[no], []).append(no)
    return ({h: k for h, k in keys.items() if h != k}, {k: v for k, v in members.items() if len(v) > 1})


def register_hulls(db: Session, hull_nos) -> Optional[models.Job]:
    """43 — 정리 대기(초안)에 호선이 붙자마자 호선 행을 만들고 PLM 일괄 조회 작업을 넣는다(설정돼 있을 때만).
    확정을 기다리지 않아 정리 대기 카드에서 선종 · 선형을 보고 맞는 호선인지 확인할 수 있다.
    호선 목록은 확정 자료로만 세므로(hull_info.list_hulls) 초안에만 있는 호선이 목록에 끼지는 않는다."""
    nos = sorted({h for h in (hull_nos or []) if h})
    if not nos:
        return None
    have = {h for (h,) in db.query(models.Hull.hull_no).filter(models.Hull.hull_no.in_(nos))}
    for no in nos:
        if no not in have:
            db.add(models.Hull(hull_no=no))
    db.flush()
    return enqueue_fill(db)


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
