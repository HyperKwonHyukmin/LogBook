"""실험 스크립트 공용 출력 유틸: UTF-8 JSON 출력과 CLI 인자 파싱을 모아둔다.

콘솔 코드페이지가 UTF-8 이 아닌 145 서버에서도 한글이 깨지지 않게 하기 위한
공용 헬퍼다. 모든 실험 스크립트는 이 모듈의 dump/parse_args 를 통해서만
결과를 출력한다.
"""
import json
import sys
from pathlib import Path


def dump(obj, out: str | None = None) -> None:
    """결과를 UTF-8 JSON 으로 쓴다. out 이 있으면 그 파일에, 없으면 stdout(UTF-8 재설정)에."""
    text = json.dumps(obj, ensure_ascii=False, indent=2)
    if out:
        path = Path(out)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    else:
        sys.stdout.reconfigure(encoding="utf-8")
        print(text)


def parse_args(argv: list[str]) -> tuple[list[str], str | None]:
    """인자에서 -o <경로> 를 분리한다.

    반환: (positionals, out). positional 인자가 하나도 없으면 usage 를
    stderr 에 출력하고 종료 코드 2 로 종료한다.
    """
    positionals: list[str] = []
    out: str | None = None
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "-o":
            i += 1
            if i >= len(argv):
                print("usage: -o 뒤에 출력 경로가 필요합니다", file=sys.stderr)
                sys.exit(2)
            out = argv[i]
        else:
            positionals.append(arg)
        i += 1
    if not positionals:
        print("usage: <스크립트> <경로...> [-o <출력 파일>]", file=sys.stderr)
        sys.exit(2)
    return positionals, out
