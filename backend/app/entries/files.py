# backend/app/entries/files.py
"""Entry 파일 이동(실패 시 되돌림)과 메타데이터 파일(entry.json·_INFO.txt).

같은 공유 폴더 안에서 os.rename 으로만 옮긴다(PoC 실험 2: 이동 후 평문 유지).
WorkBench model_registry_storage.py 의 원칙과 같다 — 같은 볼륨 안 rename 은 원자적이다.
"""
import json
import logging
import os
from pathlib import Path, PurePosixPath
from typing import Callable

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..storage.paths import StoragePaths, long_join, to_long

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
                   plans: list[tuple[models.File, str]]) -> list[tuple[Path, Path]]:
    """(File, 목적지 rel) 목록을 (src, dst) 절대경로 쌍으로 만든다. long_join 을 써서
    ('..'·절대경로 조각을 거부하며) 만든다 — Path(*PurePosixPath(rel).parts) 뒤에
    to_long() 을 부르면 끝 공백·점이 잘려 나간다(I1)."""
    return [(Path(long_join(staging_root, f.rel_path)), Path(long_join(files_root, r))) for f, r in plans]


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


def move_all(moves: list[tuple[Path, Path]]) -> Callable[[], None]:
    """(src, dst) 목록을 옮긴다. 하나라도 실패하면 옮긴 것을 스스로 되돌리고 503
    (storage_error, 또는 되돌리기 자체가 실패하면 storage_error_partial).

    성공하면 '되돌리기' 콜러블을 돌려준다(I2) — 파일은 옮겼는데 그 뒤 DB 작업이 실패한
    경우, 호출자가 `db.rollback()` 과 함께 이 콜러블로 파일도 원상복구할 수 있다."""
    done: list[tuple[Path, Path]] = []
    try:
        for src, dst in moves:
            os.makedirs(to_long(dst.parent), exist_ok=True)
            os.rename(to_long(src), to_long(dst))
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
    long_root = to_long(root)
    if not os.path.isdir(long_root):
        return
    for dirpath, _dirs, _files in os.walk(long_root, topdown=False):
        try:
            os.rmdir(dirpath)
        except OSError:
            pass


def write_entry_files(db: Session, storage: StoragePaths, entry: models.Entry) -> None:
    """entry.json(DB 재구축 원천)과 사람용 _INFO.txt 를 쓴다(설계 §3·§4.1).

    확정된 Entry 에만 의미가 있다(vault_rel 이 있어야 쓸 자리가 있다) — 초안에는
    아무것도 하지 않는다(I3). 실패는 여기서 잡지 않고 위로 올린다(OSError) — 호출자가
    "실패했지만 나머지 흐름은 성공으로 본다" 는 정책(재시도 job 등)을 결정한다."""
    if entry.status != "confirmed":
        return
    from .service import entry_to_dict

    d = entry_to_dict(db, entry)
    meta = {k: d[k] for k in ("entry_id", "title", "analysis_type", "description", "analysis_period",
                              "hulls", "zones", "uploaded_by", "confirmed_by", "confirmed_at", "version")}
    meta["files"] = [{k: f[k] for k in ("rel_path", "kind", "size", "sha256")} for f in d["files"]]
    base = entry_dir(storage, entry)
    os.makedirs(to_long(base), exist_ok=True)
    with open(to_long(base / "entry.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
    hulls = ", ".join(h["hull_no"] + (f" ({h['ship_type']})" if h["ship_type"] else "") for h in d["hulls"])
    info = (f"{d['entry_id']}  {d['title']}\n호선: {hulls or '-'}\n구역: {', '.join(d['zones']) or '-'}\n"
            f"올린 사람: {d['uploaded_by'] or '-'}  확정: {d['confirmed_by'] or '-'} {d['confirmed_at'] or ''}\n"
            f"파일 {len(d['files'])}개 — 원본은 files 폴더. 이 폴더는 Logbook 이 관리합니다(직접 수정 금지).\n")
    with open(to_long(base / "_INFO.txt"), "w", encoding="utf-8") as fh:
        fh.write(info)
