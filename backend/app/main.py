"""Logbook 앱 팩토리. API(/api/*)와 빌드된 프론트를 같은 출처(포트 9095)로 서빙한다.

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
from .routers import admin_ops, auth, batches, entries, files, hulls, search, solve, suggest, system, uploads, users
from .routers import tags as tags_router
from .routers import vocab as vocab_router
from .spa import mount_spa
from .vocab import safe_seed

log = logging.getLogger("logbook")

_USE_DEFAULT = object()


@asynccontextmanager
async def lifespan(app: FastAPI):
    added = init_schema()
    if added:
        log.info("기존 표에 열을 더했습니다: %s", ", ".join(added))
    try:
        get_storage().ensure_layout()
    except OSError as exc:  # 공유 폴더가 끊겨도 기동은 한다(화면에 연결 끊김 표시)
        log.warning("저장소 폴더 준비 실패: %s", exc)
    # 08 — 분류 목록(해석 종류·구역)이 비어 있으면 기본 목록을 넣는다(이미 있으면 아무것도 안 함)
    db = SessionLocal()
    try:
        safe_seed(db, get_storage())
    finally:
        db.close()
    yield


def create_app(frontend_dist: Path | None | object = _USE_DEFAULT) -> FastAPI:
    app = FastAPI(title="Logbook", version=APP_VERSION, lifespan=lifespan)
    app.include_router(auth.router)
    app.include_router(users.router)
    app.include_router(system.router)
    app.include_router(batches.router)
    app.include_router(entries.router)
    app.include_router(uploads.router)
    app.include_router(suggest.router)
    app.include_router(search.router)
    app.include_router(hulls.router)
    app.include_router(files.router)
    app.include_router(solve.router)
    app.include_router(tags_router.router)
    app.include_router(vocab_router.router)
    app.include_router(admin_ops.router)
    dist = settings.frontend_dist if frontend_dist is _USE_DEFAULT else frontend_dist
    mount_spa(app, dist)  # 반드시 마지막 — 나머지 경로를 index.html 로 받는다
    return app


app = create_app()
