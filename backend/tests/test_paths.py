# backend/tests/test_paths.py
import concurrent.futures
import threading
import time

from app.storage import paths as paths_module
from app.storage.paths import LAYOUT, StoragePaths, to_long


def _wait_for_inflight(sp, timeout=2.0):
    """테스트가 끝나기 전에, 자신이 만든 in-flight future 가 실제로 끝나길 기다린다
    (모듈 공용 스레드풀 위로 sleep 중인 작업이 다음 테스트까지 새어 나가지 않게)."""
    entry = paths_module._inflight_futures.get(str(sp.root))
    if entry is not None:
        future = entry[0] if isinstance(entry, tuple) else entry
        future.result(timeout=timeout)


def test_to_long_unc():
    assert to_long(r"\\server\share\a") == r"\\?\UNC\server\share\a"


def test_to_long_local():
    assert to_long(r"C:\a\b") == r"\\?\C:\a\b"


def test_to_long_idempotent():
    assert to_long(r"\\?\UNC\server\share") == r"\\?\UNC\server\share"


def test_to_long_normalizes_relative_segments():
    assert to_long("C:/a/../b") == r"\\?\C:\b"


def test_layout_names_match_design():
    assert LAYOUT == ("00_Inbox", "10_Vault", "20_Derived", "80_Backup", "90_System", "95_Trash")


def test_ensure_layout_creates_all_folders(tmp_path):
    sp = StoragePaths(tmp_path)
    sp.ensure_layout()
    for name in LAYOUT:
        assert (tmp_path / name).is_dir()
    assert sp.audit_dir == tmp_path / "90_System" / "audit"
    assert sp.audit_dir.is_dir()
    assert sp.logs_dir.is_dir()


def test_is_reachable(tmp_path):
    assert StoragePaths(tmp_path).is_reachable() is True
    assert StoragePaths(tmp_path / "없는폴더").is_reachable() is False


def test_check_reachable_normal_case(tmp_path):
    assert StoragePaths(tmp_path).check_reachable() is True


def test_check_reachable_missing_path_is_false(tmp_path):
    assert StoragePaths(tmp_path / "없는폴더").check_reachable() is False


def test_check_reachable_times_out_on_dead_share(tmp_path, monkeypatch):
    def _slow(self):
        time.sleep(0.5)
        return True

    monkeypatch.setattr(StoragePaths, "is_reachable", _slow)
    sp = StoragePaths(tmp_path)
    start = time.monotonic()
    assert sp.check_reachable(timeout=0.1) is False
    assert time.monotonic() - start < 1.0
    _wait_for_inflight(sp)


def test_check_reachable_single_flight_per_root(tmp_path, monkeypatch):
    calls = {"n": 0}
    lock = threading.Lock()

    def _slow(self):
        with lock:
            calls["n"] += 1
        time.sleep(0.5)
        return True

    monkeypatch.setattr(StoragePaths, "is_reachable", _slow)
    sp = StoragePaths(tmp_path)

    results = []

    def _call():
        results.append(sp.check_reachable(timeout=0.1))

    threads = [threading.Thread(target=_call) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert calls["n"] == 1, "동시 호출이 같은 root 에 대해 job 을 여러 개 만들었다"
    assert results == [False] * 5
    _wait_for_inflight(sp)


def test_check_reachable_does_not_deadlock_on_already_done_future(tmp_path, monkeypatch):
    """add_done_callback 을 lock 안에서 부르면, 이미 끝난 Future 에 등록하는 순간
    콜백이 같은 스레드에서 동기 실행된다 — 그 콜백이 같은(재진입 불가) lock 을 다시
    잡으려 하면 영구 데드락이 난다. 데드락이 나도 테스트 자체는 멈추지 않도록
    별도 스레드 + join(timeout) 으로 관찰한다."""
    done_future = concurrent.futures.Future()
    done_future.set_result(True)
    monkeypatch.setattr(paths_module._reachability_executor, "submit", lambda fn, *a, **kw: done_future)

    sp = StoragePaths(tmp_path)
    outcome = {}

    def _call():
        outcome["value"] = sp.check_reachable(timeout=1.0)

    t = threading.Thread(target=_call, daemon=True)
    t.start()
    t.join(timeout=1.0)

    assert not t.is_alive(), "check_reachable() 이 1초 안에 반환하지 않았다 — 데드락"
    assert outcome.get("value") is True


def test_check_reachable_does_not_return_stale_true_while_stuck(tmp_path, monkeypatch):
    sp = StoragePaths(tmp_path)
    assert sp.check_reachable() is True  # 정상 캐시(True) 확립

    hang_event = threading.Event()

    def _hang(self):
        hang_event.wait(5.0)
        return True

    monkeypatch.setattr(StoragePaths, "is_reachable", _hang)

    # 캐시를 강제로 낡게 만들어(TTL 만료) 다음 호출이 새 job 을 띄우게 한다 —
    # 이 job 은 hang_event 가 set 되기 전까지 절대 안 끝난다(죽은 공유를 흉내).
    key = str(sp.root)
    paths_module._reachability_cache[key] = (time.monotonic() - 999, True)

    try:
        start = time.monotonic()
        assert sp.check_reachable(timeout=0.1) is False
        assert time.monotonic() - start < 1.0

        # 그 job 이 여전히 진행 중인 상태에서 또 호출 — 리뷰 전 코드는 여기서
        # 낡은 캐시(True) 를 그대로 돌려줬다. 지금은 False 여야 한다.
        assert sp.check_reachable(timeout=0.1) is False
    finally:
        hang_event.set()
        _wait_for_inflight(sp, timeout=2.0)


def test_check_reachable_worker_exception_is_false_not_raised(tmp_path, monkeypatch):
    def _boom(self):
        raise RuntimeError("stat 실패")

    monkeypatch.setattr(StoragePaths, "is_reachable", _boom)
    sp = StoragePaths(tmp_path)
    assert sp.check_reachable(timeout=1.0) is False
    _wait_for_inflight(sp)


def test_check_reachable_concurrent_followers_get_real_result_when_healthy(tmp_path, monkeypatch):
    """공유가 멀쩡하고 여러 요청이 우연히 겹쳤을 뿐이면, 편승한 호출도 실제 결과를
    받아야 한다 — 무조건 False 를 주면(이전 구현) 멀쩡한 공유가 잠깐 불안정해 보인다."""

    def _slow_ok(self):
        time.sleep(0.2)
        return True

    monkeypatch.setattr(StoragePaths, "is_reachable", _slow_ok)
    sp = StoragePaths(tmp_path)

    results = []

    def _call():
        results.append(sp.check_reachable(timeout=1.0))

    threads = [threading.Thread(target=_call) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert results == [True] * 5
    _wait_for_inflight(sp)


def test_check_reachable_treats_very_old_inflight_as_abandoned(tmp_path, monkeypatch):
    calls = {"n": 0}

    def _fast(self):
        calls["n"] += 1
        return True

    monkeypatch.setattr(StoragePaths, "is_reachable", _fast)
    sp = StoragePaths(tmp_path)
    key = str(sp.root)

    # 절대 안 끝나는 future 를 60초보다 더 전에 시작된 것처럼 등록해 '버려진 job' 을 흉내낸다.
    stuck_future = concurrent.futures.Future()
    paths_module._inflight_futures[key] = (stuck_future, time.monotonic() - 61)

    result = sp.check_reachable(timeout=0.5)

    assert result is True
    assert calls["n"] == 1, "버려진 job 을 새로 대체하지 않았다"
    _wait_for_inflight(sp)


def test_check_reachable_abandoned_replacement_is_still_single_flight(tmp_path, monkeypatch):
    calls = {"n": 0}
    lock = threading.Lock()

    def _slow_ok(self):
        with lock:
            calls["n"] += 1
        time.sleep(0.2)
        return True

    monkeypatch.setattr(StoragePaths, "is_reachable", _slow_ok)
    sp = StoragePaths(tmp_path)
    key = str(sp.root)

    stuck_future = concurrent.futures.Future()
    paths_module._inflight_futures[key] = (stuck_future, time.monotonic() - 61)

    results = []

    def _call():
        results.append(sp.check_reachable(timeout=1.0))

    threads = [threading.Thread(target=_call) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert calls["n"] == 1, "버려진 job 교체가 동시 호출 중 여러 번 일어났다"
    assert results == [True] * 5
    _wait_for_inflight(sp)


def test_check_reachable_uses_ttl_cache(tmp_path, monkeypatch):
    calls = {"n": 0}

    def _counting(self):
        calls["n"] += 1
        return True

    monkeypatch.setattr(StoragePaths, "is_reachable", _counting)
    sp = StoragePaths(tmp_path)
    assert sp.check_reachable() is True
    assert sp.check_reachable() is True
    assert calls["n"] == 1
