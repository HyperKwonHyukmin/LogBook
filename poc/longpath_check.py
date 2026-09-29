"""실험 7: 260자를 넘는 경로와 한글 파일명을 쓰고 읽고 지울 수 있는지 확인한다.

사용법: python longpath_check.py <999_LogBook 루트> [-o 결과.json]
접두사 없이/있이 두 경우를 모두 시도해 결과를 비교한다.

⚠ 2026-09-28 코드 리뷰 수정:
- 매 실행마다 `_poc/longpath_<uuid8>` 처럼 고유한 폴더를 써서, 이전 실행이 남긴
  파일(또는 사용자가 그 자리에 둔 다른 파일)을 절대 건드리지 않는다.
- 접두사 없이/있이 두 시도가 **서로 다른 마지막 폴더명**을 쓴다 — 같은 경로를 쓰면
  먼저 성공한 시도가 만들어 둔 폴더를 두 번째 시도가 `exist_ok=True` 로 그냥 재사용해
  버려서, "접두사가 실제로 필요했는가"를 검증하지 못한다.
- `python`(sys.version)과 레지스트리 `LongPathsEnabled` 값을 같이 기록해, 같은 결과가
  OS 설정 차이 때문인지 우리 코드 때문인지 구분할 수 있게 한다.
"""
import os
import shutil
import sys
import winreg
from pathlib import Path
from uuid import uuid4

from pocio import dump, parse_args

SEGMENT = "구조해석_검토_자료_폴더_Mooring_Fitting_Fore_Deck"  # 한글 + 영문 긴 폴더명
TEST_FILE_NAME = "검토보고서_최종본_리비전3.txt"


def to_long(p: str) -> str:
    """Windows 긴 경로 접두사를 붙인다."""
    if p.startswith("\\\\?\\"):
        return p
    if p.startswith("\\\\"):
        return "\\\\?\\UNC\\" + p[2:]
    return "\\\\?\\" + p


def _attempt(base: str) -> str:
    try:
        os.makedirs(base, exist_ok=True)
        f = os.path.join(base, TEST_FILE_NAME)
        with open(f, "w", encoding="utf-8") as fh:
            fh.write("테스트")
        with open(f, encoding="utf-8") as fh:
            if fh.read() != "테스트":
                return "fail content mismatch"
        return "ok"
    except Exception as exc:  # 실험 도구: 실패는 결과로 기록한다
        return f"fail {type(exc).__name__}: {exc}"


def _long_paths_enabled() -> bool | None:
    """`HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem\\LongPathsEnabled` 를 읽는다.
    키/값이 없거나 접근이 막히면(관리자 권한 등) 판단 불가로 None."""
    try:
        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\FileSystem"
        ) as key:
            value, _ = winreg.QueryValueEx(key, "LongPathsEnabled")
        return bool(value)
    except OSError:
        return None


def run(root: Path) -> dict:
    # uuid 로 매번 새 폴더를 만들어 이전 실행/사용자가 그 자리에 둔 파일을 건드리지 않는다.
    top = os.path.abspath(os.path.join(str(root), "_poc", f"longpath_{uuid4().hex[:8]}"))
    deep = os.path.join(top, *([SEGMENT] * 6))
    # 두 시도는 서로 다른 마지막 폴더를 써서, 한쪽이 만든 폴더를 다른 쪽이 그냥
    # 재사용(exist_ok)해 버리는 것을 막는다 — 각자 실제로 디렉터리를 만들어야 한다.
    deep_without = deep + "_무접두사"
    deep_with = deep + "_접두사"

    result = {
        "path_len": len(deep_without),
        "without_prefix": _attempt(deep_without),
        "with_prefix": _attempt(to_long(deep_with)),
        "python": sys.version,
        "long_paths_enabled": _long_paths_enabled(),
        # _attempt() 가 실제로 만든 파일 경로(디렉터리 + 파일명)의 길이 — 시도별로
        # 리프 폴더명 길이가 달라 path_len 만으로는 정확한 비교가 안 된다.
        "file_path_len": {
            "without_prefix": len(os.path.join(deep_without, TEST_FILE_NAME)),
            "with_prefix": len(os.path.join(to_long(deep_with), TEST_FILE_NAME)),
        },
    }

    shutil.rmtree(to_long(top), ignore_errors=True)
    result["cleaned"] = not os.path.exists(to_long(top))
    try:
        os.rmdir(os.path.dirname(top))  # "_poc" 폴더 — 비어 있을 때만 지운다
    except OSError:
        pass
    return result


def main(argv: list[str]) -> int:
    positionals, out = parse_args(argv)
    dump(run(Path(positionals[0])), out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
