import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from drm_check import sniff, check


def test_sniff_detects_drm_header():
    assert sniff(b"HHIDRMC\x00\x01\x02") == "drm"


def test_sniff_detects_office_zip():
    assert sniff(b"PK\x03\x04\x14\x00") == "zip"


def test_sniff_detects_pdf():
    assert sniff(b"%PDF-1.7\n") == "pdf"


def test_sniff_unknown():
    assert sniff(b"$ NASTRAN") == "unknown"


def test_check_reports_drm_file_as_not_openable(tmp_path):
    p = tmp_path / "report.pptx"
    p.write_bytes(b"HHIDRMC" + b"\x00" * 64)
    row = check(p)
    assert row["sniff"] == "drm"
    assert row["open"].startswith("fail")
    assert row["size"] == 71


def test_check_handles_missing_file_without_raising(tmp_path):
    missing = tmp_path / "does_not_exist.pdf"
    row = check(missing)
    assert row["size"] is None
    assert row["sniff"].startswith("error")
    assert row["open"] == "skip"
    assert row["plaintext"] is False


def test_check_real_xlsx_is_plaintext(tmp_path):
    from openpyxl import Workbook

    p = tmp_path / "sample.xlsx"
    Workbook().save(p)
    row = check(p)
    assert row["sniff"] == "zip"
    assert row["open"].startswith("ok")
    assert row["plaintext"] is True


def test_check_drm_file_with_embedded_pdf_marker_is_not_plaintext(tmp_path):
    # HHIDRMC 로 시작하지만 뒤에 mupdf 가 "복구 가능한 빈 PDF"로 실제로 열어
    # 버리는(page_count=0) 조각을 붙인다. 앞부분 패딩이 짧거나 trailer/obj 가
    # 없으면 mupdf 가 FileDataError 로 거부해 애초에 page_count==0 분기를
    # 타지 않으므로(구 테스트의 함정), 4096바이트 패딩 + 최소 obj/trailer 를 둔다.
    p = tmp_path / "sneaky.pdf"
    p.write_bytes(
        b"HHIDRMC" + b"\x00" * 4096 + b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
    )
    row = check(p)
    assert row["plaintext"] is False
    assert row["open"] == "fail empty/repaired pages=0"


def test_move_check_runs_on_local_folder(tmp_path):
    from move_check import run

    samples = tmp_path / "_poc" / "samples"
    samples.mkdir(parents=True)
    (samples / "a.pdf").write_bytes(b"%PDF-1.7\n")
    result = run(tmp_path)
    assert [r["sniff"] for r in result["after_rename"]] == ["pdf"]
    assert [r["sniff"] for r in result["after_copy"]] == ["pdf"]
    assert [r["sniff"] for r in result["after_file_move"]] == ["pdf"]


def test_move_check_records_copy_errors_without_aborting(tmp_path, monkeypatch):
    from move_check import run
    import move_check

    samples = tmp_path / "_poc" / "samples"
    samples.mkdir(parents=True)
    (samples / "a.pdf").write_bytes(b"%PDF-1.7\n")
    (samples / "b.pdf").write_bytes(b"%PDF-1.7\n")

    original_copy2 = move_check.shutil.copy2

    def flaky_copy2(src, dst):
        if Path(src).name == "b.pdf":
            raise OSError("simulated failure")
        return original_copy2(src, dst)

    monkeypatch.setattr(move_check.shutil, "copy2", flaky_copy2)

    result = run(tmp_path)
    errors = [r for r in result["after_copy"] if "error" in r]
    oks = [r for r in result["after_copy"] if "error" not in r]
    assert len(errors) == 1
    assert errors[0]["path"].endswith("b.pdf")
    assert len(oks) == 1
    # 2026-09-28 최종 리뷰: 실패 행도 drm_check.check() 의 에러 행과 같은 키 구성을
    # 갖는다(size/sniff/open/plaintext) — 후처리 코드가 두 종류의 에러 행을 같은
    # 방식으로 다룰 수 있게 한다.
    assert errors[0]["plaintext"] is False
    assert errors[0]["size"] is None
    assert errors[0]["sniff"].startswith("error")
    assert errors[0]["open"] == "skip"


def test_move_check_missing_samples_folder_is_error_row_not_traceback(tmp_path):
    """samples 폴더가 없으면(사람이 아직 표본을 안 둔 경우) traceback 으로 죽지 않고
    pocio 스타일의 에러 정보만 담아 돌려줘야 한다."""
    from move_check import run

    # tmp_path 에는 _poc/samples 를 만들지 않는다 — 존재하지 않는 상태 그대로 호출.
    result = run(tmp_path)
    assert "samples_error" in result
    assert result["samples_error"].startswith("FileNotFoundError") or "FileNotFoundError" in result["samples_error"]
    assert result["before"] == []
    assert result["after_copy"] == []
    assert result["after_rename"] == []
    assert result["after_file_move"] == []


def test_move_check_main_returns_0_on_success(tmp_path):
    from move_check import main

    samples = tmp_path / "_poc" / "samples"
    samples.mkdir(parents=True)
    (samples / "a.pdf").write_bytes(b"%PDF-1.7\n")
    out = tmp_path / "out" / "exp2.json"
    assert main([str(tmp_path), "-o", str(out)]) == 0
    assert out.exists()


def test_move_check_main_returns_nonzero_when_samples_missing(tmp_path):
    from move_check import main

    out = tmp_path / "out" / "exp2.json"
    assert main([str(tmp_path), "-o", str(out)]) != 0


def test_move_check_records_rename_error_and_still_returns_after_copy(tmp_path, monkeypatch):
    from move_check import run
    import move_check

    samples = tmp_path / "_poc" / "samples"
    samples.mkdir(parents=True)
    (samples / "a.pdf").write_bytes(b"%PDF-1.7\n")

    def flaky_rename(src, dst):
        raise OSError("simulated rename failure")

    monkeypatch.setattr(move_check.os, "rename", flaky_rename)

    result = run(tmp_path)
    # rename(② 단계)이 죽어도 copy(① 단계) 결과는 그대로 돌아와야 한다.
    assert [r["sniff"] for r in result["after_copy"]] == ["pdf"]
    assert "rename_error" in result
    assert result["after_rename"] == []
    # rename 이 실패하면 ③ 파일 이동은 아예 시도하지 않는다.
    assert result["after_file_move"] == []


def test_move_check_records_file_move_errors_without_aborting(tmp_path, monkeypatch):
    from move_check import run
    import move_check

    samples = tmp_path / "_poc" / "samples"
    samples.mkdir(parents=True)
    (samples / "a.pdf").write_bytes(b"%PDF-1.7\n")
    (samples / "b.pdf").write_bytes(b"%PDF-1.7\n")

    original_replace = move_check.os.replace

    def flaky_replace(src, dst):
        if Path(src).name == "b.pdf":
            raise OSError("simulated replace failure")
        return original_replace(src, dst)

    monkeypatch.setattr(move_check.os, "replace", flaky_replace)

    result = run(tmp_path)
    errors = [r for r in result["after_file_move"] if "error" in r]
    oks = [r for r in result["after_file_move"] if "error" not in r]
    assert len(errors) == 1
    assert errors[0]["path"].endswith("b.pdf")
    assert len(oks) == 1
    assert errors[0]["plaintext"] is False
    assert errors[0]["size"] is None
    assert errors[0]["sniff"].startswith("error")
    assert errors[0]["open"] == "skip"


def test_collect_uses_os_walk_and_returns_files_and_empty_walk_errors(tmp_path):
    """정상 폴더는 기존과 동일하게 파일 목록만 돌려주고, walk 에러 목록은 비어 있다."""
    from drm_check import collect

    (tmp_path / "a.pdf").write_bytes(b"%PDF-1.7\n")
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "b.pdf").write_bytes(b"%PDF-1.7\n")

    targets, walk_errors = collect([str(tmp_path)])
    assert {p.name for p in targets} == {"a.pdf", "b.pdf"}
    assert walk_errors == []


def test_collect_records_walk_errors_as_rows_without_aborting(tmp_path, monkeypatch):
    """2026-09-28 최종 리뷰: Path.rglob() 은 하위 폴더 나열 자체가 실패(권한 없음 등)
    하면 예외로 전체 실행을 끊는다. os.walk(onerror=...) 로 바꿔 그 실패를 행으로만
    남기고 계속 진행해야 한다(다른 실험 스크립트와 동일한 관례)."""
    import drm_check

    (tmp_path / "a.pdf").write_bytes(b"%PDF-1.7\n")

    def fake_walk(folder, onerror=None, **kwargs):
        if onerror:
            onerror(OSError(13, "Permission denied", str(tmp_path / "blocked")))
        yield (str(tmp_path), [], ["a.pdf"])

    monkeypatch.setattr(drm_check.os, "walk", fake_walk)
    targets, walk_errors = drm_check.collect([str(tmp_path)])
    assert {p.name for p in targets} == {"a.pdf"}
    assert len(walk_errors) == 1
    assert "blocked" in walk_errors[0]["path"]
    assert walk_errors[0]["sniff"].startswith("error")
    assert walk_errors[0]["plaintext"] is False


def test_main_includes_walk_error_rows_and_exits_3(tmp_path, monkeypatch):
    import drm_check

    (tmp_path / "a.pdf").write_bytes(b"%PDF-1.7\n")

    def fake_walk(folder, onerror=None, **kwargs):
        if onerror:
            onerror(OSError(13, "Permission denied", str(tmp_path / "blocked")))
        yield (str(tmp_path), [], ["a.pdf"])

    monkeypatch.setattr(drm_check.os, "walk", fake_walk)
    out = tmp_path / "out" / "exp1.json"
    code = drm_check.main([str(tmp_path), "-o", str(out)])
    assert code == 3
    data = json.loads(out.read_text(encoding="utf-8"))
    assert any((r.get("sniff") or "").startswith("error") for r in data)
    assert any(r.get("sniff") == "pdf" for r in data)  # a.pdf 행은 그대로 정상 처리된다


def test_main_returns_0_when_no_drm_or_error(tmp_path):
    from drm_check import main

    f = tmp_path / "note.txt"
    f.write_bytes(b"plain text")
    out = tmp_path / "out.json"
    assert main([str(f), "-o", str(out)]) == 0


def test_main_returns_1_when_drm_present(tmp_path):
    from drm_check import main

    f = tmp_path / "locked.pptx"
    f.write_bytes(b"HHIDRMC" + b"\x00" * 16)
    out = tmp_path / "out.json"
    assert main([str(f), "-o", str(out)]) == 1


def test_main_returns_3_when_error_row_and_no_drm(tmp_path):
    from drm_check import main

    missing = tmp_path / "does_not_exist.pdf"
    out = tmp_path / "out.json"
    assert main([str(missing), "-o", str(out)]) == 3


def test_main_prefers_drm_exit_code_over_error(tmp_path):
    from drm_check import main

    drm_file = tmp_path / "locked.pptx"
    drm_file.write_bytes(b"HHIDRMC" + b"\x00" * 16)
    missing = tmp_path / "does_not_exist.pdf"
    out = tmp_path / "out.json"
    assert main([str(drm_file), str(missing), "-o", str(out)]) == 1
