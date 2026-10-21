"""재구축(설계 §2.1·§4.1·§9) — 공유 폴더만으로 빈 DB 를 다시 채운다.

원천:
- 90_System\\registry.json — 사용자(등급 포함)·호선 선종/메모·태그 동의어·비공개 범위·열람 허락(13)·
  WorkBench 보내기 제한 규칙(18-b)
- 10_Vault\\<연도>\\<EntryID>\\entry.json — 확정 Entry(21 — 보고서 정보·연결 `reports`. 29 — 옛 `project` 는 읽지 않는다)
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
from ..report_catalog import restore_reports
from ..models import ENTRY_ACCESS, FILE_KINDS, LEGACY_ENTRY_ACCESS, USER_LEVELS, USER_STATUSES
from ..storage.paths import StoragePaths, long_join, to_long
from .autoinc import fix_autoinc
from .registry import read_registry
from .state import worker_status

log = logging.getLogger(__name__)

ENTRY_ID_PATTERN = re.compile(r"^E[0-9]{6,9}$")
YEAR_PATTERN = re.compile(r"^[0-9]{4}$")
TRASH_PATTERN = re.compile(r"^(E[0-9]{6,9})_([0-9]{8})-([0-9]{6})$")
FILES_TRASH_PATTERN = re.compile(r"^E[0-9]{6,9}_files_[0-9]{8}-[0-9]{6}$")   # 37 — 자료에서 뺀 파일
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


def _level_of(u: dict) -> int:
    """registry 사용자 → LogBook 등급(15). 15 이전 registry 는 database.migrate_levels 와 같은 규칙으로
    (승인 대기·비활성·guest → 1, master·admin·is_admin → 3, viewer_all·member(13 이전은 role 없음) → 2)."""
    if u.get("level") in USER_LEVELS:
        return u["level"]
    if u.get("status") in ("pending", "disabled"):
        return 1
    role = u.get("role")
    if role in ("master", "admin") or u.get("is_admin"):
        return 3
    if role in ("viewer_all", "member") or role is None:
        return 2
    return 1


def access_value(a: str | None, min_role: str | None = None) -> str:
    """entry.json·registry 의 공개 값 → 15 공개 단계. 13 값(public/private+최소 등급)은 database.migrate_access 규칙."""
    if a in ENTRY_ACCESS:
        return a
    if a == "private":
        return "blocked" if min_role == "admin" else "normal"
    return "normal"


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
                           status=status, level=_level_of(u), wb_admin=bool(u.get("wb_admin")),
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
        plm = h.get("plm") if isinstance(h.get("plm"), dict) else None
        if plm and plm.get("status") in ("found", "not_found"):   # 30 — PLM 선박 정보
            from ..hull_info import PLM_FIELDS

            row.plm_status, row.plm_checked_at = plm["status"], _dt(plm.get("checked_at"))
            for k in PLM_FIELDS:
                v = plm.get(k)
                setattr(row, k, (bool(v) if v is not None else None) if k == "delivered"
                        else (str(v) if v is not None else None))
        series = h.get("series") if isinstance(h.get("series"), dict) else None
        if series:   # 45 — 시리즈
            lead = str(series.get("lead") or "") or None
            row.series_lead = lead if lead and HULL_PATTERN.fullmatch(lead) else None
            row.series_seq = str(series["seq"])[:10] if series.get("seq") is not None else None
            row.series_manual = True if series.get("manual") else None
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
    acc = access_value(data.get("access"), data.get("private_min_role"))
    e = models.Entry(access=acc,
        id=int(entry_id[1:]), entry_id=entry_id, title=(data.get("title") or "")[:200],
        description=data.get("description"),   # 42 — 옛 entry.json 의 analysis_type 은 읽지 않는다
        # 15 — 해석 시기는 화면에서 뺐지만 옛 entry.json 에 있으면 열에 그대로 둔다(값 보존)
        analysis_period=data.get("analysis_period"), status=status, batch_id=batch.id,
        uploaded_by=data.get("uploaded_by"), confirmed_by=data.get("confirmed_by"),
        confirmed_at=_dt(data.get("confirmed_at")), vault_rel=vault_rel, trash_rel=trash_rel,
        version=int(data.get("version") or 1),
        # 20 — 호선 없음(공용)·제목 초안의 원래 이름(없으면 기본값 — 20 이전 entry.json)
        no_hull=bool(data.get("no_hull")), title_source=(str(data["title_source"])[:255]
                                                         if data.get("title_source") else None))
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
    if isinstance(data.get("target"), str) and data["target"].strip():   # 38 — 대상 구조물
        set_tags(db, e, "target", [data["target"]])
    if data.get("assignees"):   # 46 — 담당자(명부 행을 찾거나 만든다)
        from ..people import restore_assignees
        restore_assignees(db, e, data["assignees"])
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
    # 14 — 사용자가 정리한 판 배치(entry.json revisions). 자동 추정은 다음 읽기·변환 때 다시 계산된다
    from ..revisions.series import restore_manual
    restore_manual(db, e, files, data.get("revisions"))
    db.flush()
    # 39 — WorkBench 해석 출처(entry.json origins) — 출처마다 묶음을 만들어 그 파일을 옮겨 단다
    from .. import wb_origin
    wb_origin.restore(db, e, files, data.get("origins"))
    return e, files, missing


def _restore_access(db: Session, registry: dict) -> tuple[int, int]:
    """13·15 — registry.json 의 공개 단계(공유·블록)·열람 허락을 Entry 에 입힌다(entry.json 보다 registry 를 믿는다 —
    둘 다 바뀔 때마다 쓰지만, entry.json 은 휴지통·초안에 없을 수 있다). 없는 Entry 는 건너뛴다."""
    by_id = {eid: pk for pk, eid in db.query(models.Entry.id, models.Entry.entry_id)}
    n_access = n_grants = 0
    for a in registry.get("entry_access") or []:
        pk = by_id.get(str(a.get("entry_id") or ""))
        if pk is None or a.get("access") not in ENTRY_ACCESS + LEGACY_ENTRY_ACCESS:
            continue
        e = db.get(models.Entry, pk)
        e.access = access_value(a["access"], a.get("private_min_role"))
        n_access += 1
    seen: set[tuple[int, str]] = set()
    for g in registry.get("grants") or []:
        pk = by_id.get(str(g.get("entry_id") or ""))
        who = str(g.get("employee_id") or "").strip().upper()
        if pk is None or not who or (pk, who) in seen:
            continue
        seen.add((pk, who))
        db.add(models.EntryGrant(entry_id=pk, employee_id=who, granted_by=g.get("granted_by"),
                                 granted_at=_dt(g.get("granted_at")) or models._now()))
        n_grants += 1
    db.flush()
    return n_access, n_grants


def _restore_aliases(db: Session, registry: dict) -> int:
    n = 0
    for t in registry.get("tags") or []:
        kind, value, target = t.get("kind"), t.get("value"), t.get("alias_of")
        if kind not in ("zone", "free", "target") or not value or not target or value == target:   # 42 — atype 은 읽지 않는다
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
        if kind not in ("zone", "target") or not value:   # 42 — atype 은 읽지 않는다
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


def _restore_wb_rules(db: Session, registry: dict) -> int:
    """18-b — WorkBench 앱별 보내기 제한 규칙. registry 에 있는 대상은 그 값으로 덮는다(비운 규칙도 빈 채로 —
    서버가 먼저 기동하며 넣은 기본 규칙을 이긴다). 모르는 대상·형식이 틀린 행은 건너뛴다."""
    from ..wb_targets import TARGETS

    n = 0
    for r in registry.get("wb_target_rules") or []:
        target = r.get("target") if isinstance(r, dict) else None
        if target not in TARGETS:
            continue
        zones, targets, tags = ([str(v)[:100] for v in r.get(f) or [] if isinstance(v, str) and v.strip()]
                                for f in ("zones", "targets", "tags"))   # 40 이전 registry 에는 targets 가 없다
        row = db.get(models.WbTargetRule, target)
        if row is None:
            row = models.WbTargetRule(target=target)
            db.add(row)
        row.zones, row.targets, row.tags = zones, targets, tags
        row.updated_by = str(r.get("updated_by"))[:20] if r.get("updated_by") else None
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
    # 21 — 보고서 정보·연결은 다른 자료의 모델을 가리킬 수 있어 모든 자료를 되살린 뒤에 잇는다
    pending_reports: list[tuple[str, list]] = []

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
        if data.get("reports"):
            pending_reports.append((folder_id, data["reports"]))
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
        if FILES_TRASH_PATTERN.fullmatch(folder):
            continue   # 37 — 자료에서 하나만 뺀 파일(DB 에만 기록 — 재구축하지 않는다)
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

    try:
        with db.begin_nested():
            result.update(restore_reports(db, pending_reports))
    except Exception as exc:  # noqa: BLE001 — 보고서 정보가 깨져 있어도 자료 재구축은 끝낸다
        log.warning("재구축: 보고서 정보·연결을 되살리지 못함 — %s", exc)
    db.commit()

    result["access_entries"], result["grants"] = _restore_access(db, registry)
    result["alias_tags"] = _restore_aliases(db, registry)
    result["vocab_terms"] = _restore_vocab(db, registry)
    result["wb_target_rules"] = _restore_wb_rules(db, registry)
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

    result["admins"] = [e for (e,) in db.query(models.User.employee_id)
                        .filter(models.User.level == 3).order_by(models.User.employee_id)]
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
