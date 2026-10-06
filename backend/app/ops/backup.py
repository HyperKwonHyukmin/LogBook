"""일일 백업(설계 §12) — mysqldump 출력을 gzip 해 공유 폴더 80_Backup 에 쓴다.

비밀번호는 명령줄 대신 MYSQL_PWD 환경변수로 넘긴다(프로세스 목록 노출 방지). 로그·예외에 남기지 않는다.
일일 백업(logbook-YYYYMMDD-HHMMSS.sql.gz)과 수동 백업(…-manual.sql.gz)은 보관 개수를 따로 센다."""
import gzip
import os
import subprocess
import tempfile
import threading
import time
from datetime import datetime

from ..config import settings
from ..storage.paths import StoragePaths, to_long

PREFIX = "logbook-"
SUFFIX = ".sql.gz"
MANUAL_TAG = "-manual"
CHUNK = 1024 * 1024
DUMP_TIMEOUT_SECONDS = 30 * 60   # 넘으면 mysqldump 를 끝낸다(멈춘 덤프가 워커를 붙잡지 않게)
TMP_MAX_AGE_SECONDS = 24 * 3600  # 이보다 오래된 .tmp 는 죽은 백업의 찌꺼기로 보고 지운다
# 덤프하지 않는 표 — 세션·내려받기 토큰은 짧게 사는 값이라 복원할 가치가 없다(models.py 의 __tablename__)
SKIP_TABLES = ("user_sessions", "download_tokens")


class BackupError(Exception):
    pass


def _mask(text: str) -> str:
    pw = settings.db_password
    return text.replace(pw, "***") if pw else text


def dump_args() -> list[str]:
    """mysqldump 인자(비밀번호 없음). --no-tablespaces 는 PROCESS 권한 없이 덤프하려고 넣는다."""
    db = settings.db_name
    return [settings.mysqldump_path, "--single-transaction", "--routines", "--no-tablespaces",
            "--default-character-set=utf8mb4",
            *(f"--ignore-table={db}.{t}" for t in SKIP_TABLES),
            "-h", settings.db_host, "-P", str(settings.db_port), "-u", settings.db_user, db]


def _run_dump(out) -> None:
    """mysqldump 를 돌려 표준출력을 out 에 흘려 쓴다(1MB 조각).

    stderr 는 임시 파일로 받는다 — 파이프로 받으면 stderr 가 가득 찼을 때 stdout 을 읽는
    쪽과 서로 기다리며 멈출 수 있다. DUMP_TIMEOUT_SECONDS 를 넘으면 프로세스를 끝낸다."""
    if not os.path.isfile(settings.mysqldump_path):
        raise BackupError("mysqldump_not_found")
    env = {**os.environ, "MYSQL_PWD": settings.db_password}
    with tempfile.TemporaryFile() as errf:
        proc = subprocess.Popen(dump_args(), stdout=subprocess.PIPE, stderr=errf, env=env)
        timed_out = threading.Event()

        def _kill() -> None:
            timed_out.set()
            try:
                proc.kill()
            except OSError:
                pass

        timer = threading.Timer(DUMP_TIMEOUT_SECONDS, _kill)
        timer.daemon = True
        timer.start()
        try:
            while chunk := proc.stdout.read(CHUNK):
                out.write(chunk)
            code = proc.wait()
        except BaseException:
            proc.kill()
            proc.wait()
            raise
        finally:
            timer.cancel()
            proc.stdout.close()
        if timed_out.is_set():
            raise BackupError("mysqldump_timeout")
        errf.seek(0)
        err = errf.read().decode("utf-8", errors="replace")
    if code != 0:
        raise BackupError(_mask(f"mysqldump 실패(종료 코드 {code}): {err[:500]}"))


def run_backup(storage: StoragePaths, *, runner=None, now: datetime | None = None, manual: bool = False) -> dict:
    """80_Backup\\logbook-YYYYMMDD-HHMMSS[-manual].sql.gz 를 만든다. 임시 파일에 쓰고 다 되면 바꿔 끼운다.

    runner 기본값은 실행 시점의 _run_dump 다(정의 시점에 묶지 않아 테스트가 갈아 끼울 수 있다)."""
    runner = runner or _run_dump
    now = now or datetime.now()
    name = f"{PREFIX}{now:%Y%m%d-%H%M%S}{MANUAL_TAG if manual else ''}{SUFFIX}"
    path = storage.backup / name
    tmp = path.with_name(name + ".tmp")
    os.makedirs(to_long(storage.backup), exist_ok=True)
    try:
        with open(to_long(tmp), "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", compresslevel=6) as gz:
            runner(gz)
        os.replace(to_long(tmp), to_long(path))
    except BaseException:
        try:
            os.remove(to_long(tmp))
        except OSError:
            pass
        raise
    return {"file": name, "size": os.path.getsize(to_long(path)), "at": now.replace(microsecond=0).isoformat()}


def prune_backups(storage: StoragePaths, keep: int, *, now: float | None = None) -> int:
    """일일·수동 백업을 각각 keep 개만 남기고(이름순 = 시각순) 오래된 것부터 지운다.
    하루가 지난 .tmp(죽은 백업의 찌꺼기)도 지운다."""
    try:
        names = os.listdir(to_long(storage.backup))
    except OSError:
        return 0
    backups = sorted(n for n in names if n.startswith(PREFIX) and n.endswith(SUFFIX))
    manual = [n for n in backups if n.endswith(MANUAL_TAG + SUFFIX)]
    daily = [n for n in backups if not n.endswith(MANUAL_TAG + SUFFIX)]
    doomed = [*daily[:max(0, len(daily) - keep)], *manual[:max(0, len(manual) - keep)]]
    limit = (now if now is not None else time.time()) - TMP_MAX_AGE_SECONDS
    for n in names:
        if n.startswith(PREFIX) and n.endswith(".tmp"):
            try:
                if os.path.getmtime(to_long(storage.backup / n)) < limit:
                    doomed.append(n)
            except OSError:
                pass
    removed = 0
    for n in doomed:
        try:
            os.remove(to_long(storage.backup / n))
            removed += 1
        except OSError:
            pass
    return removed
