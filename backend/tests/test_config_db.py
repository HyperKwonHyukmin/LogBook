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


def test_ensure_columns_adds_missing_column_idempotently():
    """04c: create_all 은 기존 표에 열을 더하지 않는다 — 04c 이전 DB(model_summaries 에 format_version 없음)에
    init_schema 가 열을 더하고, 두 번째 부르면 아무것도 하지 않는다."""
    from sqlalchemy import inspect, text

    from app import database

    def columns():
        return {c["name"] for c in inspect(database.engine).get_columns("model_summaries")}

    with database.engine.begin() as conn:
        conn.execute(text("ALTER TABLE model_summaries DROP COLUMN format_version"))
    assert "format_version" not in columns()
    assert database.init_schema() == ["model_summaries.format_version"]
    assert "format_version" in columns()
    assert database.init_schema() == []
    assert database.ensure_columns() == []
