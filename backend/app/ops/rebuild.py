"""재구축(설계 §2.1·§4.1·§9) — 공유 폴더만으로 빈 DB 를 다시 채운다.

원천:
- 90_System\\registry.json — 사용자·호선 선종/메모·태그 동의어
- 10_Vault\\<연도>\\<EntryID>\\entry.json — 확정 Entry
- 95_Trash\\<EntryID>_<시각>\\entry.json — 휴지통 Entry(draft_… 는 entry.json 이 없어 건너뛴다)
- 90_System\\audit\\*.jsonl — 감사 로그
- 10_Vault\\_staging\\<key> — 미확정 초안 대신 '주인 없는 배치'로 다시 처리한다

entries 표가 비어 있을 때만 돈다(운영 DB 덮어쓰기 방지). Entry 는 원래 id 그대로 넣는다(E000123 → 123) —
MySQL 은 명시 id 를 받으면 자동 증가 값을 최대값 다음으로 옮기므로 새 Entry 번호가 겹치지 않는다.
파생물(본문·BDF 변환)은 작업 큐에 다시 넣고, 워커가 sha·key 캐시로 빠르게 다시 채운다."""
import json
import logging
import os
import re
from datetime import datetime

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from .. import audit, jobs, models
from ..convert.job import enqueue_convert
from ..entries.service import HULL_PATTERN, set_tags
from ..extract.job import enqueue_extract
from ..ingest.rules import safe_ext
from ..models import FILE_KINDS, USER_STATUSES
from ..storage.paths import StoragePaths, long_join, to_long
from .autoinc import fix_autoinc
from .registry import read_registry
from .state import worker_status

log = logging.getLogger(__name__)

ENTRY_ID_PATTERN = re.compile(r"^E[0-9]{6,9}$")
YEAR_PATTERN = re.compile(r"^[0-9]{4}$")
TRASH_PATTERN = re.compile(r"^(E[0-9]{6,9})_([0-9]{8})-([0-9]{6})$")
COMMIT_EVERY = 500      # Entry 이만큼마다 중간 커밋(실패하면 빈 DB 에서 다시 하면 된다)
AUDIT_CHUNK = 5000


class RebuildError(Exception):
    pass


def _load_json(path: str) -> dict | None:
    """긴 경로(to_long/long_join 을 거친 문자열)의 JSON 을 읽는다. 없거나 깨졌으면 None."""
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _dirs(path) -> list[str]:
    try:
        with os.scandir(to_long(path)) as it:
            return sorted(e.name for e in it if e.is_dir())
    except OSError:
        return []


def _dt(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)).replace(microsecond=0)
    except ValueError:
        return None


def _restore_users(db: Session, registry: dict) -> int:
    known = {e for (e,) in db.query(models.User.employee_id)}
    n = 0
    for u in registry.get("users") or []:
        eid = str(u.get("employee_id") or "").strip().upper()
        if not eid or eid in known:
            continue
        status = u.get("status") if u.get("status") in USER_STATUSES else "pending"
        db.add(models.User(employee_id=eid, name=(u.get("name") or eid)[:50],
                           department=u.get("department"), position=u.get("position"),
                           status=status, is_admin=bool(u.get("is_admin")),
                           created_at=_dt(u.get("created_at")) or models._now()))
        known.add(eid)
        n += 1
    db.flush()
    return n


def _restore_hulls(db: Session, registry: dict) -> int:
    n = 0
    for h in registry.get("hulls") or []:
        no = str(h.get("hull_no") or "")
        if not HULL_PATTERN.fullmatch(no):
            continue
        row = db.get(models.Hull, no)
        if row is None:
            row = models.Hull(hull_no=no)
            db.add(row)
            n += 1
        row.ship_type, row.memo = h.get("ship_type"), h.get("memo")
    db.flush()
    return n


def _ensure_hull(db: Session, hull_no: str, ship_type: str | None) -> None:
    row = db.get(models.Hull, hull_no)
    if row is None:
        db.add(models.Hull(hull_no=hull_no, ship_type=ship_type))
        db.flush()  # autoflush 가 꺼져 있어 다음 db.get 이 pending 행을 못 본다
    elif not row.ship_type and ship_type:
        row.ship_type = ship_type


def _restore_entry(db: Session, storage: StoragePaths, data: dict, *, status: str, vault_rel: str,
                   trash_rel: str | None, location: str, batch: models.Batch, files_root: str,
                   updated_at: datetime | None = None) -> tuple[models.Entry, list[models.File], int]:
    """entry.json 하나로 Entry·호선·태그·파일 행을 만든다. 디스크에 없는 파일도 행은 만들고 센다."""
    entry_id = data["entry_id"]
    e = models.Entry(
        id=int(entry_id[1:]), entry_id=entry_id, title=(data.get("title") or "")[:200],
        analysis_type=data.get("analysis_type"), description=data.get("description"),
        analysis_period=data.get("analysis_period"), status=status, batch_id=batch.id,
        uploaded_by=data.get("uploaded_by"), confirmed_by=data.get("confirmed_by"),
        confirmed_at=_dt(data.get("confirmed_at")), vault_rel=vault_rel, trash_rel=trash_rel,
        version=int(data.get("version") or 1))
    if updated_at is not None:
        # 휴지통 Entry 는 버린 시각(폴더 이름)을 넣는다 — 재구축 시각이면 90일 보관 기간이 처음부터 다시 센다(리뷰 I10)
        e.updated_at = updated_at
    db.add(e)
    db.flush()
    seen: set[str] = set()
    hulls = sorted(data.get("hulls") or [], key=lambda h: not h.get("is_primary"))
    for i, h in enumerate(hulls):
        no = str(h.get("hull_no") or "")
        if not HULL_PATTERN.fullmatch(no) or no in seen:
            continue
        seen.add(no)
        db.add(models.EntryHull(entry_id=e.id, hull_no=no, is_primary=(i == 0)))
        _ensure_hull(db, no, h.get("ship_type"))
    set_tags(db, e, "zone", [str(z) for z in data.get("zones") or []])
    set_tags(db, e, "free", [str(t) for t in data.get("tags") or []])
    files: list[models.File] = []
    missing = 0
    for fd in data.get("files") or []:
        rel = str(fd.get("rel_path") or "")
        if not rel:
            continue
        name = rel.split("/")[-1]
        kind = fd.get("kind") if fd.get("kind") in FILE_KINDS else "other"
        f = models.File(batch_id=batch.id, entry_id=e.id, rel_path=rel, name=name[:255], ext=safe_ext(name),
                        kind=kind, size=int(fd.get("size") or 0), sha256=str(fd.get("sha256") or "")[:64],
                        location=location)
        db.add(f)
        files.append(f)
        try:
            exists = os.path.isfile(long_join(files_root, rel))
        except ValueError:
            exists = False
        if not exists:
            missing += 1
            log.warning("재구축: 디스크에 없는 파일 — %s %s", entry_id, rel)
    db.flush()
    return e, files, missing


def _restore_aliases(db: Session, registry: dict) -> int:
    n = 0
    for t in registry.get("tags") or []:
        kind, value, target = t.get("kind"), t.get("value"), t.get("alias_of")
        if kind not in ("zone", "free", "atype") or not value or not target or value == target:
            continue
        rows = {}
        for v in (value, target):
            row = db.query(models.Tag).filter_by(kind=kind, value=v).first()
            if row is None:
                row = models.Tag(kind=kind, value=v[:100])
                db.add(row)
                db.flush()
            rows[v] = row
        if rows[value].id == rows[target].id:  # 대소문자만 다른 값(같은 태그)
            continue
        rows[value].alias_of_id = rows[target].id
        n += 1
    db.flush()
    return n


def _restore_vocab(db: Session, registry: dict) -> int:
    """08 — 분류 목록 용어(순서·사용 여부). 동의어(alias)는 _restore_aliases 가 이미 되살렸다."""
    n = 0
    for t in registry.get("vocab") or []:
        kind, value = t.get("kind"), str(t.get("value") or "")[:100]
        if kind not in ("zone", "atype") or not value:
            continue
        row = db.query(models.Tag).filter_by(kind=kind, value=value).first()
        if row is None:
            row = models.Tag(kind=kind, value=value)
            db.add(row)
        row.alias_of_id, row.listed = None, True
        row.sort_order = t.get("sort_order") if isinstance(t.get("sort_order"), int) else None
        row.active = t.get("active") is not False
        db.flush()
        n += 1
    return n


def _restore_audit(db: Session, storage: StoragePaths) -> tuple[int, int]:
    ok = bad = 0
    try:
        names = sorted(n for n in os.listdir(to_long(storage.audit_dir)) if n.endswith(".jsonl"))
    except OSError:
        return 0, 0
    for name in names:
        try:
            fh = open(to_long(storage.audit_dir / name), encoding="utf-8", errors="replace")
        except OSError:
            log.warning("재구축: 감사 로그 파일을 열 수 없음 — %s", name)
            continue
        with fh:
            for line in fh:
                if not line.strip():
                    continue
                try:
                    d = json.loads(line)
                    target = d.get("target") or {}
                    at = _dt(d["at"])
                    if at is None or not d.get("action"):
                        raise ValueError("at/action 없음")
                    db.add(models.AuditLog(at=at, employee_id=d.get("employee_id"), action=str(d["action"])[:40],
                                           target_type=str(target.get("type") or "")[:20],
                                           target_id=str(target.get("id") or "")[:40],
                                           before=d.get("before"), after=d.get("after"), ip=d.get("ip")))
                    ok += 1
                except (ValueError, KeyError, TypeError, AttributeError):
                    bad += 1
                    continue
                if ok % AUDIT_CHUNK == 0:
                    db.flush()
    db.flush()
    return ok, bad


def _has_files(path: str) -> bool:
    for _dirpath, _dirs, files in os.walk(path):
        if files:
            return True
    return False


def _restore_staging(db: Session, storage: StoragePaths) -> tuple[int, int]:
    known = {k for (k,) in db.query(models.Batch.key)}
    batches = queued = 0
    for key in _dirs(storage.staging):
        if key in known or len(key) > 24:
            if len(key) > 24:
                log.warning("재구축: 배치 키가 너무 긴 staging 폴더 — 건너뜀: %s", key)
            continue
        if not _has_files(long_join(storage.staging, key)):
            continue  # 확정 뒤 남은 빈 폴더
        b = models.Batch(key=key, source="inbox", original_name=key, state="staged", uploader=None)
        db.add(b)
        db.flush()
        jobs.enqueue(db, "process_batch", b.id)
        batches += 1
        queued += 1
    db.flush()
    return batches, queued


def rebuild(db: Session, storage: StoragePaths, *, force: bool = False) -> dict:
    if db.query(models.Entry.id).first() is not None:
        raise RebuildError("db_not_empty")
    if not force and worker_status(db)["alive"]:
        # 워커가 빈 DB 를 보고 돌고 있으면 재구축과 겹친다(staging 배치를 동시에 처리 등) — 먼저 멈춘다
        raise RebuildError("worker_running")
    now = datetime.now().replace(microsecond=0)
    result = {"entries": 0, "trashed": 0, "files": 0, "missing_files": 0, "skipped_drafts": 0,
              "skipped_bad": 0, "users": 0, "hulls": 0, "alias_tags": 0, "audit": 0, "audit_bad": 0,
              "staging_batches": 0, "jobs": 0, "admins": [], "next_entry_id": 0, "missing_in_db": []}

    registry = read_registry(storage)
    result["users"] = _restore_users(db, registry)
    result["hulls"] = _restore_hulls(db, registry)

    batch = models.Batch(key=f"rebuild-{now:%Y%m%d-%H%M%S}", source="rebuild", original_name="재구축",
                         state="done", processed_at=now)
    db.add(batch)
    db.flush()
    db.commit()

    seen: set[str] = set()

    def add(data: dict | None, folder_id: str, **kw) -> bool:
        if (data is None or data.get("entry_id") != folder_id or not ENTRY_ID_PATTERN.fullmatch(folder_id)
                or folder_id in seen):
            result["skipped_bad"] += 1
            log.warning("재구축: entry.json 이 없거나 맞지 않음 — 건너뜀: %s", folder_id)
            return False
        seen.add(folder_id)
        # Entry 하나가 깨져 있어도(형식이 틀린 값 등) 그 Entry 만 건너뛴다 — savepoint 로 감싼다(리뷰 I7)
        try:
            with db.begin_nested():
                _e, files, missing = _restore_entry(db, storage, data, batch=batch, **kw)
        except Exception as exc:  # noqa: BLE001 — 어떤 손상이든 그 Entry 만 건너뛴다
            result["skipped_bad"] += 1
            log.warning("재구축: Entry 를 되살리지 못해 건너뜀: %s — %s", folder_id, exc)
            return False
        result["files"] += len(files)
        result["missing_files"] += missing
        if (result["entries"] + result["trashed"]) % COMMIT_EVERY == COMMIT_EVERY - 1:
            db.commit()
        return True

    # Vault — <연도>\<EntryID>\entry.json (_staging 제외)
    for year in _dirs(storage.vault):
        if not YEAR_PATTERN.fullmatch(year):
            continue
        for eid in _dirs(storage.vault / year):
            base = long_join(storage.vault, f"{year}/{eid}")
            if add(_load_json(base + "\\entry.json"), eid, status="confirmed", vault_rel=f"{year}/{eid}",
                   trash_rel=None, location="vault", files_root=base + "\\files"):
                result["entries"] += 1

    # 휴지통 — <EntryID>_<시각>\entry.json (draft_… 는 entry.json 이 없다)
    for folder in _dirs(storage.trash):
        if folder.startswith("draft_"):
            result["skipped_drafts"] += 1
            continue
        m = TRASH_PATTERN.fullmatch(folder)
        if m is None:
            result["skipped_bad"] += 1
            log.warning("재구축: 알 수 없는 휴지통 폴더 — 건너뜀: %s", folder)
            continue
        base = long_join(storage.trash, folder)
        data = _load_json(base + "\\entry.json")
        confirmed = _dt((data or {}).get("confirmed_at"))
        year = confirmed.year if confirmed else int(m.group(2)[:4])
        try:
            trashed_at = datetime.strptime(m.group(2) + m.group(3), "%Y%m%d%H%M%S")
        except ValueError:
            trashed_at = None
        if add(data, m.group(1), status="trashed", vault_rel=f"{year}/{m.group(1)}", trash_rel=folder,
               location="trash", updated_at=trashed_at, files_root=base + "\\files"):
            result["trashed"] += 1
    db.commit()

    result["alias_tags"] = _restore_aliases(db, registry)
    result["vocab_terms"] = _restore_vocab(db, registry)
    result["audit"], result["audit_bad"] = _restore_audit(db, storage)
    db.commit()

    result["staging_batches"], result["jobs"] = _restore_staging(db, storage)
    # 파생물 — 본문 추출·BDF 변환을 다시 건다(휴지통 파일은 복원될 때 다시 건다).
    # 중간 커밋으로 만료된 객체를 하나씩 다시 읽지 않도록 한 번에 읽는다.
    live_files = (db.query(models.File).filter(models.File.batch_id == batch.id, models.File.location == "vault")
                  .order_by(models.File.id).all())
    for f in live_files:
        if enqueue_extract(db, f):
            result["jobs"] += 1
        if enqueue_convert(db, f):
            result["jobs"] += 1
    db.commit()

    result["admins"] = [e for (e,) in db.query(models.User.employee_id).filter(models.User.is_admin.is_(True))
                        .order_by(models.User.employee_id)]
    audit.record(db, storage, actor="system", action="DB_REBUILD", target_type="system", target_id="rebuild",
                 after={k: v for k, v in result.items() if k != "missing_in_db"})
    # 새 Entry 번호가 디스크·감사 로그·휴지통에서 본 번호와 겹치지 않게 자동 증가 값을 올린다(리뷰 I6)
    try:
        fixed = fix_autoinc(db, storage)
        result["next_entry_id"], result["missing_in_db"] = fixed["next_id"], fixed["missing_in_db"]
    except SQLAlchemyError as exc:
        db.rollback()
        log.warning("재구축: 자동 증가 값 보정 실패 — 'python -m app.cli fix-autoinc' 로 다시 하세요: %s", exc)
    return result
