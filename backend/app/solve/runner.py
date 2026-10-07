"""Nastran 실행(06 §3) — `<exe> deck.bdf scr=yes old=no batch=no`, cwd = 임시 폴더.

- 실측(이 PC, MSC Nastran 2013.1): nastran.exe 는 해석이 끝날 때까지 기다렸다 돌아온다. `batch=no` 는 Windows 에서
  'This keyword is not available on this platform' 경고만 내고 무시된다(설계대로 넘기되 동작에는 영향 없음).
- 결과 파일 이름은 입력 이름을 소문자로 바꾼 것일 수 있다(실측: negE.bdf → nege.f06) — 대소문자 무시로 찾는다.
- 실행 중 heartbeat_seconds 마다 heartbeat() 를 부른다(워커가 job.updated_at 을 갱신해 '멈춘 작업' 복구에 안 걸리게).
- 제한 시간을 넘기면 프로세스 트리를 끝낸다(nastran.exe 가 해석 프로세스를 따로 띄운다).
"""
import os
import subprocess
import time
from dataclasses import dataclass
from typing import Callable, Protocol

HEARTBEAT_SECONDS = 60
OUTPUT_CHARS = 20_000      # 판정(라이선스 문구)에 쓰는 표준출력·.log 끝부분 길이


class NastranMissing(Exception):
    """Nastran 실행 파일이 없다."""


@dataclass
class RunResult:
    returncode: int | None
    timed_out: bool
    f06_path: str | None     # 없으면 None
    log_text: str            # 표준출력 + .log 끝부분(라이선스 실패 판정용)


class Runner(Protocol):
    def __call__(self, exe: str, workdir: str, deck_name: str, *, timeout: float,
                 heartbeat: Callable[[], None] | None = None) -> RunResult: ...


def find_output(workdir: str, deck_name: str, ext: str) -> str | None:
    """workdir 안의 '<deck 이름 stem>.<ext>' 를 대소문자 무시로 찾는다."""
    want = (os.path.splitext(deck_name)[0] + ext).casefold()
    try:
        for name in os.listdir(workdir):
            if name.casefold() == want:
                return os.path.join(workdir, name)
    except OSError:
        return None
    return None


def _tail(path: str | None, chars: int = OUTPUT_CHARS) -> str:
    if not path:
        return ""
    try:
        with open(path, "r", encoding="latin-1", errors="replace") as fh:
            return fh.read()[-chars:]
    except OSError:
        return ""


def kill_tree(proc: subprocess.Popen) -> None:
    """프로세스와 자식을 모두 끝낸다(Windows: taskkill /T /F)."""
    if os.name == "nt":
        try:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True, timeout=60,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except (OSError, subprocess.SubprocessError):
            pass
    try:
        proc.kill()
    except OSError:
        pass
    try:
        proc.wait(timeout=30)
    except subprocess.TimeoutExpired:
        pass


def run_nastran(exe: str, workdir: str, deck_name: str, *, timeout: float,
                heartbeat: Callable[[], None] | None = None,
                heartbeat_seconds: float = HEARTBEAT_SECONDS, clock: Callable[[], float] = time.monotonic) -> RunResult:
    """실제 Nastran 실행기. exe 가 없으면 NastranMissing."""
    if not exe or not os.path.isfile(exe):
        raise NastranMissing(exe or "")
    out_path = os.path.join(workdir, "_stdout.txt")
    started = clock()
    timed_out = False
    with open(out_path, "wb") as out:
        try:
            proc = subprocess.Popen([exe, deck_name, "scr=yes", "old=no", "batch=no"], cwd=workdir,
                                    stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT,
                                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except FileNotFoundError as exc:
            raise NastranMissing(exe) from exc
        while True:
            left = timeout - (clock() - started)
            if left <= 0:
                timed_out = True
                kill_tree(proc)
                break
            try:
                proc.wait(timeout=min(left, heartbeat_seconds))
                break
            except subprocess.TimeoutExpired:
                if heartbeat is not None:
                    heartbeat()
    log_text = _tail(out_path) + "\n" + _tail(find_output(workdir, deck_name, ".log"))
    return RunResult(returncode=proc.returncode, timed_out=timed_out,
                     f06_path=find_output(workdir, deck_name, ".f06"), log_text=log_text)
