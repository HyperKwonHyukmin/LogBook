"""68 2단계 — 자료의 과제 정보(선택 칸, `entry_tasks` 1:1). 엑셀 없이 올린 자료에도 손으로 넣을 수 있다.

- Category 는 정해진 목록(과제 엑셀의 6종)에서만. 의뢰 부서는 글 칸 + 자동완성(엑셀 부서 목록 + 이미 쓴 값).
- 분류 목록(tags)에 넣지 않는다(계획 68 '분류 목록 확장 비용'). 동의어 묶기가 필요해지면 그때 옮긴다.
- 칸이 모두 비면 행을 지운다. task_key, source_batch 는 과제 엑셀 가져오기(3단계)만 채운다 — 손 입력이 지우지 않는다.
- entry.json `task`(재구축 원천), 감사는 ENTRY_UPDATE 스냅숏의 `task` 칸.
"""
from datetime import date

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models

# 2026년 구조솔루션팀 통합과제 엑셀의 Category(102행에서 쓰인 값 그대로)
CATEGORIES = ("공정공법 개선", "구조강도 평가 및 최적화", "안전", "RCA", "변형 제어", "자동화 프로그램 개발")
# 같은 엑셀 하단 '의뢰 부서' 집계표의 부서(자동완성 기본값)
DEPARTMENTS = (
    "구조설계부", "선체설계부", "선장설계부", "선실설계부", "기장설계부", "전장설계부", "기본설계부", "설계운용부",
    "특수선선체설계부", "대조립1부", "건조기술기획부", "생산지원2부", "운항관제부", "군산공장부", "미래기술개발부",
    "발판지원부", "건조5부", "선행의장부", "조선안전부", "삼호", "미포", "건조2부", "가공소조립2부", "UNIT생산부",
    "선체품질경영부", "설계플랫폼혁신부", "CHS공사부", "선실선행부", "기계보전부", "엔진기계안전부",
    "액화가스저장연구실", "구조시스템연구실", "성능평가연구실", "중형선사업부",
)
# 글 칸과 최대 길이(모델 열과 같다). 날짜 칸은 따로
TEXT_FIELDS = {"request_no": 80, "category": 40, "request_dept": 60, "requester": 60, "target_text": 200,
               "key_point": 300, "purpose": 300, "criteria": 300, "effect_note": 4000}
DATE_FIELDS = ("started_on", "finished_on")
FIELDS = tuple(TEXT_FIELDS) + DATE_FIELDS
# 화면, _INFO.txt, 감사에 쓰는 이름
LABELS = {"request_no": "과제의뢰서 NO.", "category": "Category", "request_dept": "의뢰 부서", "requester": "의뢰자",
          "target_text": "대상(엑셀 원문)", "key_point": "Key point", "purpose": "목적", "criteria": "평가 기준",
          "effect_note": "효과 설명", "started_on": "시작 날짜", "finished_on": "완료 날짜"}


def _date(v) -> date | None:
    if v in (None, ""):
        return None
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        raise HTTPException(status_code=422, detail="task_invalid_date") from None


def clean(data: dict | None) -> dict:
    """화면이나 entry.json 의 과제 정보 → 저장할 값(모르는 칸은 버림, 빈 글자는 None). Category 는 목록 밖이면 422."""
    data = data or {}
    out = {}
    for k, n in TEXT_FIELDS.items():
        v = data.get(k)
        v = " ".join(str(v).split()) if k != "effect_note" and v is not None else (str(v).strip() if v is not None else "")
        out[k] = v[:n] or None
    if out["category"] and out["category"] not in CATEGORIES:
        raise HTTPException(status_code=422, detail="task_invalid_category")
    for k in DATE_FIELDS:
        out[k] = _date(data.get(k))
    if out["started_on"] and out["finished_on"] and out["finished_on"] < out["started_on"]:
        raise HTTPException(status_code=422, detail="task_dates_reversed")
    return out


def to_dict(row: models.EntryTask | None) -> dict | None:
    """응답, entry.json 용(값이 있는 칸만). 행이 없으면 None."""
    if row is None:
        return None
    d = {k: getattr(row, k) for k in FIELDS}
    d = {k: (v.isoformat() if isinstance(v, date) else v) for k, v in d.items() if v not in (None, "")}
    if row.task_key:
        d["task_key"] = row.task_key
    if row.source_batch:
        d["source_batch"] = row.source_batch
    return d or None


def get(db: Session, entry: models.Entry) -> dict | None:
    return to_dict(db.get(models.EntryTask, entry.id))


def put(db: Session, entry: models.Entry, data: dict | None) -> bool:
    """과제 정보를 통째로 바꾼다(빈 칸은 지움). 칸이 모두 비고 가져오기 열쇠도 없으면 행을 지운다. 바뀌었으면 True."""
    values = clean(data)
    row = db.get(models.EntryTask, entry.id)
    before = to_dict(row)
    if row is None:
        if not any(values.values()):
            return False
        row = models.EntryTask(entry_id=entry.id)
        db.add(row)
    for k, v in values.items():
        setattr(row, k, v)
    if not any(values.values()) and not row.task_key:
        db.delete(row)
        db.flush()
        return before is not None
    db.flush()
    return to_dict(row) != before


def restore(db: Session, entry: models.Entry, data: dict | None) -> None:
    """재구축 — entry.json 의 task 를 그대로 되살린다(가져오기 열쇠 포함). 칸이 모두 비고 열쇠만 있는 행도 되살린다
    (손으로 칸을 다 지워도 열쇠는 남는다 — 지우면 같은 엑셀 행을 다시 가져오게 된다). 고유 제약 충돌은 flush 에서
    올라오므로 부르는 쪽이 savepoint 로 감싼다."""
    if not isinstance(data, dict) or not data:
        return
    values = clean(data)
    key = (str(data.get("task_key") or "").strip()[:80]) or None
    src = (str(data.get("source_batch") or "").strip()[:64]) or None
    if not any(values.values()) and not key:
        return
    row = db.get(models.EntryTask, entry.id) or models.EntryTask(entry_id=entry.id)
    db.add(row)
    for k, v in values.items():
        setattr(row, k, v)
    row.task_key, row.source_batch = key, src
    db.flush()


def carry(db: Session, src: models.Entry, dst: models.Entry) -> dict | None:
    """합치기(초안끼리, 기존 자료로 합쳐 확정) — src 의 과제 정보를 dst 로. dst 에 이미 있으면 dst 것을 두고
    src 것은 지운 뒤 버린 값을 돌려준다(감사에 남긴다). src 행은 이 함수가 끝나면 남지 않는다."""
    s = db.get(models.EntryTask, src.id)
    if s is None:
        return None
    if db.get(models.EntryTask, dst.id) is None:
        db.flush()
        s.entry_id = dst.id
        db.flush()
        return None
    dropped = to_dict(s)
    db.delete(s)
    db.flush()
    return dropped


def summary_line(task: dict | None) -> str:
    """_INFO.txt 한 줄 — 의뢰서 NO., Category, 의뢰 부서."""
    if not task:
        return ""
    parts = [task.get(k) for k in ("request_no", "category", "request_dept") if task.get(k)]
    return ", ".join(parts)


def options(db: Session, user) -> dict:
    """화면 선택지 — Category 목록, 의뢰 부서 자동완성(기본 목록 + 이 사람이 볼 수 있는 자료에서 이미 쓴 값, 가나다순).
    볼 수 없는 자료에만 쓴 부서 이름이 새지 않게 열람 조건을 건다(Codex 검토 2026-11-23)."""
    from .. import access

    T = models.EntryTask
    used = {v for (v,) in db.query(T.request_dept).join(models.Entry, models.Entry.id == T.entry_id)
            .filter(T.request_dept.isnot(None), models.Entry.status != "trashed", access.visible_entries_filter(user))
            .distinct()}
    return {"categories": list(CATEGORIES), "departments": sorted(set(DEPARTMENTS) | used), "labels": LABELS}
