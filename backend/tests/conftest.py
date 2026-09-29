"""공통 fixture — MySQL logbook_test + 임시 저장소 루트.

⚠ app 을 import 하기 전에 환경변수를 바꿔야 한다(config 가 import 시점에 읽는다).
load_dotenv 는 이미 설정된 환경변수를 덮어쓰지 않으므로 여기 값이 .env 보다 우선한다.
"""
import atexit
import os
import shutil
import tempfile

_TEST_ROOT = tempfile.mkdtemp(prefix="logbook_test_root_")
atexit.register(shutil.rmtree, _TEST_ROOT, True)
os.environ["LOGBOOK_DB_NAME"] = os.environ.get("LOGBOOK_TEST_DB_NAME", "logbook_test")
os.environ["LOGBOOK_STORAGE_ROOT"] = _TEST_ROOT

import pytest  # noqa: E402

from app import database  # noqa: E402
from app.config import settings  # noqa: E402

if not settings.db_name.endswith("_test"):
    raise RuntimeError(f"테스트 DB 이름은 _test 로 끝나야 합니다: {settings.db_name}")
if not database.engine.url.database.endswith("_test"):
    raise RuntimeError(f"엔진이 가리키는 DB 도 _test 로 끝나야 합니다: {database.engine.url.database}")


@pytest.fixture(autouse=True)
def _clear_reachability_cache():
    """StoragePaths.check_reachable() 의 TTL 캐시를 테스트마다 비운다(같은 루트를 쓰는
    다른 테스트로 결과가 새지 않게)."""
    from app.storage.paths import _reachability_cache

    _reachability_cache.clear()
    yield
    _reachability_cache.clear()


@pytest.fixture(autouse=True)
def clean_db():
    """테스트마다 모든 테이블을 지우고 다시 만든다."""
    from app import models  # noqa: F401  (테이블 등록)

    database.Base.metadata.drop_all(database.engine)
    database.Base.metadata.create_all(database.engine)
    yield


@pytest.fixture
def db():
    """READ COMMITTED 로 연다 — MySQL 기본(REPEATABLE-READ)이면 이 세션의 트랜잭션이
    (예: make_user 안의 db.refresh) 먼저 열려, 이후 client 픽스처(별도 세션)가 커밋한
    변경이 같은 테스트 안에서 보이지 않는다(테스트끼리 세션이 다른 Task 7+ API 테스트에서 실측).
    """
    session = database.SessionLocal(bind=database.engine.execution_options(isolation_level="READ COMMITTED"))
    try:
        yield session
    finally:
        session.close()


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
