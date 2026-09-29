import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import win32security

from owner_check import account_name, owner_info, collect_owners, main


def test_account_name_strips_domain_and_lowercases():
    assert account_name("HDRND\\A476854") == "a476854"


def test_account_name_without_domain():
    assert account_name("a476854") == "a476854"


def test_owner_info_local_file_returns_sid_and_owner(tmp_path):
    p = tmp_path / "x.txt"
    p.write_text("x")
    info = owner_info(str(p))
    assert info["sid"].startswith("S-1-")
    assert "\\" in info["owner"]
    assert info["account"] == account_name(info["owner"])
    assert info["lookup_error"] is None


def test_owner_info_records_orphan_sid_lookup_error(tmp_path, monkeypatch):
    """LookupAccountSid 만 실패해도(도메인에서 지워진 계정 등) sid 는 살아남는다."""
    p = tmp_path / "x.txt"
    p.write_text("x")
    import owner_check

    def boom(root, sid):
        raise Exception("no mapping between account names and security IDs was done")

    monkeypatch.setattr(owner_check.win32security, "LookupAccountSid", boom)
    info = owner_check.owner_info(str(p))
    assert info["sid"].startswith("S-1-")
    assert info["owner"] is None
    assert info["account"] is None
    assert info["is_user"] is False
    assert info["lookup_error"].startswith("Exception")


def test_owner_info_group_owner_is_not_user(tmp_path, monkeypatch):
    p = tmp_path / "x.txt"
    p.write_text("x")
    import owner_check

    monkeypatch.setattr(
        owner_check.win32security,
        "LookupAccountSid",
        lambda root, sid: ("Administrators", "BUILTIN", win32security.SidTypeAlias),
    )
    info = owner_check.owner_info(str(p))
    assert info["owner"] == "BUILTIN\\Administrators"
    assert info["sid_type"] == win32security.SidTypeAlias
    assert info["is_user"] is False


def test_owner_info_user_owner_is_user(tmp_path, monkeypatch):
    p = tmp_path / "x.txt"
    p.write_text("x")
    import owner_check

    monkeypatch.setattr(
        owner_check.win32security,
        "LookupAccountSid",
        lambda root, sid: ("A476854", "HDRND", win32security.SidTypeUser),
    )
    info = owner_check.owner_info(str(p))
    assert info["is_user"] is True
    assert info["account"] == "a476854"


def test_collect_owners_records_error_rows(tmp_path, monkeypatch):
    """GetFileSecurity 자체가 실패하는 파일(권한 없음 등)은 행으로만 남는다."""
    (tmp_path / "a.txt").write_text("a")
    import owner_check

    def boom(path):
        raise OSError("denied")

    monkeypatch.setattr(owner_check, "owner_info", boom)
    rows = collect_owners(str(tmp_path))
    assert rows[0]["owner"] is None
    assert rows[0]["error"].startswith("OSError")
    assert rows[0]["lookup_error"] is None  # 실패 행도 lookup_error 키는 항상 있다(None)


def test_collect_owners_success_row_always_has_error_key(tmp_path, monkeypatch):
    """성공 행에도 error 키가 항상 있다(None) — 실패 행과 스키마가 같아야 한다."""
    (tmp_path / "a.txt").write_text("a")
    import owner_check

    monkeypatch.setattr(
        owner_check,
        "owner_info",
        lambda path: {
            "sid": "S-1-5-21-1", "owner": "HDRND\\A1", "account": "a1",
            "sid_type": 1, "is_user": True, "lookup_error": None,
        },
    )
    rows = collect_owners(str(tmp_path))
    assert rows[0]["error"] is None
    assert rows[0]["lookup_error"] is None


def test_collect_owners_records_walk_errors_as_rows(tmp_path, monkeypatch):
    """os.walk 자체가 실패하는 하위 폴더(권한 없음 등)도 전체 실행을 죽이지 않고 행으로 남는다."""
    (tmp_path / "a.txt").write_text("a")
    import owner_check
    import os

    def fake_walk(folder, onerror=None, **kwargs):
        if onerror:
            onerror(OSError(13, "Permission denied", str(tmp_path / "blocked")))
        yield (str(tmp_path), [], ["a.txt"])

    monkeypatch.setattr(owner_check.os, "walk", fake_walk)
    monkeypatch.setattr(
        owner_check,
        "owner_info",
        lambda path: {
            "sid": "S-1-5-21-1", "owner": "HDRND\\A1", "account": "a1",
            "sid_type": 1, "is_user": True, "lookup_error": None,
        },
    )
    rows = collect_owners(str(tmp_path))
    walk_rows = [r for r in rows if (r.get("error") or "").startswith("walk")]
    assert len(walk_rows) == 1
    assert "blocked" in walk_rows[0]["path"]
    assert walk_rows[0]["owner"] is None
    assert walk_rows[0]["lookup_error"] is None
    assert walk_rows[0]["walk_error"] is True  # 2026-09-28 재재검토: 별도 표식
    file_rows = [r for r in rows if r["path"].endswith("a.txt")]
    assert len(file_rows) == 1
    assert file_rows[0]["walk_error"] is False


def test_summary_excludes_walk_errors_from_files_count(tmp_path, monkeypatch):
    """walk 실패는 특정 파일이 아니라 폴더 나열 자체의 실패라 summary.files(파일 수)에
    넣으면 안 된다 — 대신 walk_errors 로 따로 센다."""
    (tmp_path / "a.txt").write_text("a")
    import owner_check
    import os

    def fake_walk(folder, onerror=None, **kwargs):
        if onerror:
            onerror(OSError(13, "Permission denied", str(tmp_path / "blocked1")))
            onerror(OSError(13, "Permission denied", str(tmp_path / "blocked2")))
        yield (str(tmp_path), [], ["a.txt"])

    monkeypatch.setattr(owner_check.os, "walk", fake_walk)
    monkeypatch.setattr(
        owner_check,
        "owner_info",
        lambda path: {
            "sid": "S-1-5-21-1", "owner": "HDRND\\A1", "account": "a1",
            "sid_type": 1, "is_user": True, "lookup_error": None,
        },
    )
    rows = collect_owners(str(tmp_path))
    summary = owner_check.summarize(rows)
    assert len(rows) == 3  # 파일 1 + walk 오류 2
    assert summary["files"] == 1  # walk 오류는 파일 수에서 빠진다
    assert summary["walk_errors"] == 2
    assert summary["user_owned"] == 1


def test_main_writes_rows_and_summary(tmp_path, monkeypatch):
    (tmp_path / "a.txt").write_text("a")
    (tmp_path / "b.txt").write_text("b")
    import owner_check

    infos = iter([
        {"sid": "S-1-5-21-1", "owner": "HDRND\\A1", "account": "a1", "sid_type": 1, "is_user": True, "lookup_error": None},
        {"sid": "S-1-5-32-544", "owner": "BUILTIN\\Administrators", "account": "administrators", "sid_type": 4, "is_user": False, "lookup_error": None},
    ])
    monkeypatch.setattr(owner_check, "owner_info", lambda path: next(infos))

    out = tmp_path / "out" / "exp4.json"
    assert main([str(tmp_path), "-o", str(out)]) == 0

    data = json.loads(out.read_text(encoding="utf-8"))
    assert len(data["rows"]) == 2
    assert data["summary"] == {
        "files": 2, "user_owned": 1, "group_owned": 1, "orphaned_sid": 0, "read_failed": 0,
        "walk_errors": 0,
    }


def test_summary_splits_orphaned_sid_and_read_failed(tmp_path, monkeypatch):
    (tmp_path / "a.txt").write_text("a")
    (tmp_path / "b.txt").write_text("b")
    import owner_check

    infos = iter([
        {"sid": "S-1-5-21-1", "owner": None, "account": None, "sid_type": None,
         "is_user": False, "lookup_error": "Exception: no mapping"},  # orphan SID
        Exception("denied"),  # GetFileSecurity 자체 실패 → read_failed
    ])

    def fake_owner_info(path):
        v = next(infos)
        if isinstance(v, Exception):
            raise v
        return v

    monkeypatch.setattr(owner_check, "owner_info", fake_owner_info)
    rows = collect_owners(str(tmp_path))
    summary = owner_check.summarize(rows)
    assert summary["orphaned_sid"] == 1
    assert summary["read_failed"] == 1
    assert summary["user_owned"] == 0
