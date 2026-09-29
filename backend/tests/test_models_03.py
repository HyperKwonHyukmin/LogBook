from sqlalchemy import text

from app import models


def test_file_texts_has_ngram_fulltext_index(db):
    rows = db.execute(text("SHOW INDEX FROM file_texts WHERE Key_name = 'ft_file_texts_text'")).mappings().all()
    assert rows and rows[0]["Index_type"] == "FULLTEXT"


def test_ngram_fulltext_finds_korean_substring(db, make_entry_file):
    _e, f = make_entry_file()
    db.add(models.FileText(file_id=f.id, seq=0, locator="page:1", text="선체 구조 강도 평가 보고서"))
    db.commit()
    n = db.execute(text("SELECT COUNT(*) FROM file_texts WHERE MATCH(text) AGAINST(:q IN BOOLEAN MODE)"),
                   {"q": '"강도"'}).scalar()
    assert n == 1


def test_file_extract_row_defaults(db, make_entry_file):
    _e, f = make_entry_file()
    db.add(models.FileExtract(file_id=f.id))
    db.commit()
    row = db.get(models.FileExtract, f.id)
    assert row.state == "queued" and row.chars == 0 and row.summary is None


def test_download_token_row(db):
    from datetime import datetime, timedelta

    db.add(models.DownloadToken(token="t" * 36, file_id=1, employee_id="A100001",
                                expires_at=datetime.now() + timedelta(minutes=10)))
    db.commit()
    assert db.get(models.DownloadToken, "t" * 36).file_id == 1
