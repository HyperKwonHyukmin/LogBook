import os
import stat

import pytest

from app.ingest import inbox


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def _watcher(storage, clock, owner="a476854"):
    return inbox.InboxWatcher(storage, stable_seconds=60, clock=clock, owner_of=lambda p: owner)


def test_folder_ready_only_after_stable_period(storage):
    d = storage.inbox / "3496_검토"
    d.mkdir()
    (d / "a.bdf").write_text("GRID", encoding="utf-8")
    clock = Clock()
    w = _watcher(storage, clock)
    assert w.poll() == []            # 처음 봄
    clock.t += 30
    assert w.poll() == []            # 아직 60초 안 됨
    clock.t += 31
    [item] = w.poll()
    assert (item.kind, item.name, item.owner) == ("folder", "3496_검토", "a476854")


def test_change_resets_stability(storage):
    d = storage.inbox / "x"
    d.mkdir()
    (d / "a.bdf").write_text("1", encoding="utf-8")
    clock = Clock()
    w = _watcher(storage, clock)
    w.poll()
    clock.t += 50
    (d / "b.bdf").write_text("2", encoding="utf-8")  # 복사 진행 중
    assert w.poll() == []
    clock.t += 59
    assert w.poll() == []
    clock.t += 2
    assert len(w.poll()) == 1


def test_loose_files_grouped_by_owner_and_time(storage):
    """묶음 판단은 워처가 '처음 본 시각'(주입된 시계) 기준이다 — 실제 파일 mtime
    (탐색기가 원본 수정 시각을 그대로 복사해 오므로 믿을 수 없다)이 아니다."""
    clock = Clock()
    w = _watcher(storage, clock)

    (storage.inbox / "3496_a.bdf").write_text("1", encoding="utf-8")
    w.poll()  # 3496_a.bdf 최초 관찰(first_seen=1000)

    clock.t = 1030
    (storage.inbox / "3496_a.f06").write_text("2", encoding="utf-8")
    w.poll()  # 3496_a.f06 최초 관찰(first_seen=1030)

    clock.t = 1900
    (storage.inbox / "다른날.pdf").write_text("3", encoding="utf-8")
    w.poll()  # 다른날.pdf 최초 관찰(first_seen=1900), 아직 아무것도 안정 안 됨

    clock.t = 1961  # 세 파일 모두 각자의 마지막 변경 이후 60초 이상 지남
    items = sorted(w.poll(), key=lambda i: len(i.paths))
    assert [len(i.paths) for i in items] == [1, 2]
    assert all(i.kind == "loose" for i in items)


def test_loose_grouping_holds_back_ready_file_for_pending_sibling(storage):
    """같은 소유자가 120초 안에 넣은 낱개 파일 중 하나가 아직 준비 안 됐으면,
    먼저 안정된 파일도 그 사이엔 내보내지 않는다(묶음이 쪼개지지 않게)."""
    clock = Clock()
    w = _watcher(storage, clock)

    (storage.inbox / "a.bdf").write_text("1", encoding="utf-8")
    w.poll()  # a.bdf first_seen=1000

    clock.t = 1060
    (storage.inbox / "b.bdf").write_text("2", encoding="utf-8")
    # 이 시점에 a.bdf 는 자기 기준으로는 이미 안정(60초 경과)됐지만, 같은 소유자의
    # b.bdf 가 방금 나타나 아직 준비되지 않았으므로 둘 다 보류돼야 한다.
    assert w.poll() == []

    clock.t = 1121  # b.bdf 도 안정됨(61초 경과)
    [item] = w.poll()
    assert sorted(p.name for p in item.paths) == ["a.bdf", "b.bdf"]


def test_reserved_and_excluded_names_skipped(storage):
    (storage.inbox / "_web").mkdir()
    (storage.inbox / "Thumbs.db").write_text("x", encoding="utf-8")
    clock = Clock()
    w = _watcher(storage, clock)
    w.poll()
    clock.t += 61
    assert w.poll() == []


def test_only_web_reserved_prefix_is_skipped(storage):
    """'_' 로 시작하는 이름 전부가 아니라 '_web' 만 예약이다."""
    (storage.inbox / "_web").mkdir()
    d = storage.inbox / "_archive"
    d.mkdir()
    (d / "a.bdf").write_text("GRID", encoding="utf-8")
    clock = Clock()
    w = _watcher(storage, clock)
    w.poll()
    clock.t += 61
    [item] = w.poll()
    assert item.name == "_archive"


def test_locked_file_is_not_ready(storage, monkeypatch):
    d = storage.inbox / "잠김"
    d.mkdir()
    (d / "a.bdf").write_text("x", encoding="utf-8")
    monkeypatch.setattr(inbox, "_all_writable", lambda paths: False)
    clock = Clock()
    w = _watcher(storage, clock)
    w.poll()
    clock.t += 61
    assert w.poll() == []


def test_readonly_file_becomes_ready(storage):
    d = storage.inbox / "읽기전용"
    d.mkdir()
    p = d / "a.bdf"
    p.write_text("GRID", encoding="utf-8")
    os.chmod(p, stat.S_IREAD)
    try:
        clock = Clock()
        w = _watcher(storage, clock)
        w.poll()
        clock.t += 61
        [item] = w.poll()
        assert item.name == "읽기전용"
    finally:
        os.chmod(p, stat.S_IWRITE)  # 정리(테스트 후 삭제 가능하도록)


def test_file_locked_by_other_handle_is_not_ready(storage):
    d = storage.inbox / "잠김2"
    d.mkdir()
    p = d / "a.bdf"
    p.write_text("GRID", encoding="utf-8")
    handle = open(p, "rb")
    try:
        clock = Clock()
        w = _watcher(storage, clock)
        w.poll()
        clock.t += 61
        assert w.poll() == []
    finally:
        handle.close()


def test_empty_folder_never_ready(storage):
    (storage.inbox / "빈폴더").mkdir()
    clock = Clock()
    w = _watcher(storage, clock)
    w.poll()
    clock.t += 61
    assert w.poll() == []


def test_folder_with_only_excluded_files_never_ready(storage):
    d = storage.inbox / "제외만"
    d.mkdir()
    (d / "Thumbs.db").write_text("x", encoding="utf-8")
    clock = Clock()
    w = _watcher(storage, clock)
    w.poll()
    clock.t += 61
    assert w.poll() == []


def test_folder_name_ending_in_dot_is_still_recognized(storage):
    from pathlib import Path

    from app.storage.paths import to_long

    name = "3496_검토."
    # to_long() 은 접두 없는 경로에 os.path.abspath() 를 거치는데, 그 안에서 쓰는
    # GetFullPathNameW 가 끝 점을 지워 버린다. 부모만 접두하고 이름은 손으로 이어붙여
    # 정규화를 한 번도 안 태운다(item 5 가 말하는 "이미 접두된 경로" 상태를 직접 만듦).
    long_path = to_long(storage.inbox) + "\\" + name
    try:
        os.mkdir(long_path)
    except OSError as exc:
        pytest.skip(f"끝에 점이 있는 폴더를 만들 수 없는 환경: {exc}")
    (Path(long_path) / "a.bdf").write_bytes(b"GRID")
    clock = Clock()
    w = _watcher(storage, clock)
    w.poll()
    clock.t += 61
    [item] = w.poll()
    assert item.name == name


def test_warns_once_when_folder_has_many_files(storage, monkeypatch, caplog):
    d = storage.inbox / "대량"
    d.mkdir()
    for i in range(3):
        (d / f"f{i}.bdf").write_bytes(b"x")
    monkeypatch.setattr(inbox, "FILE_COUNT_WARN_THRESHOLD", 2)
    clock = Clock()
    w = _watcher(storage, clock)
    with caplog.at_level("WARNING", logger=inbox.logger.name):
        w.poll()
        clock.t += 61
        w.poll()
        clock.t += 61
        w.poll()
    warnings = [r for r in caplog.records if "파일 수" in r.message]
    assert len(warnings) == 1


def test_group_loose_drops_vanished_files(storage):
    real = storage.inbox / "real.bdf"
    real.write_text("x", encoding="utf-8")
    gone = storage.inbox / "gone.bdf"  # 만들지 않음 — 그루핑 직전 사라진 상황 재현
    clock = Clock()
    w = _watcher(storage, clock)
    items = [
        {"path": real, "owner": "a476854", "first_seen": 1000, "ready": True},
        {"path": gone, "owner": "a476854", "first_seen": 1000, "ready": True},
    ]
    groups = w._group_loose(items)
    assert [p.name for g in groups for p in g.paths] == ["real.bdf"]
