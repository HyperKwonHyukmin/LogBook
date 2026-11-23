"""68 3단계 — 과제 엑셀 묶음: 미리보기(행마다 담당자 대조, 호선 추정, 이미 있음) → LV2 이상이 [초안 n건 만들기] → 파일 없는 초안.

묶음 상태: 워커가 과제 엑셀을 알아보면 `review`(미리보기 대기)로 두고 행 목록을 batch.preset['task_sheet'] 에 저장한다.
[초안 만들기]는 묶음 행을 잠그고 review 일 때만 한 번(두 번 누름, 두 창 동시 요청 방지) → 만든 초안이 있으면 processed, 없으면 done.
원본은 staging 폴더의 `_task_sheet.xlsx`, 만든 기록은 `_task_import.json`(재구축 원천 — 파일 없는 초안은 이것 없이는 재구축 때 사라진다).
다시 넣기: 행 열쇠(과제의뢰서 NO., 없으면 '연도-#NO')가 이미 있으면(초안, 확정, 휴지통) 만들지 않는다 — entry_tasks.task_key 고유 제약이 최종으로 막는다.
금액, 기여도, M/H, 직책과장은 파서가 읽지 않는다.
"""
import json
import logging
import os
import re
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import access, audit, models, people, vocab, wb_users
from ..ingest.hulls import extract_hull_candidates
from ..storage.paths import StoragePaths, long_join, to_long
from . import tasks

log = logging.getLogger(__name__)

SHEET_KEY = "task_sheet"        # batch.preset — 파서 결과 {rows, columns, skipped, unread, year, sheet, file} 또는 {error}
RESULT_KEY = "task_result"      # batch.preset — {created: [E…], failed: [{no, reason}], skipped: [no], by, at}
SHEET_FILE = "_task_sheet.xlsx"
IMPORT_FILE = "_task_import.json"
DEFAULT_STATUSES = {"완료", "진행중", "자체수행"}   # 공백을 뺀 값(계획 68 결정 3)
EMPTY_KEYS = {"", "X", "-", "–", "—", "N/A", "NA"}
TASK_TEXT = ("request_no", "category", "request_dept", "requester", "key_point", "purpose", "criteria", "effect_note",
             "started_on", "finished_on")


def is_task_batch(batch: models.Batch) -> bool:
    return isinstance(batch.preset, dict) and SHEET_KEY in batch.preset


def row_key(row: dict, year: int) -> str:
    """다시 넣기의 열쇠 — 앞뒤 공백을 빼고 대문자로 맞춘 의뢰서 NO., 없거나 'X' 면 '연도-#NO'."""
    rn = " ".join(str(row.get("request_no") or "").split()).upper()
    return rn[:80] if rn not in EMPTY_KEYS else f"{year}-#{row.get('no')}"


def split_people(text: str) -> list[tuple[str, str | None]]:
    """'이정훈 연구원, 김명규 선임' → [(이름, 직책)]. 첫 낱말이 이름, 나머지가 직책."""
    out = []
    for part in re.split(r"[,/·、;]|\s{2,}", text or ""):
        words = part.split()
        if words:
            out.append((words[0], " ".join(words[1:]) or None))
    return out


class _Roster:
    """담당자 이름 → 명부 사람(또는 WorkBench 사용자). 같은 이름은 한 번만 찾는다."""

    def __init__(self, db: Session):
        self.db = db
        self.cache: dict[tuple, dict] = {}
        self.wb_down = False

    def find(self, name: str, position: str | None) -> dict:
        """엑셀에 직책이 있으면 명부의 직책도 같아야 연결한다(이름만 같은 다른 사람에게 초안 권한이 가지 않게 — Codex 검토).
        명부에서 못 찾거나 직책이 비어 가릴 수 없으면 WorkBench 사용자에서 찾는다."""
        key = (name, position)
        if key in self.cache:
            return self.cache[key]
        rows = self.db.query(models.Person).filter(models.Person.name == name).all()
        if position:
            rows = [p for p in rows if (p.position or "") == position]
        if len(rows) == 1:
            p = rows[0]
            got = {"name": name, "ref": {"id": p.id}, "label": people.label(people.person_to_dict(p))}
        elif len(rows) > 1:
            got = {"name": name, "notice": f"동명이인({name}): 담당자를 손으로 고르세요"}
        else:
            got = self._wb(name, position)
        self.cache[key] = got
        return got

    def _wb(self, name: str, position: str | None) -> dict:
        if self.wb_down:
            return {"name": name, "notice": f"명부에 없음({name})"}
        try:
            users = [u for u in wb_users.list_active(self.db, name, limit=20) if (u.name or "") == name]
        except wb_users.WbUnavailable:
            self.wb_down = True
            return {"name": name, "notice": f"명부에 없음({name}), WorkBench 명부를 읽지 못함"}
        if len(users) > 1 and position:
            users = [u for u in users if (u.position or "") == position] or users
        if len(users) == 1:
            u = users[0]
            return {"name": name, "ref": {"employee_id": u.employee_id},
                    "label": f"{u.name}({', '.join(x for x in (u.department, u.position) if x)})"}
        if len(users) > 1:
            return {"name": name, "notice": f"동명이인({name}): 담당자를 손으로 고르세요"}
        return {"name": name, "notice": f"명부에 없음({name})"}


CHANGED_LABELS = {"title": "과제 이름", "category": "Category", "request_dept": "의뢰 부서", "requester": "의뢰자",
                  "key_point": "Key point", "purpose": "목적", "criteria": "평가 기준", "started_on": "시작 날짜",
                  "finished_on": "완료 날짜"}


def _changed(entry: models.Entry, task: models.EntryTask | None, r: dict, category: str) -> list[str]:
    """다시 넣을 때 엑셀 값이 LogBook 값과 다른 칸(표시만 — 반영은 계획 3부)."""
    def n(v):
        return " ".join(str(v or "").split())
    have = {"title": entry.title, **({k: getattr(task, k) for k in CHANGED_LABELS if k != "title"} if task else {})}
    new = {"title": r.get("name"), **{k: r.get(k) for k in CHANGED_LABELS if k != "title"}, "category": category}
    return [CHANGED_LABELS[k] for k in CHANGED_LABELS
            if n(new.get(k)) and n(new.get(k)) != n(have.get(k).isoformat() if hasattr(have.get(k), "isoformat") else have.get(k))]


def _plan(db: Session, batch: models.Batch, viewer=None) -> list[dict]:
    """행마다 초안으로 만들 내용과 알림(DB 대조). 미리보기와 만들기가 같은 계산을 쓴다.
    viewer 를 주면 '이미 있음'의 자료 번호, 상태, 바뀐 칸은 그 사람이 볼 수 있는 자료일 때만 싣는다(볼 수 없으면 숨김)."""
    sheet = batch.preset.get(SHEET_KEY) or {}
    year = int(sheet.get("year") or datetime.now().year)
    rows = sheet.get("rows") or []
    keys = [row_key(r, year) for r in rows]
    found_rows = (db.query(models.EntryTask, models.Entry).join(models.Entry, models.Entry.id == models.EntryTask.entry_id)
                  .filter(models.EntryTask.task_key.in_(keys or [""])).all())
    have = {t.task_key: (t, e) for t, e in found_rows}
    seen = access.visible_entry_pks(db, viewer, {e.id for _t, e in found_rows}) if viewer is not None else {e.id for _t, e in found_rows}
    known = {h for (h,) in db.query(models.Hull.hull_no)}
    target_vocab = vocab.Vocab(db, "target")
    roster = _Roster(db)
    out = []
    for i, (r, key) in enumerate(zip(rows, keys)):
        notices = []
        found = [roster.find(n, p) for n, p in split_people(r.get("assignee") or "")]
        notices += [f["notice"] for f in found if f.get("notice")]
        cands = sorted(extract_hull_candidates([r.get("name") or ""], known), key=lambda c: -c.score)
        hull = next((c.hull_no for c in cands if c.hull_no in known), None)
        raw_target = (r.get("target") or "").strip()
        term = target_vocab.target(raw_target) if raw_target else None
        category = (r.get("category") or "").strip()
        if category and category not in tasks.CATEGORIES:
            notices.append(f"목록 밖 Category({category}): 비워 둡니다")
            category = ""
        hit = have.get(key)
        exists = None
        if hit:
            t, e = hit
            if e.id in seen:
                exists = {"entry_id": e.entry_id, "status": e.status}
                changed = _changed(e, t, r, category)
                notices.insert(0, f"이미 있음({e.entry_id})" + (f", 바뀐 칸: {', '.join(changed)}" if changed else ""))
            else:
                exists = {"entry_id": None, "status": None, "hidden": True}
                notices.insert(0, "이미 있음(볼 수 없는 자료)")
        status = (r.get("status") or "").strip()
        out.append({
            "index": i, "no": r.get("no"), "row": r.get("row"), "name": r.get("name") or "", "status": status,
            "key": key, "exists": exists,
            "assignee_text": r.get("assignee") or "",
            "assignees": [{"name": f["name"], "label": f.get("label"), "ref": f.get("ref")} for f in found],
            "hull": hull, "target": term.value if term is not None else None,
            "target_text": raw_target if raw_target and term is None else None,
            "category": category or None, "request_no": r.get("request_no") or "",
            "task": {**{k: r.get(k) or "" for k in TASK_TEXT}, "category": category},
            "notices": notices,
            "checked": not exists and status.replace(" ", "") in DEFAULT_STATUSES,
        })
    return out


def can_create(user, batch: models.Batch) -> bool:
    """[초안 만들기] — LV2 이상인 올린 사람(폴더에 직접 넣은 묶음은 '내가 올렸어요'로 가져간 뒤), 또는 LV3."""
    if user is None or not access.can_write_shared(user):
        return False
    return access.is_admin(user) or bool(batch.uploader and batch.uploader == user.employee_id)


def preview(db: Session, batch: models.Batch, viewer) -> dict:
    """화면용 — 묶음 응답 task_sheet. review 상태에서만 행을 대조한다(끝난 묶음은 결과만)."""
    sheet = batch.preset.get(SHEET_KEY) or {}
    d = {"file": sheet.get("file"), "sheet": sheet.get("sheet"), "year": sheet.get("year"),
         "error": sheet.get("error"), "skipped": sheet.get("skipped") or [], "unread": sheet.get("unread") or [],
         "total": len(sheet.get("rows") or []), "result": batch.preset.get(RESULT_KEY)}
    if batch.state == "review":
        if not sheet.get("error"):
            d["rows"] = _plan(db, batch, viewer)
            d["can_create"] = can_create(viewer, batch)
        # 필수 열 오류로 읽지 못한 묶음도 버릴 수 있어야 한다(Codex 검토)
        d["can_discard"] = bool(viewer is not None and (access.is_admin(viewer) or batch.uploader == viewer.employee_id))
    return d


def _lock_review(db: Session, key: str) -> models.Batch:
    b = db.query(models.Batch).filter_by(key=key).with_for_update().populate_existing().first()
    if b is None or not is_task_batch(b):
        raise HTTPException(status_code=404, detail="batch_not_found")
    if b.state != "review":
        raise HTTPException(status_code=409, detail="task_sheet_not_review")
    return b


def _make_draft(db: Session, batch: models.Batch, p: dict) -> models.Entry:
    from .service import set_tags

    e = models.Entry(title=(p["name"] or f"과제 {p['no']}")[:200], status="draft", batch_id=batch.id,
                     uploaded_by=batch.uploader, access="normal")
    db.add(e)
    db.flush()
    e.entry_id = f"E{e.id:06d}"
    if p["hull"]:
        db.add(models.EntryHull(entry_id=e.id, hull_no=p["hull"], is_primary=True))
    if p["target"]:
        set_tags(db, e, "target", [p["target"]])
    refs = [a["ref"] for a in p["assignees"] if a.get("ref")]
    if refs:
        people.set_assignees(db, e, people.resolve_refs(db, refs))
    data = {**p["task"], "target_text": p["target_text"] or ""}
    try:
        values = tasks.clean(data)
    except HTTPException:   # 거꾸로 된 날짜, 잘못된 날짜 — 날짜만 비우고 만든다
        values = tasks.clean({**data, "started_on": "", "finished_on": ""})
    db.add(models.EntryTask(entry_id=e.id, task_key=p["key"], source_batch=batch.key, **values))
    db.flush()
    return e


def create_drafts(db: Session, storage: StoragePaths, key: str, user, indexes: list[int], ip: str | None = None) -> dict:
    """고른 행으로 초안을 만든다. 행 하나가 실패해도(열쇠 충돌 등) 나머지는 만들고 사유를 남긴다."""
    # WorkBench 조회(명부 대조, 명부 만들기)는 실패하면 세션을 롤백한다(wb_users._run) — 잠금을 잡기 전에 끝낸다(Codex 검토)
    pre = db.query(models.Batch).filter_by(key=key).first()
    if pre is None or not is_task_batch(pre):
        raise HTTPException(status_code=404, detail="batch_not_found")
    if pre.state != "review":
        raise HTTPException(status_code=409, detail="task_sheet_not_review")
    if not can_create(user, pre):
        raise HTTPException(status_code=403, detail="level2_uploader_required")
    plan = {p["index"]: p for p in _plan(db, pre, user)}
    chosen = [plan[i] for i in dict.fromkeys(indexes) if i in plan]
    for p in chosen:
        for a in p["assignees"]:
            if a.get("ref", {}) and a["ref"].get("employee_id"):
                a["ref"] = {"id": people._from_wb(db, a["ref"]["employee_id"]).id}
    db.commit()
    batch = _lock_review(db, key)
    if not can_create(user, batch):
        raise HTTPException(status_code=403, detail="level2_uploader_required")
    created, failed, skipped, records = [], [], [], []
    for p in chosen:
        if p["exists"]:
            skipped.append(p["no"])
            continue
        sp = db.begin_nested()
        try:
            e = _make_draft(db, batch, p)
            sp.commit()
        except IntegrityError:
            sp.rollback()
            failed.append({"no": p["no"], "reason": "이미 있음(같은 열쇠)"})
            continue
        except HTTPException as exc:
            sp.rollback()
            failed.append({"no": p["no"], "reason": str(exc.detail)})
            continue
        created.append(e.entry_id)
        records.append({"no": p["no"], "key": p["key"], "entry_id": e.entry_id, "title": e.title,
                        "hulls": [p["hull"]] if p["hull"] else [], "target": p["target"],
                        "assignees": people.export(people.assignees_of(db, e)), "task": tasks.get(db, e)})
    hulls = {p["hull"] for p in chosen if p["hull"]}
    now = datetime.now().replace(microsecond=0)
    batch.preset = {**batch.preset, RESULT_KEY: {"created": created, "failed": failed, "skipped": skipped,
                                                 "by": user.employee_id, "at": now.isoformat()}}
    batch.state = "processed" if created else "done"
    batch.processed_at = now
    db.flush()
    # 기록 파일: 커밋 전에 임시 파일로 써 두고(못 쓰면 커밋하지 않는다), 커밋한 뒤에 바꿔 끼운다 —
    # 커밋이 실패했는데 기록만 남아 재구축 때 없는 초안이 생기지 않게(Codex 검토)
    tmp = _write_import(storage, batch, records, user.employee_id, now) if records else None
    try:
        db.commit()
    except Exception:
        _drop(tmp)
        raise
    if tmp:
        try:
            os.replace(tmp, tmp[:-4])
        except OSError:
            log.exception("과제 묶음 %s — %s 바꿔 끼우기 실패(초안은 만들어짐, 재구축 때 되살리지 못함)", batch.key, IMPORT_FILE)
    if hulls:
        from .. import plm_ship
        plm_ship.register_hulls(db, hulls)
        db.commit()
    audit.record(db, storage, actor=user.employee_id, action="TASK_IMPORT", target_type="batch", target_id=batch.key,
                 after={"file": (batch.preset.get(SHEET_KEY) or {}).get("file"), "created": created,
                        "failed": failed, "skipped": skipped}, ip=ip)
    return {"created": created, "failed": failed, "skipped": skipped}


def _write_import(storage: StoragePaths, batch: models.Batch, records: list[dict], by: str, at: datetime) -> str:
    """기록을 임시 파일(.tmp)로 쓰고 그 경로를 돌려준다(부르는 쪽이 커밋 뒤 바꿔 끼운다). 못 쓰면 503."""
    sheet = batch.preset.get(SHEET_KEY) or {}
    data = {"version": 1, "batch": batch.key, "file": sheet.get("file"), "sheet": sheet.get("sheet"),
            "year": sheet.get("year"), "by": by, "at": at.isoformat(), "drafts": records, "gone": []}
    path = long_join(storage.staging / batch.key, IMPORT_FILE)
    tmp = path + ".tmp"
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1)
    except OSError as exc:
        log.warning("과제 묶음 %s — %s 를 쓰지 못함: %s", batch.key, IMPORT_FILE, exc)
        _drop(tmp)
        raise HTTPException(status_code=503, detail="storage_unavailable") from exc
    return tmp


def _drop(path: str | None) -> None:
    if path:
        try:
            os.remove(path)
        except OSError:
            pass


def mark_gone(db: Session, storage: StoragePaths | None, entry: models.Entry, gone: bool = True) -> None:
    """과제 엑셀로 만든 초안을 버리거나 합쳐 없앨 때 기록(_task_import.json)의 gone 에 적는다 — 재구축이 그 초안을
    다시 만들지 않게(Codex 검토). 버린 초안을 되돌리면 gone=False 로 지운다. 실패해도 본 동작은 막지 않는다."""
    if storage is None or entry is None:
        return
    row = db.get(models.EntryTask, entry.id)
    if row is None or not row.source_batch:
        return
    path = long_join(storage.staging / row.source_batch, IMPORT_FILE)
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        ids = set(data.get("gone") or [])
        ids = ids | {entry.entry_id} if gone else ids - {entry.entry_id}
        data["gone"] = sorted(ids)
        with open(path + ".tmp", "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1)
        os.replace(path + ".tmp", path)
    except FileNotFoundError:
        return
    except (OSError, ValueError):
        log.warning("과제 기록 %s 의 gone 을 고치지 못함(%s)", row.source_batch, entry.entry_id, exc_info=True)


def discard(db: Session, storage: StoragePaths, key: str, user, ip: str | None = None) -> None:
    """[이 묶음 버리기] — 초안을 만들지 않고 끝낸다. 원본 엑셀은 휴지통 폴더로(재구축 때 다시 미리보기가 생기지 않게)."""
    batch = _lock_review(db, key)
    if not (access.is_admin(user) or (batch.uploader and batch.uploader == user.employee_id)):
        raise HTTPException(status_code=403, detail="not_uploader")
    src = long_join(storage.staging / batch.key, SHEET_FILE)
    if os.path.exists(src):
        dest_dir = to_long(storage.trash / f"task_{batch.key}")
        os.makedirs(dest_dir, exist_ok=True)
        os.replace(src, os.path.join(dest_dir, SHEET_FILE))
    batch.state, batch.processed_at = "done", datetime.now().replace(microsecond=0)
    db.commit()
    audit.record(db, storage, actor=user.employee_id, action="TASK_SHEET_DISCARD", target_type="batch",
                 target_id=batch.key, after={"file": (batch.preset.get(SHEET_KEY) or {}).get("file")}, ip=ip)


def restore_import(db: Session, batch: models.Batch, data: dict) -> int:
    """재구축 — `_task_import.json` 의 초안을 다시 만든다(같은 자료 번호). 열쇠가 이미 있으면(확정 자료가 먼저 되살아났거나)
    그 행은 건너뛴다. 만든 수."""
    made = 0
    gone = set(data.get("gone") or [])
    for rec in data.get("drafts") or []:
        eid, key = str(rec.get("entry_id") or ""), str(rec.get("key") or "")
        if not re.fullmatch(r"E\d{6}", eid) or not key or eid in gone:
            continue
        if db.query(models.EntryTask.entry_id).filter_by(task_key=key).first() or db.get(models.Entry, int(eid[1:])):
            continue
        sp = db.begin_nested()
        try:
            e = models.Entry(id=int(eid[1:]), entry_id=eid, title=str(rec.get("title") or eid)[:200], status="draft",
                             batch_id=batch.id, uploaded_by=data.get("by"), access="normal")
            db.add(e)
            db.flush()
            for i, h in enumerate(rec.get("hulls") or []):
                if re.fullmatch(r"\d{4}", str(h)):
                    db.add(models.EntryHull(entry_id=e.id, hull_no=str(h), is_primary=(i == 0)))
            if rec.get("target"):
                from .service import set_tags
                set_tags(db, e, "target", [str(rec["target"])])
            if rec.get("assignees"):
                people.restore_assignees(db, e, rec["assignees"])
            tasks.restore(db, e, {**(rec.get("task") or {}), "task_key": key, "source_batch": batch.key})
            sp.commit()
            made += 1
        except Exception:   # noqa: BLE001 — 행 하나가 재구축 전체를 멈추지 않게
            sp.rollback()
            log.warning("재구축: 과제 초안 %s 를 되살리지 못함(건너뜀)", eid, exc_info=True)
    return made
