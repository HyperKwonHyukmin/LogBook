"""2026-11-19 — Server Manager Update 순서: 서버가 도는 채로 git pull → 중지 → (pip) → 재시작.

예전에는 먼저 끄고 pull 해서 GitHub 에서 받는 시간만큼 검색이 멈춰 있었고(Update 직후 검색이 회색 줄로 한동안 멈춤),
pull 이 실패하면 서버가 꺼진 채로 남았다. 창(tkinter)은 띄우지 않고 가짜 self 로 _update_worker 만 돌린다."""
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server_manager  # noqa: E402

Manager = server_manager.LogbookManager


def _fake(pull_ok=True, req_changed=False):
    calls = []

    def after(_ms, fn, *args):
        fn(*args)   # 화면 스레드 대신 바로 실행

    me = SimpleNamespace(
        root=SimpleNamespace(after=after),
        _log=lambda *a: None,
        _get_git_hash=lambda: "abc1234",
        _run_cmd_capture=lambda cmd, cwd: (calls.append("pull") or (pull_ok, ["fatal: x"])),
        _stop_api=lambda: calls.append("stop_api"),
        _stop_children=lambda: calls.append("stop_children"),
        _requirements_changed=lambda: req_changed,
        _run_cmd=lambda cmd, cwd: calls.append("pip"),
        _post_update_start=lambda: calls.append("start"),
        _health_check_after_update=lambda: calls.append("health"),
        _finish_update=lambda: calls.append("finish"),
    )
    me._on_ui_and_wait = lambda fn, timeout=120: Manager._on_ui_and_wait(me, fn, timeout)
    return me, calls


def test_pull_before_stop(monkeypatch):
    monkeypatch.setattr(server_manager.time, "sleep", lambda s: None)
    me, calls = _fake()
    Manager._update_worker(me)
    assert calls == ["pull", "stop_api", "stop_children", "start", "health", "finish"]


def test_pip_after_stop_when_requirements_changed(monkeypatch):
    monkeypatch.setattr(server_manager.time, "sleep", lambda s: None)
    me, calls = _fake(req_changed=True)
    Manager._update_worker(me)
    assert calls == ["pull", "stop_api", "stop_children", "pip", "start", "health", "finish"]


def test_failed_pull_keeps_services_running(monkeypatch):
    monkeypatch.setattr(server_manager.time, "sleep", lambda s: None)
    me, calls = _fake(pull_ok=False)
    Manager._update_worker(me)
    assert calls == ["pull", "finish"]   # 끄지 않는다
