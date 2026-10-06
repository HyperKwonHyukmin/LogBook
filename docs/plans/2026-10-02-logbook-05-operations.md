# Logbook 05 — 운영 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 145 서버에서 Logbook 을 혼자 돌아가게 만든다.
- 재부팅해도 자동 시작한다.
- 매일 백업한다.
- DB 를 잃어도 공유 폴더만으로 다시 세운다.
- 관리자가 화면에서 워커·작업 큐·백업을 보고 재시도·재변환한다.
- 휴지통은 90일 뒤 비운다.
- 팀원에게 `.url` 바로가기를 배포한다.

**Architecture:**
- **레지스트리**: DB 에만 있던 운영 정보를 `90_System\registry.json` 에도 남긴다(사용자·호선 메모·선종·태그 동의어). 바뀔 때마다 갱신한다.
- **재구축**: `python -m app.cli rebuild` 가 `registry.json` + 모든 `entry.json`(Vault·휴지통) + 감사 JSONL 로 빈 DB 를 채운다. 파생물은 sha·key 캐시로 다시 쓴다.
- **매일 작업**: 워커가 하루 한 번(02시 이후 첫 주기) `mysqldump` 백업, 레지스트리 갱신, 90일 지난 휴지통 비우기를 한다. 상태는 새 표 `system_state` 에 둔다(워커 심장 박동 포함).
- **서비스 등록**: 145 에는 서비스 관리 도구(NSSM 등)를 새로 들이지 않는다. Windows 작업 스케줄러에 "시작 시 실행 + 실패 시 재시작" 작업 두 개(API·워커)를 등록하는 PowerShell 스크립트를 둔다. 공유 폴더 권한이 필요하므로 SYSTEM 이 아니라 공유 폴더 권한이 있는 도메인 계정으로 실행한다.

**Tech Stack:** FastAPI · SQLAlchemy · MySQL 8(`mysqldump`) · React · PowerShell(작업 스케줄러)

**설계 근거:** `docs/specs/2026-09-28-logbook-design.md`
- §2.1: 공유 폴더가 원본이고 DB 는 재구축 가능한 캐시다.
- §3: `80_Backup`·`90_System`·`95_Trash` 90일.
- §4.1: entry.json → 재구축.
- §6.1: `/admin` — 가입 승인, 관리자 지정, 재색인·재변환·재구축, 워커 상태.
- §8: 휴지통 90일 자동 비움, 관리자 수동 영구 삭제.
- §9: DB 유실 → entry.json 재구축 + 일일 덤프.
- §12: 서비스 등록, 로그, 덤프, 관리자 화면, 배포.

**이번 계획에서 확정한 점:**
1. 태그 동의어와 호선 메모·선종은 `registry.json` 에 남긴다(앞서 미뤄 둔 결정). 사용자 목록(사번·이름·부서·상태·관리자 여부)도 함께 남긴다. 세션은 남기지 않는다.
2. 재구축은 **entries 표가 비어 있을 때만** 돈다. 실수로 운영 DB 에 덮어쓰지 않게 하려는 것이다. 재구축한 Entry 는 **원래 id 를 그대로 넣는다**(`E000123` → id 123). 그래야 새 Entry 번호가 겹치지 않는다(MySQL 자동 증가가 최대값 다음부터 이어진다).
3. 미확정 초안은 entry.json 이 없어서 되살리지 않는다. 대신 `10_Vault\_staging\<key>` 폴더마다 "주인 없는 배치"를 새로 만들어 다시 처리하게 한다(정리 대기 화면에서 다시 가져간다).
4. 백업은 `mysqldump --single-transaction` 출력을 gzip 해서 `80_Backup\logbook-YYYYMMDD-HHMMSS.sql.gz` 로 쓴다(공유 폴더라 평문이다). 30개를 넘으면 오래된 것부터 지운다.
   - 비밀번호는 명령줄이 아니라 환경변수 `MYSQL_PWD` 로 넘긴다(프로세스 목록에 노출 방지).
   - `.env` 값은 앱 설정(`settings`)에서만 읽는다.

---

## 공통 규칙 (모든 태스크)

- 백엔드: `C:\Coding\Logbook\backend` 에서 `.venv\Scripts\python.exe -m pytest ...`, **순차 실행**.
- 프런트: `C:\Coding\Logbook\frontend` 에서 `npx vitest run <파일>` / `npm test` / `npm run build`.
- **`backend\.env` 는 어떤 방법으로도 열지 않는다.** DB 비밀번호가 필요한 코드는 `app.config.settings` 를 통해서만 읽고, 로그·화면·예외 메시지에 비밀번호를 절대 남기지 않는다. 테스트는 `mysqldump` 호출을 가짜로 바꾼다.
- **git 금지.** "커밋" 단계는 사람이 한다.
- 공유 폴더 경로는 `to_long()`·`long_join()` 을 거친다.
- 디자인은 `DESIGN.md`·`PRODUCT.md` 를 따른다(토큰만, 대문자 꾸밈 라벨·em dash 금지).
- 실제 호선 자료 금지, 가상 호선 9999.

## 파일 구조

| 파일 | 역할 |
|---|---|
| `backend/app/config.py` (수정) | `mysqldump_path`, `public_url`, `backup_keep`, `trash_days`, `daily_hour` |
| `backend/app/models.py` (수정) | `SystemState`(key → JSON) |
| `backend/app/ops/__init__.py` (새) | 빈 docstring |
| `backend/app/ops/state.py` (새) | `get_state`·`set_state`, 워커 심장 박동 |
| `backend/app/ops/registry.py` (새) | `build_registry`·`write_registry`·`read_registry` |
| `backend/app/ops/backup.py` (새) | `run_backup`·`prune_backups` |
| `backend/app/ops/purge.py` (새) | `purge_entry`·`purge_expired` |
| `backend/app/ops/daily.py` (새) | `run_daily` — 하루 한 번 묶음 |
| `backend/app/ops/rebuild.py` (새) | `rebuild` — 공유 폴더 → 빈 DB |
| `backend/app/ops/shortcut.py` (새) | `write_shortcut` — `.url` + 안내문 |
| `backend/app/worker.py` (수정) | 심장 박동, `run_daily` 호출 |
| `backend/app/tags.py`·`hull_info.py`·`routers/users.py`·`routers/auth.py` (수정) | 바뀐 뒤 `write_registry` |
| `backend/app/cli.py` (수정) | `backup`·`rebuild`·`write-shortcut`·`purge-trash` |
| `backend/app/routers/admin_ops.py` (새) | 관리자 운영 API |
| `backend/app/main.py` (수정) | 라우터 등록 |
| `frontend/src/pages/admin/OpsPage.jsx` (새) | `/admin/ops` |
| `frontend/src/pages/TrashPage.jsx` (수정) | 관리자 영구 삭제 |
| `frontend/src/components/shell/SideNav.jsx`·`App.jsx` (수정) | 메뉴·라우트 |
| `frontend/src/lib/labels.js` (수정) | 새 동작·오류 라벨 |
| `ops/install-tasks.ps1`·`ops/run-api.ps1`·`ops/run-worker.ps1`·`ops/README.md` (새) | 145 설치 |
| `.gitignore` (수정) | `backend/logs/` |

---

### Task 1: 설정·`system_state`·워커 심장 박동

**Files:**
- Modify: `backend/app/config.py`, `backend/app/models.py`, `backend/app/worker.py`
- Create: `backend/app/ops/__init__.py`, `backend/app/ops/state.py`
- Test: `backend/tests/test_ops_state.py`

- [ ] **Step 1: 실패하는 테스트**

```python
from datetime import datetime, timedelta

from app import models
from app.ops.state import WORKER_ALIVE_SECONDS, get_state, set_state, worker_status


def test_state_roundtrip(db):
    assert get_state(db, "x") is None
    set_state(db, "x", {"a": 1})
    set_state(db, "x", {"a": 2})
    db.commit()
    assert get_state(db, "x") == {"a": 2}
    assert db.query(models.SystemState).count() == 1


def test_worker_status(db):
    now = datetime(2026, 10, 2, 12, 0, 0)
    assert worker_status(db, now) == {"alive": False, "at": None, "stats": None}
    set_state(db, "worker_heartbeat", {"at": (now - timedelta(seconds=30)).isoformat(), "stats": {"processed": 2}})
    db.commit()
    s = worker_status(db, now)
    assert s["alive"] is True and s["stats"] == {"processed": 2}
    set_state(db, "worker_heartbeat", {"at": (now - timedelta(seconds=WORKER_ALIVE_SECONDS + 1)).isoformat(), "stats": {}})
    db.commit()
    assert worker_status(db, now)["alive"] is False


def test_run_once_writes_heartbeat(db, storage):
    from app.ingest.inbox import InboxWatcher
    from app.worker import run_once

    run_once(db, storage, InboxWatcher(storage))
    hb = get_state(db, "worker_heartbeat")
    assert hb and hb["at"] and "processed" in hb["stats"]
```

- [ ] **Step 2: 실패 확인** — `pytest tests/test_ops_state.py -v` → FAIL(모듈 없음)
- [ ] **Step 3: 구현**

`config.py` 의 `Settings` 에 필드를 더하고 `load_settings()` 에서 읽는다(기본값은 아래와 같다).

```python
    mysqldump_path: str
    public_url: str
    backup_keep: int
    trash_days: int
    daily_hour: int
```

```python
        mysqldump_path=os.getenv("LOGBOOK_MYSQLDUMP",
                                 r"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe"),
        public_url=os.getenv("LOGBOOK_PUBLIC_URL", "http://10.14.42.145:9095"),
        backup_keep=int(os.getenv("LOGBOOK_BACKUP_KEEP", "30")),
        trash_days=int(os.getenv("LOGBOOK_TRASH_DAYS", "90")),
        daily_hour=int(os.getenv("LOGBOOK_DAILY_HOUR", "2")),
```

`models.py` 끝에 둔다.

```python
class SystemState(Base):
    """운영 상태(워커 심장 박동·마지막 백업·마지막 일일 작업). 재구축 대상이 아니다(다시 쌓인다)."""

    __tablename__ = "system_state"

    key = Column(String(40), primary_key=True)
    value = Column(JSON, nullable=True)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)
```

`backend/app/ops/__init__.py`: `"""운영 기능(설계 §12) — 백업·재구축·레지스트리·휴지통 비우기·상태."""`

`backend/app/ops/state.py`:

```python
"""system_state 읽기·쓰기와 워커 생존 판정."""
from datetime import datetime

from sqlalchemy.orm import Session

from .. import models

WORKER_ALIVE_SECONDS = 120  # 워커 주기(30초)의 4배 — 이보다 오래 소식이 없으면 멈춘 것으로 본다


def get_state(db: Session, key: str):
    row = db.get(models.SystemState, key)
    return row.value if row else None


def set_state(db: Session, key: str, value) -> None:
    """커밋은 호출자가 한다."""
    row = db.get(models.SystemState, key)
    if row is None:
        db.add(models.SystemState(key=key, value=value))
    else:
        row.value = value


def worker_status(db: Session, now: datetime | None = None) -> dict:
    now = now or datetime.now()
    hb = get_state(db, "worker_heartbeat")
    if not hb or not hb.get("at"):
        return {"alive": False, "at": None, "stats": None}
    at = datetime.fromisoformat(hb["at"])
    return {"alive": (now - at).total_seconds() <= WORKER_ALIVE_SECONDS, "at": hb["at"], "stats": hb.get("stats")}
```

`worker.py`: `run_once` 가 `stats` 를 돌려주기 직전에 넣는다. 정확한 위치는 함수 끝, `return stats` 바로 앞이다.

```python
    set_state(db, "worker_heartbeat", {"at": datetime.now().replace(microsecond=0).isoformat(), "stats": stats})
    db.commit()
```

import 는 `from datetime import datetime`, `from .ops.state import set_state` 다.

- [ ] **Step 4:** PASS, `pytest -q` 전체 PASS
- [ ] **Step 5: 커밋(사람)** — `feat: 05 system_state·워커 심장 박동`

---

### Task 2: 레지스트리 — 사용자·호선·태그 동의어를 공유 폴더에

**Files:**
- Create: `backend/app/ops/registry.py`
- Modify: `backend/app/tags.py`, `backend/app/hull_info.py`, `backend/app/routers/users.py`, `backend/app/routers/auth.py`, `backend/app/cli.py`(`create_admin`)
- Test: `backend/tests/test_ops_registry.py`

형식: `90_System\registry.json`

```json
{"version": 1, "written_at": "2026-10-02T12:00:00",
 "users": [{"employee_id", "name", "department", "position", "status", "is_admin", "created_at"}],
 "hulls": [{"hull_no", "ship_type", "memo"}],
 "tags":  [{"kind", "value", "alias_of"}]}
```

`tags` 는 동의어로 묶인 태그(`alias_of` = 대표 값)만 남긴다. 그 밖의 태그는 entry.json 에서 다시 생긴다.

호출 지점은 커밋이 끝난 뒤다. 레지스트리 쓰기 실패(`OSError`)는 경고 로그만 남기고 요청은 성공시킨다(감사 JSONL 과 같은 원칙). 아래에서 `write_registry(db, storage)` 를 부른다.
- `tags.set_alias`·`clear_alias` 끝
- `hull_info.update_hull` 끝
- `routers/users.py` 의 상태·관리자 변경 끝(공통 함수가 있으면 거기)
- `routers/auth.py` 의 가입 신청 끝
- `cli.create_admin` 끝

- [ ] **Step 1: 실패하는 테스트**

```python
import json
import os

from app import models
from app.ops.registry import REGISTRY_FILE, build_registry, read_registry, write_registry
from app.storage.paths import to_long


def _seed(db):
    db.add(models.User(employee_id="A100001", name="홍길동", department="구조", status="active", is_admin=True))
    db.add(models.Hull(hull_no="9999", ship_type="LNGC", memo="174K"))
    bow = models.Tag(kind="zone", value="선수부")
    db.add(bow)
    db.flush()
    db.add(models.Tag(kind="zone", value="FWD", alias_of_id=bow.id))
    db.add(models.Tag(kind="free", value="계류"))
    db.commit()


def test_build_registry(db):
    _seed(db)
    r = build_registry(db)
    assert r["version"] == 1
    assert r["users"][0]["employee_id"] == "A100001" and r["users"][0]["is_admin"] is True
    assert r["hulls"] == [{"hull_no": "9999", "ship_type": "LNGC", "memo": "174K"}]
    assert r["tags"] == [{"kind": "zone", "value": "FWD", "alias_of": "선수부"}]


def test_write_and_read(db, storage):
    _seed(db)
    write_registry(db, storage)
    path = storage.system / REGISTRY_FILE
    with open(to_long(path), encoding="utf-8") as fh:
        assert json.load(fh)["hulls"][0]["memo"] == "174K"
    assert read_registry(storage)["tags"][0]["value"] == "FWD"


def test_write_failure_does_not_raise(db, storage, monkeypatch):
    _seed(db)
    import app.ops.registry as reg

    def boom(*a, **k):
        raise OSError("share down")
    monkeypatch.setattr(reg.os, "replace", boom)
    write_registry(db, storage)  # 예외 없이 경고만


def test_alias_and_hull_update_write_registry(client, db, storage, make_user, auth_headers):
    make_user("A100001")
    h = auth_headers("A100001")
    a, b = models.Tag(kind="zone", value="A"), models.Tag(kind="zone", value="B")
    db.add_all([a, b])
    db.commit()
    client.post(f"/api/tags/{b.id}/alias", json={"target_id": a.id}, headers=h)
    assert read_registry(storage)["tags"] == [{"kind": "zone", "value": "B", "alias_of": "A"}]
    client.patch("/api/hulls/9999", json={"memo": "메모"}, headers=h)
    assert read_registry(storage)["hulls"][0]["memo"] == "메모"


def test_read_missing_returns_empty(storage):
    assert read_registry(storage) == {"version": 1, "users": [], "hulls": [], "tags": []}
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — `backend/app/ops/registry.py`:

```python
"""레지스트리 — DB 에만 있던 운영 정보를 공유 폴더(90_System\\registry.json)에도 남긴다.

entry.json 이 Entry 를 되살린다면, 이 파일은 사용자·호선 메모·선종·태그 동의어를 되살린다(재구축 원천).
쓰기 실패는 요청을 실패시키지 않는다(DB 가 먼저다) — 다음 변경이나 매일 작업에서 다시 쓴다."""
import json
import logging
import os
from datetime import datetime

from sqlalchemy.orm import Session

from .. import models
from ..storage.paths import StoragePaths, to_long

log = logging.getLogger(__name__)
REGISTRY_FILE = "registry.json"
EMPTY = {"version": 1, "users": [], "hulls": [], "tags": []}


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
    return {"version": 1, "written_at": datetime.now().replace(microsecond=0).isoformat(),
            "users": users, "hulls": hulls, "tags": tags}


def write_registry(db: Session, storage: StoragePaths) -> bool:
    path = storage.system / REGISTRY_FILE
    tmp = path.with_name(path.name + ".tmp")
    try:
        data = build_registry(db)
        os.makedirs(to_long(path.parent), exist_ok=True)
        with open(to_long(tmp), "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1)
        os.replace(to_long(tmp), to_long(path))
        return True
    except OSError as exc:
        log.warning("registry.json 쓰기 실패(DB 는 유지): %s", exc)
        return False


def read_registry(storage: StoragePaths) -> dict:
    try:
        with open(to_long(storage.system / REGISTRY_FILE), encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return dict(EMPTY)
    return {**EMPTY, **{k: data.get(k, []) for k in ("users", "hulls", "tags")}, "version": data.get("version", 1)}
```

훅 연결(각 함수의 마지막, 커밋 뒤):
- `tags.set_alias`·`clear_alias`: `return tag` 앞에 `write_registry(db, storage)` 를 넣는다. 순환 import 를 피하려면 함수 안에서 `from .ops.registry import write_registry` 로 불러온다.
- `hull_info.update_hull`: 같은 방식으로 넣는다.
- `routers/users.py`: 상태·관리자 변경을 마친 응답 직전에 넣는다. `_set_status` 와 관리자 지정 핸들러 양쪽에 넣는다.
- `routers/auth.py`: 가입 신청(새 사용자 생성) 응답 직전에 넣는다. `storage` 의존성이 없으면 `Depends(get_storage)` 를 더한다.
- `cli.create_admin`: `db.refresh(user)` 다음에 넣는다.

- [ ] **Step 4:** PASS, 전체 PASS(기존 사용자·태그·호선 테스트 포함)
- [ ] **Step 5: 커밋(사람)** — `feat: 05 레지스트리(사용자·호선·태그 동의어) 공유 폴더 보존`

---

### Task 3: 백업 — `mysqldump` → `80_Backup`

**Files:**
- Create: `backend/app/ops/backup.py`
- Test: `backend/tests/test_ops_backup.py`

규칙:
- **백업 파일**: `run_backup(storage, *, runner=_run_dump, now=None)` 이 `80_Backup\logbook-YYYYMMDD-HHMMSS.sql.gz` 를 만든다. 임시 파일(`.tmp`)에 쓴 뒤 `os.replace` 로 바꾼다.
- **덤프 실행(`_run_dump`)**:
  - `[settings.mysqldump_path, "--single-transaction", "--routines", "--default-character-set=utf8mb4", "-h", host, "-P", port, "-u", user, db_name]` 를 실행한다.
  - 환경변수 `MYSQL_PWD=<비밀번호>` 를 넘기고, stdout 을 1MB 조각으로 읽어 gzip 으로 흘려 쓴다.
  - 종료 코드가 0 이 아니면 stderr 앞 500자로 `BackupError` 를 낸다. 비밀번호는 메시지에 섞이지 않는다(stderr 에 나올 일도 없지만 `replace` 로 지운다).
- **보관 개수**: `prune_backups(storage, keep)` 이 `logbook-*.sql.gz` 를 이름순으로 보고 오래된 것부터 지운다.
- **반환**: `{"file": 이름, "size": 바이트, "at": iso}`. `mysqldump` 가 없으면 `BackupError("mysqldump_not_found")` 를 낸다.
- **CLI**: `python -m app.cli backup` 은 실행 결과를 출력한다. 실패하면 종료 코드 2.

- [ ] **Step 1: 실패하는 테스트**

```python
import gzip
import os
from datetime import datetime

import pytest

from app.ops.backup import BackupError, prune_backups, run_backup
from app.storage.paths import to_long


def fake_runner(out):
    out.write(b"-- MySQL dump\nCREATE TABLE x;\n")


def test_backup_writes_gz(storage):
    r = run_backup(storage, runner=fake_runner, now=datetime(2026, 10, 2, 2, 5, 0))
    assert r["file"] == "logbook-20261002-020500.sql.gz" and r["size"] > 0
    with open(to_long(storage.backup / r["file"]), "rb") as fh:
        assert gzip.decompress(fh.read()).startswith(b"-- MySQL dump")
    assert not any(n.endswith(".tmp") for n in os.listdir(to_long(storage.backup)))


def test_backup_failure_leaves_no_file(storage):
    def bad(out):
        out.write(b"partial")
        raise BackupError("dump failed")
    with pytest.raises(BackupError):
        run_backup(storage, runner=bad, now=datetime(2026, 10, 2, 2, 6, 0))
    assert os.listdir(to_long(storage.backup)) == []


def test_prune_keeps_newest(storage):
    for d in range(1, 6):
        run_backup(storage, runner=fake_runner, now=datetime(2026, 10, d, 2, 0, 0))
    removed = prune_backups(storage, keep=3)
    assert removed == 2
    assert sorted(os.listdir(to_long(storage.backup))) == [
        "logbook-20261003-020000.sql.gz", "logbook-20261004-020000.sql.gz", "logbook-20261005-020000.sql.gz"]


def test_missing_mysqldump(storage, monkeypatch):
    from app.ops import backup

    monkeypatch.setattr(backup.settings.__class__, "mysqldump_path", property(lambda s: r"C:\없는\mysqldump.exe"),
                        raising=False)
    with pytest.raises(BackupError, match="mysqldump_not_found"):
        backup._run_dump(open(os.devnull, "wb"))
```

`Settings` 가 frozen dataclass 라 `monkeypatch.setattr(backup, "settings", dataclasses.replace(backup.settings, mysqldump_path=...))` 쪽이 더 간단하다. 구현 모듈이 `settings` 를 모듈 전역으로 import 한다면 그 방식으로 테스트를 고친다.

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — `backend/app/ops/backup.py`:

```python
"""일일 백업(설계 §12) — mysqldump 출력을 gzip 해 공유 폴더 80_Backup 에 쓴다.

비밀번호는 명령줄 대신 MYSQL_PWD 환경변수로 넘긴다(프로세스 목록 노출 방지). 로그·예외에 남기지 않는다."""
import gzip
import os
import subprocess
from datetime import datetime

from ..config import settings
from ..storage.paths import StoragePaths, to_long

PREFIX = "logbook-"
SUFFIX = ".sql.gz"
CHUNK = 1024 * 1024


class BackupError(Exception):
    pass


def _run_dump(out) -> None:
    exe = settings.mysqldump_path
    if not os.path.isfile(exe):
        raise BackupError("mysqldump_not_found")
    args = [exe, "--single-transaction", "--routines", "--default-character-set=utf8mb4",
            "-h", settings.db_host, "-P", str(settings.db_port), "-u", settings.db_user, settings.db_name]
    env = {**os.environ, "MYSQL_PWD": settings.db_password}
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    while chunk := proc.stdout.read(CHUNK):
        out.write(chunk)
    err = proc.stderr.read().decode("utf-8", errors="replace")
    if proc.wait() != 0:
        if settings.db_password:
            err = err.replace(settings.db_password, "***")
        raise BackupError(f"mysqldump 실패: {err[:500]}")


def run_backup(storage: StoragePaths, *, runner=_run_dump, now: datetime | None = None) -> dict:
    now = now or datetime.now()
    name = f"{PREFIX}{now:%Y%m%d-%H%M%S}{SUFFIX}"
    path = storage.backup / name
    tmp = path.with_name(name + ".tmp")
    os.makedirs(to_long(storage.backup), exist_ok=True)
    try:
        with open(to_long(tmp), "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", compresslevel=6) as gz:
            runner(gz)
        os.replace(to_long(tmp), to_long(path))
    except BaseException:
        try:
            os.remove(to_long(tmp))
        except OSError:
            pass
        raise
    return {"file": name, "size": os.path.getsize(to_long(path)), "at": now.replace(microsecond=0).isoformat()}


def prune_backups(storage: StoragePaths, keep: int) -> int:
    try:
        names = sorted(n for n in os.listdir(to_long(storage.backup)) if n.startswith(PREFIX) and n.endswith(SUFFIX))
    except OSError:
        return 0
    removed = 0
    for n in names[:max(0, len(names) - keep)]:
        try:
            os.remove(to_long(storage.backup / n))
            removed += 1
        except OSError:
            pass
    return removed
```

`cli.py` 에 서브명령 `backup` 을 더한다. 동작은 `run_backup(get_storage())` 다음에 `prune_backups(..., settings.backup_keep)` 이고, `백업 완료: <file> (<MB>)` 를 출력한다. `BackupError` 가 나면 `오류: …` 를 내고 종료 코드 2.

- [ ] **Step 4:** PASS
- [ ] **Step 5: 커밋(사람)** — `feat: 05 mysqldump 백업·보관 개수`

---

### Task 4: 휴지통 영구 삭제

**Files:**
- Create: `backend/app/ops/purge.py`
- Test: `backend/tests/test_ops_purge.py`

규칙(설계 §8):
- `purge_entry(db, storage, entry, actor, ip=None)` 는 `trashed` 상태만 받는다(그 밖은 409 `not_trashed`). 순서는 다음과 같다.
  1. `95_Trash\<trash_rel>` 폴더를 지운다(`shutil.rmtree(to_long(...))`). 폴더가 이미 없어도 괜찮다.
  2. 그 Entry 의 `FileText`·`FileExtract`·`ModelSummary`·`File`·`EntryHull`·`EntryTag`·`Entry` 행을 지운다.
  3. 다른 행이 이 Entry 를 가리키면 비운다(`entries.service._clear_dangling_references` 재사용).
  4. 감사 `TRASH_PURGE`(before = snapshot 요약 `{title, files: N, trash_rel}`)를 남긴다.
  - 폴더 삭제가 `OSError` 로 실패하면 DB 를 건드리지 않고 503 `storage_error` 다.
- `purge_expired(db, storage, days, now=None)`: `status='trashed'` 이고 `updated_at <= now - days` 인 Entry 를 모두 `purge_entry(actor="system")` 한다. 반환은 지운 수다. 하나가 실패해도 나머지는 계속한다.

- [ ] **Step 1: 실패하는 테스트**

```python
import os
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException

from app import models
from app.ops.purge import purge_entry, purge_expired
from app.storage.paths import to_long


def _trashed(db, storage, make_entry_file, days_ago=0, rel="E1_x"):
    e, f = make_entry_file(status="trashed", name="r.pdf")
    e.trash_rel = rel
    e.updated_at = datetime.now() - timedelta(days=days_ago)
    db.add(models.FileText(file_id=f.id, seq=0, locator="page:1", text="본문"))
    db.add(models.FileExtract(file_id=f.id, state="done"))
    db.commit()
    os.makedirs(to_long(storage.trash / rel / "files"), exist_ok=True)
    with open(to_long(storage.trash / rel / "files" / "r.pdf"), "wb") as fh:
        fh.write(b"x")
    return e, f


def test_purge_entry_removes_folder_and_rows(db, storage, make_entry_file):
    e, f = _trashed(db, storage, make_entry_file)
    purge_entry(db, storage, e, "A100001")
    assert not os.path.exists(to_long(storage.trash / "E1_x"))
    assert db.get(models.Entry, e.id) is None and db.get(models.File, f.id) is None
    assert db.query(models.FileText).count() == 0
    assert db.query(models.AuditLog).filter_by(action="TRASH_PURGE").count() == 1


def test_purge_rejects_live_entry(db, storage, make_entry_file):
    e, _ = make_entry_file(status="confirmed")
    with pytest.raises(HTTPException) as ei:
        purge_entry(db, storage, e, "A100001")
    assert ei.value.detail == "not_trashed"


def test_purge_expired(db, storage, make_entry_file):
    old, _ = _trashed(db, storage, make_entry_file, days_ago=91, rel="E_old")
    new, _ = _trashed(db, storage, make_entry_file, days_ago=10, rel="E_new")
    assert purge_expired(db, storage, days=90) == 1
    assert db.get(models.Entry, old.id) is None and db.get(models.Entry, new.id) is not None
```

`make_entry_file` 은 `updated_at` 을 지금 시각으로 넣는다(`onupdate`). 테스트에서 `e.updated_at` 을 직접 바꾼 뒤 커밋하면 `onupdate` 가 다시 덮어쓸 수 있다. 덮어쓰면 `db.query(models.Entry).filter_by(id=e.id).update({"updated_at": ...}, synchronize_session=False)` 로 바꾼다.

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — `backend/app/ops/purge.py`:

```python
"""휴지통 영구 삭제(설계 §8) — 90일 지난 것은 매일 자동으로, 관리자는 수동으로."""
import logging
import os
import shutil
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import audit, models
from ..entries.service import _clear_dangling_references
from ..storage.paths import StoragePaths, to_long

log = logging.getLogger(__name__)


def purge_entry(db: Session, storage: StoragePaths, entry: models.Entry, actor: str, ip: str | None = None) -> None:
    if entry.status != "trashed":
        raise HTTPException(status_code=409, detail="not_trashed")
    if entry.trash_rel:
        folder = to_long(storage.trash / entry.trash_rel)
        try:
            if os.path.exists(folder):
                shutil.rmtree(folder)
        except OSError as exc:
            log.warning("휴지통 폴더 삭제 실패: %s — %s", entry.trash_rel, exc)
            raise HTTPException(status_code=503, detail="storage_error")
    file_ids = [i for (i,) in db.query(models.File.id).filter_by(entry_id=entry.id)]
    before = {"title": entry.title, "files": len(file_ids), "trash_rel": entry.trash_rel}
    if file_ids:
        for model in (models.FileText, models.FileExtract, models.ModelSummary):
            db.query(model).filter(model.file_id.in_(file_ids)).delete(synchronize_session=False)
        db.query(models.File).filter(models.File.id.in_(file_ids)).delete(synchronize_session=False)
    db.query(models.EntryHull).filter_by(entry_id=entry.id).delete(synchronize_session=False)
    db.query(models.EntryTag).filter_by(entry_id=entry.id).delete(synchronize_session=False)
    _clear_dangling_references(db, entry.id)
    entry_id = entry.entry_id
    db.delete(entry)
    db.flush()
    audit.record(db, storage, actor=actor, action="TRASH_PURGE", target_type="entry", target_id=entry_id,
                 before=before, ip=ip)


def purge_expired(db: Session, storage: StoragePaths, days: int, now: datetime | None = None) -> int:
    limit = (now or datetime.now()) - timedelta(days=days)
    n = 0
    for e in db.query(models.Entry).filter(models.Entry.status == "trashed", models.Entry.updated_at <= limit).all():
        try:
            purge_entry(db, storage, e, "system")
            n += 1
        except HTTPException as exc:
            db.rollback()
            log.warning("휴지통 자동 비우기 실패: %s — %s", e.entry_id, exc.detail)
    return n
```

메모:
- 파일을 지우기 전에 `File.duplicate_of_id` 가 이 파일들을 가리키면 FK 위반이 난다. 지우기 전에 `db.query(models.File).filter(models.File.duplicate_of_id.in_(file_ids)).update({"duplicate_of_id": None}, synchronize_session=False)` 를 넣는다.
- 테스트도 하나 더한다: 다른 Entry 의 파일이 중복 대상으로 가리키는 경우.

- [ ] **Step 4:** PASS
- [ ] **Step 5: 커밋(사람)** — `feat: 05 휴지통 영구 삭제·자동 비우기`

---

### Task 5: 매일 작업 — 워커에서 하루 한 번

**Files:**
- Create: `backend/app/ops/daily.py`
- Modify: `backend/app/worker.py`, `backend/app/cli.py`(`purge-trash`)
- Test: `backend/tests/test_ops_daily.py`

규칙:
- `run_daily(db, storage, now=None, *, backup_runner=None)`
  - 실행 조건: `now.hour >= settings.daily_hour` 이고 `system_state['last_daily'].date != now.date()` 일 때만 한다.
  - 돌면 다음 순서로 실행한다.
    1. 레지스트리 쓰기
    2. 백업(+보관 개수 정리)
    3. 휴지통 비우기(`settings.trash_days`)
    4. `last_daily = {date, at}`, `last_backup = {ok, file, size, at, error}` 기록
  - 백업이 실패해도 나머지는 하고, `last_backup.ok=false` 와 `error` 를 남긴다.
  - 반환: `{"ran": bool, "backup": ..., "purged": n, "registry": bool}`.
- 워커 `run_once` 시작 부분(정리 작업 다음)에서 `run_daily(db, storage)` 를 부른다. 예외는 잡아서 로그만 남긴다(워커가 멈추면 안 된다).
- CLI: `purge-trash [--days N]` 은 수동 실행용이다.

- [ ] **Step 1: 실패하는 테스트**

```python
from datetime import datetime

from app.ops.daily import run_daily
from app.ops.state import get_state


def ok_runner(out):
    out.write(b"-- dump")


def test_runs_once_per_day_after_hour(db, storage):
    early = datetime(2026, 10, 2, 1, 0, 0)
    assert run_daily(db, storage, early, backup_runner=ok_runner)["ran"] is False
    t = datetime(2026, 10, 2, 2, 10, 0)
    r = run_daily(db, storage, t, backup_runner=ok_runner)
    assert r["ran"] is True and r["backup"]["ok"] is True and r["registry"] is True
    assert run_daily(db, storage, datetime(2026, 10, 2, 9, 0, 0), backup_runner=ok_runner)["ran"] is False
    assert run_daily(db, storage, datetime(2026, 10, 3, 2, 1, 0), backup_runner=ok_runner)["ran"] is True
    assert get_state(db, "last_backup")["ok"] is True


def test_backup_failure_recorded(db, storage):
    def bad(out):
        from app.ops.backup import BackupError
        raise BackupError("mysqldump_not_found")
    r = run_daily(db, storage, datetime(2026, 10, 2, 3, 0, 0), backup_runner=bad)
    assert r["ran"] is True and r["backup"]["ok"] is False
    assert get_state(db, "last_backup")["error"] == "mysqldump_not_found"
    assert get_state(db, "last_daily")["date"] == "2026-10-02"
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — `backend/app/ops/daily.py`:

```python
"""하루 한 번 운영 작업(설계 §12) — 워커가 매 주기 부르지만 실제로는 날짜가 바뀐 뒤 첫 번에만 돈다."""
import logging
from datetime import datetime

from sqlalchemy.orm import Session

from ..config import settings
from ..storage.paths import StoragePaths
from .backup import BackupError, prune_backups, run_backup
from .purge import purge_expired
from .registry import write_registry
from .state import get_state, set_state

log = logging.getLogger(__name__)


def run_daily(db: Session, storage: StoragePaths, now: datetime | None = None, *, backup_runner=None) -> dict:
    now = (now or datetime.now()).replace(microsecond=0)
    last = get_state(db, "last_daily") or {}
    if now.hour < settings.daily_hour or last.get("date") == now.date().isoformat():
        return {"ran": False}
    registry_ok = write_registry(db, storage)
    try:
        kwargs = {"runner": backup_runner} if backup_runner else {}
        b = run_backup(storage, now=now, **kwargs)
        prune_backups(storage, settings.backup_keep)
        backup = {"ok": True, **b, "error": None}
    except (BackupError, OSError) as exc:
        log.warning("일일 백업 실패: %s", exc)
        backup = {"ok": False, "file": None, "size": None, "at": now.isoformat(), "error": str(exc)[:500]}
    purged = purge_expired(db, storage, settings.trash_days, now)
    set_state(db, "last_backup", backup)
    set_state(db, "last_daily", {"date": now.date().isoformat(), "at": now.isoformat()})
    db.commit()
    return {"ran": True, "backup": backup, "purged": purged, "registry": registry_ok}
```

`worker.run_once`: `cleanup_stale` 호출 다음에 아래를 넣는다.

```python
    try:
        daily = run_daily(db, storage)
        if daily.get("ran"):
            log.info("일일 작업: %s", daily)
    except Exception:
        db.rollback()
        log.exception("일일 작업 실패")
```

⚠ 기존 워커 테스트가 02시 이후 시각에 돌면 진짜 `mysqldump` 를 부르게 된다. 이를 막으려고 `tests/conftest.py` 에 autouse 픽스처를 둔다. `app.ops.daily.run_backup` 을 가짜(바로 성공)로 바꾸고, `test_ops_daily.py` 는 `backup_runner` 를 직접 넘긴다. 이 픽스처는 **실행 파일을 부르는 일이 테스트에서 생기지 않게 하는 안전장치**다. 이름은 `_no_real_dump`.

- [ ] **Step 4:** PASS, 전체 PASS
- [ ] **Step 5: 커밋(사람)** — `feat: 05 워커 일일 작업(백업·레지스트리·휴지통 비우기)`

---

### Task 6: 재구축 — 공유 폴더 → 빈 DB

**Files:**
- Create: `backend/app/ops/rebuild.py`
- Modify: `backend/app/cli.py`(`rebuild --yes`)
- Test: `backend/tests/test_ops_rebuild.py`

규칙(설계 §2.1·§4.1·§9):
- **시작 조건**: `entries` 표가 비어 있지 않으면 `RebuildError("db_not_empty")` 를 낸다.
- **레지스트리**
  - 사용자: 없는 사번만 만든다. 레지스트리의 status·is_admin 을 그대로 쓴다.
  - 호선: 선종·메모를 넣는다.
- **Vault**: `10_Vault\<4자리 연도>\<EntryID>\entry.json` 을 모두 읽는다(`_staging` 은 제외).
  - Entry: id=`int(EntryID[1:])`, `status='confirmed'`, `vault_rel='<연도>/<EntryID>'`, entry.json 의 제목·해석 종류·설명·시기·올린/확정 사람·확정 시각·version.
  - Entry 의 `batch_id` 는 이번 재구축의 합성 배치(`key='rebuild-YYYYMMDD-HHMMSS'`, `source='rebuild'`, `state='done'`, `original_name='재구축'`) 하나다.
  - 호선: `EntryHull`(대표 = `is_primary`), 없는 `Hull` 행도 만든다.
  - 태그: `zones`→zone 태그, `tags`→free 태그.
  - 파일: entry.json `files` 의 `rel_path`·`kind`·`size`·`sha256` 으로 만든다. `name`=마지막 조각, `ext`=`safe_ext(name)`, `location='vault'`, `batch_id`=합성 배치.
  - 디스크에 없는 파일은 세어서 보고한다(행은 만든다 — 사람이 판단).
- **휴지통**: `95_Trash\<EntryID>_<시각>\entry.json` 은 같은 방식으로 만든다. 다른 점은 다음과 같다.
  - `status='trashed'`, `trash_rel=폴더 이름`, `vault_rel='<확정 연도>/<EntryID>'`(복원 대상 자리), 파일 `location='trash'`.
  - `draft_…` 폴더는 entry.json 이 없어서 건너뛰고 센다.
- **태그 동의어**: 레지스트리 `tags` 로 `alias_of_id` 를 잇는다. 태그가 아직 없으면 만든다.
- **감사 로그**: `90_System\audit\*.jsonl` 을 모두 읽어 `AuditLog` 로 넣는다. 깨진 줄은 센다.
- **staging**: `10_Vault\_staging\<key>` 폴더마다 Batch(`source='inbox'`, `state='staged'`, `uploader=None`, `original_name=key`)를 만들고 `process_batch` 작업을 건다. 키가 DB 에 이미 있으면 건너뛴다.
- **변환 작업**: 모든 파일에 `enqueue_extract`·`enqueue_convert` 를 건다. 파생 캐시(sha·key)가 있으면 워커가 다시 쓴다.
- **반환**: `{"entries", "trashed", "files", "missing_files", "skipped_drafts", "users", "hulls", "alias_tags", "audit", "audit_bad", "staging_batches", "jobs"}`.
- **CLI**: `python -m app.cli rebuild --yes` 는 결과를 출력한다. `--yes` 가 없으면 무엇을 할지만 안내하고 끝낸다.

- [ ] **Step 1: 실패하는 테스트**

```python
import json
import os
from datetime import datetime

import pytest

from app import models
from app.entries.files import write_entry_files
from app.ops.rebuild import RebuildError, rebuild
from app.ops.registry import write_registry
from app.storage.paths import to_long


def _make_world(db, storage, make_entry_file, make_user):
    make_user("A100001", name="홍길동", is_admin=True)
    e1, f1 = make_entry_file(title="계류 검토", name="model/main.bdf", kind="model", sha="a" * 64)
    make_entry_file(entry=e1, name="r.pdf", sha="b" * 64)
    db.add(models.Hull(hull_no="9999")) if db.get(models.Hull, "9999") is None else None
    db.get(models.Hull, "9999").memo = "174K"
    bow = models.Tag(kind="zone", value="선수부")
    db.add(bow)
    db.flush()
    fwd = models.Tag(kind="zone", value="FWD", alias_of_id=bow.id)
    db.add(fwd)
    db.flush()
    db.add(models.EntryTag(entry_id=e1.id, tag_id=fwd.id))
    db.commit()
    for f in db.query(models.File).filter_by(entry_id=e1.id):
        p = storage.vault / "2026" / e1.entry_id / "files" / f.rel_path
        os.makedirs(to_long(p.parent), exist_ok=True)
        with open(to_long(p), "wb") as fh:
            fh.write(b"x")
    write_entry_files(db, storage, e1)
    # 휴지통 Entry 하나
    e2, _ = make_entry_file(title="버린 것", name="t.pdf", sha="c" * 64)
    write_entry_files(db, storage, e2)
    os.makedirs(to_long(storage.trash), exist_ok=True)
    os.rename(to_long(storage.vault / "2026" / e2.entry_id), to_long(storage.trash / f"{e2.entry_id}_20261001-120000"))
    # staging 폴더 하나(초안은 되살리지 않고 배치로 다시 처리)
    os.makedirs(to_long(storage.staging / "20261002-000000-zzzz" / "a"), exist_ok=True)
    with open(to_long(storage.staging / "20261002-000000-zzzz" / "a" / "x.pdf"), "wb") as fh:
        fh.write(b"x")
    # 감사 JSONL
    from app import audit
    audit.record(db, storage, actor="A100001", action="ENTRY_CONFIRM", target_type="entry", target_id=e1.entry_id)
    write_registry(db, storage)
    return e1, e2


def _wipe(db):
    from app import database
    database.Base.metadata.drop_all(database.engine)
    database.Base.metadata.create_all(database.engine)
    db.expire_all()


def test_rebuild_round_trip(db, storage, make_entry_file, make_user):
    e1, e2 = _make_world(db, storage, make_entry_file, make_user)
    e1_id, e2_id = e1.entry_id, e2.entry_id
    _wipe(db)
    r = rebuild(db, storage)
    assert r["entries"] == 1 and r["trashed"] == 1 and r["files"] == 3 and r["missing_files"] == 0
    assert r["users"] == 1 and r["alias_tags"] == 1 and r["audit"] >= 1 and r["staging_batches"] == 1
    a = db.query(models.Entry).filter_by(entry_id=e1_id).one()
    assert a.id == int(e1_id[1:]) and a.status == "confirmed" and a.vault_rel == f"2026/{e1_id}"
    assert a.title == "계류 검토"
    assert [h.hull_no for h in db.query(models.EntryHull).filter_by(entry_id=a.id)] == ["9999"]
    assert db.get(models.Hull, "9999").memo == "174K"
    fwd = db.query(models.Tag).filter_by(kind="zone", value="FWD").one()
    assert db.get(models.Tag, fwd.alias_of_id).value == "선수부"
    t = db.query(models.Entry).filter_by(entry_id=e2_id).one()
    assert t.status == "trashed" and t.trash_rel == f"{e2_id}_20261001-120000"
    assert db.query(models.User).filter_by(employee_id="A100001").one().is_admin is True
    types = {j.type for j in db.query(models.Job)}
    assert {"process_batch", "extract_file", "convert_model"} <= types
    # 새 Entry 번호가 겹치지 않는다
    nb = models.Batch(key="k-new", source="inbox", original_name="n")
    db.add(nb)
    db.flush()
    ne = models.Entry(title="새것", status="draft", batch_id=nb.id)
    db.add(ne)
    db.flush()
    assert ne.id > max(int(e1_id[1:]), int(e2_id[1:]))


def test_rebuild_refuses_non_empty(db, storage, make_entry_file):
    make_entry_file()
    with pytest.raises(RebuildError, match="db_not_empty"):
        rebuild(db, storage)
```

(`_make_world` 의 `db.add(...) if ... else None` 줄은 구현 때 두 줄 if 로 고친다. 테스트 DB 는 conftest 가 매 테스트 새로 만들므로 `_wipe` 로 다시 비워도 안전하다.)

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — `backend/app/ops/rebuild.py`

규칙대로 작성한다. 함수 구성은 다음과 같다.
- `_load_json(path) -> dict | None`(OSError·ValueError → None)
- `_restore_users`·`_restore_hulls`
- `_restore_entry(db, data, *, status, vault_rel, trash_rel, location, batch) -> (entry, files, missing)`
- `_restore_aliases`·`_restore_audit`·`_restore_staging`
- `rebuild(db, storage) -> dict`

구현 요점:
- **태그 생성**: `entries.service.set_tags` 를 재사용해 태그 생성·중복 처리를 맞춘다. `set_tags(db, entry, "zone", zones)`, `set_tags(db, entry, "free", tags)`.
- **Entry id 지정**: `models.Entry(id=..., entry_id=..., ...)` 처럼 id 를 직접 넣는다. MySQL 은 명시 id 를 받고, 다음 자동 증가를 그 뒤로 옮긴다.
- **감사 JSONL**: 줄 형식은 `audit._append_jsonl` 이 쓰는 `{at, employee_id, action, target:{type,id}, before, after, ip}` 다.
- **변환 작업**: `extract.job.enqueue_extract`, `convert.job.enqueue_convert` 를 쓴다.
- **커밋**: 끝에 한 번 커밋한다. 많아지면 1000 Entry 마다 중간 커밋해도 된다(재구축 중 실패하면 빈 DB 에서 다시 하면 된다).

CLI `rebuild` 는 다음을 한다.
- `--yes` 없이 실행하면 아래 안내를 출력하고 종료 코드 1 로 끝낸다.

  ```
  빈 DB 에 공유 폴더(<root>)의 entry.json·registry.json·감사 로그를 읽어 채웁니다. 실행하려면 --yes
  ```

- `--yes` 면 `create_all` 다음에 `rebuild` 를 부르고 결과를 한 줄씩 출력한다. `RebuildError` 면 "DB 가 비어 있지 않아 재구축하지 않습니다." 를 내고 종료 코드 2.

- [ ] **Step 4:** PASS, 전체 PASS
- [ ] **Step 5: 커밋(사람)** — `feat: 05 공유 폴더 기반 재구축 명령`

---

### Task 7: 관리자 운영 API

**Files:**
- Create: `backend/app/routers/admin_ops.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_admin_ops_api.py`

모든 경로는 `require_admin` 이다. 일반 사용자는 403 `admin_required` 다.

- `GET /api/admin/ops/status`:

```json
{"worker": {"alive", "at", "stats"},
 "storage": {"reachable"},
 "jobs": [{"type", "state", "count"}],
 "failed": [{"id", "type", "target_id", "label", "attempts", "last_error", "updated_at"}],
 "backup": <last_backup 또는 null>,
 "daily": <last_daily 또는 null>,
 "trash": {"count", "expiring": N, "days"}}
```

  - `failed` 는 최근 20건이다. `label` 은 대상 이름이다.
    - `extract_file`·`convert_model` → 파일 이름
    - `process_batch` → 배치 키
    - `write_meta` → Entry 번호
    - 대상이 없으면 `#<id>`
  - `trash.expiring` 은 7일 안에 비워질 Entry 수다.
- `POST /api/admin/ops/jobs/{id}/retry`: `failed` 만 받는다(그 밖은 409 `not_failed`). `state='queued'`, `attempts=0`, `last_error=None`, `run_after=now` 로 두고, 감사 `JOB_RETRY` 를 남긴다.
- `POST /api/admin/ops/reextract`·`/reconvert`(body `{force: bool}`): `cli.enqueue_extract_all`/`enqueue_convert_all` 를 부르고 `{queued: n}` 을 돌려준다. 감사 `OPS_REEXTRACT`·`OPS_RECONVERT` 를 남긴다.
- `POST /api/admin/ops/backup`: `run_backup` + `prune_backups` 를 하고 `last_backup` 을 기록한 뒤 결과를 돌려준다. 실패하면 502 `{code:'backup_failed', message}`. 감사 `OPS_BACKUP` 을 남긴다.
- `DELETE /api/admin/trash/{entry_id}`: `purge_entry(actor=관리자)`. 응답 204.

- [ ] **Step 1: 실패하는 테스트**

```python
from app import models
from app.ops.state import set_state


def _admin(client, make_user, auth_headers):
    make_user("A100001", is_admin=True)
    make_user("A100002")
    return auth_headers("A100001"), auth_headers("A100002")


def test_status_and_permissions(client, db, make_user, auth_headers, make_entry_file):
    ha, hu = _admin(client, make_user, auth_headers)
    assert client.get("/api/admin/ops/status", headers=hu).status_code == 403
    _e, f = make_entry_file(name="m.bdf", kind="model")
    db.add(models.Job(type="convert_model", target_id=f.id, state="failed", attempts=3, last_error="boom"))
    db.add(models.Job(type="extract_file", target_id=f.id, state="queued"))
    set_state(db, "last_backup", {"ok": True, "file": "logbook-x.sql.gz", "size": 10, "at": "2026-10-02T02:00:00", "error": None})
    db.commit()
    d = client.get("/api/admin/ops/status", headers=ha).json()
    assert d["worker"]["alive"] is False
    assert {"type": "convert_model", "state": "failed", "count": 1} in d["jobs"]
    assert d["failed"][0]["label"] == "m.bdf" and d["failed"][0]["last_error"] == "boom"
    assert d["backup"]["file"] == "logbook-x.sql.gz" and d["trash"]["days"] == 90


def test_retry(client, db, make_user, auth_headers):
    ha, _ = _admin(client, make_user, auth_headers)
    j = models.Job(type="write_meta", target_id=1, state="failed", attempts=3, last_error="x")
    q = models.Job(type="write_meta", target_id=2, state="queued")
    db.add_all([j, q])
    db.commit()
    assert client.post(f"/api/admin/ops/jobs/{j.id}/retry", headers=ha).status_code == 200
    db.expire_all()
    assert (db.get(models.Job, j.id).state, db.get(models.Job, j.id).attempts) == ("queued", 0)
    assert client.post(f"/api/admin/ops/jobs/{q.id}/retry", headers=ha).json()["detail"] == "not_failed"
    assert db.query(models.AuditLog).filter_by(action="JOB_RETRY").count() == 1


def test_reconvert_and_reextract(client, db, make_user, auth_headers, make_entry_file):
    ha, _ = _admin(client, make_user, auth_headers)
    make_entry_file(name="m.bdf", kind="model")
    make_entry_file(name="r.pdf")
    assert client.post("/api/admin/ops/reconvert", json={"force": False}, headers=ha).json() == {"queued": 1}
    assert client.post("/api/admin/ops/reextract", json={"force": False}, headers=ha).json() == {"queued": 1}


def test_backup_endpoint(client, db, make_user, auth_headers, monkeypatch):
    ha, _ = _admin(client, make_user, auth_headers)
    import app.routers.admin_ops as ops

    monkeypatch.setattr(ops, "_backup_runner", lambda out: out.write(b"-- dump"))
    d = client.post("/api/admin/ops/backup", headers=ha).json()
    assert d["ok"] is True and d["file"].startswith("logbook-")

    def bad(out):
        from app.ops.backup import BackupError
        raise BackupError("mysqldump_not_found")
    monkeypatch.setattr(ops, "_backup_runner", bad)
    res = client.post("/api/admin/ops/backup", headers=ha)
    assert res.status_code == 502 and res.json()["detail"]["code"] == "backup_failed"


def test_admin_purge(client, db, storage, make_user, auth_headers, make_entry_file):
    ha, hu = _admin(client, make_user, auth_headers)
    e, _ = make_entry_file(status="trashed")
    e.trash_rel = "E_x"
    db.commit()
    assert client.delete(f"/api/admin/trash/{e.entry_id}", headers=hu).status_code == 403
    assert client.delete(f"/api/admin/trash/{e.entry_id}", headers=ha).status_code == 204
    assert db.query(models.Entry).filter_by(entry_id=e.entry_id).first() is None
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
  - `admin_ops.py` 를 규칙대로 작성한다.
  - 테스트가 백업 실행 함수를 갈아 끼울 수 있도록 모듈 전역 `_backup_runner = backup._run_dump` 를 두고 `run_backup(storage, runner=_backup_runner)` 로 쓴다.
  - 작업 개수는 `db.query(Job.type, Job.state, func.count()).group_by(...)` 로 센다.
  - 실패 작업의 이름은 한 번에 모아서 읽는다(N+1 금지).
  - `main.py` 에 라우터를 등록한다.
- [ ] **Step 4:** PASS, 전체 PASS
- [ ] **Step 5: 커밋(사람)** — `feat: 05 관리자 운영 API`

---

### Task 8: 관리자 운영 화면·휴지통 영구 삭제

**Files:**
- Create: `frontend/src/pages/admin/OpsPage.jsx`
- Modify: `frontend/src/App.jsx`, `frontend/src/components/shell/SideNav.jsx`, `frontend/src/pages/TrashPage.jsx`, `frontend/src/lib/labels.js`
- Test: `frontend/src/pages/admin/OpsPage.test.jsx`, `frontend/src/pages/TrashPage.test.jsx`(추가)

화면 규칙(DESIGN.md 를 따르고, 기존 `UsersPage`·공용 `Page`/`PageHeader`/`Button`/`ConfirmDialog`/`Status` 부품을 쓴다):
- `/admin/ops` 제목은 "운영" 이다. 사이드 내비 관리 묶음의 "사용자 관리" 아래에 "운영" 메뉴(아이콘 `Activity`)를 둔다.
- **상태 줄**은 세 가지다. 30초마다 다시 불러온다.
  - 워커: 점 + "동작 중"/"멈춤" + 마지막 응답 시각
  - 공유 폴더: 연결됨/끊김
  - 마지막 백업: 시각·크기, 실패면 사유
- **작업 큐**: 종류(라벨 "보고서 본문 추출"·"BDF 변환"·"배치 처리"·"메타 파일 쓰기") × 상태(대기·실행 중·완료·실패) 개수 표다. 완료는 접어 둔다.
- **실패한 작업**: 대상 이름·종류·시도·마지막 오류(한 줄로 잘라 보이고, 펼치면 전체)·`다시 시도` 단추.
- **일괄 작업**
  - `본문 다시 추출`·`BDF 다시 변환`. 각각 "이미 끝난 것도 모두" 체크(force)가 있고, 확인 대화상자를 거친다. 결과는 "N건을 넣었습니다".
  - `지금 백업`: 진행 중 표시, 결과를 표시한다.
- **휴지통**: "휴지통 N건 · 7일 안에 비워질 것 M건 · 보관 90일" 한 줄과 `/trash` 링크.
- **TrashPage**: 관리자에게만 행마다 `영구 삭제` 단추를 보인다. 위험 확인 대화상자의 문구는 "되돌릴 수 없습니다. 95_Trash 폴더에서도 지워집니다." 다. 성공하면 행을 지운다.
- **labels.js**
  - `ACTION_LABELS`: `TRASH_PURGE: '영구 삭제'`, `JOB_RETRY: '작업 다시 시도'`, `OPS_REEXTRACT: '본문 다시 추출'`, `OPS_RECONVERT: 'BDF 다시 변환'`, `OPS_BACKUP: '수동 백업'`
  - `ERROR_LABELS`: `not_failed`, `not_trashed`, `backup_failed`, `admin_required`
  - `JOB_TYPE_LABELS`, `JOB_STATE_LABELS`

- [ ] **Step 1: 실패하는 테스트**

`OpsPage.test.jsx`:

```jsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { calls, mockApi } from '../../test/mockApi.js';
import OpsPage from './OpsPage.jsx';

const STATUS = {
  worker: { alive: true, at: '2026-10-02T12:00:00', stats: { processed: 2 } },
  storage: { reachable: true },
  jobs: [{ type: 'convert_model', state: 'failed', count: 1 }, { type: 'extract_file', state: 'queued', count: 4 }],
  failed: [{ id: 9, type: 'convert_model', target_id: 3, label: 'main.bdf', attempts: 3, last_error: 'ValueError: 깨짐', updated_at: '2026-10-02T11:00:00' }],
  backup: { ok: true, file: 'logbook-20261002-020000.sql.gz', size: 2048000, at: '2026-10-02T02:00:00', error: null },
  daily: { date: '2026-10-02', at: '2026-10-02T02:00:00' },
  trash: { count: 3, expiring: 1, days: 90 },
};

function renderPage(map) {
  const fetch = mockApi({ 'GET /api/admin/ops/status': STATUS, ...map });
  render(<MemoryRouter><OpsPage /></MemoryRouter>);
  return fetch;
}

test('상태·큐·실패 작업·백업·휴지통', async () => {
  renderPage({});
  expect(await screen.findByText('동작 중')).toBeInTheDocument();
  expect(screen.getByText(/logbook-20261002-020000\.sql\.gz/)).toBeInTheDocument();
  const failed = screen.getByRole('table', { name: '실패한 작업' });
  expect(within(failed).getByText('main.bdf')).toBeInTheDocument();
  expect(screen.getByText(/휴지통 3건/)).toBeInTheDocument();
  expect(screen.getByText(/7일 안에 비워질 것 1건/)).toBeInTheDocument();
});

test('다시 시도', async () => {
  const fetch = renderPage({ 'POST /api/admin/ops/jobs/9/retry': { ok: true } });
  await userEvent.click(await screen.findByRole('button', { name: 'main.bdf 다시 시도' }));
  expect(calls(fetch)).toContain('POST /api/admin/ops/jobs/9/retry');
});

test('BDF 다시 변환은 확인 후 실행', async () => {
  const fetch = renderPage({ 'POST /api/admin/ops/reconvert': { queued: 5 } });
  await userEvent.click(await screen.findByRole('button', { name: 'BDF 다시 변환' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '실행' }));
  expect(await screen.findByText('5건을 넣었습니다.')).toBeInTheDocument();
  const post = fetch.mock.calls.find(([u, i]) => u === '/api/admin/ops/reconvert');
  expect(JSON.parse(post[1].body)).toEqual({ force: false });
});

test('백업 실패 사유', async () => {
  renderPage({ 'POST /api/admin/ops/backup': { __status: 502, detail: { code: 'backup_failed', message: 'mysqldump_not_found' } } });
  await userEvent.click(await screen.findByRole('button', { name: '지금 백업' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('백업');
});

test('워커 멈춤 표시', async () => {
  renderPage({ 'GET /api/admin/ops/status': { ...STATUS, worker: { alive: false, at: null, stats: null } } });
  expect(await screen.findByText('멈춤')).toBeInTheDocument();
});
```

`TrashPage.test.jsx` 에 추가한다(관리자 문맥은 기존 테스트의 렌더 방식을 따른다).

```jsx
test('관리자는 영구 삭제할 수 있다', async () => {
  // 관리자 AuthContext 로 렌더하고 GET /api/trash 는 ROWS[0] 하나
  // '영구 삭제' → 대화상자 '영구 삭제' → DELETE /api/admin/trash/E000001 호출, 행이 사라짐
});
test('일반 사용자에게는 영구 삭제가 없다', async () => {
  // 일반 사용자 문맥 — '영구 삭제' 단추 없음
});
```

위 두 테스트는 기존 `TrashPage.test.jsx` 의 렌더 함수에 `AuthContext.Provider` 를 씌워 완성한다. 현재 파일이 Provider 없이 렌더한다면, 관리자 여부를 읽는 쪽이 문맥이 없을 때 일반 사용자로 동작하도록 만든다.

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 규칙대로 작성한다. 30초 주기 재조회는 `setInterval` 로 하고, 언마운트 때 해제하고, 늦게 온 응답은 무시한다.
- [ ] **Step 4:** `npm test` 전체 PASS, `npm run build` 성공
- [ ] **Step 5: 커밋(사람)** — `feat: 05 관리자 운영 화면·휴지통 영구 삭제`

---

### Task 9: 145 설치 스크립트·바로가기

**Files:**
- Create: `ops/install-tasks.ps1`, `ops/run-api.ps1`, `ops/run-worker.ps1`, `ops/README.md`, `backend/app/ops/shortcut.py`
- Modify: `backend/app/cli.py`(`write-shortcut`), `.gitignore`(`backend/logs/`)
- Test: `backend/tests/test_ops_shortcut.py`; 스크립트는 `-WhatIf` 로 검증한다.

**`ops/run-api.ps1`**
- 저장소 루트를 스크립트 위치에서 찾는다(`$PSScriptRoot\..`).
- `backend\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 9095` 를 실행하고 표준출력·오류를 `backend\logs\api.log` 에 덧붙인다. 같은 폴더(`backend\logs\`)에 있는 다른 로그 파일과 섞지 않는다.
- 로그가 10MB 를 넘으면 `api.log.1` 로 바꾼다.
- 종료 코드를 그대로 돌려준다. 작업 스케줄러가 재시작한다.

**`ops/run-worker.ps1`**: 같은 구조로 `-m app.worker` 를 실행하고 `backend\logs\worker-console.log` 에 쓴다. 워커는 자체 로그를 `90_System\logs` 에 따로 쓴다.

**`ops/install-tasks.ps1 -User <도메인\계정> [-WhatIf] [-Uninstall]`**
- 작업 `Logbook API`·`Logbook Worker` 를 등록한다.
  - 트리거: 시작 시(AtStartup) + 30초 지연.
  - 동작: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <run-*.ps1>`
  - 설정: `-RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew`
  - 계정: 비밀번호는 `Read-Host -AsSecureString` 으로 받는다. **명령줄 인자로 받지 않는다.** `-RunLevel Highest`, "로그온 여부와 관계없이 실행"(`-LogonType Password`).
- `-WhatIf` 면 등록하지 않고 할 일을 출력한다. `-Uninstall` 은 두 작업을 지운다.
- 방화벽 9095 인바운드 규칙(`New-NetFirewallRule -DisplayName 'Logbook 9095' -Direction Inbound -Protocol TCP -LocalPort 9095 -Action Allow`)은 이미 있으면 건너뛴다.

**`ops/README.md`(한국어)**: 145 최초 설치부터 일상 운영까지 순서대로 적는다.
1. git clone
2. Python 3.11 venv + `pip install -r requirements.txt`
3. `backend\.env` 작성(**값은 담당자가 직접 입력** — 키 이름 목록만 적는다. `.env.example` 참조)
4. `frontend\dist` 는 저장소에 들어 있다
5. `python -m app.cli create-admin`
6. `ops\install-tasks.ps1 -User …`
7. `python -m app.cli write-shortcut`
8. 팀원 안내
9. 업데이트 절차(`git pull` → pip → 작업 재시작 `Restart-ScheduledTask`)
10. 백업 확인·복원(`mysql logbook < 덤프` — `gunzip` 대신 파이썬 한 줄로 푼다)
11. 재구축 절차(빈 DB 만들고 `rebuild --yes`)
12. 문제 해결(워커 멈춤 → 운영 화면, 로그 위치)

**`app/ops/shortcut.py`**: `write_shortcut(storage, url) -> list[str]` 가 공유 폴더 루트에 두 파일을 쓴다(기존 파일은 덮어쓴다).
- `Logbook.url`: `[InternetShortcut]\r\nURL=<url>\r\n`
- `Logbook 사용 안내.txt`(UTF-8 BOM, 메모장 호환): 접속 주소, 크롬 북마크 방법, 사번 가입·승인 안내, "자료 원본은 이 폴더에 있습니다. 10_Vault 를 직접 고치지 마세요." 문구

CLI `write-shortcut [--url URL]` 의 기본값은 `settings.public_url` 이다.

- [ ] **Step 1: 실패하는 테스트**

```python
import os

from app.ops.shortcut import write_shortcut
from app.storage.paths import to_long


def test_write_shortcut(storage):
    names = write_shortcut(storage, "http://10.14.42.145:9095")
    assert set(names) == {"Logbook.url", "Logbook 사용 안내.txt"}
    with open(to_long(storage.root / "Logbook.url"), "rb") as fh:
        assert fh.read() == b"[InternetShortcut]\r\nURL=http://10.14.42.145:9095\r\n"
    with open(to_long(storage.root / "Logbook 사용 안내.txt"), "rb") as fh:
        data = fh.read()
    assert data.startswith(b"\xef\xbb\xbf") and "http://10.14.42.145:9095" in data.decode("utf-8-sig")
```

- [ ] **Step 2:** FAIL → 구현 → PASS
- [ ] **Step 3: 스크립트 검증**
  - `powershell -NoProfile -File ops\install-tasks.ps1 -User TEST\user -WhatIf` 가 오류 없이 할 일을 출력해야 한다. 실제 등록은 하지 않는다.
  - 문법 확인: `powershell -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('ops\run-api.ps1',[ref]$null,[ref]$e); $e"` 가 빈 결과여야 한다(세 스크립트 모두).
- [ ] **Step 4: 커밋(사람)** — `feat: 05 145 설치 스크립트·바로가기·운영 안내`

---

### Task 10: 실제 확인 (컨트롤러가 직접 수행)

- [ ] **백업**: 개발 PC 에서 `python -m app.cli backup` 을 실행한다.
  - 공유 폴더 `80_Backup` 에 `.sql.gz` 가 생긴다.
  - 풀어서 `CREATE TABLE \`entries\`` 가 있는지 확인한다.
  - 실행 중 프로세스 목록에 비밀번호가 보이지 않아야 한다(`Get-CimInstance Win32_Process` 명령줄 확인).
- [ ] **재구축 리허설**: **운영 DB(`logbook`)는 건드리지 않는다.**
  - `LOGBOOK_DB_NAME=logbook_test` 로 빈 테스트 DB 에 실제 공유 폴더 재구축을 한다(`rebuild --yes`).
  - 결과 수가 개발 DB 와 맞는지 비교한다: Entry·휴지통·파일·사용자 수. 개발 DB 수는 앱 엔진으로 셀 때 비밀번호를 출력하지 않는다.
  - 끝나면 테스트 DB 를 비운다(다음 pytest 가 어차피 비운다).
- [ ] **바로가기**: `python -m app.cli write-shortcut` → 공유 폴더 루트의 `Logbook.url` 을 더블클릭해 크롬이 열리는지 확인한다(로컬 9095 로 띄워서).
- [ ] **운영 화면**: API·워커를 띄우고 Playwright 로 `/admin/ops` 를 확인한다.
  - 워커 "동작 중"
  - 큐 표
  - 수동 백업 성공
  - 실패 작업 다시 시도(일부러 실패 작업 하나를 만든다)
  - 휴지통 영구 삭제(합성 Entry)
  - 콘솔 오류 0
- [ ] **설치 스크립트**: `install-tasks.ps1 -WhatIf` 출력을 검토한다. 실제 등록은 145 에서 담당자가 한다.
- [ ] `docs/plans/README.md` 의 05 줄에 계획서 파일 이름을 적는다.

---

## 자체 점검 (계획 작성 시)

- §12
  - 서비스 등록 → Task 9
  - 로그 → Task 9(API 콘솔 로그, 워커는 기존 `90_System\logs`)
  - 일일 덤프 → Task 3·5
  - 관리자 화면(워커 상태·대기 작업·최근 오류) → Task 7·8
  - 배포(`git pull` + 재시작) → Task 9 README
- §9 DB 유실 → 재구축 + 덤프 → Task 3·6
- §8 휴지통 90일 자동·관리자 수동 영구 삭제 → Task 4·5·7·8
- §6.1 `/admin` 재색인·재변환·재구축·워커 상태 → Task 7·8. 재구축은 화면이 아니라 CLI 다(빈 DB 전제라 화면 단추로 두면 위험하다).
- §1.3 `.url` 바로가기 + 북마크 안내 → Task 9
- 미룬 결정(태그 동의어·호선 메모 보존) → Task 2·6
