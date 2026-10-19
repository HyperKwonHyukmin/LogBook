# backend/app/entries/files.py
"""Entry 파일 이동(실패 시 되돌림)과 메타데이터 파일(entry.json·_INFO.txt).

같은 공유 폴더 안에서 os.rename 으로만 옮긴다(PoC 실험 2: 이동 후 평문 유지).
WorkBench model_registry_storage.py 의 원칙과 같다 — 같은 볼륨 안 rename 은 원자적이다.
"""
import hashlib
import json
import logging
import os
import tempfile
import time
from pathlib import Path, PurePosixPath
from typing import Callable

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..storage.paths import StoragePaths, long_join, to_long, walk_root

logger = logging.getLogger(__name__)


def entry_dir(storage: StoragePaths, entry: models.Entry) -> Path:
    return storage.vault / Path(*PurePosixPath(entry.vault_rel).parts)


def unique_rel(files_root: Path, rel: str, planned: set[str] | None = None) -> str:
    """files_root 안에 rel 이 이미 있거나(디스크) 이번 작업에서 이미 정해 둔 이름과 같으면
    (planned, 대소문자 무시 — Windows 파일시스템 기준) 'name (2).ext' 형태로 비어 있는
    이름을 찾는다(M1). planned 를 넘기면 이번에 고른 이름을 그 자리에서 등록해 둔다 —
    같은 호출 안에서 여러 파일을 계획할 때, 디스크에는 아직 아무것도 없어도(옮기기 전)
    서로 같은 이름으로 계획되는 충돌을 막는다."""
    p = PurePosixPath(rel)
    candidate, n = p, 2
    while (os.path.exists(long_join(files_root, candidate.as_posix()))
           or (planned is not None and candidate.as_posix().casefold() in planned)):
        candidate = p.with_name(f"{p.stem} ({n}){p.suffix}")
        n += 1
    result = candidate.as_posix()
    if planned is not None:
        planned.add(result.casefold())
    return result


def rel_move_pairs(staging_root: Path, files_root: Path,
                   plans: list[tuple[models.File, str]]) -> list[tuple[Path, Path, int, str]]:
    """(File, 목적지 rel) 목록을 (src, dst, 크기, sha256) 로 만든다. long_join 을 써서
    ('..'·절대경로 조각을 거부하며) 만든다 — Path(*PurePosixPath(rel).parts) 뒤에
    to_long() 을 부르면 끝 공백·점이 잘려 나간다(I1). 크기·sha256 은 move_all 이 '앞선 시도가
    이미 옮겨 둔 파일'을 알아보는 데 쓴다."""
    return [(Path(long_join(staging_root, f.rel_path)), Path(long_join(files_root, r)), f.size, f.sha256)
            for f, r in plans]


# 이미 옮겨진 파일인지 볼 때 sha256 까지 비교하는 크기 상한 — 넘으면 크기만 본다
# (재시도 때 수백 MB 짜리를 SMB 로 다시 읽지 않게. 같은 이름·같은 크기면 사실상 같은 파일이다)
VERIFY_HASH_MAX_BYTES = 64 * 1024 ** 2


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def same_content(path: str, size: int | None, sha256: str | None, *, force_hash: bool = False) -> bool:
    """path 가 DB 가 기록한 파일(크기·sha256)과 같은가. force_hash 면 크기와 상관없이 sha256 까지 맞아야
    한다(지우기 전 확인용). 읽지 못하면 False — 같다고 우기지 않는다."""
    try:
        if not os.path.isfile(path) or os.path.getsize(path) != size:
            return False
        if force_hash:
            return bool(sha256) and _sha256(path) == sha256
        if not sha256 or size > VERIFY_HASH_MAX_BYTES:
            return True
        return _sha256(path) == sha256
    except OSError:
        return False


def find_moved_rel(files_root: Path, rel: str, taken: set[str], size: int | None,
                   sha256: str | None) -> str | None:
    """앞선(중단된) 이동이 files_root 에 이미 옮겨 둔 이 파일의 이름을 찾는다 — rel 그대로이거나
    unique_rel 이 붙인 'name (n).ext'. taken(대소문자 무시)은 다른 DB 행이 이미 쓰는 이름이라 건너뛴다
    (같은 내용이라도 남의 파일을 내 것으로 집으면 한 파일을 두 행이 가리킨다). 없으면 None."""
    p = PurePosixPath(rel)
    candidate, n = p, 2
    while os.path.exists(long_join(files_root, candidate.as_posix())):
        name = candidate.as_posix()
        if name.casefold() not in taken and same_content(long_join(files_root, name), size, sha256):
            return name
        candidate = p.with_name(f"{p.stem} ({n}){p.suffix}")
        n += 1
    return None


def plan_rel(src_root: Path, files_root: Path, f: models.File, planned: set[str], taken: set[str]) -> str:
    """파일 하나의 목적지 이름 — 원본이 없고 앞선 시도가 옮겨 둔 사본이 있으면 그 이름(재시도가 이어서
    끝내게), 아니면 unique_rel 로 비어 있는 이름. taken = 목적지에서 다른 DB 행이 쓰는 이름(casefold)."""
    if not os.path.exists(long_join(src_root, f.rel_path)):
        found = find_moved_rel(files_root, f.rel_path, taken | planned, f.size, f.sha256)
        if found is not None:
            planned.add(found.casefold())
            return found
    return unique_rel(files_root, f.rel_path, planned)


def _undo(done: list[tuple[Path, Path]]) -> None:
    """move_all 이 옮긴 것을 되돌린다. 하나라도 되돌리기 자체가 실패하면(파일이 원래
    자리로도 새 자리로도 온전히 없는 상태) 그 사실을 error 로 남기고 503 을 던진다 —
    이 경우는 원래 실패보다 더 급하다(수동 확인이 필요하다는 신호, I7)."""
    failed: list[tuple[Path, Path]] = []
    for src, dst in reversed(done):
        try:
            os.rename(to_long(dst), to_long(src))
        except OSError as exc:
            logger.error("되돌리기 실패 — 파일이 정상 위치에 없을 수 있음: dst=%s src=%s (%s)", dst, src, exc)
            failed.append((src, dst))
    if failed:
        raise HTTPException(status_code=503, detail="storage_error_partial")


def _already_moved(dst: str, size: int | None, sha256: str | None) -> bool:
    """원본이 없을 때, 목적지가 앞선 시도가 옮겨 둔 그것인가. 폴더 이동(크기 없음)은 폴더가 있으면 된다."""
    if size is None:
        return os.path.isdir(dst)
    return same_content(dst, size, sha256)


def move_all(moves: list[tuple]) -> Callable[[], None]:
    """(src, dst[, 크기, sha256]) 목록을 옮긴다. 하나라도 실패하면 옮긴 것을 스스로 되돌리고 503
    (storage_error, 또는 되돌리기 자체가 실패하면 storage_error_partial).

    멱등이다(리뷰 7) — SMB 끊김·재시작으로 앞선 시도가 중간에 멈춰 파일이 staging 과 vault 에 갈라져
    있어도 다시 부르면 이어서 끝낸다:
    - 원본이 없고 목적지에 같은 파일(크기, 작으면 sha256 까지)이 있으면 이미 옮긴 것으로 본다.
    - 둘 다 있고 둘 다 기록된 sha256 과 같으면 원본(검증된 사본)을 지우고 옮긴 것으로 본다 — 원본을
      남기면 staging 폴더가 영영 비지 않고, 같은 내용이 확인됐으니 지워도 잃는 것이 없다.
      내용이 다르거나 확인할 수 없으면 손대지 않고 실패시킨다(덮어쓰기 금지 — 사람이 볼 일).
    이미 옮겨진 것도 '옮긴 것' 목록에 넣는다 — 되돌리면 전부 원래 자리로 모여 일관된 초안 상태가 된다.

    성공하면 '되돌리기' 콜러블을 돌려준다(I2) — 파일은 옮겼는데 그 뒤 DB 작업이 실패한
    경우, 호출자가 `db.rollback()` 과 함께 이 콜러블로 파일도 원상복구할 수 있다.
    ⚠ DB 가 이미 커밋된 뒤에는 부르지 말 것(파일만 되돌아가 DB 와 어긋난다, 리뷰 M3)."""
    done: list[tuple[Path, Path]] = []
    try:
        for item in moves:
            src, dst = item[0], item[1]
            size, sha256 = (item[2], item[3]) if len(item) >= 4 else (None, None)
            s, d = to_long(src), to_long(dst)
            if os.path.exists(d):
                if not os.path.exists(s) and _already_moved(d, size, sha256):
                    logger.info("앞선 시도가 이미 옮겨 둔 것으로 봄: %s", dst)
                    done.append((src, dst))
                    continue
                if (size is not None and same_content(d, size, sha256, force_hash=True)
                        and same_content(s, size, sha256, force_hash=True)):
                    os.remove(s)
                    logger.warning("원본과 같은 사본이 이미 목적지에 있어 원본을 지움: %s → %s", src, dst)
                    done.append((src, dst))
                    continue
                logger.error("목적지에 다른 파일이 있어 옮기지 않음(수동 확인): %s → %s", src, dst)
            os.makedirs(to_long(dst.parent), exist_ok=True)
            os.rename(s, d)
            done.append((src, dst))
    except OSError as exc:
        try:
            _undo(done)
        except HTTPException:
            raise  # 되돌리기 자체가 실패 — storage_error_partial 이 원래 에러보다 급하다
        raise HTTPException(status_code=503, detail="storage_error") from exc

    def undo() -> None:
        _undo(done)

    return undo


def remove_empty_dirs(root: Path) -> None:
    long_root = walk_root(root)
    if not os.path.isdir(long_root):
        return
    for dirpath, _dirs, _files in os.walk(long_root, topdown=False):
        try:
            os.rmdir(dirpath)
        except OSError:
            pass


def write_entry_files(db: Session, storage: StoragePaths, entry: models.Entry, base: Path | None = None) -> None:
    """entry.json(DB 재구축 원천)과 사람용 _INFO.txt 를 쓴다(설계 §3·§4.1).

    확정된 Entry 에만 의미가 있다(vault_rel 이 있어야 쓸 자리가 있다) — 초안에는
    아무것도 하지 않는다(I3). base 를 주면 그 폴더에 쓴다 — 매일 재동기화가 휴지통 폴더에서
    빠진 entry.json 을 채울 때(휴지통 Entry 도 재구축 때 이 파일로 되살아난다).
    실패는 여기서 잡지 않고 위로 올린다(OSError) — 호출자가
    "실패했지만 나머지 흐름은 성공으로 본다" 는 정책(재시도 job 등)을 결정한다."""
    if base is None and entry.status != "confirmed":
        return
    if not entry.vault_rel:
        return
    from .service import entry_to_dict

    d = entry_to_dict(db, entry)
    meta = {k: d[k] for k in ("entry_id", "title", "analysis_type", "description",
                              "hulls", "zones", "tags", "uploaded_by", "confirmed_by", "confirmed_at",
                              "version")}
    # 13·15 — 공개 단계(공유·일반·블록)는 재구축 원천이라 남긴다(열람 허락 명단은 registry.json 에만 — 이 폴더는 탐색기로 보인다)
    meta["access"] = d["access"]
    # 20 — '호선 없음(공용)'·제목 초안의 원래 이름(재구축 원천). 값이 있을 때만 쓴다
    if d["no_hull"]:
        meta["no_hull"] = True
    if d["title_source"]:
        meta["title_source"] = d["title_source"]
    # 38 — 대상 구조물(있을 때만)
    if d["target"]:
        meta["target"] = d["target"]
    # 21 — 프로젝트(자료의 소속, 있을 때만)
    meta["files"] = [{k: f[k] for k in ("rel_path", "kind", "size", "sha256")} for f in d["files"]]
    # 14 — 사용자가 정리한 판 배치(재구축 원천). 정리한 것이 없으면 쓰지 않는다(자동 추정은 다시 계산된다)
    from ..revisions.series import export_manual
    revisions = export_manual(db, entry.id)
    if revisions:
        meta["revisions"] = revisions
    # 21 — 보고서별 문서 분류·'보고서에 사용한 모델' 연결(재구축 원천). 정보가 있는 보고서만
    from ..report_catalog import export_entry
    reports = export_entry(db, entry)
    if reports:
        meta["reports"] = reports
    base = entry_dir(storage, entry) if base is None else base
    os.makedirs(to_long(base), exist_ok=True)
    write_text_atomic(base / "entry.json", json.dumps(meta, ensure_ascii=False, indent=2))
    hulls = ", ".join(h["hull_no"] + (f" ({h['ship_type']})" if h["ship_type"] else "") for h in d["hulls"])
    info = (f"{d['entry_id']}  {d['title']}\n호선: {hulls or ('공용' if d['no_hull'] else '-')}\n"
            + f"구역: {', '.join(d['zones']) or '-'}\n"
            + (f"대상: {d['target']}\n" if d["target"] else "")
            + f"태그: {', '.join(d['tags']) or '-'}\n"
            f"공개 범위: {d['label'] or '일반'}\n"
            f"올린 사람: {d['uploaded_by'] or '-'}  확정: {d['confirmed_by'] or '-'} {d['confirmed_at'] or ''}\n"
            f"파일 {len(d['files'])}개 — 원본은 files 폴더. 이 폴더는 Hi-TESS LogBook 이 관리합니다(직접 수정 금지).\n")
    write_text_atomic(base / "_INFO.txt", info)


# 바꿔 끼우기가 잠깐 막혔을 때(탐색기·백업이 대상 파일을 열고 있음 — Windows 는 공유 삭제 없이 열린
# 파일을 대체하지 못한다) 다시 해 보는 횟수와 간격
REPLACE_TRIES = 3
REPLACE_WAIT_SECONDS = 0.3


def write_text_atomic(path: Path, text: str) -> None:
    """같은 폴더의 임시 파일에 다 쓴 뒤 os.replace 로 바꿔 끼운다(리뷰 8) — 쓰는 도중 SMB 가 끊겨도
    기존 파일은 온전히 남는다(예전 open("w") 는 먼저 0바이트로 비워 재구축이 그 Entry 를 건너뛰게 했다).
    같은 폴더라 같은 볼륨 안 바꿔 끼우기이고, 임시 파일 이름은 프로세스끼리 겹치지 않는다(mkstemp).
    실패(OSError)는 임시 파일을 지우고 위로 올린다 — 호출자가 재시도 작업을 넣는다."""
    fd, tmp = tempfile.mkstemp(dir=to_long(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        for attempt in range(REPLACE_TRIES):
            try:
                os.replace(tmp, to_long(path))
                break
            except PermissionError:
                if attempt == REPLACE_TRIES - 1:
                    raise
                time.sleep(REPLACE_WAIT_SECONDS)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise
