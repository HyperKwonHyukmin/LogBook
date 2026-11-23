"""Hi-TESS LogBook 앱 팩토리. API(/api/*)와 빌드된 프론트를 같은 출처(포트 9095)로 서빙한다.

실행 (backend 폴더): .venv\\Scripts\\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 9095
"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from . import models  # noqa: F401  (테이블 등록)
from .config import APP_VERSION, settings
from .database import SessionLocal, init_schema
from .dependencies import get_storage
from .routers import admin_cleanup, admin_ops, admin_stats, auth, batches, compares, entries, favorites, files, hulls, integration, revisions, search, solve, suggest, system, uploads, users
from .routers import tags as tags_router
from .routers import coverage as coverage_router
from .routers import graph as graph_router
from .routers import similar as similar_router
from .routers import draft_attachments as draft_attachments_router
from .routers import vocab as vocab_router
from .routers import wb_targets as wb_targets_router
from .routers import reports as reports_router
from .routers import people as people_router
from .routers import comments as comments_router
from .routers import notes as notes_router
from .routers import updates as updates_router
from .routers import inbox as inbox_router
from .routers import targets as targets_router
from .spa import mount_spa
from .vocab import safe_seed
from .wb_targets import safe_seed as safe_seed_wb_rules

log = logging.getLogger("logbook")

_USE_DEFAULT = object()


def _quiet_connection_reset(loop) -> None:
    """Windows asyncio(Proactor)가 브라우저가 먼저 끊은 연결을 정리하며 남기는 WinError 10054 기록만 넘긴다.
    응답은 이미 끝난 뒤라 무해한데, 화면 폴링·새로고침마다 [API] 로그를 덮는다(README '145 서버'). 다른 예외는 그대로."""
    previous = loop.get_exception_handler()

    def handler(lp, context):
        exc = context.get("exception")
        if isinstance(exc, ConnectionResetError) and "_call_connection_lost" in str(context.get("handle", "")):
            return
        if previous is not None:
            previous(lp, context)
        else:
            lp.default_exception_handler(context)

    loop.set_exception_handler(handler)


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio

    _quiet_connection_reset(asyncio.get_running_loop())
    added = init_schema()
    if added:
        log.info("기존 표에 열을 더했습니다: %s", ", ".join(added))
    try:
        get_storage().ensure_layout()
    except OSError as exc:  # 공유 폴더가 끊겨도 기동은 한다(화면에 연결 끊김 표시)
        log.warning("저장소 폴더 준비 실패: %s", exc)
    # 08 — 분류 목록(구역·대상)이 비어 있으면 기본 목록을 넣는다(이미 있으면 아무것도 안 함)
    db = SessionLocal()
    try:
        safe_seed(db, get_storage())
        # 18-b — WorkBench 보내기 기본 규칙(truss = 태그 'Truss'). 행이 없을 때만 넣는다
        safe_seed_wb_rules(db, get_storage())
    finally:
        db.close()
    _start_report_features_warmup()
    yield


def _start_report_features_warmup() -> None:
    """관계 지도의 문서 관계(32)에 쓰는 보고서 본문 특징을 서버 시작 직후 백그라운드에서 미리 계산한다.
    안 하면 재시작 뒤 관계 지도를 처음 연 사람이 약 30초 기다린다(report_index.features.warm).
    LOGBOOK_GRAPH_WARMUP=0 이면 끈다(테스트). 실패해도 기동·화면에는 영향이 없다 — 그때는 첫 요청이 계산한다.
    2026-11-19 — 업데이트 직후 검색이 느리다는 신고로 60초 뒤에 시작하고 끊어 쉬며 계산하게 했지만 풀리지 않았다(오히려 Update 뒤
    1분쯤 화면을 여는 때와 겹쳤다). 2026-11-23 — 원인은 이 프로세스 안의 파이썬 계산이 잠금(GIL)을 쥐는 것이라 계산을 별도 프로세스로
    옮겼다(features.CHILD_MIN). 시작은 LOGBOOK_GRAPH_WARMUP_DELAY 초(기본 5) 뒤."""
    import os
    import threading
    import time

    if os.getenv("LOGBOOK_GRAPH_WARMUP", "1").strip().lower() in ("0", "false", "no"):
        return

    try:
        delay = max(0.0, float(os.getenv("LOGBOOK_GRAPH_WARMUP_DELAY", "5")))
    except ValueError:
        delay = 5.0

    def run():
        from .report_index import features as report_features
        from .routers.reports import get_report_index

        time.sleep(delay)
        started = time.perf_counter()
        try:
            count = report_features.warm(get_report_index())
            log.info("보고서 본문 특징 미리 계산: %d건, %.1f초", count, time.perf_counter() - started)
        except Exception:  # noqa: BLE001
            log.warning("보고서 본문 특징 미리 계산 실패 — 첫 관계 지도 요청이 계산합니다", exc_info=True)

    threading.Thread(target=run, name="report-features-warmup", daemon=True).start()


def create_app(frontend_dist: Path | None | object = _USE_DEFAULT) -> FastAPI:
    app = FastAPI(title="Hi-TESS LogBook", version=APP_VERSION, lifespan=lifespan)
    app.include_router(auth.router)
    app.include_router(auth.page_router)   # 55 — /auth/windows, SPA 보다 먼저
    app.include_router(users.router)
    app.include_router(system.router)
    app.include_router(batches.router)
    app.include_router(inbox_router.router)   # 68 — 올리기와 확정 줄 목록
    app.include_router(targets_router.router)   # 69 — 업무별 모음
    app.include_router(entries.router)
    app.include_router(people_router.router)   # 46 — 담당자 명부
    app.include_router(draft_attachments_router.router)
    app.include_router(uploads.router)
    app.include_router(suggest.router)
    app.include_router(search.router)
    app.include_router(reports_router.router)   # 21·22 — 보고서 목록·본문 검색·색인 상태·근거 요약
    app.include_router(favorites.router)
    app.include_router(comments_router.router)   # 63 — 자료 의견과 이슈
    app.include_router(notes_router.router)      # 64 — 나의 메모
    app.include_router(compares.router)
    app.include_router(hulls.router)
    app.include_router(graph_router.router)   # 25 — 관계 지도
    app.include_router(coverage_router.router)   # 26 — 갖춤 현황
    app.include_router(similar_router.router)    # 27 — 선례 찾기
    app.include_router(revisions.router)   # 14 — /files/{a}/diff/{b} 가 files 의 /{file_id} 보다 먼저
    app.include_router(files.router)
    app.include_router(solve.router)
    app.include_router(tags_router.router)
    app.include_router(vocab_router.router)
    app.include_router(admin_ops.router)
    app.include_router(admin_cleanup.router)   # 20 — 자료 정비(필수 분류·제목 형식)
    app.include_router(admin_stats.router)     # 57 — 자료 현황·자료 목록(LV3)
    # 18 — WorkBench 연동: 서버 간 API(/api/integration/*) + 자동 로그인(/sso, SPA 보다 먼저)
    app.include_router(integration.router)
    app.include_router(integration.sso_router)
    # 18-b — WorkBench 앱별 보내기 제한(분류 규칙)
    app.include_router(wb_targets_router.router)
    app.include_router(wb_targets_router.admin_router)
    dist = settings.frontend_dist if frontend_dist is _USE_DEFAULT else frontend_dist
    app.include_router(updates_router.router)   # 46 — 개선·업데이트 이력(/updates, LV3)
    mount_spa(app, dist)  # 반드시 마지막 — 나머지 경로를 index.html 로 받는다
    return app


app = create_app()
