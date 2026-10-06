import dataclasses
import gzip
import os
from datetime import datetime

import pytest

from app.ops.backup import BackupError, prune_backups, run_backup
from app.storage.paths import to_long


def fake_runner(out):
    out.write(b"-- MySQL dump\nCREATE TABLE x;\n")


def test_backup_writes_gz(storage):
    r = run_backup(storage, runner=fake_runner, now=datetime(2026, 10, 2, 2, 5, 0))
    assert r["file"] == "logbook-20261002-020500.sql.gz" and r["size"] > 0
    with open(to_long(storage.backup / r["file"]), "rb") as fh:
        assert gzip.decompress(fh.read()).startswith(b"-- MySQL dump")
    assert not any(n.endswith(".tmp") for n in os.listdir(to_long(storage.backup)))


def test_backup_failure_leaves_no_file(storage):
    def bad(out):
        out.write(b"partial")
        raise BackupError("dump failed")
    with pytest.raises(BackupError):
        run_backup(storage, runner=bad, now=datetime(2026, 10, 2, 2, 6, 0))
    assert os.listdir(to_long(storage.backup)) == []


def test_prune_keeps_newest(storage):
    for d in range(1, 6):
        run_backup(storage, runner=fake_runner, now=datetime(2026, 10, d, 2, 0, 0))
    removed = prune_backups(storage, keep=3)
    assert removed == 2
    assert sorted(os.listdir(to_long(storage.backup))) == [
        "logbook-20261003-020000.sql.gz", "logbook-20261004-020000.sql.gz", "logbook-20261005-020000.sql.gz"]


def test_missing_mysqldump(storage, monkeypatch):
    from app.ops import backup

    # Settings 는 frozen dataclass 라 모듈 전역 settings 를 바꾼 사본으로 갈아 끼운다
    monkeypatch.setattr(backup, "settings", dataclasses.replace(backup.settings,
                                                                mysqldump_path=r"C:\없는\mysqldump.exe"))
    with open(os.devnull, "wb") as out, pytest.raises(BackupError, match="mysqldump_not_found"):
        backup._run_dump(out)


class _FakeProc:
    """subprocess.Popen 대역 — 실제 mysqldump 를 부르지 않는다."""

    def __init__(self, args, stdout=None, stderr=None, env=None, **kw):
        import io

        _FakeProc.seen = {"args": args, "env": env, "kw": kw}
        self.stdout = io.BytesIO(b"-- dump body")
        if hasattr(stderr, "write"):  # 구현은 stderr 를 임시 파일로 받는다
            stderr.write(_FakeProc.err)
        self._code = _FakeProc.code

    def kill(self):
        pass

    def wait(self, timeout=None):
        return self._code


def _fake_settings(backup, tmp_path, password):
    exe = tmp_path / "mysqldump.exe"
    exe.write_bytes(b"")  # 존재 확인용 빈 파일(실행하지 않는다)
    return dataclasses.replace(backup.settings, mysqldump_path=str(exe), db_password=password,
                               db_user="u", db_host="h", db_port=3306, db_name="logbook_test")


def test_run_dump_password_only_in_env(tmp_path, monkeypatch):
    """비밀번호는 명령줄이 아니라 MYSQL_PWD 로만 넘어간다."""
    import io

    from app.ops import backup

    secret = "s3cr3t-합성"
    monkeypatch.setattr(backup, "settings", _fake_settings(backup, tmp_path, secret))
    _FakeProc.err, _FakeProc.code = b"", 0
    monkeypatch.setattr(backup.subprocess, "Popen", _FakeProc)
    out = io.BytesIO()
    backup._run_dump(out)
    assert out.getvalue() == b"-- dump body"
    assert all(secret not in str(a) for a in _FakeProc.seen["args"])
    assert "--single-transaction" in _FakeProc.seen["args"]
    assert _FakeProc.seen["env"]["MYSQL_PWD"] == secret


def test_run_dump_failure_masks_password(tmp_path, monkeypatch):
    import io

    from app.ops import backup

    secret = "s3cr3t-합성"
    monkeypatch.setattr(backup, "settings", _fake_settings(backup, tmp_path, secret))
    _FakeProc.err, _FakeProc.code = f"error near {secret}".encode(), 2
    monkeypatch.setattr(backup.subprocess, "Popen", _FakeProc)
    with pytest.raises(BackupError) as ei:
        backup._run_dump(io.BytesIO())
    assert secret not in str(ei.value) and "***" in str(ei.value)


def test_cli_backup(storage, monkeypatch, capsys):
    from app import cli
    from app.ops import backup

    monkeypatch.setattr(backup, "_run_dump", fake_runner)
    assert cli.main(["backup"]) == 0
    assert "백업 완료: logbook-" in capsys.readouterr().out
    assert any(n.endswith(".sql.gz") for n in os.listdir(to_long(storage.backup)))


def test_cli_backup_failure_exit_2(storage, monkeypatch, capsys):
    from app import cli
    from app.ops import backup

    def bad(out):
        raise BackupError("mysqldump_not_found")
    monkeypatch.setattr(backup, "_run_dump", bad)
    assert cli.main(["backup"]) == 2
    assert "오류: mysqldump_not_found" in capsys.readouterr().err


def test_dump_args_skip_privileged_and_short_lived(tmp_path, monkeypatch):
    """--no-tablespaces(PROCESS 권한 불필요) + 세션·내려받기 토큰 표 제외(리뷰 I1)."""
    from app import models
    from app.ops import backup

    monkeypatch.setattr(backup, "settings", _fake_settings(backup, tmp_path, "pw"))
    args = backup.dump_args()
    assert "--no-tablespaces" in args
    for t in (models.UserSession.__tablename__, models.DownloadToken.__tablename__):
        assert f"--ignore-table=logbook_test.{t}" in args
    assert all("pw" != a for a in args)


class _HangingProc:
    """끝나지 않는 덤프 — kill 해야 stdout 이 닫힌다."""

    def __init__(self, args, stdout=None, stderr=None, env=None, **kw):
        import threading

        self.killed = threading.Event()
        proc = self

        class _Out:
            def read(self, n):
                proc.killed.wait(5)
                return b""

            def close(self):
                pass

        self.stdout = _Out()

    def kill(self):
        self.killed.set()

    def wait(self, timeout=None):
        return -9


def test_run_dump_timeout_kills(tmp_path, monkeypatch):
    import io

    from app.ops import backup

    monkeypatch.setattr(backup, "settings", _fake_settings(backup, tmp_path, "pw"))
    monkeypatch.setattr(backup, "DUMP_TIMEOUT_SECONDS", 0.2)
    monkeypatch.setattr(backup.subprocess, "Popen", _HangingProc)
    with pytest.raises(BackupError, match="mysqldump_timeout"):
        backup._run_dump(io.BytesIO())


def test_manual_backups_kept_separately_and_old_tmp_removed(storage):
    import time

    for d in range(1, 5):
        run_backup(storage, runner=fake_runner, now=datetime(2026, 10, d, 2, 0, 0))
        run_backup(storage, runner=fake_runner, now=datetime(2026, 10, d, 9, 0, 0), manual=True)
    old_tmp = storage.backup / "logbook-20260901-020000.sql.gz.tmp"
    new_tmp = storage.backup / "logbook-20261005-020000.sql.gz.tmp"
    for p in (old_tmp, new_tmp):
        with open(to_long(p), "wb") as fh:
            fh.write(b"x")
    os.utime(to_long(old_tmp), (time.time() - 2 * 86400, time.time() - 2 * 86400))
    assert prune_backups(storage, keep=2) == 5
    assert sorted(os.listdir(to_long(storage.backup))) == [
        "logbook-20261003-020000.sql.gz", "logbook-20261003-090000-manual.sql.gz",
        "logbook-20261004-020000.sql.gz", "logbook-20261004-090000-manual.sql.gz",
        "logbook-20261005-020000.sql.gz.tmp"]
