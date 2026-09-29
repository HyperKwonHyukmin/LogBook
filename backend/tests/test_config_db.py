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
