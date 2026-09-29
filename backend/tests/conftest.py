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
    from app.storage.paths import LAYOUT, StoragePaths, to_long

    root = Path(_TEST_ROOT)
    for name in LAYOUT:
        # to_long() 로 지운다 — 끝에 공백·점이 있는 이름(테스트가 실측용으로 직접 만든 폴더
        # 등)은 접두 없는 경로로 rmtree 하면 Windows 경로 정규화가 그 이름을 찾지 못해
        # ignore_errors=True 아래 조용히 삭제가 실패하고, 다음 테스트의 inbox 스캔에
        # 영원히 남아 오염시킨다(실측: test_worker 의 end-to-end 테스트가 이 때문에
        # staged/processed 가 2로 뻥튀기됨 — 원인은 test_inbox 의 trailing-dot 테스트).
        shutil.rmtree(to_long(root / name), ignore_errors=True)
    sp = StoragePaths(root)
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
def setup_entry_with_files(db, storage):
    """확정 대상 초안 Entry + 배치 + staging 파일을 만든다(Task 11 이후 여러 테스트가 공유).

    본디 tests/test_confirm.py 의 사설 함수 `_setup(db, storage, ...)` 였다. `tests/` 에
    `__init__.py` 가 없어 네임스페이스 패키지로 잡히는데, 다른 테스트 모듈이
    `from tests.test_confirm import _setup` 로 끌어 쓰면 같은 파일이 pytest 자체의 컬렉터
    (최상위 모듈 `test_confirm`)와 이 import 문(`tests.test_confirm` 서브모듈)에 각각
    다른 모듈 객체로 이중 로드될 위험이 있다. 리뷰에서 지적받아 공유 헬퍼는 전부 이
    fixture 로 옮겼다 — 기존 fixture(`make_user` 등)와 같은 패턴.
    """
    from app import models

    def _make(uploader="A100001", rels=("3496_검토/model/a.bdf", "3496_검토/r.pdf"),
             key="20260929-000000-bbbb"):
        b = models.Batch(key=key, source="inbox", original_name="3496_검토", uploader=uploader)
        db.add(b)
        db.flush()
        e = models.Entry(title="3496 검토", status="draft", batch_id=b.id, uploaded_by=uploader)
        db.add(e)
        db.flush()
        e.entry_id = f"E{e.id:06d}"
        db.add(models.EntryHull(entry_id=e.id, hull_no="3496", is_primary=True))
        for rel in rels:
            p = storage.staging / b.key / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b"data")
            db.add(models.File(batch_id=b.id, entry_id=e.id, rel_path=rel, name=p.name, ext=p.suffix,
                               kind="model", size=4, sha256="a" * 64))
        db.commit()
        return b, e

    return _make


@pytest.fixture
def auth_headers(client):
    def _headers(employee_id):
        res = client.post("/api/auth/login", json={"employee_id": employee_id})
        assert res.status_code == 200, res.text
        return {"Authorization": f"Bearer {res.json()['token']}"}

    return _headers
