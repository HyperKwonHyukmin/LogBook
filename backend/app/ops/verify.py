"""DB ↔ 공유 폴더 대조(리뷰 7) — `python -m app.cli verify [--fix]`.

DB 의 파일 위치(location·rel_path)대로 실제 파일이 있는지 보고, 없으면 다른 자리(중단된 이동이 남긴 자리)에
있는지 찾는다. 기본은 **보기만** 한다.

보고하는 것
- missing    : 어디에서도 찾지 못한 파일
- misplaced  : DB 가 말하는 자리에는 없고 다른 자리에 있는 파일(반쯤 옮겨진 것)
- orphan     : DB 행이 없는 폴더 — Vault 의 Entry 폴더, `_staging` 배치 폴더, 휴지통 폴더

--fix 가 고치는 것(안전한 경우만)
- misplaced 중 DB 위치가 staging 또는 vault 이고 찾은 자리도 staging/vault 이며, 내용이 DB 기록(크기·작으면
  sha256)과 같고, DB 자리가 비어 있을 때 — 파일을 **DB 가 말하는 자리로** 옮긴다.
  DB 쪽을 고치지 않는 이유: DB 는 감사 로그와 함께 한 번에 커밋된 상태라 일관되고(초안이면 초안, 확정이면 확정),
  파일만 따라가면 된다. 초안의 파일이 Vault 에 반쯤 가 있으면 staging 으로 되돌려 온전한 초안으로 만든다
  (확정은 멱등이라 다시 누르면 끝난다).
- 휴지통이 걸린 경우(폴더째 옮기는 이동)는 고치지 않는다 — 휴지통 보내기·복원을 다시 실행하면 이어서 끝난다.
- orphan 폴더는 지우지 않는다(사람이 내용을 보고 판단).
"""
import os
import re
from pathlib import Path, PurePosixPath

from sqlalchemy.orm import Session

from .. import models
from ..entries.files import find_moved_rel, same_content
from ..storage.paths import StoragePaths, long_join, to_long

YEAR_RE = re.compile(r"^[0-9]{4}$")
ENTRY_RE = re.compile(r"^E[0-9]{6,9}$")
TRASH_RE = re.compile(r"^(?:draft_)?(E[0-9]{6,9})_[0-9]{8}-[0-9]{6}$")


def _dirs(path) -> list[str]:
    try:
        with os.scandir(to_long(path)) as it:
            return sorted(e.name for e in it if e.is_dir())
    except OSError:
        return []


def _vault_dir(storage: StoragePaths, vault_rel: str) -> Path:
    return storage.vault / Path(*PurePosixPath(vault_rel).parts)


class _Ctx:
    def __init__(self, db: Session, storage: StoragePaths):
        self.db, self.storage = db, storage
        self.batches = {b.id: b for b in db.query(models.Batch)}
        self.entries = {e.id: e for e in db.query(models.Entry)}
        self.vault_years = [y for y in _dirs(storage.vault) if YEAR_RE.fullmatch(y)]
        self.trash_dirs = _dirs(storage.trash)
        self._taken: dict[int, set[str]] = {}

    def taken(self, entry_id: int) -> set[str]:
        if entry_id not in self._taken:
            self._taken[entry_id] = {r.casefold() for (r,) in self.db.query(models.File.rel_path)
                                     .filter_by(entry_id=entry_id)}
        return self._taken[entry_id]


def _expected(ctx: _Ctx, f: models.File) -> tuple[Path | None, str]:
    """DB 가 말하는 파일 자리(폴더 루트, rel). 만들 수 없으면 (None, 사유)."""
    entry = ctx.entries.get(f.entry_id) if f.entry_id else None
    if f.location == "staging":
        batch = ctx.batches.get(f.batch_id)
        return (ctx.storage.staging / batch.key, f.rel_path) if batch else (None, "batch_missing")
    if entry is None or not (entry.vault_rel or entry.trash_rel):
        return None, "entry_missing"
    if f.location == "vault":
        return (_vault_dir(ctx.storage, entry.vault_rel) / "files", f.rel_path) if entry.vault_rel \
            else (None, "no_vault_rel")
    if f.location == "trash":
        if not entry.trash_rel:
            return None, "no_trash_rel"
        base = ctx.storage.trash / entry.trash_rel
        return (base if entry.trash_rel.startswith("draft_") else base / "files", f.rel_path)
    return None, f"unknown_location:{f.location}"


def _candidates(ctx: _Ctx, f: models.File) -> list[tuple[str, Path, str]]:
    """DB 자리가 아닌 곳 중 이 파일이 있을 법한 자리 (종류, 루트, rel)."""
    entry = ctx.entries.get(f.entry_id) if f.entry_id else None
    batch = ctx.batches.get(f.batch_id)
    out: list[tuple[str, Path, str]] = []
    if f.location != "staging" and batch is not None:
        out.append(("staging", ctx.storage.staging / batch.key, f.rel_path))
    if entry is not None and f.location != "vault":
        if entry.vault_rel:
            out.append(("vault", _vault_dir(ctx.storage, entry.vault_rel) / "files", f.rel_path))
        elif entry.entry_id:
            # 초안의 중단된 확정 — 확정 직전에 정한 vault_rel 은 롤백으로 사라졌다(연도 폴더를 훑는다)
            for y in ctx.vault_years:
                out.append(("vault", ctx.storage.vault / y / entry.entry_id / "files", f.rel_path))
        target = ctx.entries.get(entry.merge_into_id) if entry.merge_into_id else None
        if target is not None and target.vault_rel:
            # 기존 자료에 합치기가 중단 — 이름이 'name (n)' 으로 바뀌었을 수 있다
            root = _vault_dir(ctx.storage, target.vault_rel) / "files"
            rel = find_moved_rel(root, f.rel_path, ctx.taken(target.id), f.size, f.sha256)
            if rel is not None:
                out.append(("vault", root, rel))
    if entry is not None and entry.entry_id and f.location != "trash":
        for name in ctx.trash_dirs:
            m = TRASH_RE.fullmatch(name)
            if m and m.group(1) == entry.entry_id:
                base = ctx.storage.trash / name
                out.append(("trash", base if name.startswith("draft_") else base / "files", f.rel_path))
    return out


def verify(db: Session, storage: StoragePaths, *, fix: bool = False, out=None, progress_every: int = 5000) -> dict:
    say = (lambda msg: print(msg, file=out)) if out is not None else (lambda msg: None)
    ctx = _Ctx(db, storage)
    result = {"files": 0, "ok": 0, "missing": [], "misplaced": [], "fixed": [], "fix_failed": [],
              "orphan_vault": [], "orphan_staging": [], "orphan_trash": []}
    for f in db.query(models.File).order_by(models.File.id).yield_per(1000):
        result["files"] += 1
        if progress_every and result["files"] % progress_every == 0:
            say(f"  … 파일 {result['files']}개 확인")
        root, rel = _expected(ctx, f)
        if root is not None:
            try:
                if os.path.exists(long_join(root, rel)):
                    result["ok"] += 1
                    continue
            except ValueError:
                pass
        found = []
        for kind, croot, crel in _candidates(ctx, f):
            try:
                path = long_join(croot, crel)
            except ValueError:
                continue
            if same_content(path, f.size, f.sha256):
                found.append((kind, croot, crel))
        entry = ctx.entries.get(f.entry_id) if f.entry_id else None
        label = f"file={f.id} {entry.entry_id if entry else '-'}({entry.status if entry else '-'}) {f.rel_path}"
        if not found:
            result["missing"].append({"file_id": f.id, "location": f.location, "rel_path": f.rel_path,
                                      "reason": rel if root is None else "not_found"})
            say(f"[없음] {label} — DB 위치 {f.location}" + (f" ({rel})" if root is None else ""))
            continue
        kind, croot, crel = found[0]
        item = {"file_id": f.id, "db_location": f.location, "found_in": kind,
                "found_path": long_join(croot, crel), "candidates": len(found)}
        result["misplaced"].append(item)
        say(f"[반쯤 옮겨짐] {label} — DB 는 {f.location}, 실제는 {kind}: {item['found_path']}")
        safe = (fix and root is not None and len(found) == 1 and f.location in ("staging", "vault")
                and kind in ("staging", "vault"))
        if safe:
            dst = long_join(root, rel)
            try:
                if os.path.exists(dst):
                    raise FileExistsError(dst)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                os.rename(item["found_path"], dst)
                result["fixed"].append(item)
                say(f"    → 고침: DB 자리로 옮김 {dst}")
            except OSError as exc:
                result["fix_failed"].append({**item, "error": str(exc)})
                say(f"    → 고치지 못함: {exc}")
        elif fix:
            say("    → 자동으로 고치지 않음(휴지통 이동이 걸렸거나 후보가 여럿) — 보내기·복원·확정을 다시 실행해 보세요")

    # DB 행이 없는 폴더
    confirmed_rel = {e.vault_rel for e in ctx.entries.values() if e.status == "confirmed" and e.vault_rel}
    by_entry_id = {e.entry_id: e for e in ctx.entries.values() if e.entry_id}
    for y in ctx.vault_years:
        for name in _dirs(storage.vault / y):
            if not ENTRY_RE.fullmatch(name) or f"{y}/{name}" in confirmed_rel:
                continue
            e = by_entry_id.get(name)
            note = f"DB 에는 {e.status}" if e else "DB 에 없음"
            result["orphan_vault"].append({"folder": f"{y}/{name}", "note": note})
            say(f"[DB 행 없는 Vault 폴더] {y}/{name} — {note}")
    keys = {b.key for b in ctx.batches.values()}
    for name in _dirs(storage.staging):
        if name not in keys:
            result["orphan_staging"].append({"folder": name})
            say(f"[배치 행 없는 staging 폴더] {name}")
    trash_rels = {e.trash_rel for e in ctx.entries.values() if e.status == "trashed" and e.trash_rel}
    for name in ctx.trash_dirs:
        if name not in trash_rels:
            m = TRASH_RE.fullmatch(name)
            e = by_entry_id.get(m.group(1)) if m else None
            note = f"DB 에는 {e.status}" if e else "DB 에 없음"
            result["orphan_trash"].append({"folder": name, "note": note})
            say(f"[DB 행 없는 휴지통 폴더] {name} — {note}")

    db.rollback()
    say(f"\n파일 {result['files']}개 — 정상 {result['ok']}, 없음 {len(result['missing'])}, "
        f"반쯤 옮겨짐 {len(result['misplaced'])}" + (f"(고침 {len(result['fixed'])}, 실패 {len(result['fix_failed'])})"
                                                   if fix else "")
        + f" / DB 행 없는 폴더: Vault {len(result['orphan_vault'])}, staging {len(result['orphan_staging'])}, "
          f"휴지통 {len(result['orphan_trash'])}")
    return result


def has_problems(result: dict) -> bool:
    unresolved = len(result["misplaced"]) - len(result["fixed"])
    return bool(result["missing"] or unresolved or result["orphan_vault"] or result["orphan_staging"]
                or result["orphan_trash"])
