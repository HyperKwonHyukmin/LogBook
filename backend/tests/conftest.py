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
# 15 — WorkBench 사용자 표는 테스트 DB 안의 가짜 표(wb_users)를 가리킨다. 실제 hitessworkbench 에 접속하지 않는다
WB_TABLE = "wb_users"
os.environ["LOGBOOK_WB_USERS_TABLE"] = f"{os.environ['LOGBOOK_DB_NAME']}.{WB_TABLE}"
# 22 — 보고서 본문 색인은 임시 폴더의 SQLite 를 쓰고(개발 PC 의 backend/.report-search 색인을 건드리지 않는다),
# Ollama 주소는 닫힌 포트로 돌린다(실수로 모의 없이 불러도 실제 서버에 닿지 않게 — 테스트는 모두 모의한다)
_REPORT_INDEX_DIR = tempfile.mkdtemp(prefix="logbook_test_report_index_")
atexit.register(shutil.rmtree, _REPORT_INDEX_DIR, True)
os.environ["LOGBOOK_REPORT_INDEX_PATH"] = os.path.join(_REPORT_INDEX_DIR, "index.sqlite3")
os.environ["LOGBOOK_REPORT_OLLAMA_URL"] = "http://127.0.0.1:9"
# 리뷰 9 — 본문 추출·BDF 변환은 운영에서 자식 프로세스(app.isolated)로 돈다. 테스트는 기본으로 같은 프로세스에서
# 돌린다(0) — 모의(monkeypatch)가 자식 프로세스에는 닿지 않는다. 자식 프로세스 경로는 test_isolated.py 가 따로 본다
os.environ["LOGBOOK_EXTRACT_TIMEOUT"] = "0"
os.environ["LOGBOOK_CONVERT_TIMEOUT"] = "0"

import pytest  # noqa: E402

from app import database  # noqa: E402
from app.config import settings  # noqa: E402

if not settings.db_name.endswith("_test"):
    raise RuntimeError(f"테스트 DB 이름은 _test 로 끝나야 합니다: {settings.db_name}")
if not database.engine.url.database.endswith("_test"):
    raise RuntimeError(f"엔진이 가리키는 DB 도 _test 로 끝나야 합니다: {database.engine.url.database}")
if settings.wb_users_table != f"{settings.db_name}.{WB_TABLE}":
    raise RuntimeError(f"WorkBench 사용자 표는 테스트 DB 의 가짜 표여야 합니다: {settings.wb_users_table}")

# WorkBench users 표와 같은 열(id, employee_id, name, company, department, position, is_active, is_admin,
# is_developer, login_count, last_login, created_at). 앱은 읽기만 하고, 이 표를 만들고 채우는 것은 테스트뿐이다
WB_DDL = (f"CREATE TABLE IF NOT EXISTS `{WB_TABLE}` (id INT AUTO_INCREMENT PRIMARY KEY, "
          "employee_id VARCHAR(50) NOT NULL UNIQUE, name VARCHAR(100), company VARCHAR(100), "
          "department VARCHAR(100), position VARCHAR(100), is_active TINYINT(1) NOT NULL DEFAULT 0, "
          "is_admin TINYINT(1) NOT NULL DEFAULT 0, is_developer TINYINT(1) NOT NULL DEFAULT 0, "
          "login_count INT NOT NULL DEFAULT 0, last_login DATETIME NULL, created_at DATETIME NULL) "
          "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")


def wb_put(employee_id, *, name="사용자", active=True, admin=False, department=None, position=None):
    """가짜 WorkBench 표에 사용자를 넣거나 고친다(테스트 전용 — 앱 코드는 이 표에 쓰지 않는다)."""
    from sqlalchemy import text

    from app import wb_users

    with database.engine.begin() as conn:
        conn.execute(text(
            f"INSERT INTO `{WB_TABLE}` (employee_id, name, department, position, is_active, is_admin) "
            "VALUES (:e, :n, :d, :p, :a, :m) ON DUPLICATE KEY UPDATE name = VALUES(name), "
            "department = VALUES(department), position = VALUES(position), is_active = VALUES(is_active), "
            "is_admin = VALUES(is_admin)"),
            {"e": employee_id, "n": name, "d": department, "p": position, "a": int(active), "m": int(admin)})
    wb_users.clear_cache()


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
def _clear_report_index_caches():
    """22 — 임베딩 모델 확인(60초)·벡터 행렬 캐시가 테스트 사이로 새지 않게 비운다."""
    from app.report_index import embeddings, store

    embeddings.clear_identity_cache()
    store.clear_vector_cache()
    yield
    embeddings.clear_identity_cache()
    store.clear_vector_cache()


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


# ── DB 초기화 ────────────────────────────────────────────────────────────────────────────────
# 예전에는 테스트마다 drop_all + create_all(표 26개, FULLTEXT ngram 색인 포함)을 해서 setup 이 테스트당
# ~1.5초였다(전체 1,019건 ~29분). 이제 스키마는 세션에 한 번만 만들고, 테스트 사이에는 '데이터만' 비운다.
#   - 행이 있거나 AUTO_INCREMENT 가 1 보다 큰 표만 골라 DELETE + AUTO_INCREMENT=1 (id·E000001 을 가정하는
#     테스트가 새 표와 똑같이 1번부터 받는다). FULLTEXT 표(file_texts)는 TRUNCATE — DELETE 만 하면 FTS 의
#     삭제 문서 표가 남아 순위(관련도) 계산이 새 표와 달라질 수 있다.
#   - 스키마를 바꾸는 테스트(ALTER TABLE·DROP INDEX·일부 표 drop 후 init_schema 등)는
#     @pytest.mark.fresh_schema 를 단다 → 그 테스트 앞뒤로 예전처럼 drop_all/create_all 한다.
#   - 안전망: 표시를 빠뜨린 테스트가 스키마를 바꿔도 테스트가 끝날 때 스키마 지문(열·색인·표 목록)을 비교해
#     달라졌으면 다시 만들고 경고를 남긴다(다음 테스트가 오염되지 않게).

def pytest_configure(config):
    config.addinivalue_line(
        "markers", "fresh_schema: 스키마를 바꾸는 테스트 — 앞뒤로 drop_all/create_all 로 표를 새로 만든다")


_SCHEMA: dict = {"fingerprint": None, "fulltext": frozenset()}


def _build_schema() -> None:
    """표를 전부 지우고 새로 만든다(Base 표 + 가짜 WorkBench 사용자 표). 지문도 다시 잰다."""
    from sqlalchemy import text

    from app import models, wb_users  # noqa: F401  (테이블 등록)

    database.Base.metadata.drop_all(database.engine)
    database.Base.metadata.create_all(database.engine)
    with database.engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS `{WB_TABLE}`"))
        conn.execute(text(WB_DDL))
    _SCHEMA["fingerprint"] = _schema_fingerprint()
    _SCHEMA["fulltext"] = frozenset(
        t for (t, _i, _s, _c, _u, kind) in _SCHEMA["fingerprint"][2] if kind == "FULLTEXT")


def _schema_fingerprint() -> tuple:
    """테스트 DB 의 표·열·색인 정의를 한 값으로 묶는다(information_schema 3회 조회, 수 ms)."""
    from sqlalchemy import text

    with database.engine.connect() as conn:
        tables = tuple(r[0] for r in conn.execute(text(
            "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() "
            "ORDER BY TABLE_NAME")))
        columns = tuple(tuple(r) for r in conn.execute(text(
            "SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA "
            "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
            "ORDER BY TABLE_NAME, ORDINAL_POSITION")))
        indexes = tuple(tuple(r) for r in conn.execute(text(
            "SELECT TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, NON_UNIQUE, INDEX_TYPE "
            "FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() "
            "ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX")))
        conn.rollback()
    return tables, columns, indexes


def _wipe_data() -> None:
    """모든 표(Base 밖의 표 포함)를 '새로 만든 표'와 같은 상태로 비운다 — 손댄 표만 골라서."""
    from sqlalchemy import text

    with database.engine.connect() as conn:
        # AUTO_INCREMENT 를 캐시(기본 24시간) 말고 엔진에서 바로 읽는다
        conn.execute(text("SET SESSION information_schema_stats_expiry = 0"))
        try:
            auto_inc = dict(conn.execute(text(
                "SELECT TABLE_NAME, AUTO_INCREMENT FROM information_schema.TABLES "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'")).all())
            if not auto_inc:
                return
            probe = " UNION ALL ".join(
                f"SELECT '{t}', EXISTS(SELECT 1 FROM `{t}`)" for t in sorted(auto_inc))
            has_rows = {t for t, e in conn.execute(text(probe)) if e}
            dirty = [t for t in sorted(auto_inc) if t in has_rows or (auto_inc[t] or 1) > 1]
            if not dirty:
                return
            conn.execute(text("SET FOREIGN_KEY_CHECKS = 0"))
            try:
                for t in dirty:
                    if t in _SCHEMA["fulltext"]:
                        conn.execute(text(f"TRUNCATE TABLE `{t}`"))
                        continue
                    if t in has_rows:
                        conn.execute(text(f"DELETE FROM `{t}`"))
                    if (auto_inc[t] or 1) > 1:
                        conn.commit()   # 빈 표가 된 뒤에야 1 로 내려간다
                        conn.execute(text(f"ALTER TABLE `{t}` AUTO_INCREMENT = 1"))
                conn.commit()
            finally:
                conn.execute(text("SET FOREIGN_KEY_CHECKS = 1"))
        finally:
            conn.execute(text("SET SESSION information_schema_stats_expiry = DEFAULT"))
            conn.commit()


@pytest.fixture(scope="session", autouse=True)
def _test_schema():
    """세션 시작 때 한 번만 스키마를 만든다."""
    _build_schema()
    yield


@pytest.fixture(autouse=True)
def clean_db(request, _test_schema):
    """테스트마다 데이터를 비운다(스키마는 세션 것을 그대로 쓴다). 15 — 가짜 WorkBench 사용자 표도 비운다.
    @pytest.mark.fresh_schema 테스트는 앞뒤로 표를 새로 만든다(위 'DB 초기화' 주석)."""
    import warnings

    from app import wb_users

    fresh = request.node.get_closest_marker("fresh_schema") is not None
    if fresh:
        _build_schema()
    else:
        _wipe_data()
    wb_users.clear_cache()
    yield
    wb_users.clear_cache()
    if fresh:
        _build_schema()
    elif _schema_fingerprint() != _SCHEMA["fingerprint"]:
        warnings.warn(f"{request.node.nodeid} 가 스키마를 바꿨다 — @pytest.mark.fresh_schema 를 달 것"
                      "(다음 테스트를 위해 표를 다시 만들었다)")
        _build_schema()


@pytest.fixture
def wb():
    """가짜 WorkBench 사용자 표에 넣기·고치기: wb(사번, name=, active=, admin=)."""
    return wb_put


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

    # 13 의 등급 이름 → 15 LV(이전 규칙과 같다)
    role_level = {"guest": 1, "member": 2, "viewer_all": 2, "admin": 3, "master": 3}

    def _make(employee_id="A100001", *, name="사용자", status="active", is_admin=False, role=None, level=None,
              wb_admin=False, wb_active=None):
        """LogBook 사용자 + 같은 사번의 가짜 WorkBench 사용자(15 — 로그인·매 요청 확인이 WorkBench 표를 본다).
        level 을 안 주면 role(13 이름) → is_admin(LV3) → LV2(예전 '승인된 일반 사용자'와 같은 열람 범위)."""
        if level is None:
            level = role_level[role] if role else (3 if is_admin else 2)
        u = models.User(employee_id=employee_id, name=name, status=status, level=level, wb_admin=wb_admin)
        db.add(u)
        db.commit()
        db.refresh(u)
        wb_put(employee_id, name=name, active=(status == "active") if wb_active is None else wb_active,
               admin=wb_admin)
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
        # 20 — BDF 자료는 호선·구역·해석 종류가 있어야 확정된다(확정 테스트용 기본값을 채워 둔다)
        e = models.Entry(title="3496 검토", status="draft", batch_id=b.id, uploaded_by=uploader,
                         analysis_type="강도 평가")
        db.add(e)
        db.flush()
        e.entry_id = f"E{e.id:06d}"
        db.add(models.EntryHull(entry_id=e.id, hull_no="3496", is_primary=True))
        zone = db.query(models.Tag).filter_by(kind="zone", value="선수부").first()
        if zone is None:
            zone = models.Tag(kind="zone", value="선수부")
            db.add(zone)
            db.flush()
        db.add(models.EntryTag(entry_id=e.id, tag_id=zone.id))
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
def fill_required(db):
    """20 — 초안에 확정 필수 분류(구역·해석 종류, 호선이 없으면 3496)를 채운다: fill_required(entry)."""
    from app import models
    from app.entries import service

    def _fill(entry, *, zone="선수부", analysis_type="강도 평가", hull="3496"):
        entry.analysis_type = analysis_type
        service.set_zones(db, entry, [zone])
        if hull and not service.hulls_of(db, entry) and not entry.no_hull:
            db.add(models.EntryHull(entry_id=entry.id, hull_no=hull, is_primary=True))
        db.commit()
        return entry

    return _fill


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
