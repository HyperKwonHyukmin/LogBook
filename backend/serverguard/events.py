"""감시 계층 공용 이벤트 로그.

JSONL 파일에 append 한다. 상태가 '바뀐 순간'만 기록하므로 정상 운영 시 하루
수 줄 수준으로 유지된다.
"""
import json
from datetime import datetime, timedelta
from pathlib import Path

EVENTS_FILENAME = "server_events.jsonl"
UVICORN_SUBDIR = "uvicorn"
RETENTION_DAYS = 30


def append_event(log_dir, src, event, detail=None, *, now=None):
    """이벤트 한 줄을 JSONL 로 append 하고 기록된 dict 를 반환한다.

    로그 기록 실패가 감시·복구를 막아서는 안 되므로 어떤 예외도 밖으로 내보내지 않는다.
    """
    now = now or datetime.now().astimezone()
    record = {
        "ts": now.astimezone().isoformat(timespec="seconds"),
        "src": src,
        "event": event,
        "detail": detail or {},
    }
    try:
        path = Path(log_dir)
        path.mkdir(parents=True, exist_ok=True)
        with open(path / EVENTS_FILENAME, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass
    return record


def read_events(log_dir):
    """이벤트를 기록 순서(오래된 것 → 최신)로 반환한다. 손상된 줄은 건너뛴다."""
    path = Path(log_dir) / EVENTS_FILENAME
    if not path.exists():
        return []
    records = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except (ValueError, TypeError):
                continue
    return records


def prune_events(log_dir, retention_days=RETENTION_DAYS, *, now=None):
    """보존 기간이 지난 이벤트를 제거하고 삭제된 줄 수를 반환한다."""
    try:
        path = Path(log_dir) / EVENTS_FILENAME
        if not path.exists():
            return 0

        now = (now or datetime.now()).astimezone()
        cutoff = now - timedelta(days=retention_days)

        kept, removed = [], 0
        for record in read_events(log_dir):
            try:
                ts = datetime.fromisoformat(record["ts"])
            except (KeyError, ValueError, TypeError):
                kept.append(record)
                continue
            if ts < cutoff:
                removed += 1
            else:
                kept.append(record)

        if removed:
            with open(path, "w", encoding="utf-8") as fh:
                for record in kept:
                    fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        return removed
    except Exception:
        return 0


def prune_uvicorn_logs(log_dir, retention_days=RETENTION_DAYS, *, now=None):
    """보존 기간이 지난 일자별 로그 파일을 삭제하고 삭제 개수를 반환한다."""
    directory = Path(log_dir) / UVICORN_SUBDIR
    if not directory.exists():
        return 0

    now = now or datetime.now()
    cutoff = (now - timedelta(days=retention_days)).strftime("%Y%m%d")

    removed = 0
    for entry in directory.glob("*.log"):
        if entry.stem < cutoff:
            try:
                entry.unlink()
                removed += 1
            except OSError:
                continue
    return removed


class DailyLogWriter:
    """stdout 을 날짜별 파일에 보존한다.

    GUI 텍스트 위젯만으로는 앱을 닫으면 크래시 직전 traceback 이 사라지므로,
    줄마다 flush 해 프로세스가 급사해도 마지막 줄이 디스크에 남게 한다.
    """

    def __init__(self, log_dir, subdir=UVICORN_SUBDIR):
        self.dir = Path(log_dir) / subdir
        self._stamp = None
        self._fh = None

    def write(self, line, *, now=None):
        now = now or datetime.now()
        stamp = now.strftime("%Y%m%d")
        try:
            if stamp != self._stamp:
                self.close()
                self.dir.mkdir(parents=True, exist_ok=True)
                self._fh = open(self.dir / f"{stamp}.log", "a", encoding="utf-8")
                self._stamp = stamp
            self._fh.write(f"{now.strftime('%H:%M:%S')} {line}\n")
            self._fh.flush()
        except Exception:
            pass

    def close(self):
        if self._fh is not None:
            try:
                self._fh.close()
            except Exception:
                pass
        self._fh = None
        self._stamp = None
