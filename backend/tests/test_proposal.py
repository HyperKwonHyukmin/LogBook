from app.ingest.proposal import FileInfo, propose


def _f(i, rel):
    return FileInfo(key=i, rel_path=rel)


def test_single_uploaded_folder_is_one_proposal():
    files = [_f(1, "3496_Mooring_검토/model/a.bdf"), _f(2, "3496_Mooring_검토/report/검토.pptx")]
    [p] = propose(files, known=set())
    assert p.title == "3496 Mooring 검토"
    assert sorted(p.file_keys) == [1, 2]
    assert p.best_hull == "3496"


def test_subfolders_with_different_hulls_are_split():
    files = [_f(1, "자료/3496_Mooring/a.bdf"), _f(2, "자료/3496_Mooring/r.pdf"),
             _f(3, "자료/3370_권상/b.bdf")]
    props = sorted(propose(files, known=set()), key=lambda p: p.title)
    assert [p.title for p in props] == ["3370 권상", "3496 Mooring"]
    assert [p.best_hull for p in props] == ["3370", "3496"]


def test_subfolders_with_same_hull_stay_together():
    files = [_f(1, "3496/Mooring/a.bdf"), _f(2, "3496/권상/b.bdf")]
    [p] = propose(files, known=set())
    assert p.title == "3496"


def test_loose_files_group():
    files = [_f(1, "3496-35210_model.bdf"), _f(2, "3496-35210_model.f06")]
    [p] = propose(files, known=set())
    assert p.title == "3496-35210 model"
    assert p.best_hull == "3496"


def test_candidates_are_serializable():
    [p] = propose([_f(1, "3496_x/a.bdf")], known=set())
    assert p.hull_candidates[0]["hull_no"] == "3496"


def test_folder_label_keeps_dotted_version_suffix():
    """폴더 이름은 파일이 아니므로 확장자를 떼지 않는다 — 점을 확장자로 오인해
    버전 표기(v1.2)의 ".2" 를 잘라내면 안 된다."""
    files = [_f(1, "3496_검토_v1.2/a.bdf")]
    [p] = propose(files, known=set())
    assert p.title == "3496 검토 v1.2"
