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
from .routers import auth, batches, entries, system, users
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
    app.include_router(users.router)
    app.include_router(system.router)
    app.include_router(batches.router)
    app.include_router(entries.router)
    dist = settings.frontend_dist if frontend_dist is _USE_DEFAULT else frontend_dist
    mount_spa(app, dist)  # 반드시 마지막 — 나머지 경로를 index.html 로 받는다
    return app


app = create_app()
