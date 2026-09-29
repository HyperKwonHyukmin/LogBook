from app.entries.files import unique_rel


def test_unique_rel_avoids_disk_collision(tmp_path):
    (tmp_path / "r.pdf").write_bytes(b"x")
    assert unique_rel(tmp_path, "r.pdf") == "r (2).pdf"


def test_unique_rel_no_collision_returns_as_is(tmp_path):
    assert unique_rel(tmp_path, "r.pdf") == "r.pdf"


def test_unique_rel_avoids_already_planned_name_in_same_batch(tmp_path):
    """M1: 디스크에는 아직 아무것도 없어도(옮기기 전), 같은 확정/합치기 작업 안에서
    이미 다른 파일에 배정한 이름과 겹치면 안 된다 — 대소문자 무시(casefold, Windows
    파일시스템 기준)."""
    planned: set[str] = set()
    first = unique_rel(tmp_path, "r.pdf", planned)
    second = unique_rel(tmp_path, "r.pdf", planned)
    assert (first, second) == ("r.pdf", "r (2).pdf")

    # 대소문자만 다른 이름도 같은 것으로 본다.
    third = unique_rel(tmp_path, "R.PDF", planned)
    assert third == "R (3).PDF"
