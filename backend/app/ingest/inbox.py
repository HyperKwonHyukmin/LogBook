"""00_Inbox 감시 — 복사가 끝난 항목을 골라낸다(설계 §5.1).

SMB 변경 알림은 믿기 어려워 주기적으로 훑는다. '복사 완료' 는 일정 시간 동안
(파일 수·총 크기·최신 수정 시각) 서명이 변하지 않고, 모든 파일을 아무도 못 열게
배타적으로 열 수 있는 것(읽기 전용 파일도 통과해야 하므로 GENERIC_READ 로 연다).
워커 재시작 시 관찰 기록은 사라지므로 다시 60초를 기다린다(안전한 쪽).
"""
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable

from sqlalchemy.orm import Session

from .. import audit, jobs, models
from ..storage.paths import StoragePaths, long_join, to_long, walk_root
from .owner import employee_for_account, owner_account
from .rules import is_excluded

logger = logging.getLogger(__name__)

STABLE_SECONDS = 60
LOOSE_GROUP_SECONDS = 120
LOCK_WARNING_SECONDS = 600  # 안정된 지 이만큼 지나도 계속 잠겨 있으면 경고
FILE_COUNT_WARN_THRESHOLD = 50_000
RESERVED_PREFIX = "_web"  # 웹 업로드 전용 폴더 — 이것만 건너뛴다(그 밖의 '_' 이름은 일반 항목)


@dataclass
class ReadyItem:
    kind: str                 # folder | loose
    name: str
    paths: list[Path] = field(default_factory=list)
    owner: str | None = None


def _iter_file_entries(root: Path):
    """root 아래 모든 파일을 재귀적으로 훑는다(os.scandir 재귀 — DirEntry.stat() 은
    나열할 때 이미 받은 정보를 쓰므로 파일마다 새 핸들을 열지 않는다). 제외 규칙에
    걸리는 이름은 건너뛴다. 못 읽는 하위 폴더는 경고만 남기고 계속한다."""
    stack = [walk_root(root)]
    while stack:
        cur = stack.pop()
        try:
            with os.scandir(cur) as it:
                dirents = list(it)
        except OSError as exc:
            logger.warning("Inbox 하위 폴더를 읽지 못함: %s (%s)", cur, exc)
            continue
        for de in dirents:
            if is_excluded(de.name):
                continue
            try:
                is_dir = de.is_dir()
            except OSError as exc:
                logger.warning("Inbox 항목 종류 확인 실패: %s (%s)", de.path, exc)
                continue
            if is_dir:
                stack.append(de.path)
            else:
                yield de


def _files_under(path: Path) -> list[Path]:
    if not path.is_dir():
        return [path]
    return [Path(de.path) for de in _iter_file_entries(path)]


def _signature(path: Path) -> tuple:
    """(파일 수, 총 크기, 최신 수정 시각). 제외 규칙에 걸리는 파일은 세지 않는다 —
    그것만 있는 폴더는 파일 수 0 으로 나와 절대 준비완료가 되지 않는다."""
    if not path.is_dir():
        try:
            st = os.stat(to_long(path))
        except OSError:
            return (0, 0, 0.0)
        return (1, st.st_size, st.st_mtime)
    total, newest, count = 0, 0.0, 0
    for de in _iter_file_entries(path):
        try:
            st = de.stat()
        except OSError:
            continue
        total += st.st_size
        newest = max(newest, st.st_mtime)
        count += 1
    return (count, total, newest)


def _all_writable(paths: list[Path]) -> bool:
    """모든 파일을 아무도 못 열게 배타적으로 열어 본다 — 열리면 복사 중인 프로세스가
    핸들을 쥐고 있지 않다는 뜻(읽기전용 파일도 GENERIC_READ 라 통과한다)."""
    import win32con
    import win32file

    for p in paths:
        try:
            handle = win32file.CreateFile(
                to_long(p), win32con.GENERIC_READ, 0, None, win32con.OPEN_EXISTING, 0, None,
            )
        except Exception:
            return False
        handle.Close()
    return True


class InboxWatcher:
    def __init__(self, storage: StoragePaths, *, stable_seconds: float = STABLE_SECONDS,
                 clock: Callable[[], float] = time.monotonic,
                 owner_of: Callable[[Path], str | None] = owner_account):
        self.storage = storage
        self.stable_seconds = stable_seconds
        self.clock = clock
        self.owner_of = owner_of
        # name -> (서명, 마지막으로 서명이 바뀐 시각, 처음 관찰한 시각)
        self._seen: dict[str, tuple[tuple, float, float]] = {}
        self._warned_locked: set[str] = set()
        self._warned_large: set[str] = set()

    def poll(self) -> list[ReadyItem]:
        now = self.clock()
        current: set[str] = set()
        ready_folders: list[ReadyItem] = []
        loose_info: list[dict] = []  # 이번 회차에 본 낱개 파일 전부(준비 여부와 무관)

        with os.scandir(walk_root(self.storage.inbox)) as it:
            entries = list(it)
        for entry in entries:
            name = entry.name
            if name.startswith(RESERVED_PREFIX) or is_excluded(name):
                continue
            # entry.path 는 scandir 에 넘긴 (이미 \\?\ 접두된) 경로를 이어 붙인 것이라
            # 끝에 공백·점이 있는 이름도 그대로 보존한다(재구성하면 정규화로 잘려 나간다).
            path = Path(entry.path)
            current.add(name)
            try:
                is_dir = entry.is_dir()
                sig = _signature(path)
            except OSError:
                continue

            if sig[0] > FILE_COUNT_WARN_THRESHOLD and name not in self._warned_large:
                logger.warning("Inbox 항목 파일 수가 %d 를 넘음: %s (%d개)",
                                FILE_COUNT_WARN_THRESHOLD, name, sig[0])
                self._warned_large.add(name)

            prev = self._seen.get(name)
            if prev is None:
                self._seen[name] = (sig, now, now)
                last_change, first_seen, changed = now, now, True
            else:
                prev_sig, last_change, first_seen = prev
                if prev_sig != sig:
                    self._seen[name] = (sig, now, first_seen)
                    last_change, changed = now, True
                else:
                    changed = False

            stable = (not changed) and (now - last_change >= self.stable_seconds)

            if is_dir:
                if not stable:
                    continue
                if sig[0] == 0:  # 빈 폴더(또는 제외 파일만 있는 폴더) — 절대 준비완료 아님
                    continue
                if not self._unlocked(name, _files_under(path), now, last_change):
                    continue
                ready_folders.append(ReadyItem("folder", name, [path], self.owner_of(path)))
            else:
                # 낱개 파일은 아직 안정되지 않았어도 loose_info 에 넣는다 — 방금 나타난
                # 같은 소유자의 형제 파일이 있어야 "아직 준비 안 된 형제" 로 보류 판단이
                # 가능하다(이번 회차에 처음 본 파일도 예외가 아니다).
                owner = self.owner_of(path) or ""
                ready = stable and self._unlocked(name, [path], now, last_change)
                loose_info.append({"path": path, "owner": owner, "first_seen": first_seen, "ready": ready})

        for gone in set(self._seen) - current:
            del self._seen[gone]
            self._warned_locked.discard(gone)
            self._warned_large.discard(gone)

        return ready_folders + self._group_loose(self._release_loose(loose_info))

    def _unlocked(self, name: str, paths: list[Path], now: float, stable_since: float) -> bool:
        if _all_writable(paths):
            return True
        if now - stable_since > LOCK_WARNING_SECONDS and name not in self._warned_locked:
            logger.warning("Inbox 항목이 안정됐지만 %d초 넘게 잠겨 있음: %s", LOCK_WARNING_SECONDS, name)
            self._warned_locked.add(name)
        return False

    def _release_loose(self, loose_info: list[dict]) -> list[dict]:
        """같은 소유자가 120초 안에 함께 넣은 낱개 파일 중 하나라도 아직 준비 안 됐으면,
        이미 준비된 파일도 같이 보류한다 — 그래야 한 묶음이 둘로 쪼개지지 않는다."""
        released = []
        for item in loose_info:
            if not item["ready"]:
                continue
            blocked = any(
                other is not item
                and other["owner"] == item["owner"]
                and abs(other["first_seen"] - item["first_seen"]) <= LOOSE_GROUP_SECONDS
                and not other["ready"]
                for other in loose_info
            )
            if not blocked:
                released.append(item)
        return released

    def _group_loose(self, items: list[dict]) -> list[ReadyItem]:
        keyed = sorted(items, key=lambda i: (i["owner"], i["first_seen"]))
        groups: list[ReadyItem] = []
        last_owner, last_time = None, None
        for it in keyed:
            path = it["path"]
            try:
                os.stat(to_long(path))
            except OSError:
                continue  # 묶기 직전 사라진 파일(레이스) — 건너뛴다
            owner, first_seen = it["owner"], it["first_seen"]
            if groups and owner == last_owner and first_seen - last_time <= LOOSE_GROUP_SECONDS:
                groups[-1].paths.append(path)
            else:
                groups.append(ReadyItem("loose", path.name, [path], owner or None))
            last_owner, last_time = owner, first_seen
        return groups

    def forget(self, item: ReadyItem) -> None:
        for p in item.paths:
            self._seen.pop(p.name, None)
            self._warned_locked.discard(p.name)
            self._warned_large.discard(p.name)


def new_batch_key() -> str:
    return f"{datetime.now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:4]}"


def _undo_stage(moved: list[tuple[Path, Path]], dest_root: Path) -> None:
    for src, dst in reversed(moved):
        try:
            os.rename(to_long(dst), to_long(src))
        except OSError as exc:
            logger.error("staging 되돌리기 실패 — 파일이 정상 위치에 없을 수 있음: dst=%s src=%s (%s)",
                        dst, src, exc)
    try:
        os.rmdir(to_long(dest_root))
    except OSError:
        pass


def stage_item(db: Session, storage: StoragePaths, item: ReadyItem) -> models.Batch:
    r"""ReadyItem 을 staging 으로 옮기고 배치를 만든다.

    item.paths 는 InboxWatcher.poll() 이 os.scandir 로 얻은, 이미 \\?\ 접두된 Path 일
    수도 있고(실사용 경로), 테스트처럼 접두 없는 Path 일 수도 있다 — to_long() 이 멱등이라
    양쪽 다 그대로 안전하게 처리된다(이중 접두 없음).

    이동은 됐는데 그 뒤 배치 행 생성·감사 기록이 실패하면(DB 오류 등), 파일을 Inbox 로
    되돌리고 DB 는 롤백한 뒤 다시 던진다(I2) — 파일은 옮겨졌는데 배치 행이 없는
    상태(고아 staging 폴더)가 남지 않게 한다.
    """
    key = new_batch_key()
    dest_root = storage.staging / key
    os.makedirs(to_long(dest_root), exist_ok=True)
    moved: list[tuple[Path, Path]] = []
    try:
        for src in item.paths:
            # long_join 으로 만든다 — dest_root / src.name 뒤에 to_long() 을 부르면(I1)
            # src.name 끝의 공백·점이 abspath 정규화로 잘려 나간다.
            dst = Path(long_join(dest_root, src.name))
            os.rename(to_long(src), to_long(dst))
            moved.append((src, dst))
    except OSError:
        _undo_stage(moved, dest_root)
        raise

    try:
        guess = employee_for_account(db, item.owner)
        batch = models.Batch(key=key, source="inbox", original_name=item.name, owner_account=item.owner,
                             uploader_guess=guess, uploader=guess, state="staged")
        db.add(batch)
        db.flush()
        jobs.enqueue(db, "process_batch", batch.id)
        audit.record(db, storage, actor=guess, action="BATCH_RECEIVED", target_type="batch", target_id=key,
                     after={"name": item.name, "files": len(item.paths), "owner": item.owner})
    except Exception:
        db.rollback()
        _undo_stage(moved, dest_root)
        raise
    return batch
