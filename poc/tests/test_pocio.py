import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pocio import dump, parse_args


def test_dump_writes_utf8_json_roundtrip(tmp_path):
    out = tmp_path / "out" / "exp1.json"  # 부모 폴더가 없어도 만들어져야 한다
    dump({"메시지": "한글 테스트"}, str(out))
    assert out.exists()
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["메시지"] == "한글 테스트"
    raw = out.read_bytes()
    assert "한글 테스트".encode("utf-8") in raw


def test_parse_args_extracts_out_option():
    positionals, out = parse_args(["foo", "-o", "out\\exp1.json", "bar"])
    assert positionals == ["foo", "bar"]
    assert out == "out\\exp1.json"


def test_parse_args_without_out_returns_none():
    positionals, out = parse_args(["foo"])
    assert positionals == ["foo"]
    assert out is None


def test_parse_args_no_positionals_exits(capsys):
    with pytest.raises(SystemExit) as exc:
        parse_args([])
    assert exc.value.code == 2
    captured = capsys.readouterr()
    assert captured.err  # usage 메시지가 stderr 에 출력됨
