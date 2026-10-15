"""여러 파일을 함께 올렸을 때 — 해석 모델(BDF)이 파일 목록 맨 위에 온다(목록에서 바로 열어 보기)."""
from app import models


def test_model_files_come_first(db, make_entry_file):
    from app.entries.service import entry_to_dict

    e, _ = make_entry_file(name="a_report.pdf", kind="report", status="draft")
    make_entry_file(entry=e, name="0_notes.txt", kind="other")
    _, inc = make_entry_file(entry=e, name="b_part.dat", kind="model")       # 변환 안 된 모델(INCLUDE 등)
    _, main = make_entry_file(entry=e, name="z_main.bdf", kind="model")      # 변환된 본 BDF
    db.add(models.ModelSummary(file_id=main.id, state="done"))
    db.commit()

    names = [f["name"] for f in entry_to_dict(db, e)["files"]]
    assert names[:2] == ["z_main.bdf", "b_part.dat"]
    assert sorted(names[2:]) == names[2:] == ["0_notes.txt", "a_report.pdf"]  # 나머지는 경로 순 그대로
