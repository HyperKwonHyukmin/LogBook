"""2026-11-23 — MySQL 1213 교착은 다시 시도하면 되는 오류다(MySQL 안내). 확정 API 는 한 번 더 시도한다.
확정은 파일을 먼저 옮기지만 move_all 이 멱등이라(이미 옮긴 파일은 옮긴 것으로 봄) 다시 시도해도 안전하다."""
import pymysql
import pytest
from sqlalchemy.exc import OperationalError

from app.entries import service


def _deadlock():
    return OperationalError("UPDATE files ...", {}, pymysql.err.OperationalError(1213, "Deadlock found when trying to get lock"))


class _Db:
    def __init__(self):
        self.rollbacks = 0

    def rollback(self):
        self.rollbacks += 1


def test_retries_deadlock_then_succeeds(monkeypatch):
    monkeypatch.setattr(service.time, "sleep", lambda s: None)
    db, calls = _Db(), []

    def fn():
        calls.append(1)
        if len(calls) == 1:
            raise _deadlock()
        return "ok"

    assert service.with_deadlock_retry(db, fn) == "ok"
    assert len(calls) == 2 and db.rollbacks == 1


def test_other_operational_errors_are_not_retried(monkeypatch):
    monkeypatch.setattr(service.time, "sleep", lambda s: None)
    db, calls = _Db(), []

    def fn():
        calls.append(1)
        raise OperationalError("x", {}, pymysql.err.OperationalError(2013, "Lost connection"))

    with pytest.raises(OperationalError):
        service.with_deadlock_retry(db, fn)
    assert len(calls) == 1


def test_gives_up_after_attempts(monkeypatch):
    monkeypatch.setattr(service.time, "sleep", lambda s: None)
    db, calls = _Db(), []

    def fn():
        calls.append(1)
        raise _deadlock()

    with pytest.raises(OperationalError):
        service.with_deadlock_retry(db, fn, attempts=3)
    assert len(calls) == 3
