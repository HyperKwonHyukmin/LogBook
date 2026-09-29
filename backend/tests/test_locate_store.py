import os

import pytest

from app.entries.locate import FileUnavailable, file_path
from app.extract.base import ExtractResult
from app.extract.store import cache_path, load_cached, save_cached
from app.storage.paths import to_long


def test_file_path_for_staging_and_vault(db, storage, make_entry_file):
    _draft, f1 = make_entry_file(status="draft", name="sub/a.pdf")
    p = file_path(db, storage, f1)
    assert p.startswith("\\\\?\\") and p.endswith("\\sub\\a.pdf")
    assert "_staging" in p

    entry, f2 = make_entry_file(status="confirmed", name="r.pdf")
    p2 = file_path(db, storage, f2)
    assert p2.endswith(f"10_Vault\\2026\\{entry.entry_id}\\files\\r.pdf")


def test_file_path_rejects_trash(db, storage, make_entry_file):
    _e, f = make_entry_file(status="trashed")
    with pytest.raises(FileUnavailable):
        file_path(db, storage, f)


def test_cache_roundtrip(storage):
    r = ExtractResult(chunks=[("page:1", "본문")], summary={"unit": "page", "count": 1}, truncated=True)
    sha = "ab" + "0" * 62
    save_cached(storage, sha, r)
    assert os.path.exists(to_long(cache_path(storage, sha)))
    back = load_cached(storage, sha)
    assert back.chunks == [("page:1", "본문")] and back.summary["count"] == 1 and back.truncated is True


def test_cache_missing_or_corrupt_is_none(storage):
    sha = "cd" + "1" * 62
    assert load_cached(storage, sha) is None
    p = cache_path(storage, sha)
    os.makedirs(to_long(p.parent), exist_ok=True)
    with open(to_long(p), "w", encoding="utf-8") as fh:
        fh.write("{not json")
    assert load_cached(storage, sha) is None


def test_cache_ignores_other_version(storage):
    import json

    sha = "ef" + "2" * 62
    p = cache_path(storage, sha)
    os.makedirs(to_long(p.parent), exist_ok=True)
    with open(to_long(p), "w", encoding="utf-8") as fh:
        json.dump({"version": 999, "chunks": [], "summary": {}}, fh)
    assert load_cached(storage, sha) is None


def test_file_path_bad_rel_path_is_unavailable(db, storage, make_entry_file):
    _e, f = make_entry_file(status="confirmed", name="../../x.pdf")
    with pytest.raises(FileUnavailable):
        file_path(db, storage, f)
