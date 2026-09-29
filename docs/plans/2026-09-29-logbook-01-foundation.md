# Logbook 01 — 기반(로그인·승인·감사 로그·화면 틀) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사번 가입 신청 → 관리자 승인 → 로그인 → HD현대 색의 빈 화면 틀(상단 바·좌측 메뉴·연결 상태)이 크롬에서 뜨고, 모든 계정 변경이 감사 로그(DB + `999_LogBook\90_System\audit\*.jsonl`)에 남는 Logbook 의 뼈대를 만든다.

**Architecture:** `backend/`(FastAPI + SQLAlchemy + MySQL `logbook`)가 `/api/*` 와 빌드된 프론트(`frontend/dist`)를 **같은 출처(포트 9095)** 로 서빙한다. 인증·세션·DB 설정은 HiTESS WorkBench 코드(`routers/auth.py`, `sessions.py`, `dependencies.py`, `database.py`)를 이식하되 Logbook 에 맞게 축소한다. 저장소 경로는 `StoragePaths` 한 곳에서 관리하고 모든 파일 접근은 `to_long()`(`\\?\` 접두사)을 거친다 — PoC 실험 7에서 개발 PC 의 LongPathsEnabled=0 이 확인됐기 때문이다. 프론트는 React 19 + Vite + Tailwind v4 + react-router(고정 링크 `/e/E000123` 등을 위해).

**Tech Stack:** Python 3.11, FastAPI 0.128, SQLAlchemy 2.0, PyMySQL, python-dotenv, pytest / Node(npm), React 19, react-router-dom 7, Vite, Tailwind CSS v4, lucide-react, Pretendard, JetBrains Mono, Vitest + Testing Library

**근거 문서:** 설계 `docs/specs/2026-09-28-logbook-design.md` §1.3·2·3·4·6.4·8, 재사용 목록 `docs/reuse-inventory.md` §6·7·8, 화면 목업 https://claude.ai/artifact/WtzcLGqFa3hkuT8f7GSWWs

**실행 환경:** 모든 개발·테스트는 **개발 PC**. 145 에는 사용자가 커밋·푸시 → `git pull` 로만 전달한다. **에이전트는 git add/commit 을 하지 않는다** — 각 태스크의 "커밋" 단계는 사용자가 수행.

**이번 계획의 결정 사항 (사용자 확인 필요 시 태스크 15 보고에 명시):**
- `frontend/dist`(빌드 결과)는 **git 에 커밋한다.** 145 에 Node 를 설치하지 않고 `git pull` + 백엔드 재시작만으로 배포되게 하기 위함.
- 테스트 DB 는 **MySQL `logbook_test`** (설계 §10: SQLite 금지). 테스트는 이 DB 의 테이블을 매번 지우고 다시 만든다 — 이름이 `_test` 로 끝나지 않으면 테스트가 거부한다.
- 로그인 이력은 감사 로그에 남기지 않는다(설계 §8: 생성·수정·삭제·확정·복원만). 가입 신청·승인·거절·비활성화·재활성화·관리자 지정/해제·관리자 부트스트랩은 남긴다.

---

## 파일 구조

```
C:\Coding\Logbook\
├─ .gitignore                         (수정: backend/.venv, backend/.env, frontend/node_modules)
├─ backend\
│  ├─ requirements.txt
│  ├─ .env.example
│  ├─ pytest.ini
│  ├─ scripts\create_db.py            MySQL logbook / logbook_test 생성
│  ├─ app\
│  │  ├─ __init__.py
│  │  ├─ config.py                    Settings(.env) — 한곳에서만 환경변수 읽음
│  │  ├─ database.py                  engine·SessionLocal·Base·get_db  (WorkBench database.py 이식)
│  │  ├─ models.py                    User · UserSession · AuditLog
│  │  ├─ schemas.py                   요청 본문 모델 + user_to_dict
│  │  ├─ storage\__init__.py
│  │  ├─ storage\paths.py             StoragePaths · to_long · LAYOUT
│  │  ├─ audit.py                     record() — DB + JSONL 이중 기록
│  │  ├─ sessions.py                  세션 토큰 생성·조회·폐기 (WorkBench sessions.py 이식)
│  │  ├─ dependencies.py              get_storage · require_auth · require_admin · client_ip
│  │  ├─ routers\__init__.py
│  │  ├─ routers\auth.py              가입 신청·로그인·로그아웃·내 정보
│  │  ├─ routers\users.py             관리자: 목록·승인·거절·비활성·재활성·관리자 지정
│  │  ├─ routers\system.py            상태 확인(health)·감사 로그 조회
│  │  ├─ spa.py                       frontend/dist 서빙 (read() 바이트 응답 — DRM 규칙)
│  │  ├─ cli.py                       python -m app.cli create-admin
│  │  └─ main.py                      create_app()
│  └─ tests\
│     ├─ conftest.py
│     ├─ test_config_db.py  test_paths.py  test_models.py  test_audit.py  test_sessions.py
│     ├─ test_auth_api.py  test_users_api.py  test_system_api.py  test_spa.py  test_cli.py
└─ frontend\
   ├─ package.json  vite.config.js  index.html
   ├─ src\
   │  ├─ main.jsx  App.jsx  index.css
   │  ├─ test\setup.js
   │  ├─ api\client.js  api\client.test.js
   │  ├─ auth\AuthContext.jsx  auth\AuthContext.test.jsx  auth\RequireAuth.jsx
   │  ├─ components\ui\Button.jsx  components\ui\EmptyState.jsx  components\ui\Logo.jsx
   │  ├─ components\shell\AppShell.jsx  TopBar.jsx  SideNav.jsx  SideNav.test.jsx  ConnectionStatus.jsx
   │  ├─ pages\LoginPage.jsx  pages\LoginPage.test.jsx  pages\PlaceholderPage.jsx
   │  └─ pages\admin\UsersPage.jsx  UsersPage.test.jsx  pages\AuditLogPage.jsx
   └─ dist\                           (빌드 결과, git 커밋 대상)
```

---

### Task 1: 백엔드 뼈대와 DB 생성

**Files:**
- Modify: `C:\Coding\Logbook\.gitignore`
- Create: `backend\requirements.txt`, `backend\.env.example`, `backend\pytest.ini`, `backend\app\__init__.py`, `backend\app\routers\__init__.py`, `backend\app\storage\__init__.py`, `backend\scripts\create_db.py`

- [ ] **Step 1: `.gitignore` 에 추가** (기존 내용 아래에 덧붙인다)

```gitignore

# backend
backend/.venv/
backend/.env
backend/.pytest_cache/

# frontend (dist 는 145 배포를 위해 커밋한다)
frontend/node_modules/
frontend/coverage/
```

- [ ] **Step 2: `backend\requirements.txt`** (버전은 WorkBench 백엔드와 동일 — 사내망 설치 검증됨)

```text
fastapi==0.128.0
uvicorn==0.40.0
sqlalchemy==2.0.46
pymysql==1.1.2
cryptography==46.0.4
python-dotenv==1.2.1
python-multipart==0.0.22
pytest==9.0.3
httpx==0.28.1
```

- [ ] **Step 3: `backend\.env.example`**

```ini
# Logbook 백엔드 환경 변수 — 이 파일을 .env 로 복사해 값을 채운다 (.env 는 커밋 금지)
LOGBOOK_DB_USER=admin
LOGBOOK_DB_PASSWORD=
LOGBOOK_DB_HOST=localhost
LOGBOOK_DB_PORT=3306
LOGBOOK_DB_NAME=logbook
# 원본 저장소(공유 폴더). 개발 중 로컬 폴더로 바꿔도 된다.
LOGBOOK_STORAGE_ROOT=\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\999_LogBook
LOGBOOK_SESSION_HOURS=8
```

- [ ] **Step 4: `backend\pytest.ini`**

```ini
[pytest]
testpaths = tests
pythonpath = .
```

- [ ] **Step 5: 빈 패키지 파일 3개** — `backend\app\__init__.py`, `backend\app\routers\__init__.py`, `backend\app\storage\__init__.py` 를 각각 한 줄로 만든다:

```python
"""Logbook 백엔드."""
```

- [ ] **Step 6: `backend\scripts\create_db.py`**

```python
"""MySQL 에 logbook(운영)·logbook_test(테스트) 데이터베이스를 만든다.

사용법 (backend 폴더에서): .venv\\Scripts\\python.exe scripts\\create_db.py
backend\\.env 의 LOGBOOK_DB_* 접속 정보를 쓴다. 이미 있으면 건드리지 않는다.
"""
import os
import re
import sys
from pathlib import Path

import pymysql
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

NAME_PATTERN = re.compile(r"^[A-Za-z0-9_]+$")


def main() -> int:
    base = os.getenv("LOGBOOK_DB_NAME", "logbook")
    names = [base, f"{base}_test"]
    for name in names:
        if not NAME_PATTERN.fullmatch(name):
            print(f"데이터베이스 이름이 올바르지 않습니다: {name}", file=sys.stderr)
            return 2
    conn = pymysql.connect(
        host=os.getenv("LOGBOOK_DB_HOST", "localhost"),
        port=int(os.getenv("LOGBOOK_DB_PORT", "3306")),
        user=os.getenv("LOGBOOK_DB_USER", "admin"),
        password=os.getenv("LOGBOOK_DB_PASSWORD", ""),
        charset="utf8mb4",
    )
    try:
        with conn.cursor() as cur:
            for name in names:
                cur.execute(
                    f"CREATE DATABASE IF NOT EXISTS `{name}` "
                    "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
                )
                print(f"준비됨: {name}")
        conn.commit()
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 7: 가상환경·설치·`.env`·DB 생성**

Run (PowerShell, `C:\Coding\Logbook\backend`):
```powershell
py -3.11 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```
**전용 계정 사용 (2026-09-29 사용자 결정 — WorkBench `admin` 계정 공유 금지).** 사용자가 root 로 한 번 실행:
```sql
CREATE USER IF NOT EXISTS 'logbook_app'@'localhost' IDENTIFIED BY '<비밀번호>';
CREATE DATABASE IF NOT EXISTS logbook CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS logbook_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON logbook.* TO 'logbook_app'@'localhost';
GRANT ALL PRIVILEGES ON logbook_test.* TO 'logbook_app'@'localhost';
FLUSH PRIVILEGES;
```
`.env` 의 `LOGBOOK_DB_USER=logbook_app`, `LOGBOOK_DB_PASSWORD` 는 사용자가 직접 채운다(에이전트는 비밀번호를 추측·출력하지 않는다). DB 가 이미 있으면 `create_db.py` 는 확인만 한다. 개발 중에는 `LOGBOOK_STORAGE_ROOT` 를 그대로 공유 폴더로 둔다.
```powershell
.venv\Scripts\python.exe scripts\create_db.py
```
Expected: `준비됨: logbook` / `준비됨: logbook_test`

- [ ] **Step 8: 커밋 (사용자)**

```bash
git add .gitignore backend/requirements.txt backend/.env.example backend/pytest.ini backend/app backend/scripts
git commit -m "🏗️ chore: Logbook 백엔드 뼈대와 DB 생성 스크립트"
```

---

### Task 2: 설정과 DB 연결 (`config.py`, `database.py`)

**Files:**
- Create: `backend\app\config.py`, `backend\app\database.py`, `backend\tests\conftest.py`, `backend\tests\test_config_db.py`

- [ ] **Step 1: `backend\tests\conftest.py` 작성** (이후 태스크가 fixture 를 덧붙인다)

```python
"""공통 fixture — MySQL logbook_test + 임시 저장소 루트.

⚠ app 을 import 하기 전에 환경변수를 바꿔야 한다(config 가 import 시점에 읽는다).
load_dotenv 는 이미 설정된 환경변수를 덮어쓰지 않으므로 여기 값이 .env 보다 우선한다.
"""
import os
import tempfile

_TEST_ROOT = tempfile.mkdtemp(prefix="logbook_test_root_")
os.environ["LOGBOOK_DB_NAME"] = os.environ.get("LOGBOOK_TEST_DB_NAME", "logbook_test")
os.environ["LOGBOOK_STORAGE_ROOT"] = _TEST_ROOT

import pytest  # noqa: E402

from app import database  # noqa: E402
from app.config import settings  # noqa: E402

if not settings.db_name.endswith("_test"):
    raise RuntimeError(f"테스트 DB 이름은 _test 로 끝나야 합니다: {settings.db_name}")


@pytest.fixture(autouse=True)
def clean_db():
    """테스트마다 모든 테이블을 지우고 다시 만든다."""
    from app import models  # noqa: F401  (테이블 등록)

    database.Base.metadata.drop_all(database.engine)
    database.Base.metadata.create_all(database.engine)
    yield


@pytest.fixture
def db():
    session = database.SessionLocal()
    try:
        yield session
    finally:
        session.close()
```

- [ ] **Step 2: 실패하는 테스트 `backend\tests\test_config_db.py`**

```python
from dataclasses import replace

from app.config import load_settings, settings
from app.database import build_database_url


def test_test_run_uses_test_database():
    assert settings.db_name.endswith("_test")


def test_url_encodes_reserved_password_chars_and_uses_utf8mb4():
    url = build_database_url(replace(load_settings(), db_password="p@ss:w/rd"))
    rendered = url.render_as_string(hide_password=False)
    assert "p%40ss%3Aw%2Frd" in rendered
    assert url.query["charset"] == "utf8mb4"


def test_session_hours_default_is_8(monkeypatch):
    monkeypatch.delenv("LOGBOOK_SESSION_HOURS", raising=False)
    assert load_settings().session_hours == 8
```

- [ ] **Step 3: 실패 확인**

Run: `cd C:\Coding\Logbook\backend; .venv\Scripts\pytest.exe tests\test_config_db.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.config'`

- [ ] **Step 4: `backend\app\config.py`**

```python
"""Logbook 설정 — backend/.env 를 읽어 한곳에서 제공한다. 다른 모듈은 os.getenv 를 직접 쓰지 않는다."""
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

DEFAULT_STORAGE_ROOT = r"\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\999_LogBook"
APP_VERSION = "0.1.0"


@dataclass(frozen=True)
class Settings:
    db_user: str
    db_password: str
    db_host: str
    db_port: int
    db_name: str
    storage_root: str
    session_hours: int
    frontend_dist: Path


def load_settings() -> Settings:
    return Settings(
        db_user=os.getenv("LOGBOOK_DB_USER", "admin"),
        db_password=os.getenv("LOGBOOK_DB_PASSWORD", ""),
        db_host=os.getenv("LOGBOOK_DB_HOST", "localhost"),
        db_port=int(os.getenv("LOGBOOK_DB_PORT", "3306")),
        db_name=os.getenv("LOGBOOK_DB_NAME", "logbook"),
        storage_root=os.getenv("LOGBOOK_STORAGE_ROOT", DEFAULT_STORAGE_ROOT),
        session_hours=int(os.getenv("LOGBOOK_SESSION_HOURS", "8")),
        frontend_dist=Path(
            os.getenv("LOGBOOK_FRONTEND_DIST", str(BACKEND_DIR.parent / "frontend" / "dist"))
        ),
    )


settings = load_settings()
```

- [ ] **Step 5: `backend\app\database.py`** (WorkBench `app/database.py` 이식 — 예약문자 안전 URL, pool_pre_ping)

```python
"""MySQL 연결. WorkBench app/database.py 를 이식했다(예약문자 안전 URL, pool_pre_ping)."""
from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import Settings, settings


def build_database_url(s: Settings = settings) -> URL:
    return URL.create(
        drivername="mysql+pymysql",
        username=s.db_user,
        password=s.db_password,
        host=s.db_host,
        port=s.db_port,
        database=s.db_name,
        query={"charset": "utf8mb4"},
    )


engine = create_engine(build_database_url(), pool_recycle=3600, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 6: `backend\app\models.py` 를 임시로 비어 있게 만든다** (conftest 가 import 하므로 — Task 4 에서 채운다)

```python
"""Logbook ORM 모델 (Task 4 에서 채운다)."""
from .database import Base  # noqa: F401
```

- [ ] **Step 7: 통과 확인**

Run: `.venv\Scripts\pytest.exe tests\test_config_db.py -v`
Expected: `3 passed` (MySQL `logbook_test` 에 접속해 drop/create 가 실행되므로 Task 1 Step 7 이 선행돼야 한다)

- [ ] **Step 8: 커밋 (사용자)**

```bash
git add backend/app/config.py backend/app/database.py backend/app/models.py backend/tests
git commit -m "✨ feat: Logbook 설정·MySQL 연결"
```

---

### Task 3: 저장소 경로 (`storage/paths.py`)

**Files:**
- Create: `backend\app\storage\paths.py`, `backend\tests\test_paths.py`

- [ ] **Step 1: 실패하는 테스트**

```python
# backend/tests/test_paths.py
from app.storage.paths import LAYOUT, StoragePaths, to_long


def test_to_long_unc():
    assert to_long(r"\\server\share\a") == r"\\?\UNC\server\share\a"


def test_to_long_local():
    assert to_long(r"C:\a\b") == r"\\?\C:\a\b"


def test_to_long_idempotent():
    assert to_long(r"\\?\UNC\server\share") == r"\\?\UNC\server\share"


def test_layout_names_match_design():
    assert LAYOUT == ("00_Inbox", "10_Vault", "20_Derived", "80_Backup", "90_System", "95_Trash")


def test_ensure_layout_creates_all_folders(tmp_path):
    sp = StoragePaths(tmp_path)
    sp.ensure_layout()
    for name in LAYOUT:
        assert (tmp_path / name).is_dir()
    assert sp.audit_dir == tmp_path / "90_System" / "audit"
    assert sp.audit_dir.is_dir()
    assert sp.logs_dir.is_dir()


def test_is_reachable(tmp_path):
    assert StoragePaths(tmp_path).is_reachable() is True
    assert StoragePaths(tmp_path / "없는폴더").is_reachable() is False
```

- [ ] **Step 2: 실패 확인**

Run: `.venv\Scripts\pytest.exe tests\test_paths.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.storage.paths'`

- [ ] **Step 3: 구현** (`to_long` 은 PoC `poc/longpath_check.py` 에서 검증된 것과 동일)

```python
# backend/app/storage/paths.py
"""999_LogBook 폴더 구조와 경로 규칙.

⚠ 모든 파일 접근은 to_long() 을 거친다. PoC 실험 7에서 LongPathsEnabled=0 인 PC 는
260자를 넘는 경로를 접두사 없이 열지 못함이 확인됐다(설계 §9).
"""
import os
from dataclasses import dataclass
from pathlib import Path

LAYOUT = ("00_Inbox", "10_Vault", "20_Derived", "80_Backup", "90_System", "95_Trash")


def to_long(p: str | os.PathLike) -> str:
    """Windows 긴 경로 접두사를 붙인다(UNC·로컬 모두, 이미 붙어 있으면 그대로)."""
    s = str(p)
    if s.startswith("\\\\?\\"):
        return s
    if s.startswith("\\\\"):
        return "\\\\?\\UNC\\" + s[2:]
    return "\\\\?\\" + s


@dataclass(frozen=True)
class StoragePaths:
    root: Path

    @property
    def inbox(self) -> Path:
        return self.root / "00_Inbox"

    @property
    def vault(self) -> Path:
        return self.root / "10_Vault"

    @property
    def derived(self) -> Path:
        return self.root / "20_Derived"

    @property
    def backup(self) -> Path:
        return self.root / "80_Backup"

    @property
    def system(self) -> Path:
        return self.root / "90_System"

    @property
    def trash(self) -> Path:
        return self.root / "95_Trash"

    @property
    def audit_dir(self) -> Path:
        return self.system / "audit"

    @property
    def logs_dir(self) -> Path:
        return self.system / "logs"

    def ensure_layout(self) -> None:
        for p in (*(self.root / n for n in LAYOUT), self.audit_dir, self.logs_dir):
            os.makedirs(to_long(p), exist_ok=True)

    def is_reachable(self) -> bool:
        return os.path.isdir(to_long(self.root))
```

- [ ] **Step 4: 통과 확인**

Run: `.venv\Scripts\pytest.exe tests\test_paths.py -v`
Expected: `6 passed`

- [ ] **Step 5: 커밋 (사용자)**

```bash
git add backend/app/storage/paths.py backend/tests/test_paths.py
git commit -m "✨ feat: 999_LogBook 폴더 구조·긴 경로 규칙"
```

---

### Task 4: ORM 모델 (`User`, `UserSession`, `AuditLog`)

**Files:**
- Modify: `backend\app\models.py` (전체 교체)
- Create: `backend\tests\test_models.py`

- [ ] **Step 1: 실패하는 테스트**

```python
# backend/tests/test_models.py
import pytest
from sqlalchemy.exc import IntegrityError

from app import models


def test_user_defaults(db):
    u = models.User(employee_id="A123456", name="홍길동")
    db.add(u)
    db.commit()
    db.refresh(u)
    assert u.status == "pending"
    assert u.is_admin is False
    assert u.login_count == 0
    assert u.created_at is not None


def test_employee_id_is_unique(db):
    db.add(models.User(employee_id="A123456", name="가"))
    db.commit()
    db.add(models.User(employee_id="A123456", name="나"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_audit_log_stores_korean_json(db):
    row = models.AuditLog(
        employee_id="A123456", action="USER_APPROVE", target_type="user", target_id="B654321",
        before={"status": "pending"}, after={"status": "active", "메모": "승인"},
    )
    db.add(row)
    db.commit()
    db.expire_all()
    got = db.query(models.AuditLog).one()
    assert got.after == {"status": "active", "메모": "승인"}
    assert got.at is not None
```

- [ ] **Step 2: 실패 확인**

Run: `.venv\Scripts\pytest.exe tests\test_models.py -v`
Expected: FAIL — `AttributeError: module 'app.models' has no attribute 'User'`

- [ ] **Step 3: 구현** (`backend\app\models.py` 전체 교체)

```python
"""Logbook ORM 모델.

User·UserSession 은 WorkBench models.py 에서 가져와 축소했다(company·is_developer 제거,
is_active 대신 status=pending/active/disabled). 감사 로그는 WorkBench activity_log 와 달리
변경 전·후(before/after)를 남기고 자동 삭제하지 않는다(설계 §8).
"""
from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, Integer, String

from .database import Base

USER_STATUSES = ("pending", "active", "disabled")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    employee_id = Column(String(20), unique=True, nullable=False, index=True)
    name = Column(String(50), nullable=False)
    department = Column(String(100), nullable=True)
    position = Column(String(50), nullable=True)
    status = Column(String(10), nullable=False, default="pending")
    is_admin = Column(Boolean, nullable=False, default=False)
    login_count = Column(Integer, nullable=False, default=0)
    last_login = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.now)


class UserSession(Base):
    __tablename__ = "user_sessions"

    token = Column(String(36), primary_key=True)
    employee_id = Column(String(20), nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    expires_at = Column(DateTime, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True)
    at = Column(DateTime, nullable=False, default=datetime.now, index=True)
    employee_id = Column(String(20), nullable=True, index=True)
    action = Column(String(40), nullable=False, index=True)
    target_type = Column(String(20), nullable=False)
    target_id = Column(String(40), nullable=False)
    before = Column(JSON, nullable=True)
    after = Column(JSON, nullable=True)
    ip = Column(String(45), nullable=True)
```

- [ ] **Step 4: 통과 확인**

Run: `.venv\Scripts\pytest.exe tests -v`
Expected: `12 passed` (config 3 + paths 6 + models 3)

- [ ] **Step 5: 커밋 (사용자)**

```bash
git add backend/app/models.py backend/tests/test_models.py
git commit -m "✨ feat: 사용자·세션·감사 로그 모델"
```

---

### Task 5: 감사 로그 (`audit.py`)

**Files:**
- Create: `backend\app\audit.py`, `backend\tests\test_audit.py`

- [ ] **Step 1: 실패하는 테스트**

```python
# backend/tests/test_audit.py
import json

from app import audit, models
from app.storage.paths import StoragePaths


def test_record_writes_db_row_and_monthly_jsonl(db, tmp_path):
    sp = StoragePaths(tmp_path)
    row = audit.record(
        db, sp, actor="A476854", action="USER_APPROVE", target_type="user",
        target_id="B123456", before={"status": "pending"}, after={"status": "active"}, ip="10.0.0.1",
    )
    assert db.query(models.AuditLog).count() == 1
    path = tmp_path / "90_System" / "audit" / f"{row.at:%Y-%m}.jsonl"
    rec = json.loads(path.read_text(encoding="utf-8").splitlines()[-1])
    assert rec["action"] == "USER_APPROVE"
    assert rec["employee_id"] == "A476854"
    assert rec["target"] == {"type": "user", "id": "B123456"}
    assert rec["after"] == {"status": "active"}
    assert rec["ip"] == "10.0.0.1"


def test_record_commits_pending_changes_in_same_transaction(db, tmp_path):
    db.add(models.User(employee_id="C111111", name="대기자"))
    audit.record(db, StoragePaths(tmp_path), actor="C111111", action="USER_REGISTER",
                 target_type="user", target_id="C111111")
    db.rollback()  # record 가 이미 커밋했으므로 되돌려지지 않아야 한다
    assert db.query(models.User).filter_by(employee_id="C111111").count() == 1


def test_file_failure_does_not_lose_db_row(db, tmp_path):
    blocker = tmp_path / "not_a_folder"
    blocker.write_text("x", encoding="utf-8")
    audit.record(db, StoragePaths(blocker), actor="A476854", action="USER_UPDATE",
                 target_type="user", target_id="A476854")
    assert db.query(models.AuditLog).count() == 1
```

- [ ] **Step 2: 실패 확인**

Run: `.venv\Scripts\pytest.exe tests\test_audit.py -v`
Expected: FAIL — `ImportError: cannot import name 'audit'`

- [ ] **Step 3: 구현**

```python
# backend/app/audit.py
"""감사 로그 — DB(audit_log) + 999_LogBook/90_System/audit/YYYY-MM.jsonl 이중 기록.

호출자는 데이터를 바꾼 뒤 커밋하지 않고 record() 를 부른다. record() 가 감사 행과 함께
한 번에 커밋하므로 "변경은 됐는데 기록이 없는" 상태가 생기지 않는다.
파일 기록은 공유 폴더가 끊겨도 요청을 실패시키지 않는다(DB 가 우선, 경고만 남김).
"""
import json
import logging
import os
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from . import models
from .storage.paths import StoragePaths, to_long

log = logging.getLogger("logbook.audit")


def record(
    db: Session,
    storage: StoragePaths,
    *,
    actor: str | None,
    action: str,
    target_type: str,
    target_id: str,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    ip: str | None = None,
) -> models.AuditLog:
    row = models.AuditLog(
        at=datetime.now().replace(microsecond=0),
        employee_id=actor,
        action=action,
        target_type=target_type,
        target_id=str(target_id),
        before=before,
        after=after,
        ip=ip,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    _append_jsonl(storage, row)
    return row


def _append_jsonl(storage: StoragePaths, row: models.AuditLog) -> None:
    line = json.dumps(
        {
            "at": row.at.isoformat(timespec="seconds"),
            "employee_id": row.employee_id,
            "action": row.action,
            "target": {"type": row.target_type, "id": row.target_id},
            "before": row.before,
            "after": row.after,
            "ip": row.ip,
        },
        ensure_ascii=False,
    )
    try:
        os.makedirs(to_long(storage.audit_dir), exist_ok=True)
        path = storage.audit_dir / f"{row.at:%Y-%m}.jsonl"
        with open(to_long(path), "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError as exc:
        log.warning("감사 로그 파일 기록 실패(DB 기록은 유지): %s", exc)
```

- [ ] **Step 4: 통과 확인**

Run: `.venv\Scripts\pytest.exe tests -v`
Expected: `15 passed`

- [ ] **Step 5: 커밋 (사용자)**

```bash
git add backend/app/audit.py backend/tests/test_audit.py
git commit -m "✨ feat: 감사 로그 DB·JSONL 이중 기록"
```

---

### Task 6: 세션과 인증 의존성 (`sessions.py`, `dependencies.py`, `schemas.py`)

**Files:**
- Create: `backend\app\sessions.py`, `backend\app\dependencies.py`, `backend\app\schemas.py`, `backend\tests\test_sessions.py`

- [ ] **Step 1: 실패하는 테스트**

```python
# backend/tests/test_sessions.py
from datetime import datetime, timedelta

from app import models, sessions


def _user(db, employee_id="A123456", status="active"):
    db.add(models.User(employee_id=employee_id, name="사용자", status=status))
    db.commit()


def test_create_and_resolve(db):
    _user(db)
    token = sessions.create(db, "A123456", hours=8)
    assert len(token) == 36
    assert sessions.resolve(db, token) == "A123456"


def test_unknown_token_is_none(db):
    assert sessions.resolve(db, "00000000-0000-0000-0000-000000000000") is None


def test_expired_token_is_deleted(db):
    _user(db)
    token = sessions.create(db, "A123456", hours=8)
    s = db.get(models.UserSession, token)
    s.expires_at = datetime.now() - timedelta(minutes=1)
    db.commit()
    assert sessions.resolve(db, token) is None
    assert db.get(models.UserSession, token) is None


def test_session_of_disabled_user_is_rejected(db):
    _user(db)
    token = sessions.create(db, "A123456", hours=8)
    db.query(models.User).filter_by(employee_id="A123456").update({"status": "disabled"})
    db.commit()
    assert sessions.resolve(db, token) is None


def test_revoke_all(db):
    _user(db)
    sessions.create(db, "A123456", hours=8)
    sessions.create(db, "A123456", hours=8)
    assert sessions.revoke_all(db, "A123456") == 2
```

- [ ] **Step 2: 실패 확인**

Run: `.venv\Scripts\pytest.exe tests\test_sessions.py -v`
Expected: FAIL — `ImportError: cannot import name 'sessions'`

- [ ] **Step 3: `backend\app\sessions.py`** (WorkBench `sessions.py` 이식 — 매 요청마다 계정 활성 여부 재확인)

```python
"""DB 기반 세션 토큰. WorkBench sessions.py 를 이식했다.

매 요청마다 계정이 여전히 active 인지 확인한다 — 관리자가 비활성화하면 이미 발급된
세션도 즉시 무효가 된다.
"""
import uuid
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from . import models


def create(db: Session, employee_id: str, *, hours: int) -> str:
    token = str(uuid.uuid4())
    now = datetime.now()
    db.add(models.UserSession(token=token, employee_id=employee_id,
                              created_at=now, expires_at=now + timedelta(hours=hours)))
    db.commit()
    return token


def resolve(db: Session, token: str) -> str | None:
    s = db.get(models.UserSession, token)
    if s is None:
        return None
    user = db.query(models.User).filter_by(employee_id=s.employee_id).first()
    if datetime.now() > s.expires_at or user is None or user.status != "active":
        db.delete(s)
        db.commit()
        return None
    return s.employee_id


def revoke(db: Session, token: str) -> None:
    s = db.get(models.UserSession, token)
    if s is not None:
        db.delete(s)
        db.commit()


def revoke_all(db: Session, employee_id: str) -> int:
    deleted = db.query(models.UserSession).filter_by(employee_id=employee_id).delete(
        synchronize_session=False
    )
    db.commit()
    return deleted
```

- [ ] **Step 4: `backend\app\schemas.py`**

```python
"""요청 본문 모델과 응답 변환."""
from pydantic import BaseModel, Field

from . import models


class RegisterRequest(BaseModel):
    employee_id: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=50)
    department: str | None = Field(default=None, max_length=100)
    position: str | None = Field(default=None, max_length=50)


class LoginRequest(BaseModel):
    employee_id: str = Field(min_length=1, max_length=20)


class AdminFlagRequest(BaseModel):
    is_admin: bool


def user_to_dict(u: models.User) -> dict:
    return {
        "id": u.id,
        "employee_id": u.employee_id,
        "name": u.name,
        "department": u.department,
        "position": u.position,
        "status": u.status,
        "is_admin": bool(u.is_admin),
        "login_count": u.login_count or 0,
        "last_login": u.last_login.isoformat() if u.last_login else None,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


def user_snapshot(u: models.User) -> dict:
    """감사 로그용 — 바뀔 수 있는 필드만."""
    return {"status": u.status, "is_admin": bool(u.is_admin), "name": u.name,
            "department": u.department, "position": u.position}
```

- [ ] **Step 5: `backend\app\dependencies.py`** (WorkBench `dependencies.py` 이식 — 사번 대신 User 객체 반환)

```python
"""FastAPI 의존성: 저장소 경로, 인증(Bearer 토큰), 관리자 권한, 클라이언트 IP."""
from pathlib import Path

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from . import models, sessions
from .config import settings
from .database import get_db
from .storage.paths import StoragePaths


def get_storage() -> StoragePaths:
    return StoragePaths(Path(settings.storage_root))


def require_auth(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> models.User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="auth_required")
    employee_id = sessions.resolve(db, authorization.removeprefix("Bearer ").strip())
    if not employee_id:
        raise HTTPException(status_code=401, detail="session_invalid")
    return db.query(models.User).filter_by(employee_id=employee_id).one()


def require_admin(user: models.User = Depends(require_auth)) -> models.User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="admin_required")
    return user


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None
```

- [ ] **Step 6: 통과 확인**

Run: `.venv\Scripts\pytest.exe tests -v`
Expected: `20 passed`

- [ ] **Step 7: 커밋 (사용자)**

```bash
git add backend/app/sessions.py backend/app/dependencies.py backend/app/schemas.py backend/tests/test_sessions.py
git commit -m "✨ feat: 세션 토큰·인증 의존성"
```

---

### Task 7: 앱 팩토리와 가입·로그인 API (`main.py`, `routers/auth.py`)

**Files:**
- Create: `backend\app\routers\auth.py`, `backend\app\main.py`, `backend\app\spa.py`(최소판, Task 10 에서 완성), `backend\tests\test_auth_api.py`
- Modify: `backend\tests\conftest.py` (fixture 추가)

- [ ] **Step 1: `conftest.py` 끝에 fixture 추가**

```python
from pathlib import Path  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture
def storage():
    from app.storage.paths import StoragePaths

    sp = StoragePaths(Path(_TEST_ROOT))
    sp.ensure_layout()
    return sp


@pytest.fixture
def client(storage):
    from app.dependencies import get_storage
    from app.main import create_app

    app = create_app(frontend_dist=None)
    app.dependency_overrides[get_storage] = lambda: storage
    return TestClient(app)


@pytest.fixture
def make_user(db):
    from app import models

    def _make(employee_id="A100001", *, name="사용자", status="active", is_admin=False):
        u = models.User(employee_id=employee_id, name=name, status=status, is_admin=is_admin)
        db.add(u)
        db.commit()
        db.refresh(u)
        return u

    return _make


@pytest.fixture
def auth_headers(client):
    def _headers(employee_id):
        res = client.post("/api/auth/login", json={"employee_id": employee_id})
        assert res.status_code == 200, res.text
        return {"Authorization": f"Bearer {res.json()['token']}"}

    return _headers
```

- [ ] **Step 2: 실패하는 테스트 `backend\tests\test_auth_api.py`**

```python
from app import models


def test_register_creates_pending_user_and_audit(client, db):
    res = client.post("/api/auth/register",
                      json={"employee_id": "a476854", "name": "권혁민", "department": "구조시스템연구실"})
    assert res.status_code == 201
    assert res.json() == {"employee_id": "A476854", "status": "pending"}
    db.expire_all()
    assert db.query(models.User).filter_by(employee_id="A476854").one().status == "pending"
    assert db.query(models.AuditLog).filter_by(action="USER_REGISTER").count() == 1


def test_register_rejects_bad_format(client):
    res = client.post("/api/auth/register", json={"employee_id": "12345", "name": "x"})
    assert res.status_code == 422
    assert res.json()["detail"] == "invalid_employee_id"


def test_register_rejects_duplicate(client, make_user):
    make_user("A476854")
    res = client.post("/api/auth/register", json={"employee_id": "A476854", "name": "x"})
    assert res.status_code == 409
    assert res.json()["detail"] == "already_registered"


def test_login_not_registered(client):
    res = client.post("/api/auth/login", json={"employee_id": "Z999999"})
    assert res.status_code == 404
    assert res.json()["detail"] == "not_registered"


def test_login_pending(client, make_user):
    make_user("A200001", status="pending")
    res = client.post("/api/auth/login", json={"employee_id": "A200001"})
    assert res.status_code == 403
    assert res.json()["detail"] == "pending_approval"


def test_login_disabled(client, make_user):
    make_user("A200002", status="disabled")
    res = client.post("/api/auth/login", json={"employee_id": "A200002"})
    assert res.status_code == 403
    assert res.json()["detail"] == "account_disabled"


def test_login_success_returns_token_and_user(client, make_user, db):
    make_user("A200003", name="김철수")
    res = client.post("/api/auth/login", json={"employee_id": "a200003"})
    assert res.status_code == 200
    body = res.json()
    assert len(body["token"]) == 36
    assert body["user"]["employee_id"] == "A200003"
    assert body["user"]["login_count"] == 1


def test_me_requires_token(client):
    assert client.get("/api/auth/me").status_code == 401


def test_me_and_logout(client, make_user, auth_headers):
    make_user("A200004", name="이영희")
    headers = auth_headers("A200004")
    assert client.get("/api/auth/me", headers=headers).json()["name"] == "이영희"
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/auth/me", headers=headers).status_code == 401
```

- [ ] **Step 3: 실패 확인**

Run: `.venv\Scripts\pytest.exe tests\test_auth_api.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.main'`

- [ ] **Step 4: `backend\app\routers\auth.py`** (WorkBench `routers/auth.py` 이식 — 사번 형식 정규식·대문자 정규화·승인 대기 규칙)

```python
"""가입 신청·로그인·로그아웃·내 정보. WorkBench routers/auth.py 에서 이식·축소했다."""
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import audit, models, sessions
from ..config import settings
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_auth
from ..schemas import LoginRequest, RegisterRequest, user_to_dict
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/auth", tags=["auth"])

# 사번 형식: 영문 1자 + 숫자 5~7자리 (WorkBench 와 동일)
EMPLOYEE_ID_PATTERN = re.compile(r"^[A-Z]\d{5,7}$")


def _normalize(employee_id: str) -> str:
    return employee_id.strip().upper()


@router.post("/register", status_code=201)
def register(
    body: RegisterRequest,
    request: Request,
    db: Session = Depends(get_db),
    storage: StoragePaths = Depends(get_storage),
):
    employee_id = _normalize(body.employee_id)
    if not EMPLOYEE_ID_PATTERN.fullmatch(employee_id):
        raise HTTPException(status_code=422, detail="invalid_employee_id")
    if db.query(models.User).filter_by(employee_id=employee_id).first():
        raise HTTPException(status_code=409, detail="already_registered")
    user = models.User(
        employee_id=employee_id, name=body.name.strip(),
        department=(body.department or "").strip() or None,
        position=(body.position or "").strip() or None,
        status="pending", is_admin=False,
    )
    db.add(user)
    audit.record(db, storage, actor=employee_id, action="USER_REGISTER", target_type="user",
                 target_id=employee_id, after={"name": user.name, "department": user.department},
                 ip=client_ip(request))
    return {"employee_id": employee_id, "status": "pending"}


@router.post("/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    employee_id = _normalize(body.employee_id)
    user = db.query(models.User).filter_by(employee_id=employee_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="not_registered")
    if user.status == "pending":
        raise HTTPException(status_code=403, detail="pending_approval")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="account_disabled")
    user.login_count = (user.login_count or 0) + 1
    user.last_login = datetime.now().replace(microsecond=0)
    db.commit()
    db.refresh(user)
    token = sessions.create(db, user.employee_id, hours=settings.session_hours)
    return {"token": token, "user": user_to_dict(user)}


@router.post("/logout")
def logout(request: Request, db: Session = Depends(get_db),
           user: models.User = Depends(require_auth)):
    token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    sessions.revoke(db, token)
    return {"ok": True}


@router.get("/me")
def me(user: models.User = Depends(require_auth)):
    return user_to_dict(user)
```

- [ ] **Step 5: `backend\app\spa.py`** (최소판 — Task 10 에서 완성)

```python
"""frontend/dist 서빙 (Task 10 에서 완성)."""
from pathlib import Path

from fastapi import FastAPI


def mount_spa(app: FastAPI, dist: Path | None) -> None:
    return None
```

- [ ] **Step 6: `backend\app\main.py`**

```python
"""Logbook 앱 팩토리. API(/api/*)와 빌드된 프론트를 같은 출처(포트 9095)로 서빙한다.

실행 (backend 폴더): .venv\\Scripts\\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 9095
"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from . import models  # noqa: F401  (테이블 등록)
from .config import APP_VERSION, settings
from .database import Base, engine
from .dependencies import get_storage
from .routers import auth
from .spa import mount_spa

log = logging.getLogger("logbook")

_USE_DEFAULT = object()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    try:
        get_storage().ensure_layout()
    except OSError as exc:  # 공유 폴더가 끊겨도 기동은 한다(화면에 연결 끊김 표시)
        log.warning("저장소 폴더 준비 실패: %s", exc)
    yield


def create_app(frontend_dist: Path | None | object = _USE_DEFAULT) -> FastAPI:
    app = FastAPI(title="Logbook", version=APP_VERSION, lifespan=lifespan)
    app.include_router(auth.router)
    dist = settings.frontend_dist if frontend_dist is _USE_DEFAULT else frontend_dist
    mount_spa(app, dist)  # 반드시 마지막 — 나머지 경로를 index.html 로 받는다
    return app


app = create_app()
```

- [ ] **Step 7: 통과 확인**

Run: `.venv\Scripts\pytest.exe tests -v`
Expected: `29 passed`

- [ ] **Step 8: 커밋 (사용자)**

```bash
git add backend/app/main.py backend/app/spa.py backend/app/routers/auth.py backend/tests
git commit -m "✨ feat: 사번 가입 신청·로그인·로그아웃 API"
```

---

### Task 8: 관리자 사용자 관리 API (`routers/users.py`)

**Files:**
- Create: `backend\app\routers\users.py`, `backend\tests\test_users_api.py`
- Modify: `backend\app\main.py` (라우터 등록)

- [ ] **Step 1: 실패하는 테스트**

```python
# backend/tests/test_users_api.py
from app import models


def _admin(make_user, auth_headers):
    make_user("A900001", name="관리자", is_admin=True)
    return auth_headers("A900001")


def test_non_admin_is_forbidden(client, make_user, auth_headers):
    make_user("A100001")
    res = client.get("/api/admin/users", headers=auth_headers("A100001"))
    assert res.status_code == 403


def test_list_filters_by_status(client, make_user, auth_headers):
    h = _admin(make_user, auth_headers)
    make_user("A100002", status="pending")
    make_user("A100003", status="disabled")
    res = client.get("/api/admin/users?status=pending", headers=h)
    assert [u["employee_id"] for u in res.json()] == ["A100002"]
    assert len(client.get("/api/admin/users", headers=h).json()) == 3


def test_approve_activates_and_audits(client, make_user, auth_headers, db):
    h = _admin(make_user, auth_headers)
    make_user("A100004", status="pending")
    res = client.post("/api/admin/users/A100004/approve", headers=h)
    assert res.status_code == 200
    assert res.json()["status"] == "active"
    db.expire_all()
    log = db.query(models.AuditLog).filter_by(action="USER_APPROVE").one()
    assert log.employee_id == "A900001"
    assert log.before["status"] == "pending" and log.after["status"] == "active"
    assert client.post("/api/auth/login", json={"employee_id": "A100004"}).status_code == 200


def test_reject_deletes_pending_only(client, make_user, auth_headers, db):
    h = _admin(make_user, auth_headers)
    make_user("A100005", status="pending")
    make_user("A100006", status="active")
    assert client.post("/api/admin/users/A100005/reject", headers=h).status_code == 200
    assert client.post("/api/admin/users/A100006/reject", headers=h).status_code == 409
    db.expire_all()
    assert db.query(models.User).filter_by(employee_id="A100005").count() == 0
    assert db.query(models.AuditLog).filter_by(action="USER_REJECT").count() == 1


def test_disable_revokes_sessions(client, make_user, auth_headers):
    h = _admin(make_user, auth_headers)
    make_user("A100007")
    user_headers = auth_headers("A100007")
    assert client.post("/api/admin/users/A100007/disable", headers=h).json()["status"] == "disabled"
    assert client.get("/api/auth/me", headers=user_headers).status_code == 401
    assert client.post("/api/admin/users/A100007/enable", headers=h).json()["status"] == "active"


def test_admin_cannot_disable_or_demote_self(client, make_user, auth_headers):
    h = _admin(make_user, auth_headers)
    assert client.post("/api/admin/users/A900001/disable", headers=h).status_code == 400
    res = client.put("/api/admin/users/A900001/admin", json={"is_admin": False}, headers=h)
    assert res.status_code == 400


def test_grant_admin(client, make_user, auth_headers, db):
    h = _admin(make_user, auth_headers)
    make_user("A100008")
    res = client.put("/api/admin/users/A100008/admin", json={"is_admin": True}, headers=h)
    assert res.json()["is_admin"] is True
    db.expire_all()
    assert db.query(models.AuditLog).filter_by(action="USER_ADMIN_GRANT").count() == 1


def test_unknown_user_404(client, make_user, auth_headers):
    h = _admin(make_user, auth_headers)
    assert client.post("/api/admin/users/Z000000/approve", headers=h).status_code == 404
```

- [ ] **Step 2: 실패 확인**

Run: `.venv\Scripts\pytest.exe tests\test_users_api.py -v`
Expected: FAIL — 404 (라우터 없음) 로 단언 실패

- [ ] **Step 3: `backend\app\routers\users.py`** (WorkBench `routers/users.py` 의 승인·비활성·세션 폐기 규칙 이식)

```python
"""관리자 사용자 관리. WorkBench routers/users.py 에서 이식했다.

비활성화는 상태 변경과 세션 폐기를 한 트랜잭션으로 확정한다(부분 성공 방지).
관리자는 자기 자신을 비활성화하거나 관리자 권한을 내릴 수 없다(관리자 0명 사고 방지).
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import audit, models
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_admin
from ..schemas import AdminFlagRequest, user_snapshot, user_to_dict
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])


def _get(db: Session, employee_id: str) -> models.User:
    user = db.query(models.User).filter_by(employee_id=employee_id.upper()).first()
    if user is None:
        raise HTTPException(status_code=404, detail="user_not_found")
    return user


def _set_status(db, storage, request, admin, employee_id, status, action):
    user = _get(db, employee_id)
    if user.employee_id == admin.employee_id and status != "active":
        raise HTTPException(status_code=400, detail="cannot_change_self")
    before = user_snapshot(user)
    user.status = status
    if status != "active":
        db.query(models.UserSession).filter_by(employee_id=user.employee_id).delete(
            synchronize_session=False
        )
    audit.record(db, storage, actor=admin.employee_id, action=action, target_type="user",
                 target_id=user.employee_id, before=before, after=user_snapshot(user),
                 ip=client_ip(request))
    db.refresh(user)
    return user_to_dict(user)


@router.get("")
def list_users(status: str | None = None, db: Session = Depends(get_db),
               admin: models.User = Depends(require_admin)):
    q = db.query(models.User)
    if status:
        q = q.filter_by(status=status)
    return [user_to_dict(u) for u in q.order_by(models.User.created_at.desc(), models.User.id.desc())]


@router.post("/{employee_id}/approve")
def approve(employee_id: str, request: Request, db: Session = Depends(get_db),
            storage: StoragePaths = Depends(get_storage),
            admin: models.User = Depends(require_admin)):
    return _set_status(db, storage, request, admin, employee_id, "active", "USER_APPROVE")


@router.post("/{employee_id}/enable")
def enable(employee_id: str, request: Request, db: Session = Depends(get_db),
           storage: StoragePaths = Depends(get_storage),
           admin: models.User = Depends(require_admin)):
    return _set_status(db, storage, request, admin, employee_id, "active", "USER_ENABLE")


@router.post("/{employee_id}/disable")
def disable(employee_id: str, request: Request, db: Session = Depends(get_db),
            storage: StoragePaths = Depends(get_storage),
            admin: models.User = Depends(require_admin)):
    return _set_status(db, storage, request, admin, employee_id, "disabled", "USER_DISABLE")


@router.post("/{employee_id}/reject")
def reject(employee_id: str, request: Request, db: Session = Depends(get_db),
           storage: StoragePaths = Depends(get_storage),
           admin: models.User = Depends(require_admin)):
    user = _get(db, employee_id)
    if user.status != "pending":
        raise HTTPException(status_code=409, detail="not_pending")
    before = user_snapshot(user)
    target = user.employee_id
    db.delete(user)
    audit.record(db, storage, actor=admin.employee_id, action="USER_REJECT", target_type="user",
                 target_id=target, before=before, ip=client_ip(request))
    return {"ok": True}


@router.put("/{employee_id}/admin")
def set_admin(employee_id: str, body: AdminFlagRequest, request: Request,
              db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
              admin: models.User = Depends(require_admin)):
    user = _get(db, employee_id)
    if user.employee_id == admin.employee_id and not body.is_admin:
        raise HTTPException(status_code=400, detail="cannot_change_self")
    before = user_snapshot(user)
    user.is_admin = body.is_admin
    audit.record(db, storage, actor=admin.employee_id,
                 action="USER_ADMIN_GRANT" if body.is_admin else "USER_ADMIN_REVOKE",
                 target_type="user", target_id=user.employee_id, before=before,
                 after=user_snapshot(user), ip=client_ip(request))
    db.refresh(user)
    return user_to_dict(user)
```

- [ ] **Step 4: `main.py` 에 라우터 등록** — import 줄과 include 줄을 바꾼다

```python
from .routers import auth, users
```
```python
    app.include_router(auth.router)
    app.include_router(users.router)
```

- [ ] **Step 5: 통과 확인**

Run: `.venv\Scripts\pytest.exe tests -v`
Expected: `37 passed`

- [ ] **Step 6: 커밋 (사용자)**

```bash
git add backend/app/routers/users.py backend/app/main.py backend/tests/test_users_api.py
git commit -m "✨ feat: 관리자 가입 승인·거절·비활성화·권한 지정 API"
```

---

### Task 9: 상태 확인·감사 로그 조회 API (`routers/system.py`)

**Files:**
- Create: `backend\app\routers\system.py`, `backend\tests\test_system_api.py`
- Modify: `backend\app\main.py`

- [ ] **Step 1: 실패하는 테스트**

```python
# backend/tests/test_system_api.py
from app import audit


def test_health_needs_no_login_and_reports_storage(client):
    res = client.get("/api/system/health")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["storage"]["reachable"] is True
    assert body["version"] == "0.1.0"


def test_health_reports_unreachable_storage(client, tmp_path):
    from app.dependencies import get_storage
    from app.storage.paths import StoragePaths

    client.app.dependency_overrides[get_storage] = lambda: StoragePaths(tmp_path / "끊김")
    assert client.get("/api/system/health").json()["storage"]["reachable"] is False


def test_audit_list_requires_login(client):
    assert client.get("/api/audit").status_code == 401


def test_audit_list_newest_first_with_filters(client, make_user, auth_headers, db, storage):
    make_user("A100001")
    h = auth_headers("A100001")
    audit.record(db, storage, actor="A100001", action="USER_REGISTER", target_type="user", target_id="A1")
    audit.record(db, storage, actor="A100001", action="USER_APPROVE", target_type="user", target_id="A2")
    rows = client.get("/api/audit?limit=10", headers=h).json()
    assert [r["action"] for r in rows] == ["USER_APPROVE", "USER_REGISTER"]
    assert rows[0]["target"] == {"type": "user", "id": "A2"}
    only = client.get("/api/audit?action=USER_REGISTER", headers=h).json()
    assert [r["target"]["id"] for r in only] == ["A1"]
```

- [ ] **Step 2: 실패 확인**

Run: `.venv\Scripts\pytest.exe tests\test_system_api.py -v`
Expected: FAIL — 404

- [ ] **Step 3: `backend\app\routers\system.py`**

```python
"""상태 확인(로그인 불필요)과 감사 로그 조회(로그인 사용자 누구나 — 설계 §8 '활동 로그')."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models
from ..config import APP_VERSION
from ..database import get_db
from ..dependencies import get_storage, require_auth
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/system/health")
def health(storage: StoragePaths = Depends(get_storage)):
    return {
        "ok": True,
        "version": APP_VERSION,
        "storage": {"root": str(storage.root), "reachable": storage.is_reachable()},
    }


@router.get("/audit")
def list_audit(
    limit: int = Query(default=100, ge=1, le=500),
    action: str | None = None,
    employee_id: str | None = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_auth),
):
    q = db.query(models.AuditLog)
    if action:
        q = q.filter_by(action=action)
    if employee_id:
        q = q.filter_by(employee_id=employee_id.upper())
    rows = q.order_by(models.AuditLog.at.desc(), models.AuditLog.id.desc()).limit(limit)
    return [
        {
            "id": r.id,
            "at": r.at.isoformat(timespec="seconds"),
            "employee_id": r.employee_id,
            "action": r.action,
            "target": {"type": r.target_type, "id": r.target_id},
            "before": r.before,
            "after": r.after,
        }
        for r in rows
    ]
```

- [ ] **Step 4: `main.py` 등록**

```python
from .routers import auth, system, users
```
```python
    app.include_router(auth.router)
    app.include_router(users.router)
    app.include_router(system.router)
```

- [ ] **Step 5: 통과 확인**

Run: `.venv\Scripts\pytest.exe tests -v`
Expected: `41 passed`

- [ ] **Step 6: 커밋 (사용자)**

```bash
git add backend/app/routers/system.py backend/app/main.py backend/tests/test_system_api.py
git commit -m "✨ feat: 상태 확인·감사 로그 조회 API"
```

---

### Task 10: 프론트 빌드 서빙 (`spa.py`) 과 관리자 부트스트랩 (`cli.py`)

**Files:**
- Modify: `backend\app\spa.py` (전체 교체)
- Create: `backend\app\cli.py`, `backend\tests\test_spa.py`, `backend\tests\test_cli.py`

- [ ] **Step 1: 실패하는 테스트**

```python
# backend/tests/test_spa.py
from fastapi.testclient import TestClient

from app.main import create_app


def _client(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>로그북</html>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("비밀", encoding="utf-8")
    return TestClient(create_app(frontend_dist=dist))


def test_root_serves_index(tmp_path):
    res = _client(tmp_path).get("/")
    assert res.status_code == 200
    assert "로그북" in res.text
    assert res.headers["content-type"].startswith("text/html")
    assert int(res.headers["content-length"]) == len("<html>로그북</html>".encode("utf-8"))


def test_client_side_route_falls_back_to_index(tmp_path):
    assert "로그북" in _client(tmp_path).get("/e/E000123").text


def test_asset_served_with_js_type(tmp_path):
    res = _client(tmp_path).get("/assets/app.js")
    assert res.text == "console.log(1)"
    assert "javascript" in res.headers["content-type"]


def test_unknown_api_path_is_json_404(tmp_path):
    res = _client(tmp_path).get("/api/nope")
    assert res.status_code == 404
    assert res.headers["content-type"].startswith("application/json")


def test_path_traversal_does_not_escape_dist(tmp_path):
    res = _client(tmp_path).get("/..%2Fsecret.txt")
    assert "비밀" not in res.text


def test_no_dist_means_no_spa_routes(tmp_path):
    client = TestClient(create_app(frontend_dist=tmp_path / "없음"))
    assert client.get("/").status_code == 404
```

```python
# backend/tests/test_cli.py
from app import cli, models


def test_create_admin_new_user(db, storage):
    cli.create_admin(db, storage, "a476854", "권혁민", "구조시스템연구실")
    db.expire_all()
    u = db.query(models.User).filter_by(employee_id="A476854").one()
    assert (u.status, u.is_admin) == ("active", True)
    assert db.query(models.AuditLog).filter_by(action="ADMIN_BOOTSTRAP").count() == 1


def test_create_admin_promotes_existing_pending_user(db, storage, make_user):
    make_user("A476854", status="pending")
    cli.create_admin(db, storage, "A476854", "권혁민", None)
    db.expire_all()
    u = db.query(models.User).filter_by(employee_id="A476854").one()
    assert (u.status, u.is_admin) == ("active", True)
```

- [ ] **Step 2: 실패 확인**

Run: `.venv\Scripts\pytest.exe tests\test_spa.py tests\test_cli.py -v`
Expected: FAIL — `/` 404, `cli` import 실패

- [ ] **Step 3: `backend\app\spa.py` 전체 교체**

```python
"""frontend/dist 서빙.

⚠ 회사 DRM 규칙(WorkBench CLAUDE.md): FileResponse/StaticFiles 는 stat 크기로
Content-Length 를 보내 DRM 이 파일 크기를 바꿔 놓은 경우 ERR_CONTENT_LENGTH_MISMATCH 가 난다.
그래서 항상 read() 한 바이트로 응답한다.
"""
import mimetypes
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("font/woff2", ".woff2")


def _bytes_response(path: Path) -> Response:
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if media_type.startswith("text/") or media_type == "application/javascript":
        media_type += "; charset=utf-8"
    return Response(content=path.read_bytes(), media_type=media_type)


def mount_spa(app: FastAPI, dist: Path | None) -> None:
    if dist is None or not (dist / "index.html").is_file():
        return
    root = dist.resolve()
    index = root / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="not_found")
        candidate = (root / full_path).resolve()
        if full_path and candidate.is_file() and candidate.is_relative_to(root):
            return _bytes_response(candidate)
        return _bytes_response(index)
```

- [ ] **Step 4: `backend\app\cli.py`**

```python
"""관리 명령.

첫 관리자 만들기 (backend 폴더):
    .venv\\Scripts\\python.exe -m app.cli create-admin A476854 권혁민 구조시스템연구실
"""
import argparse
import sys

from sqlalchemy.orm import Session

from . import audit, models
from .database import Base, SessionLocal, engine
from .dependencies import get_storage
from .schemas import user_snapshot
from .storage.paths import StoragePaths


def create_admin(db: Session, storage: StoragePaths, employee_id: str, name: str,
                 department: str | None) -> models.User:
    employee_id = employee_id.strip().upper()
    user = db.query(models.User).filter_by(employee_id=employee_id).first()
    before = user_snapshot(user) if user else None
    if user is None:
        user = models.User(employee_id=employee_id, name=name, department=department)
        db.add(user)
    user.status = "active"
    user.is_admin = True
    audit.record(db, storage, actor="system", action="ADMIN_BOOTSTRAP", target_type="user",
                 target_id=employee_id, before=before, after=user_snapshot(user))
    db.refresh(user)
    return user


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("create-admin", help="관리자 계정을 만들거나 기존 계정을 관리자로 승격")
    p.add_argument("employee_id")
    p.add_argument("name")
    p.add_argument("department", nargs="?")
    args = parser.parse_args(argv)

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        u = create_admin(db, get_storage(), args.employee_id, args.name, args.department)
        print(f"관리자 준비됨: {u.employee_id} {u.name}")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 5: 통과 확인**

Run: `.venv\Scripts\pytest.exe tests -v`
Expected: `49 passed`

- [ ] **Step 6: 커밋 (사용자)**

```bash
git add backend/app/spa.py backend/app/cli.py backend/tests/test_spa.py backend/tests/test_cli.py
git commit -m "✨ feat: 프론트 빌드 서빙(DRM 안전)·관리자 부트스트랩 명령"
```

---

### Task 11: 프론트 뼈대 · 디자인 토큰

**Files:**
- Create: `frontend\package.json`, `frontend\vite.config.js`, `frontend\index.html`, `frontend\src\main.jsx`, `frontend\src\index.css`, `frontend\src\test\setup.js`, `frontend\src\App.jsx`(임시), `frontend\src\smoke.test.jsx`

- [ ] **Step 1: 의존성 설치** (PowerShell, `C:\Coding\Logbook\frontend` — 폴더가 없으면 만든다)

```powershell
npm init -y
npm install react@19 react-dom@19 react-router-dom@7 lucide-react pretendard @fontsource/jetbrains-mono
npm install -D vite @vitejs/plugin-react tailwindcss @tailwindcss/vite vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 2: `frontend\package.json` 의 `name`·`private`·`type`·`scripts` 를 아래로 맞춘다** (dependencies 는 Step 1 결과 유지)

```json
{
  "name": "logbook-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  }
}
```

- [ ] **Step 3: `frontend\vite.config.js`**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 개발 서버(5180)는 /api 를 백엔드(9095)로 넘긴다. 운영은 백엔드가 dist 를 같은 출처로 서빙.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5180, proxy: { '/api': 'http://localhost:9095' } },
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.js'], globals: true },
});
```

- [ ] **Step 4: `frontend\index.html`**

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Logbook</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 5: `frontend\src\index.css`** — 디자인 토큰 (설계 §6.4, 목업과 같은 값)

```css
@import "tailwindcss";
@import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
@import "@fontsource/jetbrains-mono/400.css";
@import "@fontsource/jetbrains-mono/600.css";

/* Logbook 디자인 토큰 — HD현대 시그니처 색 (WorkBench DESIGN.md 와 같은 값) */
@theme {
  --font-sans: "Pretendard Variable", Pretendard, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  --color-brand: #002554;       /* Trust Blue — 주 버튼·링크·선택 */
  --color-brand-dark: #003366;  /* hover */
  --color-brand-tint: #E8EDF4;  /* 활성 메뉴·칩 배경 */
  --color-brand-ring: #D3DCE8;  /* 포커스 링 */
  --color-ok: #008233;          /* Heritage Green — 확정·연결 */
  --color-spark: #00E600;       /* 로고 한 점에만 */
  --color-wait: #B45309;        /* 미확정 */
  --color-err: #B91C1C;         /* 오류 */
  --color-canvas: #F4F4F5;      /* 바탕 */
  --color-line: #E4E4E7;        /* 테두리 */
  --color-viewer: #0E1A2B;      /* 3D 뷰어 배경 */
}

html, body, #root { height: 100%; }
body {
  margin: 0;
  background: var(--color-canvas);
  color: #18181B;
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}
:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
```

- [ ] **Step 6: `frontend\src\test\setup.js`**

```js
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  localStorage.clear();
});
```

- [ ] **Step 7: 임시 `frontend\src\App.jsx`** (Task 14 에서 교체)

```jsx
export default function App() {
  return <h1>Logbook</h1>;
}
```

- [ ] **Step 8: `frontend\src\main.jsx`**

```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 9: 스모크 테스트 `frontend\src\smoke.test.jsx`**

```jsx
import { render, screen } from '@testing-library/react';
import App from './App.jsx';

test('앱이 렌더된다', () => {
  render(<App />);
  expect(screen.getByText('Logbook')).toBeInTheDocument();
});
```

- [ ] **Step 10: 확인**

Run: `npm test` → Expected: `1 passed`
Run: `npm run build` → Expected: `dist\index.html`, `dist\assets\*.js` 생성, 오류 없음

- [ ] **Step 11: 커밋 (사용자)**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.js frontend/index.html frontend/src
git commit -m "🏗️ chore: Logbook 프론트 뼈대·디자인 토큰"
```

---

### Task 12: API 클라이언트와 인증 컨텍스트

**Files:**
- Create: `frontend\src\api\client.js`, `frontend\src\api\client.test.js`, `frontend\src\auth\AuthContext.jsx`, `frontend\src\auth\AuthContext.test.jsx`, `frontend\src\auth\RequireAuth.jsx`

- [ ] **Step 1: 실패하는 테스트 `client.test.js`**

```js
import { vi } from 'vitest';
import { api, ApiError, tokenStore } from './client.js';

function mockFetch(status, body) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

test('토큰이 있으면 Bearer 헤더를 붙인다', async () => {
  tokenStore.set('tok-1');
  mockFetch(200, { ok: true });
  await api('/auth/me');
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe('/api/auth/me');
  expect(init.headers.Authorization).toBe('Bearer tok-1');
});

test('본문은 JSON 으로 보낸다', async () => {
  mockFetch(200, {});
  await api('/auth/login', { method: 'POST', body: { employee_id: 'A1' }, auth: false });
  const [, init] = fetch.mock.calls[0];
  expect(init.body).toBe('{"employee_id":"A1"}');
  expect(init.headers['Content-Type']).toBe('application/json');
  expect(init.headers.Authorization).toBeUndefined();
});

test('실패하면 detail 을 담은 ApiError', async () => {
  mockFetch(403, { detail: 'pending_approval' });
  await expect(api('/auth/login', { method: 'POST', body: {}, auth: false }))
    .rejects.toMatchObject({ status: 403, detail: 'pending_approval' });
});

test('401 이면 토큰을 지우고 unauthorized 이벤트를 보낸다', async () => {
  tokenStore.set('tok-2');
  mockFetch(401, { detail: 'session_invalid' });
  const onUnauthorized = vi.fn();
  window.addEventListener('logbook:unauthorized', onUnauthorized);
  await expect(api('/auth/me')).rejects.toBeInstanceOf(ApiError);
  expect(tokenStore.get()).toBe('');
  expect(onUnauthorized).toHaveBeenCalled();
  window.removeEventListener('logbook:unauthorized', onUnauthorized);
});
```

- [ ] **Step 2: 실패 확인** — `npm test` → FAIL: `Failed to resolve import "./client.js"`

- [ ] **Step 3: `frontend\src\api\client.js`**

```js
/**
 * Logbook API 클라이언트. 프론트와 백엔드가 같은 출처라 상대 경로 /api 만 쓴다
 * (다른 출처로 토큰이 새는 경로가 없다 — WorkBench workbenchRequest.js 의 걱정이 불필요).
 */
const TOKEN_KEY = 'logbook_token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY) || '',
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(status, detail) {
    super(typeof detail === 'string' ? detail : `HTTP ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = tokenStore.get();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && auth) {
      tokenStore.clear();
      window.dispatchEvent(new Event('logbook:unauthorized'));
    }
    throw new ApiError(res.status, data?.detail ?? null);
  }
  return data;
}
```

- [ ] **Step 4: 실패하는 테스트 `AuthContext.test.jsx`**

```jsx
import { vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import { tokenStore } from '../api/client.js';

function Probe() {
  const { user, loading, login, logout } = useAuth();
  if (loading) return <p>로딩</p>;
  return (
    <div>
      <p>{user ? `사용자:${user.name}` : '비로그인'}</p>
      <button onClick={() => login('A100001')}>로그인</button>
      <button onClick={() => logout()}>로그아웃</button>
    </div>
  );
}

const USER = { employee_id: 'A100001', name: '김철수', is_admin: false };

test('토큰이 없으면 비로그인 상태로 시작', async () => {
  globalThis.fetch = vi.fn();
  render(<AuthProvider><Probe /></AuthProvider>);
  expect(await screen.findByText('비로그인')).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

test('저장된 토큰으로 /auth/me 를 불러 세션을 복원', async () => {
  tokenStore.set('tok');
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(USER) });
  render(<AuthProvider><Probe /></AuthProvider>);
  expect(await screen.findByText('사용자:김철수')).toBeInTheDocument();
});

test('로그인하면 토큰을 저장하고 사번을 기억한다', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true, status: 200, json: () => Promise.resolve({ token: 'new-tok', user: USER }),
  });
  render(<AuthProvider><Probe /></AuthProvider>);
  await act(async () => { screen.getByText('로그인').click(); });
  expect(await screen.findByText('사용자:김철수')).toBeInTheDocument();
  expect(tokenStore.get()).toBe('new-tok');
  expect(localStorage.getItem('logbook_saved_employee_id')).toBe('A100001');
});

test('unauthorized 이벤트가 오면 로그아웃 상태가 된다', async () => {
  tokenStore.set('tok');
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(USER) });
  render(<AuthProvider><Probe /></AuthProvider>);
  await screen.findByText('사용자:김철수');
  act(() => { window.dispatchEvent(new Event('logbook:unauthorized')); });
  await waitFor(() => expect(screen.getByText('비로그인')).toBeInTheDocument());
});
```

- [ ] **Step 5: `frontend\src\auth\AuthContext.jsx`** (WorkBench `contexts/AuthContext.jsx` 의 구조 이식 — 토큰 기반 세션 복원)

```jsx
/**
 * 인증 상태 컨텍스트. WorkBench contexts/AuthContext.jsx 의 구조를 가져왔다.
 * 차이: 사용자 정보를 localStorage 에 두지 않고 매번 /auth/me 로 확인한다
 * (관리자가 비활성화하면 즉시 반영). 사번만 편의를 위해 기억한다.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore } from '../api/client.js';

export const SAVED_EMPLOYEE_ID_KEY = 'logbook_saved_employee_id';
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => !!tokenStore.get());

  useEffect(() => {
    if (!tokenStore.get()) return;
    api('/auth/me')
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener('logbook:unauthorized', onUnauthorized);
    return () => window.removeEventListener('logbook:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (employeeId) => {
    const res = await api('/auth/login', { method: 'POST', body: { employee_id: employeeId }, auth: false });
    tokenStore.set(res.token);
    localStorage.setItem(SAVED_EMPLOYEE_ID_KEY, res.user.employee_id);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // 이미 만료된 세션이어도 화면은 로그아웃 처리한다
    }
    tokenStore.clear();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, isAdmin: user?.is_admin === true, login, logout }),
    [user, loading, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
```

- [ ] **Step 6: `frontend\src\auth\RequireAuth.jsx`**

```jsx
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

/** 로그인이 필요한 구간. adminOnly 면 관리자만. */
export default function RequireAuth({ adminOnly = false }) {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}
```

- [ ] **Step 7: 통과 확인** — `npm test` → Expected: `9 passed` (smoke 1 + client 4 + auth 4)

- [ ] **Step 8: 커밋 (사용자)**

```bash
git add frontend/src/api frontend/src/auth
git commit -m "✨ feat: API 클라이언트·인증 컨텍스트"
```

---

### Task 13: 로그인·가입 신청 화면

**Files:**
- Create: `frontend\src\components\ui\Logo.jsx`, `frontend\src\components\ui\Button.jsx`, `frontend\src\pages\LoginPage.jsx`, `frontend\src\pages\LoginPage.test.jsx`

- [ ] **Step 1: 실패하는 테스트 `LoginPage.test.jsx`**

```jsx
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './LoginPage.jsx';
import { AuthProvider } from '../auth/AuthContext.jsx';

function renderPage() {
  return render(
    <MemoryRouter><AuthProvider><LoginPage /></AuthProvider></MemoryRouter>,
  );
}

function mockFetchOnce(status, body) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status < 300, status, json: () => Promise.resolve(body),
  });
}

test.each([
  ['not_registered', '등록되지 않은 사번입니다'],
  ['pending_approval', '관리자 승인을 기다리는 중입니다'],
  ['account_disabled', '비활성화된 계정입니다'],
])('로그인 오류 %s 를 한국어로 보여 준다', async (detail, text) => {
  mockFetchOnce(detail === 'not_registered' ? 404 : 403, { detail });
  renderPage();
  await userEvent.type(screen.getByLabelText('사번'), 'A100001');
  await userEvent.click(screen.getByRole('button', { name: '로그인' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(text);
});

test('기억된 사번을 미리 채운다', () => {
  localStorage.setItem('logbook_saved_employee_id', 'A476854');
  renderPage();
  expect(screen.getByLabelText('사번')).toHaveValue('A476854');
});

test('가입 신청이 성공하면 승인 대기 안내를 보여 준다', async () => {
  mockFetchOnce(201, { employee_id: 'A100009', status: 'pending' });
  renderPage();
  await userEvent.click(screen.getByRole('tab', { name: '가입 신청' }));
  await userEvent.type(screen.getByLabelText('사번'), 'A100009');
  await userEvent.type(screen.getByLabelText('이름'), '박영수');
  await userEvent.click(screen.getByRole('button', { name: '가입 신청' }));
  expect(await screen.findByRole('status')).toHaveTextContent('관리자 승인 후');
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe('/api/auth/register');
  expect(JSON.parse(init.body)).toMatchObject({ employee_id: 'A100009', name: '박영수' });
});
```

- [ ] **Step 2: 실패 확인** — `npm test` → FAIL: `Failed to resolve import "./LoginPage.jsx"`

- [ ] **Step 3: `frontend\src\components\ui\Logo.jsx`** (목업의 로고 — 네이비 타일 + 초록 한 점)

```jsx
export default function Logo({ size = 30, withText = true }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="relative flex items-center justify-center rounded-[7px] bg-brand text-white"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <span className="absolute right-1 top-1 h-[5px] w-[5px] rounded-full bg-spark" />
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none"
             stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 6.5c3.2-1.5 5.8-1.5 8.5 0 2.7-1.5 5.3-1.5 8.5 0v11c-3.2-1.5-5.8-1.5-8.5 0-2.7-1.5-5.3-1.5-8.5 0z" />
          <path d="M12 6.5v11" />
        </svg>
      </div>
      {withText && (
        <div className="flex flex-col leading-tight">
          <span className="text-base font-bold tracking-tight">Logbook</span>
          <span className="text-[11px] text-zinc-500">구조해석 항해일지</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `frontend\src\components\ui\Button.jsx`** (WorkBench `components/ui/Button.jsx` 의 variant 체계 이식, Logbook 토큰·크기로 조정)

```jsx
/** 공통 버튼. WorkBench components/ui/Button.jsx 의 variant 체계를 가져왔다. */
const VARIANTS = {
  primary: 'bg-brand text-white border-brand hover:bg-brand-dark',
  secondary: 'bg-white text-zinc-800 border-zinc-300 hover:bg-zinc-50',
  danger: 'bg-white text-err border-zinc-300 hover:bg-red-50',
  ghost: 'bg-transparent text-zinc-600 border-transparent hover:bg-zinc-100',
};
const SIZES = { sm: 'h-7 px-2.5 text-xs', md: 'h-8 px-3 text-[13px]', lg: 'h-10 px-4 text-sm' };

export default function Button({ variant = 'primary', size = 'md', className = '', type = 'button', ...rest }) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    />
  );
}
```

- [ ] **Step 5: `frontend\src\pages\LoginPage.jsx`**

```jsx
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button.jsx';
import Logo from '../components/ui/Logo.jsx';
import { api } from '../api/client.js';
import { SAVED_EMPLOYEE_ID_KEY, useAuth } from '../auth/AuthContext.jsx';

const MESSAGES = {
  not_registered: '등록되지 않은 사번입니다. 가입 신청을 해 주세요.',
  pending_approval: '관리자 승인을 기다리는 중입니다. 승인되면 로그인할 수 있습니다.',
  account_disabled: '비활성화된 계정입니다. 관리자에게 문의해 주세요.',
  invalid_employee_id: '사번 형식이 올바르지 않습니다. (예: A123456)',
  already_registered: '이미 가입 신청된 사번입니다.',
};
const message = (err) => MESSAGES[err?.detail] || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';

function Field({ id, label, value, onChange, required = false, placeholder, mono = false }) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5 text-[13px] font-medium text-zinc-700">
      {label}
      <input
        id={id} value={value} required={required} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-brand focus:ring-3 focus:ring-brand-ring ${mono ? 'font-mono' : ''}`}
      />
    </label>
  );
}

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState('login');
  const [employeeId, setEmployeeId] = useState(() => localStorage.getItem(SAVED_EMPLOYEE_ID_KEY) || '');
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={location.state?.from || '/'} replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setDone('');
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(employeeId.trim());
        navigate(location.state?.from || '/', { replace: true });
      } else {
        await api('/auth/register', {
          method: 'POST', auth: false,
          body: { employee_id: employeeId.trim(), name: name.trim(), department: department.trim() || null },
        });
        setDone('가입 신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다.');
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const tabClass = (active) =>
    `h-9 flex-1 border-b-2 text-[13px] ${active ? 'border-brand font-semibold text-brand' : 'border-transparent text-zinc-500'}`;

  return (
    <main className="flex min-h-full items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-white p-8 shadow-sm">
        <Logo size={36} />
        <div role="tablist" className="mt-8 flex border-b border-line">
          <button role="tab" aria-selected={mode === 'login'} className={tabClass(mode === 'login')}
                  onClick={() => { setMode('login'); setError(''); setDone(''); }}>로그인</button>
          <button role="tab" aria-selected={mode === 'register'} className={tabClass(mode === 'register')}
                  onClick={() => { setMode('register'); setError(''); setDone(''); }}>가입 신청</button>
        </div>
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <Field id="employee-id" label="사번" value={employeeId} onChange={setEmployeeId} required placeholder="A123456" mono />
          {mode === 'register' && (
            <>
              <Field id="name" label="이름" value={name} onChange={setName} required />
              <Field id="department" label="부서" value={department} onChange={setDepartment} />
            </>
          )}
          {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-[13px] text-err">{error}</p>}
          {done && <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-[13px] text-ok">{done}</p>}
          <Button type="submit" size="lg" disabled={busy}>{mode === 'login' ? '로그인' : '가입 신청'}</Button>
        </form>
        <p className="mt-6 text-center text-xs text-zinc-500">사번으로 가입 신청 → 관리자 승인 후 사용할 수 있습니다.</p>
      </div>
    </main>
  );
}
```

- [ ] **Step 6: 통과 확인** — `npm test` → Expected: `14 passed`

- [ ] **Step 7: 커밋 (사용자)**

```bash
git add frontend/src/components/ui frontend/src/pages/LoginPage.jsx frontend/src/pages/LoginPage.test.jsx
git commit -m "✨ feat: 로그인·가입 신청 화면"
```

---

### Task 14: 화면 틀(상단 바·좌측 메뉴·연결 상태)과 라우팅

**Files:**
- Create: `frontend\src\components\shell\AppShell.jsx`, `TopBar.jsx`, `SideNav.jsx`, `SideNav.test.jsx`, `ConnectionStatus.jsx`, `frontend\src\components\ui\EmptyState.jsx`, `frontend\src\pages\PlaceholderPage.jsx`
- Modify: `frontend\src\App.jsx` (전체 교체), `frontend\src\smoke.test.jsx` (전체 교체)

- [ ] **Step 1: 실패하는 테스트 `SideNav.test.jsx`**

```jsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SideNav from './SideNav.jsx';

const renderNav = (isAdmin, path = '/') => render(
  <MemoryRouter initialEntries={[path]}><SideNav isAdmin={isAdmin} storage={{ reachable: true }} /></MemoryRouter>,
);

test('일반 사용자에게는 관리 메뉴가 없다', () => {
  renderNav(false);
  expect(screen.getByRole('link', { name: /검색/ })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /관리/ })).not.toBeInTheDocument();
});

test('관리자에게는 관리 메뉴가 보인다', () => {
  renderNav(true);
  expect(screen.getByRole('link', { name: /관리/ })).toHaveAttribute('href', '/admin/users');
});

test('현재 경로의 메뉴가 활성 표시된다', () => {
  renderNav(false, '/hulls');
  expect(screen.getByRole('link', { name: /호선/ })).toHaveAttribute('aria-current', 'page');
});

test('저장소 연결이 끊기면 경고를 보인다', () => {
  render(<MemoryRouter><SideNav isAdmin={false} storage={{ reachable: false }} /></MemoryRouter>);
  expect(screen.getByText('999_LogBook 연결 끊김')).toBeInTheDocument();
});
```

- [ ] **Step 2: 실패 확인** — `npm test` → FAIL: `Failed to resolve import "./SideNav.jsx"`

- [ ] **Step 3: `frontend\src\components\shell\SideNav.jsx`** (목업 좌측 탐색 208px)

```jsx
import { NavLink } from 'react-router-dom';
import { Anchor, History, Inbox, Search, SlidersHorizontal, Tag, Trash2 } from 'lucide-react';

const ITEMS = [
  { to: '/', label: '검색', icon: Search, end: true },
  { to: '/hulls', label: '호선', icon: Anchor },
  { to: '/inbox', label: '정리 대기', icon: Inbox },
  { to: '/tags', label: '태그', icon: Tag },
  { to: '/trash', label: '휴지통', icon: Trash2 },
  { to: '/log', label: '활동 로그', icon: History },
];

const linkClass = ({ isActive }) =>
  `flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm ${isActive ? 'bg-brand-tint font-semibold text-brand' : 'text-zinc-700 hover:bg-zinc-100'}`;

export default function SideNav({ isAdmin, storage }) {
  const reachable = storage?.reachable !== false;
  return (
    <nav aria-label="주 메뉴" className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-line bg-zinc-50 px-2.5 py-3">
      {ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={linkClass}>
          <Icon size={18} strokeWidth={1.75} aria-hidden="true" />{label}
        </NavLink>
      ))}
      <div className="flex-1" />
      {isAdmin && (
        <NavLink to="/admin/users" className={linkClass}>
          <SlidersHorizontal size={18} strokeWidth={1.75} aria-hidden="true" />관리
        </NavLink>
      )}
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2.5 text-xs text-zinc-700">
        <span className={`h-[7px] w-[7px] rounded-full ${reachable ? 'bg-ok' : 'bg-err'}`} />
        {reachable ? '999_LogBook 연결됨' : '999_LogBook 연결 끊김'}
      </div>
    </nav>
  );
}
```

- [ ] **Step 4: `frontend\src\components\shell\ConnectionStatus.jsx`** — 30초마다 상태 확인하는 훅

```jsx
import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';

/** /api/system/health 를 30초마다 확인해 저장소 연결 상태를 돌려준다. */
export function useStorageStatus(intervalMs = 30000) {
  const [storage, setStorage] = useState({ reachable: true });
  useEffect(() => {
    let alive = true;
    const check = () =>
      api('/system/health', { auth: false })
        .then((r) => alive && setStorage(r.storage))
        .catch(() => alive && setStorage({ reachable: false }));
    check();
    const id = setInterval(check, intervalMs);
    return () => { alive = false; clearInterval(id); };
  }, [intervalMs]);
  return storage;
}

export function DisconnectedBanner({ storage }) {
  if (storage?.reachable !== false) return null;
  return (
    <div role="alert" className="border-b border-red-200 bg-red-50 px-5 py-2 text-[13px] text-err">
      999_LogBook 공유 폴더에 연결할 수 없습니다. 업로드가 제한되며, 검색·열람은 계속 사용할 수 있습니다.
    </div>
  );
}
```

- [ ] **Step 5: `frontend\src\components\shell\TopBar.jsx`** (목업 상단 바 56px)

```jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Search, Upload } from 'lucide-react';
import Button from '../ui/Button.jsx';
import Logo from '../ui/Logo.jsx';

export default function TopBar({ user, onLogout }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-white pl-5 pr-4">
      <div className="w-44"><Logo /></div>
      <form role="search" className="flex-1" onSubmit={(e) => { e.preventDefault(); navigate(`/?q=${encodeURIComponent(q)}`); }}>
        <label className="flex h-[38px] max-w-[640px] items-center gap-2.5 rounded-lg border border-zinc-300 bg-zinc-50 px-3 text-zinc-500 focus-within:border-brand focus-within:bg-white focus-within:ring-3 focus-within:ring-brand-ring">
          <Search size={18} strokeWidth={1.75} aria-hidden="true" />
          <input aria-label="검색어" value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="호선, 제목, 보고서 내용 검색…"
                 className="flex-1 bg-transparent text-sm text-zinc-900 outline-none" />
          <kbd className="rounded border border-b-2 border-zinc-300 bg-white px-1.5 font-mono text-[11px] text-zinc-600">Ctrl K</kbd>
        </label>
      </form>
      <Button onClick={() => navigate('/inbox')}><Upload size={14} aria-hidden="true" />올리기</Button>
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-[13px] font-semibold text-white"
              title={`${user.name} (${user.employee_id})`}>{user.name.slice(0, 1)}</span>
        <Button variant="ghost" size="sm" onClick={onLogout} aria-label="로그아웃"><LogOut size={16} aria-hidden="true" /></Button>
      </div>
    </header>
  );
}
```

- [ ] **Step 6: `frontend\src\components\shell\AppShell.jsx`**

```jsx
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import SideNav from './SideNav.jsx';
import TopBar from './TopBar.jsx';
import { DisconnectedBanner, useStorageStatus } from './ConnectionStatus.jsx';

export default function AppShell() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const storage = useStorageStatus();
  return (
    <div className="flex h-full flex-col">
      <TopBar user={user} onLogout={async () => { await logout(); navigate('/login'); }} />
      <DisconnectedBanner storage={storage} />
      <div className="flex min-h-0 flex-1">
        <SideNav isAdmin={isAdmin} storage={storage} />
        <main className="min-w-0 flex-1 overflow-auto"><Outlet /></main>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: `frontend\src\components\ui\EmptyState.jsx`**

```jsx
export default function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="mx-auto mt-24 flex max-w-md flex-col items-center gap-3 text-center">
      {Icon && <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-tint text-brand"><Icon size={22} aria-hidden="true" /></div>}
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      <p className="text-sm leading-relaxed text-zinc-600">{children}</p>
    </div>
  );
}
```

- [ ] **Step 8: `frontend\src\pages\PlaceholderPage.jsx`** — 다음 계획에서 채울 화면들

```jsx
import { Anchor, Inbox, Search, Tag, Trash2 } from 'lucide-react';
import EmptyState from '../components/ui/EmptyState.jsx';

const PAGES = {
  search: { icon: Search, title: '검색', body: '호선·제목·보고서 본문 검색은 03 단계에서 제공됩니다.' },
  hulls: { icon: Anchor, title: '호선', body: '호선별 해석 타임라인은 03 단계에서 제공됩니다.' },
  inbox: { icon: Inbox, title: '정리 대기', body: '자료 올리기와 묶음 확정은 02 단계에서 제공됩니다.' },
  tags: { icon: Tag, title: '태그', body: '태그·동의어 관리는 03 단계에서 제공됩니다.' },
  trash: { icon: Trash2, title: '휴지통', body: '삭제한 자료의 복원은 02 단계에서 제공됩니다.' },
};

export default function PlaceholderPage({ kind }) {
  const p = PAGES[kind];
  return <EmptyState icon={p.icon} title={p.title}>{p.body}</EmptyState>;
}
```

- [ ] **Step 9: `frontend\src\App.jsx` 전체 교체** — `AuditLogPage`·`UsersPage` 는 Task 15 에서 만든다. 이 단계에서는 임시로 PlaceholderPage 를 쓰지 않도록 Task 15 파일을 먼저 빈 컴포넌트로 만든다:

`frontend\src\pages\AuditLogPage.jsx`:
```jsx
export default function AuditLogPage() {
  return <h1 className="p-6 text-lg font-bold">활동 로그</h1>;
}
```
`frontend\src\pages\admin\UsersPage.jsx`:
```jsx
export default function UsersPage() {
  return <h1 className="p-6 text-lg font-bold">사용자 관리</h1>;
}
```
`frontend\src\App.jsx`:
```jsx
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.jsx';
import RequireAuth from './auth/RequireAuth.jsx';
import AppShell from './components/shell/AppShell.jsx';
import LoginPage from './pages/LoginPage.jsx';
import PlaceholderPage from './pages/PlaceholderPage.jsx';
import AuditLogPage from './pages/AuditLogPage.jsx';
import UsersPage from './pages/admin/UsersPage.jsx';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<PlaceholderPage kind="search" />} />
            <Route path="hulls" element={<PlaceholderPage kind="hulls" />} />
            <Route path="inbox" element={<PlaceholderPage kind="inbox" />} />
            <Route path="tags" element={<PlaceholderPage kind="tags" />} />
            <Route path="trash" element={<PlaceholderPage kind="trash" />} />
            <Route path="log" element={<AuditLogPage />} />
            <Route element={<RequireAuth adminOnly />}>
              <Route path="admin" element={<Navigate to="/admin/users" replace />} />
              <Route path="admin/users" element={<UsersPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
```

- [ ] **Step 10: `frontend\src\smoke.test.jsx` 전체 교체** — 비로그인 시 로그인 화면으로 간다

```jsx
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App.jsx';

test('비로그인 사용자는 로그인 화면으로 이동한다', async () => {
  globalThis.fetch = vi.fn();
  render(<MemoryRouter initialEntries={['/hulls']}><App /></MemoryRouter>);
  expect(await screen.findByRole('tab', { name: '로그인' })).toBeInTheDocument();
});
```

- [ ] **Step 11: 통과 확인** — `npm test` → Expected: `18 passed`

- [ ] **Step 12: 커밋 (사용자)**

```bash
git add frontend/src
git commit -m "✨ feat: 화면 틀(상단 바·좌측 메뉴·연결 상태)·라우팅"
```

---

### Task 15: 사용자 관리·활동 로그 화면

**Files:**
- Modify: `frontend\src\pages\admin\UsersPage.jsx`, `frontend\src\pages\AuditLogPage.jsx` (전체 교체)
- Create: `frontend\src\pages\admin\UsersPage.test.jsx`

- [ ] **Step 1: 실패하는 테스트 `UsersPage.test.jsx`**

```jsx
import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsersPage from './UsersPage.jsx';

const PENDING = [{ employee_id: 'A100002', name: '대기자', department: '구조팀', status: 'pending', is_admin: false, created_at: '2026-09-29T09:00:00' }];

function routeFetch(handlers) {
  globalThis.fetch = vi.fn((url, init = {}) => {
    const key = `${init.method || 'GET'} ${url}`;
    const body = handlers[key];
    if (body === undefined) throw new Error(`unexpected ${key}`);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  });
}

test('승인 대기 목록을 보여 주고 승인하면 목록을 다시 불러온다', async () => {
  routeFetch({
    'GET /api/admin/users?status=pending': PENDING,
    'POST /api/admin/users/A100002/approve': { ...PENDING[0], status: 'active' },
  });
  render(<UsersPage />);
  const row = (await screen.findByText('대기자')).closest('tr');
  await userEvent.click(within(row).getByRole('button', { name: '승인' }));
  const calls = fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`);
  expect(calls).toContain('POST /api/admin/users/A100002/approve');
  expect(calls.filter((c) => c === 'GET /api/admin/users?status=pending')).toHaveLength(2);
});

test('탭을 바꾸면 해당 상태로 조회한다', async () => {
  routeFetch({ 'GET /api/admin/users?status=pending': [], 'GET /api/admin/users?status=active': [] });
  render(<UsersPage />);
  await userEvent.click(screen.getByRole('tab', { name: '활성' }));
  const calls = fetch.mock.calls.map(([u]) => u);
  expect(calls).toContain('/api/admin/users?status=active');
});
```

- [ ] **Step 2: 실패 확인** — `npm test` → FAIL: 테이블/버튼 없음

- [ ] **Step 3: `frontend\src\pages\admin\UsersPage.jsx` 전체 교체**

```jsx
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import Button from '../../components/ui/Button.jsx';

const TABS = [
  { key: 'pending', label: '승인 대기' },
  { key: 'active', label: '활성' },
  { key: 'disabled', label: '비활성' },
];

export default function UsersPage() {
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setRows(await api(`/admin/users?status=${tab}`));
    } catch {
      setError('사용자 목록을 불러오지 못했습니다.');
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  async function act(employeeId, path, method = 'POST', body) {
    try {
      await api(`/admin/users/${employeeId}/${path}`, { method, body });
      await load();
    } catch (err) {
      setError(err.detail === 'cannot_change_self' ? '자기 자신은 변경할 수 없습니다.' : '처리하지 못했습니다.');
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-lg font-bold tracking-tight">사용자 관리</h1>
      <div role="tablist" className="mt-4 flex gap-5 border-b border-line">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                  className={`h-9 border-b-2 text-[13px] ${tab === t.key ? 'border-brand font-semibold text-brand' : 'border-transparent text-zinc-500'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-3 text-[13px] text-err">{error}</p>}
      <table className="mt-4 w-full border-collapse rounded-lg bg-white text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-xs text-zinc-500">
            <th className="px-3 py-2 font-medium">사번</th><th className="px-3 py-2 font-medium">이름</th>
            <th className="px-3 py-2 font-medium">부서</th><th className="px-3 py-2 font-medium">신청일</th>
            <th className="px-3 py-2 font-medium">권한</th><th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.employee_id} className="border-b border-line last:border-0">
              <td className="px-3 py-2 font-mono">{u.employee_id}</td>
              <td className="px-3 py-2">{u.name}</td>
              <td className="px-3 py-2 text-zinc-600">{u.department || '—'}</td>
              <td className="px-3 py-2 font-mono text-zinc-600">{u.created_at?.slice(0, 10)}</td>
              <td className="px-3 py-2">{u.is_admin ? '관리자' : '일반'}</td>
              <td className="flex justify-end gap-1.5 px-3 py-2">
                {u.status === 'pending' && (<>
                  <Button size="sm" onClick={() => act(u.employee_id, 'approve')}>승인</Button>
                  <Button size="sm" variant="danger" onClick={() => act(u.employee_id, 'reject')}>거절</Button>
                </>)}
                {u.status === 'active' && (<>
                  <Button size="sm" variant="secondary"
                          onClick={() => act(u.employee_id, 'admin', 'PUT', { is_admin: !u.is_admin })}>
                    {u.is_admin ? '관리자 해제' : '관리자 지정'}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => act(u.employee_id, 'disable')}>비활성화</Button>
                </>)}
                {u.status === 'disabled' && (
                  <Button size="sm" variant="secondary" onClick={() => act(u.employee_id, 'enable')}>재활성화</Button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={6} className="px-3 py-8 text-center text-zinc-500">해당하는 사용자가 없습니다.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: `frontend\src\pages\AuditLogPage.jsx` 전체 교체**

```jsx
import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

const ACTION_LABELS = {
  USER_REGISTER: '가입 신청', USER_APPROVE: '가입 승인', USER_REJECT: '가입 거절',
  USER_DISABLE: '계정 비활성화', USER_ENABLE: '계정 재활성화',
  USER_ADMIN_GRANT: '관리자 지정', USER_ADMIN_REVOKE: '관리자 해제', ADMIN_BOOTSTRAP: '관리자 초기 설정',
};

export default function AuditLogPage() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/audit?limit=200').then(setRows).catch(() => setError('활동 로그를 불러오지 못했습니다.'));
  }, []);
  return (
    <div className="p-6">
      <h1 className="text-lg font-bold tracking-tight">활동 로그</h1>
      <p className="mt-1 text-[13px] text-zinc-600">누가, 언제, 무엇을 바꿨는지 기록합니다. 기록은 삭제되지 않습니다.</p>
      {error && <p role="alert" className="mt-3 text-[13px] text-err">{error}</p>}
      <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-white">
        {rows.map((r) => (
          <li key={r.id} className="flex gap-4 px-4 py-2.5 text-[13px]">
            <span className="w-36 shrink-0 font-mono text-zinc-500">{r.at.replace('T', ' ')}</span>
            <span className="w-24 shrink-0 font-mono">{r.employee_id || 'system'}</span>
            <span className="font-medium">{ACTION_LABELS[r.action] || r.action}</span>
            <span className="font-mono text-zinc-600">{r.target.id}</span>
          </li>
        ))}
        {rows.length === 0 && !error && <li className="px-4 py-8 text-center text-[13px] text-zinc-500">아직 기록이 없습니다.</li>}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: 통과 확인** — `npm test` → Expected: `20 passed`

- [ ] **Step 6: 커밋 (사용자)**

```bash
git add frontend/src/pages
git commit -m "✨ feat: 사용자 관리·활동 로그 화면"
```

---

### Task 16: 통합 확인 (개발 PC 에서 끝까지)

**Files:**
- Create: `C:\Coding\Logbook\README.md`

- [ ] **Step 1: 전체 테스트**

```powershell
cd C:\Coding\Logbook\backend; .venv\Scripts\pytest.exe -q      # Expected: 49 passed
cd C:\Coding\Logbook\frontend; npm test                        # Expected: 20 passed
```

- [ ] **Step 2: 프론트 빌드** — `cd C:\Coding\Logbook\frontend; npm run build` → `frontend\dist` 생성

- [ ] **Step 3: 첫 관리자 만들기** (사용자 사번 — 운영 DB `logbook`)

```powershell
cd C:\Coding\Logbook\backend
.venv\Scripts\python.exe -m app.cli create-admin A476854 권혁민 구조시스템연구실
```
Expected: `관리자 준비됨: A476854 권혁민`

- [ ] **Step 4: 서버 실행과 API 확인**

```powershell
.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 9095
```
다른 창에서:
```powershell
curl.exe http://localhost:9095/api/system/health
```
Expected: `{"ok":true,"version":"0.1.0","storage":{"root":"\\\\storage.hpc.hd.com\\...","reachable":true}}` — 그리고 `999_LogBook` 에 `00_Inbox`…`95_Trash`, `90_System\audit` 폴더가 생겼는지 탐색기로 확인.

- [ ] **Step 5: 브라우저 확인** (크롬 `http://localhost:9095`)
1. `/` 접속 → 로그인 화면으로 이동
2. 가입 신청 탭에서 임의 사번(예: `B100001`) 신청 → "관리자 승인 후" 안내
3. 그 사번으로 로그인 → "관리자 승인을 기다리는 중" 오류
4. `A476854` 로 로그인 → 목업과 같은 상단 바·좌측 메뉴, "999_LogBook 연결됨" 표시, 관리 메뉴 보임
5. 관리 → 승인 대기 탭에서 `B100001` 승인 → 활동 로그에 "가입 승인" 기록
6. `999_LogBook\90_System\audit\2026-09.jsonl` 에 같은 기록이 한 줄씩 있는지 확인
7. 주소창에 `/e/E000123` 입력 → 404 가 아니라 앱이 뜨고 검색 화면으로 이동(SPA 폴백)

- [ ] **Step 6: 저장소 루트 `README.md` 작성**

```markdown
# Logbook — 구조해석 항해일지

구조해석 모델(BDF)·결과·보고서를 호선·선종·구역으로 묶어 보관·검색·확인하는 팀 자료 창고.

- 설계: `docs/specs/2026-09-28-logbook-design.md` · 계획: `docs/plans/` · WorkBench 재사용 목록: `docs/reuse-inventory.md`
- 데이터 원본: `\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\999_LogBook`
- 서버: 10.14.42.145:9095 (개발 PC 에서 개발·테스트 → 커밋·푸시 → 145 에서 `git pull`)

## 개발 PC

    cd backend
    py -3.11 -m venv .venv
    .venv\Scripts\python.exe -m pip install -r requirements.txt
    Copy-Item .env.example .env          # DB 계정 입력
    .venv\Scripts\python.exe scripts\create_db.py
    .venv\Scripts\pytest.exe -q

    cd ..\frontend
    npm install
    npm test
    npm run build                         # dist 는 커밋한다(145 에 Node 불필요)

    cd ..\backend
    .venv\Scripts\python.exe -m app.cli create-admin <사번> <이름> [부서]
    .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 9095

프론트 개발 서버(핫 리로드)는 `cd frontend; npm run dev` → http://localhost:5180 (/api 는 9095 로 전달).

## 145 서버 (첫 배포)

    git clone https://github.com/HyperKwonHyukmin/LogBook.git
    cd LogBook\backend
    python -m venv .venv                  # Python 3.10 이상
    .venv\Scripts\python.exe -m pip install -r requirements.txt
    # 145 MySQL root 로 logbook_app 계정·logbook DB 생성 (개발 PC 와 같은 SQL — 계획 01 Task 1 Step 7)
    Copy-Item .env.example .env           # LOGBOOK_DB_PASSWORD 입력
    .venv\Scripts\python.exe scripts\create_db.py
    .venv\Scripts\python.exe -m app.cli create-admin <사번> <이름>
    .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 9095

업데이트: `git pull` 후 서버 재시작. 첫 배포 점검: 팀원 PC 에서 http://10.14.42.145:9095 접속(안 되면 145 방화벽 9095 인바운드 허용), 화면 좌측 하단 "999_LogBook 연결됨" 확인.
```

- [ ] **Step 7: 커밋 (사용자)**

```bash
git add README.md frontend/dist
git commit -m "📝 docs: Logbook 실행 안내 · 🏗️ build: 프론트 빌드 결과"
```
