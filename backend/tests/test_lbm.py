import gzip
import struct

import numpy as np

from app.bdf.deck import DeckReader
from app.bdf.lbm import read_lbm, write_lbm
from app.bdf.model import build_model

DECK = (
    "SOL 101\nCEND\nBEGIN BULK\n"
    "GRID,3,,0.,1000.,0.\nGRID,1,,0.,0.,0.\nGRID,2,,1000.,0.,0.\nGRID,4,,1000.,1000.,0.\n"
    "CBEAM,10,1,1,2,0.,0.,1.\nCONROD,11,2,3,1,25.\nCQUAD4,20,5,1,2,4,3\nCTRIA3,21,5,1,2,4\n"
    "RBE2,30,1,123456,2,3\nRBE3,31,,4,123,1.,123,1,2\nCONM2,40,4,,2.5\nSPC1,1,123456,1,3\n"
    "PBEAML,1,1,,L\n,100.,100.,10.,10.\nPSHELL,5,1,12.\nMAT1,1,206000.,,0.3,7.85-9\nFOO,1\nENDDATA\n"
)


def _model():
    r = DeckReader(lambda rel: DECK.encode())
    return build_model(r.read("m.bdf"), sol=r.sol, warnings=r.warnings)


def test_layout_and_alignment():
    raw = gzip.decompress(write_lbm(_model()))
    assert raw[:4] == b"LBM1"
    (hlen,) = struct.unpack("<I", raw[4:8])
    assert hlen % 4 == 0 and (8 + hlen) % 4 == 0
    header, blocks = read_lbm(write_lbm(_model()))
    for meta in header["blocks"].values():
        assert meta["offset"] % 4 == 0


def test_roundtrip_blocks():
    header, b = read_lbm(write_lbm(_model()))
    assert header["version"] == 2 and header["sol"] == "101"
    assert b["node_ids"].tolist() == [1, 2, 3, 4]
    assert b["node_xyz"].shape == (4, 3) and b["node_xyz"][1].tolist() == [1000.0, 0.0, 0.0]
    assert b["beams"].tolist() == [[10, 1, 0, 1], [11, 0, 1, 2]]  # CONROD 11: G1=2, G2=3 → 순번 1, 2
    assert [header["cards"]["beam"][i] for i in b["beam_cards"].tolist()] == ["CBEAM", "CONROD"]
    assert b["quads"].tolist() == [[20, 5, 0, 1, 3, 2]] and b["tris"].tolist() == [[21, 5, 0, 1, 3]]
    assert b["rigid_lines"].tolist() == [[30, 0, 1], [30, 0, 2], [31, 3, 0], [31, 3, 1]]
    assert b["rigid_kinds"].tolist() == [0, 0, 1, 1]
    assert b["masses"].tolist() == [[40, 3]] and b["mass_values"].tolist() == [2.5]
    assert b["spcs"].tolist() == [[0, 123456], [2, 123456]]
    assert header["properties"]["1"]["dims"] == [100.0, 100.0, 10.0, 10.0]
    assert header["conrods"]["11"] == {"mid": 1, "A": 25.0}
    assert header["counts"]["CQUAD4"] == 1 and header["unsupported"] == {"FOO": 1}
    assert header["bbox"] == {"min": [0.0, 0.0, 0.0], "max": [1000.0, 1000.0, 0.0]}


def test_empty_blocks_are_present():
    r = DeckReader(lambda rel: b"GRID,1,,0.,0.,0.\nGRID,2,,1.,0.,0.\nCROD,1,1,1,2\n")
    header, b = read_lbm(write_lbm(build_model(r.read("m.bdf"))))
    assert b["tris"].shape == (0, 5) and b["rigid_lines"].shape == (0, 3) and b["mass_values"].shape == (0,)
    assert isinstance(b["node_xyz"], np.ndarray)
