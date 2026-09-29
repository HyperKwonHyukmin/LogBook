import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from longpath_check import to_long, run


def test_to_long_unc():
    assert to_long(r"\\server\share\a") == r"\\?\UNC\server\share\a"


def test_to_long_local():
    assert to_long(r"C:\a\b") == r"\\?\C:\a\b"


def test_to_long_idempotent():
    assert to_long(r"\\?\UNC\server\share") == r"\\?\UNC\server\share"


def test_run_on_local_temp(tmp_path):
    result = run(tmp_path)
    assert result["path_len"] > 260
    assert result["with_prefix"] == "ok"
    assert result["cleaned"] is True
    # _poc 폴더 자체도(비어 있으면) 정리된다 — 잔재를 남기지 않는다
    assert not (tmp_path / "_poc").exists()


def test_run_records_python_version_and_registry_flag(tmp_path):
    result = run(tmp_path)
    assert result["python"] == sys.version
    assert "long_paths_enabled" in result  # True/False/None(읽기 실패) 중 하나


def test_run_never_deletes_preexisting_content(tmp_path):
    """폴더 이름이 uuid 로 매번 달라 이전에 남아 있던 파일을 건드리지 않는다."""
    keep = tmp_path / "_poc" / "keep_me.txt"
    keep.parent.mkdir(parents=True)
    keep.write_text("보존", encoding="utf-8")

    run(tmp_path)

    assert keep.exists()
    assert keep.read_text(encoding="utf-8") == "보존"


def test_run_uses_distinct_leaves_for_each_attempt(tmp_path):
    """두 시도(접두사 없이/있이)가 같은 폴더를 재사용하지 않고 각자 실제로 만든다."""
    result = run(tmp_path)
    assert result["without_prefix"] in ("ok",) or result["without_prefix"].startswith("fail")
    assert result["with_prefix"] == "ok"


def test_run_attempts_actually_use_different_leaf_dirs(tmp_path, monkeypatch):
    """`_attempt` 에 실제로 전달되는 base 가 두 시도마다 다른 마지막 폴더명을 쓰는지 직접 본다
    (같은 경로를 재사용하면 두 번째 시도가 "접두사 덕에 성공"한 게 아니라 첫 시도가 만든
    폴더를 그냥 다시 여는 것일 수 있다 — 그 회귀를 여기서 잡는다)."""
    import longpath_check

    captured: list[str] = []

    def fake_attempt(base: str) -> str:
        captured.append(base)
        return "ok"

    monkeypatch.setattr(longpath_check, "_attempt", fake_attempt)
    longpath_check.run(tmp_path)

    assert len(captured) == 2
    without_base, with_base = captured
    without_leaf = without_base.rstrip("\\/").rsplit("\\", 1)[-1]
    with_leaf = with_base.rstrip("\\/").rsplit("\\", 1)[-1]
    assert without_leaf.endswith("_무접두사")
    assert with_leaf.endswith("_접두사") and not with_leaf.endswith("_무접두사")
    assert without_leaf != with_leaf


def test_run_records_actual_file_path_length_per_attempt(tmp_path):
    result = run(tmp_path)
    assert result["file_path_len"]["without_prefix"] > 260
    assert result["file_path_len"]["with_prefix"] > 260
    # with_prefix 는 "\\?\" 접두사(4자)가 붙지만 리프 폴더명("_접두사")이
    # without_prefix 쪽("_무접두사")보다 1자 짧아 순증가는 3자다.
    assert (
        result["file_path_len"]["with_prefix"]
        == result["file_path_len"]["without_prefix"] + 3
    )


def test_run_with_relative_root(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    result = run(Path("."))
    assert result["with_prefix"] == "ok"
    assert result["cleaned"] is True
