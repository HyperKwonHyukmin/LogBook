import hashlib

import pytest

from app.ingest.hashing import sha256_of
from app.ingest.rules import classify, is_excluded, safe_ext


@pytest.mark.parametrize("name", ["~$검토.pptx", "Thumbs.db", "desktop.ini", "a.MASTER", "a.dball",
                                  "job.SCRATCH", "x.tmp", ".DS_Store", "._resource", "download.crdownload",
                                  "partial.part"])
def test_excluded(name):
    assert is_excluded(name) is True


@pytest.mark.parametrize("name", ["a.bdf", "보고서.pptx", "Thumbs.db.bak"])
def test_not_excluded(name):
    assert is_excluded(name) is False


@pytest.mark.parametrize("name,kind", [
    ("a.bdf", "model"), ("a.DAT", "model"), ("a.nas", "model"), ("inc.blk", "model"),
    ("a.f06", "result"), ("a.op2", "result"), ("a.h5", "result"), ("a.log", "result"),
    ("검토.pptx", "report"), ("계산.xlsx", "report"), ("보고서.pdf", "report"), ("메모.docx", "report"),
    ("도면.dwg", "drawing"), ("a.dxf", "drawing"), ("캡처.png", "drawing"), ("사진.JPG", "drawing"),
    ("a.zip", "other"), ("README", "other"),
])
def test_classify(name, kind):
    assert classify(name) == kind


def test_sha256_of(tmp_path):
    p = tmp_path / "a.bin"
    p.write_bytes(b"logbook" * 1000)
    assert sha256_of(p) == hashlib.sha256(b"logbook" * 1000).hexdigest()


def test_safe_ext_filters_long_or_spaced():
    assert safe_ext("a.bdf") == ".bdf"
    assert safe_ext("noext") == ""
    assert safe_ext("weird." + "x" * 12) == ""
    assert safe_ext("file.a b") == ""
