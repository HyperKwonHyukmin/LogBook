# backend/app/storage/paths.py
"""999_LogBook 폴더 구조와 경로 규칙.

⚠ 모든 파일 접근은 to_long() 을 거친다. PoC 실험 7에서 LongPathsEnabled=0 인 PC 는
260자를 넘는 경로를 접두사 없이 열지 못함이 확인됐다(설계 §9).
"""
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from dataclasses import dataclass
from pathlib import Path

LAYOUT = ("00_Inbox", "10_Vault", "20_Derived", "80_Backup", "90_System", "95_Trash")

# health 체크가 죽은 공유 폴더(SMB)에 물려 요청을 붙잡지 않도록, is_reachable() 을
# 별도 스레드에서 돌리고 timeout 안에 안 끝나면 False 로 포기한다. 결과는 루트 경로
# 기준으로 짧게(TTL) 캐싱해 매 health 호출마다 파일시스템을 두드리지 않는다.
#
# ⚠ single-flight: 같은 root 로 동시에 여러 요청이 들어와도 job 은 하나만 돌린다.
# 이미 진행 중인 job 이 있으면 새로 submit 하지 않고 그 job 에 편승해 — '이 호출의
# timeout 에서 이미 지난 시간'을 뺀 나머지만큼만 같이 기다린다. 공유가 멀쩡한데
# 우연히 여러 요청이 겹쳤을 뿐이라면, 편승한 호출도 진짜 결과(True)를 받는다.
# 이미 이 호출의 timeout 만큼(또는 그 이상) 진행된 job 이면 더 기다리지 않고 즉시
# False 를 돌려준다 — 죽은 공유의 '마지막으로 살아있었을 때' 값을 True 로 우겨
# 돌려주지 않기 위해서다(여기 도달했다는 것 자체가 위 TTL 검사에서 신선한 캐시가
# 없다고 이미 판정됐다는 뜻이다). 60초가 넘도록 안 끝난 job 은 완전히 버려진 것으로
# 보고 새로 다시 시작한다 — lock 이 순서를 정해 주므로, 같은 순간 뒤이어 들어온
# 호출들은 이미 교체된 새 job 하나에만 편승하고, root 하나당 재시도는 한 번만 만들어진다.
_reachability_executor = ThreadPoolExecutor(max_workers=2)
_reachability_cache: dict[str, tuple[float, bool]] = {}
_REACHABILITY_TTL_SECONDS = 5.0
_REACHABILITY_ABANDONED_AFTER_SECONDS = 60.0
_reachability_lock = threading.Lock()
# 값은 (future, 시작 시각) 튜플.
_inflight_futures: dict[str, tuple] = {}


def _on_reachability_done(key: str, future) -> None:
    """백그라운드 job 이 실제로 끝났을 때 호출된다 — 기다리던 호출이 timeout 으로
    먼저 포기했더라도, 이 콜백이 최종 결과로 캐시를 갱신하고 in-flight 표시를 지운다.

    ⚠ 반드시 _reachability_lock 을 들고 있지 *않은* 상태에서 add_done_callback() 에
    등록돼야 한다. concurrent.futures 는 콜백 등록 시점에 future 가 이미 끝나 있으면
    등록한 스레드에서 그 자리(동기)로 콜백을 실행한다 — 호출자가 lock 을 쥔 채
    add_done_callback() 을 불렀다면, 이 함수가 같은(재진입 불가) lock 을 다시 얻으려다
    자기 자신과 데드락에 빠진다(이미 끝난 future 를 강제로 넘기는 테스트로 재현됨. 워커가
    거의 즉시 끝나는 경우 — 예외를 바로 던지는 경우 — 는 타이밍에 따라 원래 있던 요청
    경로에서도 우연히 재현될 수 있었다).
    """
    with _reachability_lock:
        entry = _inflight_futures.get(key)
        if entry is not None and entry[0] is future:
            del _inflight_futures[key]
    try:
        result = future.result()
    except Exception:
        result = False
    _reachability_cache[key] = (time.monotonic(), result)


def long_join(base: str | os.PathLike, rel_posix: str) -> str:
    r"""to_long(base) 뒤에 rel_posix('/' 로 구분된 POSIX 스타일 상대경로)의 조각을
    그대로 이어 붙인다 — to_long() 은 base 에만 걸리고 rel 조각은 GetFullPathNameW 를
    (즉 abspath 를) 다시 타지 않으므로, 끝에 공백·점이 있는 이름도 잘려 나가지 않는다.

    ⚠ os.path.relpath()·Path(*PurePosixPath(rel).parts) 뒤에 to_long() 을 부르는 패턴은
    이미 만들어진(공백·점 있는) rel 문자열을 다시 정규화해 버린다 — 그 함정을 피하려고
    이 함수가 있다. '..'·'.'· 빈 조각·드라이브 또는 절대경로 조각은 거부한다(ValueError,
    다른 배치·상위 폴더로 새는 경로 조작 방지).
    """
    parts = rel_posix.split("/")
    for part in parts:
        if part in ("", ".", ".."):
            raise ValueError(f"안전하지 않은 경로 조각: {part!r} (전체: {rel_posix!r})")
        if ":" in part or part.startswith("\\"):
            raise ValueError(f"안전하지 않은 경로 조각: {part!r} (전체: {rel_posix!r})")
    return to_long(base) + "\\" + "\\".join(parts)


def to_long(p: str | os.PathLike) -> str:
    """Windows 긴 경로 접두사를 붙인다(UNC·로컬 모두, 이미 붙어 있으면 그대로).

    접두사가 없으면 os.path.abspath 로 먼저 정규화한다(`..`·`.`·슬래시 방향 정리) —
    UNC 경로는 이미 절대경로라 abspath 를 거쳐도 `\\\\server\\share\\...` 형태를 유지한다.
    """
    s = str(p)
    if s.startswith("\\\\?\\"):
        return s
    s = os.path.abspath(s)
    if s.startswith("\\\\"):
        return "\\\\?\\UNC\\" + s[2:]
    return "\\\\?\\" + s


@dataclass(frozen=True)
class StoragePaths:
    root: Path

    @property
    def inbox(self) -> Path:
        return self.root / "00_Inbox"

    @property
    def vault(self) -> Path:
        return self.root / "10_Vault"

    @property
    def staging(self) -> Path:
        return self.vault / "_staging"

    @property
    def derived(self) -> Path:
        return self.root / "20_Derived"

    @property
    def backup(self) -> Path:
        return self.root / "80_Backup"

    @property
    def system(self) -> Path:
        return self.root / "90_System"

    @property
    def trash(self) -> Path:
        return self.root / "95_Trash"

    @property
    def audit_dir(self) -> Path:
        return self.system / "audit"

    @property
    def logs_dir(self) -> Path:
        return self.system / "logs"

    def ensure_layout(self) -> None:
        for p in (*(self.root / n for n in LAYOUT), self.audit_dir, self.logs_dir, self.staging):
            os.makedirs(to_long(p), exist_ok=True)

    def is_reachable(self) -> bool:
        return os.path.isdir(to_long(self.root))

    def check_reachable(self, timeout: float = 2.0) -> bool:
        """is_reachable() 을 timeout 안에서만 기다린다(죽은 SMB 공유가 요청을 붙잡지 않게).

        결과는 root 경로를 키로 TTL(초) 동안 캐시한다. 같은 root 를 확인하는 job 이 이미
        진행 중이면(single-flight) 새로 만들지 않고 그 job 에 편승해, 이 호출의 timeout
        에서 이미 지난 시간을 뺀 나머지만큼만 같이 기다린다 — 공유가 멀쩡한데 여러 요청이
        우연히 겹쳤을 뿐이라면 편승한 호출도 진짜 결과를 받는다. 이미 이 호출의 timeout
        만큼(또는 그 이상) 진행 중인 job 이면 더 기다리지 않고 바로 False 를 돌려준다 —
        낡은 값을 True 로 우겨 돌려주지 않기 위해서다(여기 도달했다는 것 자체가 위 TTL
        검사에서 '신선한 캐시가 없다'고 판정됐다는 뜻이다). 60초 넘게 안 끝난 job 은
        버려진 것으로 보고 새로 다시 시작한다(root 당 한 번만 — 모듈 상단 주석 참고).
        """
        key = str(self.root)
        now = time.monotonic()
        cached = _reachability_cache.get(key)
        if cached is not None and now - cached[0] < _REACHABILITY_TTL_SECONDS:
            return cached[1]

        new_future = None
        with _reachability_lock:
            entry = _inflight_futures.get(key)
            if entry is None:
                future = _reachability_executor.submit(self.is_reachable)
                _inflight_futures[key] = (future, now)
                new_future = future
                age = 0.0
            else:
                future, started_at = entry
                age = now - started_at
                if age >= _REACHABILITY_ABANDONED_AFTER_SECONDS:
                    # 오래 전에 시작된 job 이 여태 안 끝났다 — 버려진 것으로 보고 새로
                    # 만든다. lock 을 쥔 채 dict 를 덮어쓰므로, 거의 동시에 들어온 다른
                    # 호출은 이 새 항목을 보고 편승한다(재시도는 한 번만 만들어진다).
                    future = _reachability_executor.submit(self.is_reachable)
                    _inflight_futures[key] = (future, now)
                    new_future = future
                    age = 0.0

        # add_done_callback 은 반드시 lock 밖에서 호출한다 — _on_reachability_done 의
        # docstring 참고(재진입 데드락 방지). 새로 만든 future 에 대해서만 등록한다 —
        # 기존 job 에 편승하는 호출은 그 job 의 원래 제출자가 이미 등록해 뒀다.
        if new_future is not None:
            new_future.add_done_callback(lambda fut, key=key: _on_reachability_done(key, fut))

        remaining = timeout - age
        if remaining <= 0:
            return False
        try:
            result = future.result(timeout=remaining)
        except FutureTimeoutError:
            return False
        except Exception:
            result = False
        _reachability_cache[key] = (time.monotonic(), result)
        return result
