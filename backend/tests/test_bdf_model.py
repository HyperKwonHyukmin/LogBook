import math

import pytest

from app.bdf.coords import resolve_coords
from app.bdf.deck import DeckReader
from app.bdf.model import build_model


def _model(text: str):
    r = DeckReader(lambda rel: text.encode("utf-8"))
    return build_model(r.read("m.bdf"), sol=r.sol, warnings=r.warnings)


def test_basic_elements_properties_materials():
    m = _model(
        "GRID,1,,0.,0.,0.\nGRID,2,,1000.,0.,0.\nGRID,3,,1000.,1000.,0.\nGRID,4,,0.,1000.,0.\n"
        "CBEAM,10,1,1,2,0.,0.,1.\nCROD,11,2,2,3\nCONROD,12,3,4,1,25.\nCBUSH,13,4,1,\n"
        "CQUAD4,20,5,1,2,3,4\nCTRIA6,21,5,1,2,3,7,8,9\n"
        "PBEAML,1,1,MSCBML0,L\n,100.,100.,10.,10.,0.\nPROD,2,1,50.\nPSHELL,5,1,12.\n"
        "MAT1,1,206000.,,0.3,7.85-9\n"
    )
    assert [e.card for e in m.beams] == ["CBEAM", "CROD", "CONROD"]  # 접지 CBUSH(GB 없음)는 뺀다
    assert m.conrods[12] == {"mid": 1, "A": 25.0}
    assert [e.card for e in m.quads] == ["CQUAD4"] and m.tris[0].nodes == (1, 2, 3)
    assert m.properties[1] == {"card": "PBEAML", "mid": 1, "type": "L", "dims": [100.0, 100.0, 10.0, 10.0]}
    assert m.properties[2]["A"] == 50.0 and m.properties[5] == {"card": "PSHELL", "mid": 1, "t": 12.0}
    assert m.materials[1] == {"card": "MAT1", "E": 206000.0, "G": None, "nu": 0.3, "rho": pytest.approx(7.85e-9)}
    assert m.counts()["CBEAM"] == 1 and m.counts()["GRID"] == 4
    assert m.element_total() == 5
    assert m.bbox() == {"min": [0.0, 0.0, 0.0], "max": [1000.0, 1000.0, 0.0]}
    assert any(w.startswith("grounded_cbush") for w in m.warnings)


def test_rigids_masses_spcs():
    m = _model(
        "".join(f"GRID,{i},,{i}.,0.,0.\n" for i in range(1, 9))
        + "RBE2,100,1,123456,2,3,0.5\n"
        "RBE3,101,,4,123,1.0,123,5,6,0.5,12,7\n"
        "CONM2,200,8,,1.5\n"
        "SPC,1,1,123,0.,2,456\nSPC1,1,123456,3,THRU,5\n"
    )
    r2, r3 = m.rigids
    assert (r2.card, r2.center, r2.others) == ("RBE2", 1, [2, 3])
    assert (r3.card, r3.center, r3.others) == ("RBE3", 4, [5, 6, 7])
    assert m.masses == [(200, 8, 1.5)]
    assert m.spcs == {1: "123", 2: "456", 3: "123456", 4: "123456", 5: "123456"}


def test_missing_nodes_and_unsupported():
    m = _model("GRID,1,,0.,0.,0.\nCBAR,1,1,1,99\nFOO,1,2\nFOO,2\nFORCE,1,1,,1.,1.,0.,0.\n")
    assert m.beams == [] and any(w == "missing_node: 1" for w in m.warnings)
    assert m.unsupported == {"FOO": 2}


def test_cord2r_rotated_and_chained():
    # CID 10: 원점 (100,0,0), z 축 = 전역 z, x 축 = 전역 y 방향(90° 회전)
    # CID 20: CID 10 안에서 원점 (0,0,50)
    m = _model(
        "CORD2R,10,0,100.,0.,0.,100.,0.,1.\n,100.,1.,0.\n"
        "CORD2R,20,10,0.,0.,50.,0.,0.,51.\n,1.,0.,50.\n"
        "GRID,1,10,1.,0.,0.\nGRID,2,20,0.,0.,0.\n"
    )
    assert m.nodes[1] == pytest.approx((100.0, 1.0, 0.0))
    assert m.nodes[2] == pytest.approx((100.0, 0.0, 50.0))


def test_cylindrical_and_spherical():
    m = _model(
        "CORD2C,1,0,0.,0.,0.,0.,0.,1.\n,1.,0.,0.\nCORD2S,2,0,0.,0.,0.,0.,0.,1.\n,1.,0.,0.\n"
        "GRID,1,1,10.,90.,5.\nGRID,2,2,10.,90.,0.\n"
    )
    assert m.nodes[1] == pytest.approx((0.0, 10.0, 5.0), abs=1e-9)
    assert m.nodes[2] == pytest.approx((10.0, 0.0, 0.0), abs=1e-9)


def test_cord1r_defined_by_grids():
    m = _model(
        "GRID,1,,0.,0.,0.\nGRID,2,,0.,0.,1.\nGRID,3,,0.,1.,0.\n"
        "CORD1R,5,1,2,3\nGRID,4,5,2.,0.,0.\n"
    )
    assert m.nodes[4] == pytest.approx((0.0, 2.0, 0.0))


def test_unresolved_coord_warns():
    m = _model("GRID,1,77,1.,0.,0.\n")
    assert 1 not in m.nodes and any(w.startswith("coord_unresolved: 1") for w in m.warnings)


def test_resolve_coords_degenerate_system():
    nodes, unresolved, bad = resolve_coords({1: (9, 0.0, 0.0, 0.0)},
                                            [("2", "R", 9, 0, [0.0] * 9)])
    assert unresolved == 1 and bad == [9]


def test_section_dim_count_and_pcomp():
    m = _model(
        "PBARL,1,1,,TUBE\n,50.,40.,7.\nPBARL,2,1,,I\n,300.,150.,150.,9.,12.,12.\n"
        "PCOMP,3\n,1,2.,0.,,1,3.,45.\n"
    )
    assert m.properties[1]["dims"] == [50.0, 40.0]           # NSM 7. 은 버린다
    assert m.properties[2]["dims"] == [300.0, 150.0, 150.0, 9.0, 12.0, 12.0]
    assert m.properties[3] == {"card": "PCOMP", "t": 5.0}
