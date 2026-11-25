"""사용자 화면 설정(10) — 열쇠 화이트리스트 + 값 검사.

새 설정을 받으려면 PREF_KEYS 에 열쇠와 검사 함수를 더한다(모르는 열쇠는 422). 값은 JSON 으로
MAX_VALUE_BYTES 이하, 한 번에 MAX_KEYS_PER_PUT 개까지."""
import json

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models
from .search.base import GROUP_KEYS

MAX_VALUE_BYTES = 1024
MAX_KEYS_PER_PUT = 20


def _int_range(lo: int, hi: int):
    def check(v):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or not lo <= v <= hi:
            raise ValueError
        return int(round(v))
    return check


def _one_of(*allowed: str):
    def check(v):
        if not isinstance(v, str) or v not in allowed:
            raise ValueError
        return v
    return check


def _bool(v):
    if not isinstance(v, bool):
        raise ValueError
    return v


def _str_list(max_items: int, max_len: int = 100):
    def check(v):
        if not isinstance(v, list) or len(v) > max_items:
            raise ValueError
        out = []
        for s in v:
            if not isinstance(s, str) or not s.strip() or len(s.strip()) > max_len:
                raise ValueError
            if s.strip() not in out:
                out.append(s.strip())
        return out
    return check


def _iso_time(v):
    from datetime import datetime

    if not isinstance(v, str):
        raise ValueError
    return datetime.fromisoformat(v).replace(microsecond=0).isoformat()


# 열쇠 → 검사(통과하면 저장할 값을 돌려주고, 아니면 ValueError)
PREF_KEYS = {
    # 72 — 새 자료 표시: 켜기, 관심 대상(묶음이면 하위 포함), 관심 선종, 기준 시각([모두 확인])
    "news.enabled": _bool,
    "news.targets": _str_list(30),
    "news.shipTypes": _str_list(30),
    "news.seenAt": _iso_time,
    # 검색 미리보기 패널 폭(px). 아래 한계는 화면의 PREVIEW_MIN(360) 과 같다 — 표시할 때 화면 폭에 맞춰 다시 자른다
    "search.previewWidth": _int_range(360, 4000),
    # 11 — 검색의 '보기 기준'(묶어 보기). 묶지 않음은 값을 지운다(null). 19 — 태그별 추가(search.base.GROUP_KEYS 와 같다)
    "search.group": _one_of(*GROUP_KEYS),
}


def get_all(db: Session, employee_id: str) -> dict:
    return {k: v for k, v in db.query(models.UserPref.key, models.UserPref.value)
            .filter(models.UserPref.employee_id == employee_id) if k in PREF_KEYS}


def validate(body: dict) -> dict:
    """{열쇠: 값|None} 을 검사해 저장할 값으로 바꾼다. None 은 지우기."""
    if not isinstance(body, dict) or not body:
        raise HTTPException(status_code=422, detail="empty_prefs")
    if len(body) > MAX_KEYS_PER_PUT:
        raise HTTPException(status_code=422, detail="too_many_prefs")
    out = {}
    for key, value in body.items():
        check = PREF_KEYS.get(key)
        if check is None:
            raise HTTPException(status_code=422, detail="unknown_pref")
        if value is None:
            out[key] = None
            continue
        if len(json.dumps(value, ensure_ascii=False).encode()) > MAX_VALUE_BYTES:
            raise HTTPException(status_code=422, detail="pref_too_large")
        try:
            out[key] = check(value)
        except (ValueError, TypeError):
            raise HTTPException(status_code=422, detail="invalid_pref")
    return out


def put(db: Session, employee_id: str, body: dict) -> dict:
    """설정 몇 개를 고친다(보내지 않은 열쇠는 그대로). 고친 뒤 전체를 돌려준다."""
    values = validate(body)
    for key, value in values.items():
        row = db.get(models.UserPref, (employee_id, key))
        if value is None:
            if row is not None:
                db.delete(row)
        elif row is None:
            db.add(models.UserPref(employee_id=employee_id, key=key, value=value))
        else:
            row.value = value
    try:
        db.commit()
    except IntegrityError:
        # 두 탭이 동시에 처음 저장했다 — 다른 쪽 행이 먼저 들어갔으니 그 행을 고친다
        db.rollback()
        for key, value in values.items():
            row = db.get(models.UserPref, (employee_id, key))
            if row is not None and value is not None:
                row.value = value
            elif row is not None:
                db.delete(row)
        db.commit()
    return get_all(db, employee_id)
