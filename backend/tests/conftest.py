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


def _use_plain_pptx_template() -> None:
    """개발 PC 의 사내 DRM 이 .venv 안 python-pptx 기본 서식(default.pptx)을 사후에 암호화한다
    (HHIDRMC 헤더 — 설치 직후 평문으로 되돌려도 얼마 뒤 다시 감싸진다). 그러면 테스트가 메모리에서
    PPTX 를 만들 때 쓰는 `Presentation()` 이 PackageNotFoundError 로 죽는다.

    설치본이 암호화돼 있을 때만, 같은 라이브러리(python-pptx 1.0.2)의 빈 서식을 DRM 대상이 아닌
    `.bin` 확장자로 둔 사본(tests/fixtures/pptx_default_template.bin)으로 바꿔 끼운다.
    python-pptx 는 경로 대신 파일 객체도 받으므로 바이트로 넘긴다. 운영 코드는 서식을 쓰지 않는다
    (추출은 공유 폴더의 기존 파일만 읽는다)."""
    import io

    import pptx.api

    try:
        with open(pptx.api._default_pptx_path(), "rb") as fh:
            if fh.read(2) == b"PK":
                return
    except OSError:
        pass
    data = (Path(__file__).parent / "fixtures" / "pptx_default_template.bin").read_bytes()
    pptx.api._default_pptx_path = lambda: io.BytesIO(data)


from pathlib import Path  # noqa: E402

_use_plain_pptx_template()


@pytest.fixture(autouse=True)
def _clear_reachability_cache():
    """StoragePaths.check_reachable() 의 TTL 캐시를 테스트마다 비운다(같은 루트를 쓰는
    다른 테스트로 결과가 새지 않게)."""
    from app.storage.paths import _reachability_cache

    _reachability_cache.clear()
    yield
    _reachability_cache.clear()


@pytest.fixture(autouse=True)
def _no_real_dump(monkeypatch):
    """안전장치(05): 어떤 테스트도 실제 mysqldump 실행 파일을 부르지 않게 한다.

    1) 백업 모듈의 mysqldump 경로를 없는 곳으로 바꾼다 — 실제 _run_dump 는 실행 전에
       mysqldump_not_found 로 멈춘다(Popen 까지 가지 않는다).
    2) 워커의 일일 작업(daily.run_backup)은 runner 를 넘기지 않으면 바로 성공하는 가짜
       덤프를 쓴다 — 02시 이후에 도는 기존 워커 테스트가 백업 실패로 흔들리지 않게.
       runner 를 넘기면(test_ops_daily) 그 runner 를 그대로 쓴다."""
    import dataclasses

    from app.ops import backup, daily

    monkeypatch.setattr(backup, "settings", dataclasses.replace(
        backup.settings, mysqldump_path=r"C:\__logbook_test_no_mysqldump__\mysqldump.exe"))
    real_run_backup = backup.run_backup

    def _stub_dump(out):
        out.write(b"-- logbook test dump")

    def _fake_run_backup(storage, *, runner=None, now=None):
        return real_run_backup(storage, runner=runner or _stub_dump, now=now)

    monkeypatch.setattr(daily, "run_backup", _fake_run_backup)
    yield


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
    from app.storage.paths import LAYOUT, StoragePaths, walk_root

    root = Path(_TEST_ROOT)
    for name in LAYOUT:
        # walk_root()(늘 긴 경로 접두) 로 지운다 — 끝에 공백·점이 있는 이름(테스트가 실측용으로 직접 만든 폴더
        # 등)은 접두 없는 경로로 rmtree 하면 Windows 경로 정규화가 그 이름을 찾지 못해
        # ignore_errors=True 아래 조용히 삭제가 실패하고, 다음 테스트의 inbox 스캔에
        # 영원히 남아 오염시킨다(실측: test_worker 의 end-to-end 테스트가 이 때문에
        # staged/processed 가 2로 뻥튀기됨 — 원인은 test_inbox 의 trailing-dot 테스트).
        shutil.rmtree(walk_root(root / name), ignore_errors=True)
    sp = StoragePaths(root)
    sp.ensure_layout()
    return sp


_LOCAL_DRM: bool | None = None


@pytest.fixture
def skip_if_local_drm():
    """이 PC 의 회사 DRM 이 로컬에 막 쓴 .pdf 를 감싸 내용을 바꾸면(2026-10-06 부터 dev PC 에서 실측:
    11B 를 쓰면 4096B 빈 파일로 읽히고, 평범한 PDF 도 크기가 +4096B 로 보임) 바이트·크기를 그대로
    되읽는 테스트는 의미가 없어 건너뛴다.
    공유 폴더와 145 서버에서는 일어나지 않는 일이라 코드 결함이 아니다."""
    global _LOCAL_DRM
    if _LOCAL_DRM is None:
        probe = Path(_TEST_ROOT) / "_drm_probe.pdf"
        # 실측: 평범한 PDF 는 내용은 그대로 읽히지만 크기가 +4096B 로 보이고, DRM 머리를 흉내 낸 내용은 빈 값으로 읽힌다
        data = b"HHIDRMC...."
        with open(probe, "wb") as fh:
            fh.write(data)
        with open(probe, "rb") as fh:
            _LOCAL_DRM = fh.read() != data
        probe.unlink(missing_ok=True)
    if _LOCAL_DRM:
        pytest.skip("로컬 DRM 이 .pdf 쓰기를 바꿔 이 PC 에서는 확인할 수 없음")


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


@pytest.fixture
def make_entry_file(db):
    """Entry(+배치) 와 파일 행을 한 번에 만든다(03 검색·추출 테스트 공용).

    entry 를 넘기면 그 Entry 에 파일만 더한다. 디스크에는 아무것도 쓰지 않는다 —
    디스크 파일이 필요한 테스트는 돌려받은 File 의 경로에 직접 쓴다."""
    from datetime import datetime

    from app import models

    seq = {"n": 0}

    def _make(*, entry=None, status="confirmed", title="구조 검토", hulls=("9999",), name="a.pdf",
              kind="report", uploaded_by="A100001", analysis_type=None, period=None, sha=None,
              location=None, confirmed_at=datetime(2026, 9, 1, 9, 0, 0)):
        seq["n"] += 1
        n = seq["n"]
        if entry is None:
            b = models.Batch(key=f"20260929-{n:06d}-test", source="inbox", original_name=title,
                             uploader=uploaded_by)
            db.add(b)
            db.flush()
            entry = models.Entry(title=title, status=status, batch_id=b.id, uploaded_by=uploaded_by,
                                 analysis_type=analysis_type, analysis_period=period,
                                 confirmed_at=confirmed_at if status == "confirmed" else None,
                                 confirmed_by=uploaded_by if status == "confirmed" else None)
            db.add(entry)
            db.flush()
            entry.entry_id = f"E{entry.id:06d}"
            if status in ("confirmed", "trashed"):
                entry.vault_rel = f"2026/{entry.entry_id}"
            for i, h in enumerate(hulls):
                db.add(models.EntryHull(entry_id=entry.id, hull_no=h, is_primary=(i == 0)))
                if status == "confirmed" and db.get(models.Hull, h) is None:
                    db.add(models.Hull(hull_no=h))
        loc = location or {"confirmed": "vault", "draft": "staging", "trashed": "trash"}[entry.status]
        ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
        f = models.File(batch_id=entry.batch_id, entry_id=entry.id, rel_path=name, name=name.split("/")[-1],
                        ext=ext, kind=kind, size=10, sha256=sha or f"{n:064d}", location=loc)
        db.add(f)
        db.commit()
        return entry, f

    return _make
