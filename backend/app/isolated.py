"""무거운 외부 형식 처리(본문 추출·BDF 변환·보고서 OCR)를 자식 프로세스에서 시간 제한을 걸어 돌린다(리뷰 9).

워커는 프로세스 하나라, PyMuPDF·openpyxl·BDF 파서가 파일 하나에 멈추면 워커 전체가 영영 멈춘다
(recover_running 은 시작 때만 돌고, run-worker.ps1 은 프로세스가 끝나야 다시 띄운다). 그래서 무거운 부분만
자식 프로세스(spawn)에 맡기고, 제한 시간을 넘기면 자식을 프로세스 트리째 끝낸 뒤 HeavyTimeout 을 던진다.

- 자식은 하나를 계속 다시 쓴다(작업마다 새로 띄우면 Windows spawn·import 비용이 건마다 1~2초).
  멈췄거나 죽었으면 끝내고 다음 호출 때 새로 띄운다. RECYCLE_AFTER 건마다 새로 띄워 메모리 조각을 놓는다.
- 자식은 공유 폴더를 직접 읽고, 파생물(20_Derived)도 공유 폴더에 쓴다 — 로컬 C: 에 쓰면 회사 DRM 이 감싼다.
- timeout ≤ 0 이면 같은 프로세스에서 그대로 부른다(제한 없음 — 테스트·디버깅용, 예전 동작).
- 넘기는 함수·인자·결과는 pickle 된다 — 모듈 최상위 함수만 넘길 것.
"""
import logging
import multiprocessing
import os
import subprocess
import threading
from contextlib import contextmanager
from typing import Any, Callable

log = logging.getLogger(__name__)

RECYCLE_AFTER = 200      # 자식 하나가 처리할 최대 건수
BEAT_SECONDS = 60        # 기다리는 동안 박동 간격(긴 변환이 '멈춘 작업'·'워커 멈춤'으로 보이지 않게)


class HeavyTimeout(Exception):
    """제한 시간을 넘겨 자식 프로세스를 끝냈다. 다시 돌려도 같으므로 재시도하지 않는다."""

    def __init__(self, seconds: float):
        self.seconds = seconds
        minutes = max(1, round(seconds / 60))
        super().__init__(f"처리 시간이 {minutes}분을 넘어 중단했습니다")


class HeavyCrashed(RuntimeError):
    """자식 프로세스가 결과 없이 끝났다(메모리 부족으로 OS 가 죽인 경우 등). 작업 큐가 재시도한다."""


def _serve(conn) -> None:
    """자식 프로세스 본체 — (함수, 인자, 키워드) 를 받아 결과나 예외를 돌려준다."""
    while True:
        try:
            fn, args, kwargs = conn.recv()
        except (EOFError, OSError):
            return
        try:
            reply = ("ok", fn(*args, **kwargs))
        except BaseException as exc:  # noqa: BLE001 — 예외도 부모가 그대로 다시 던진다
            reply = ("err", exc)
        try:
            conn.send(reply)
        except Exception:  # noqa: BLE001 — 예외 객체가 pickle 되지 않으면 글로 바꿔 보낸다
            exc = reply[1] if reply[0] == "err" else None
            text = f"{type(exc).__name__}: {exc}" if exc is not None else "결과를 넘기지 못했습니다(pickle)"
            conn.send(("err", RuntimeError(text)))


def kill_pid_tree(pid: int) -> None:
    """프로세스와 그 자식(OCR·변환 도구)을 모두 끝낸다(Windows: taskkill /T /F — solve.runner.kill_tree 와 같은 방식)."""
    if os.name == "nt":
        try:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(pid)], capture_output=True, timeout=60,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except (OSError, subprocess.SubprocessError):
            pass


class IsolatedRunner:
    def __init__(self) -> None:
        self._proc = None
        self._conn = None
        self._served = 0
        self._lock = threading.Lock()   # 워커는 한 줄로 돌지만, 혹시 겹쳐 불려도 파이프를 섞지 않게

    def _start(self) -> None:
        ctx = multiprocessing.get_context("spawn")
        parent, child = ctx.Pipe()
        proc = ctx.Process(target=_serve, args=(child,), name="logbook-heavy", daemon=True)
        proc.start()
        child.close()
        self._proc, self._conn, self._served = proc, parent, 0

    def stop(self) -> None:
        proc, conn = self._proc, self._conn
        self._proc = self._conn = None
        if conn is not None:
            try:
                conn.close()
            except OSError:
                pass
        if proc is not None and proc.is_alive():
            kill_pid_tree(proc.pid)
            proc.kill()
        if proc is not None:
            proc.join(10)

    def run(self, fn: Callable, args: tuple = (), kwargs: dict | None = None, *, timeout: float,
            heartbeat: Callable[[], None] | None = None) -> Any:
        with self._lock:
            if self._proc is None or not self._proc.is_alive() or self._served >= RECYCLE_AFTER:
                self.stop()
                self._start()
            self._served += 1
            try:
                self._conn.send((fn, args, kwargs or {}))
            except (OSError, EOFError) as exc:
                self.stop()
                raise HeavyCrashed(f"처리 프로세스에 작업을 넘기지 못했습니다: {exc}") from exc
            waited = 0.0
            while True:
                step = min(BEAT_SECONDS, timeout - waited)
                if step <= 0:
                    log.error("무거운 처리 제한 시간 초과(%s초) — 자식 프로세스를 끝냄: %s", timeout,
                              getattr(fn, "__name__", fn))
                    self.stop()
                    raise HeavyTimeout(timeout)
                try:
                    ready = self._conn.poll(step)
                except (OSError, EOFError):
                    ready = True   # 끊겼다 — 아래 recv 가 원인을 드러낸다
                if ready:
                    break
                waited += step
                if heartbeat is not None:
                    heartbeat()
            try:
                status, value = self._conn.recv()
            except (OSError, EOFError) as exc:
                code = self._proc.exitcode if self._proc is not None else None
                self.stop()
                raise HeavyCrashed(f"처리 프로세스가 결과 없이 끝났습니다(종료 코드 {code})") from exc
        if status == "err":
            raise value
        return value


_runner = IsolatedRunner()
_heartbeat: Callable[[], None] | None = None


@contextmanager
def heartbeat_scope(beat: Callable[[], None] | None):
    """이 안에서 run() 이 기다리는 동안 beat 를 부른다(워커가 작업마다 걸어 둔다 — 함수 서명을 바꾸지 않으려고)."""
    global _heartbeat
    previous, _heartbeat = _heartbeat, beat
    try:
        yield
    finally:
        _heartbeat = previous


def run(fn: Callable, *args, timeout: float, **kwargs) -> Any:
    """fn(*args, **kwargs) 를 자식 프로세스에서 돌린다. timeout ≤ 0 이면 여기서 바로 부른다."""
    if not timeout or timeout <= 0:
        return fn(*args, **kwargs)
    return _runner.run(fn, args, kwargs, timeout=timeout, heartbeat=_heartbeat)


def shutdown() -> None:
    _runner.stop()
