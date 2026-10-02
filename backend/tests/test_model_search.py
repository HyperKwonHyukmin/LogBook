import os

from app.convert.job import run_convert
from app.entries.locate import file_path
from app.search import SearchQuery, get_search

MESH = ("GRID,1,,0.,0.,0.\nGRID,2,,1000.,0.,0.\nCBEAM,1,1,1,2,0.,0.,1.\n"
        "PBEAML,1,1,,L\n,100.,100.,10.,10.\n")


def test_fingerprint_is_searchable(db, storage, make_entry_file):
    e, f = make_entry_file(title="모델 검토", name="m.bdf", kind="model")
    p = file_path(db, storage, f)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as fh:
        fh.write(MESH)
    run_convert(db, storage, f)
    res = get_search().search(db, SearchQuery(q="100x100x10x10"))
    assert [i["entry_id"] for i in res["items"]] == [e.entry_id]
    snip = res["items"][0]["snippets"][0]
    assert snip["locator"] == "model" and "PBEAML L 100x100x10x10" in snip["text"]


def test_file_items_carry_model_state_and_key(db, storage, make_entry_file):
    from app import models

    e, f = make_entry_file(title="모델 검토", name="m.bdf", kind="model")
    make_entry_file(entry=e, name="r.pdf")
    p = file_path(db, storage, f)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as fh:
        fh.write(MESH)
    run_convert(db, storage, f)
    key = db.get(models.ModelSummary, f.id).key
    res = get_search().search(db, SearchQuery(q="", unit="file"))
    by = {i["name"]: i for i in res["items"]}
    assert (by["m.bdf"]["model_state"], by["m.bdf"]["model_key"]) == ("done", key)
    assert (by["r.pdf"]["model_state"], by["r.pdf"]["model_key"]) == (None, None)
