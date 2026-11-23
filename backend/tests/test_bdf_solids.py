"""솔리드 요소 겉면 미리보기(2026-11-24) — CTETRA 만 든 BDF 가 '요소 없음'으로 미리보기가 안 되던 것."""
from app.bdf.deck import DeckReader
from app.bdf.fingerprint import fingerprint
from app.bdf.lbm import read_lbm, write_lbm
from app.bdf.model import build_model


def _model(text: str):
    r = DeckReader(lambda rel: text.encode("utf-8"))
    return build_model(r.read("m.bdf"), sol=r.sol, warnings=r.warnings)


CUBE = "".join(f"GRID,{i + 1},,{x}.,{y}.,{z}.\n" for i, (x, y, z) in enumerate(
    [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0), (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)]))


def test_two_tetras_share_inner_face():
    # 사면체 둘이 면(1,2,3)을 나눈다 → 겉면 4 + 4 - 2 = 6
    m = _model("GRID,1,,0.,0.,0.\nGRID,2,,1.,0.,0.\nGRID,3,,0.,1.,0.\nGRID,4,,0.,0.,1.\nGRID,5,,0.,0.,-1.\n"
               "CTETRA,10,7,1,2,3,4\nCTETRA,11,7,1,3,2,5\nPSOLID,7,1\nMAT1,1,206000.,,0.3\n")
    assert len(m.tris) == 6 and not m.quads
    assert {e.eid for e in m.tris} == {10, 11} and {e.card for e in m.tris} == {"CTETRA"}
    assert all(e.pid == 7 for e in m.tris)
    assert tuple(sorted((1, 2, 3))) not in {tuple(sorted(e.nodes)) for e in m.tris}
    assert m.counts()["CTETRA"] == 2 and m.element_total() == 6
    assert "CTRIA3" not in m.counts() and not m.unsupported
    assert fingerprint(m).startswith("CTETRA 2")
    header, blocks = read_lbm(write_lbm(m))
    assert "CTETRA" in header["cards"]["tri"] and header["counts"]["CTETRA"] == 2
    assert len(blocks["tris"]) == 6


def test_tetra10_uses_corners_only():
    m = _model("GRID,1,,0.,0.,0.\nGRID,2,,1.,0.,0.\nGRID,3,,0.,1.,0.\nGRID,4,,0.,0.,1.\n"
               + "".join(f"GRID,{i},,0.5,0.5,0.5\n" for i in range(5, 11))
               + "CTETRA,1,1,1,2,3,4,5,6\n,7,8,9,10\n")
    assert len(m.tris) == 4
    assert {n for e in m.tris for n in e.nodes} == {1, 2, 3, 4}


def test_hexa_skips_face_covered_by_shell():
    # 육면체 겉면 6개 중 밑면(1,2,3,4)은 CQUAD4 가 이미 덮는다 → 솔리드 겉면 5 + 쉘 1
    m = _model(CUBE + "CHEXA,1,1,1,2,3,4,5,6\n,7,8\nCQUAD4,100,2,1,2,3,4\n")
    assert [e.card for e in m.quads].count("CHEXA") == 5
    assert [e.card for e in m.quads].count("CQUAD4") == 1
    assert m.counts() == {"CHEXA": 1, "CQUAD4": 1, "GRID": 8}


def test_penta_and_pyram_faces():
    m = _model(CUBE + "CPENTA,1,1,1,2,3,5,6,7\n")
    assert sorted(len(e.nodes) for e in (*m.tris, *m.quads)) == [3, 3, 4, 4, 4]
    m = _model(CUBE + "CPYRAM,2,1,1,2,3,4,7\n")
    assert len(m.tris) == 4 and len(m.quads) == 1


def test_solid_with_missing_node_is_dropped():
    m = _model("GRID,1,,0.,0.,0.\nGRID,2,,1.,0.,0.\nGRID,3,,0.,1.,0.\nCTETRA,1,1,1,2,3,99\n")
    assert m.element_total() == 0 and "CTETRA" not in m.counts()
    assert "missing_node: 1" in m.warnings
