"""실험 2: 공유 폴더 안에서 옮기거나(rename) 복사한 뒤에도 평문이 유지되는지 확인한다.

사용법: python move_check.py <999_LogBook 루트> [-o <출력 파일>]
전제: <루트>\\_poc\\samples\\ 에 사람이 탐색기로 표본을 복사해 두었다.
"""
import os
import shutil
import sys
from pathlib import Path

from drm_check import check
from pocio import dump, parse_args


def _copy_error_row(path: Path, exc: Exception) -> dict:
    """실패한 복사/이동 행을 drm_check.check() 의 에러 행과 같은 키 구성으로 만든다
    (path/size/sniff/open/plaintext) — 후처리 코드가 두 종류의 실패 행을 같은
    방식으로 다룰 수 있게 하기 위함이다. `error` 키는 기존 후처리(성공/실패 구분)와의
    하위 호환을 위해 그대로 남겨 둔다."""
    return {
        "path": str(path),
        "size": None,
        "sniff": f"error {type(exc).__name__}: {exc}",
        "open": "skip",
        "plaintext": False,
        "error": f"{type(exc).__name__}: {exc}",
    }


def run(share_root: Path) -> dict:
    poc = Path(share_root) / "_poc"
    samples = poc / "samples"
    work = poc / "move"

    empty_result = {
        "before": [], "after_copy": [], "after_rename": [], "after_file_move": [],
    }

    # samples 폴더가 아직 없으면(사람이 표본을 안 둔 경우) FileNotFoundError 로
    # 전체 실행이 죽는 대신 pocio 스타일의 에러 정보만 담아 돌려준다.
    try:
        sample_files = sorted(samples.iterdir())
    except OSError as exc:
        return {**empty_result, "samples_error": f"{type(exc).__name__}: {exc}"}

    # work 는 항상 <share_root>\_poc\move 여야 한다. rmtree 대상이 실수로
    # 다른 경로가 되는 것을 막는 안전장치 — 실패하면 예외가 그대로 드러난다.
    assert work.parts[-2:] == ("_poc", "move")
    if work.exists():
        shutil.rmtree(work)
    staged = work / "staged"
    staged.mkdir(parents=True)

    # ① Python 이 공유 폴더 → 공유 폴더로 복사 (Vault 로 옮기지 않고 사본을 만드는 경우)
    copied: list[Path] = []
    after_copy: list[dict] = []
    for p in sample_files:
        if not p.is_file():
            continue
        try:
            dest = Path(shutil.copy2(p, staged / p.name))
        except OSError as exc:
            after_copy.append(_copy_error_row(p, exc))
            continue
        copied.append(dest)
        after_copy.append(check(dest))

    result = {
        "before": [check(p) for p in sample_files if p.is_file()],
        "after_copy": after_copy,
        "after_rename": [],
        "after_file_move": [],
    }

    # ② 같은 공유 폴더 안에서 폴더 이름 바꾸기 (Inbox → Vault 이동 방식)
    moved = work / "moved"
    try:
        os.rename(staged, moved)
    except OSError as exc:
        # rename 이 실패해도 ① 단계 결과(after_copy)는 이미 채워져 있으니 그대로 돌려준다.
        # ③ 파일 이동은 moved 폴더가 없어 의미가 없으므로 건너뛴다.
        result["rename_error"] = f"{type(exc).__name__}: {exc}"
        return result

    result["after_rename"] = [check(moved / p.name) for p in copied]

    # ③ 파일 단위로 다른 폴더로 이동 (os.replace, Vault 안에서 파일만 옮기는 경우)
    vault = work / "vault"
    vault.mkdir(parents=True, exist_ok=True)
    after_file_move = []
    for p in copied:
        dst = vault / p.name
        try:
            os.replace(moved / p.name, dst)
        except OSError as exc:
            after_file_move.append(_copy_error_row(moved / p.name, exc))
            continue
        after_file_move.append(check(dst))
    result["after_file_move"] = after_file_move

    return result


def _has_failure(result: dict) -> bool:
    if result.get("samples_error") or result.get("rename_error"):
        return True
    if any("error" in r for r in result.get("after_copy", [])):
        return True
    if any("error" in r for r in result.get("after_file_move", [])):
        return True
    return False


def main(argv: list[str]) -> int:
    positionals, out = parse_args(argv)
    result = run(Path(positionals[0]))
    dump(result, out)
    return 3 if _has_failure(result) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
