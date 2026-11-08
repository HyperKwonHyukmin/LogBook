"""61 — Abaqus .inp 3D 뷰어: inp 읽기 → Model → lbm, 변환 작업 연결."""
import os

from app import models
from app.abaqus.inp import InpReader, build_inp_model
from app.bdf.deck import DeckReader
from app.bdf.fingerprint import fingerprint
from app.bdf.lbm import read_lbm, write_lbm
from app.bdf.model import BEAM_CARDS, QUAD_CARDS, TRI_CARDS, build_model
from app.convert.job import enqueue_convert, model_paths, run_convert
from app.entries.locate import file_path
from app.ingest.rules import classify, has_model_view
from app.storage.paths import to_long


def _model(files: dict[str, str], main: str = "m.inp"):
    def opener(rel: str) -> bytes:          # 실제 opener 처럼 없는 파일은 OSError
        if rel not in files:
            raise FileNotFoundError(rel)
        return files[rel].encode()

    r = InpReader(opener)
    blocks = r.read(main)
    return build_inp_model(blocks, warnings=r.warnings, includes=r.includes, missing=r.missing), r


PLANE = """** HyperMesh 2D
*NODE
1, 0.0, 0.0
2, 100.0, 0.0
3, 100.0, 50.0
4, 0.0, 50.0
5, 200.0, 0.0
*ELEMENT,TYPE=CPS4R,ELSET=PLATE
10, 1, 2, 3, 4
*ELEMENT,TYPE=CPS3,ELSET=TRI
11, 2, 5, 3
*SOLID SECTION, ELSET=PLATE, MATERIAL=steel
12.0
*MATERIAL, NAME=Steel
*DENSITY
7.85e-9
*ELASTIC, TYPE = ISOTROPIC
206000.0, 0.3
*STEP
*STATIC
*BOUNDARY
1, 1, 2, 0.0
4, ENCASTRE
*END STEP
"""


def test_plane_model_2d_nodes_sections_materials_boundary():
    m, _r = _model({"m.inp": PLANE})
    assert m.nodes[3] == (100.0, 50.0, 0.0)            # 2D 절점은 z = 0
    assert m.counts() == {"CPS4R": 1, "CPS3": 1, "GRID": 5}
    quad, tri = m.quads[0], m.tris[0]
    assert quad.nodes == (1, 2, 3, 4) and tri.nodes == (2, 5, 3)
    sec = m.properties[quad.pid]
    assert sec["card"] == "SOLID SECTION" and sec["name"] == "PLATE" and sec["t"] == 12.0
    assert m.materials[sec["mid"]] == {"card": "MATERIAL", "abaqus": True, "name": "STEEL",
                                       "E": 206000.0, "nu": 0.3, "rho": 7.85e-9}
    # 단면이 없는 요소는 *ELEMENT 의 ELSET 마다 PID 하나
    assert m.properties[tri.pid] == {"card": "ELSET", "abaqus": True, "name": "TRI", "kind": "ELSET"}
    assert m.spcs == {1: "12", 4: "123456"}
    assert m.sol == "STATIC"


PIPE = """*NODE
1, 0., 0., 0.
2, 500., 0., 0.
3, 1000., 0., 0.
4, 1000., 0., 500.
9, 0., 100., 0.
*ELEMENT, TYPE=B32, ELSET=LINE1
1, 1, 2, 3
*ELEMENT, TYPE=B31, ELSET=LINE2
2, 3, 4, 9
*ELEMENT, TYPE=CONN3D2, ELSET=PUSH
3, 4
4, 1, 9
*ELEMENT, TYPE=SPRINGA, ELSET=SP
5, 2, 9
*BEAM SECTION, ELSET=LINE1, MATERIAL=A312, SECTION=PIPE
36.5, 14.0
0.0, 0.0, 2.0
*BEAM SECTION, ELSET=LINE2, MATERIAL=A312, SECTION=CIRC
10.
*MATERIAL, NAME=A312
*ELASTIC
193000., 0.29
"""


def test_line_elements_end_nodes_pipe_section_and_orientation():
    m, _r = _model({"m.inp": PIPE})
    beams = {e.eid: e for e in m.beams}
    assert beams[1].card == "B32" and beams[1].nodes == (1, 3)     # 끝·가운데·끝 → 양 끝
    assert beams[2].nodes == (3, 4)                                 # B31 의 3번째(방향 절점)는 버린다
    assert beams[1].v == (0.0, 0.0, 1.0)                            # n1 방향을 단위 벡터로
    assert beams[4].card == "CONN3D2" and beams[5].card == "SPRINGA"
    assert 3 not in beams and "grounded_element: 1" in m.warnings   # 한 절점 커넥터
    p1 = m.properties[beams[1].pid]
    assert p1["type"] == "TUBE" and p1["dims"] == [36.5, 22.5] and p1["data"] == [36.5, 14.0]
    assert m.properties[beams[2].pid]["type"] == "ROD"
    assert "LINE1 PIPE 36.5,14" in fingerprint(m)


SETS = """*NODE, NSET=ALL
1, 0., 0., 0.
2, 10., 0., 0.
3, 10., 10., 0.
4, 0., 10., 0.
5, 5., 5., 10.
6, 20., 0., 0.
*ELEMENT, TYPE=S4R, ELSET=SKIN
1, 1, 2, 3,
   4
*ELEMENT, TYPE=C3D8R, ELSET=BLOCK
7, 1, 2, 3, 4, 1, 2, 3, 4
*ELEMENT, TYPE=MASS, ELSET=PM
8, 5
*MASS, ELSET=PM
2.5
*NSET, NSET=EDGE, GENERATE
1, 2, 1
*NSET, NSET=BOTH
EDGE, 4
*SHELL SECTION, ELSET=SKIN, MATERIAL=M
8.0
*MPC
TIE, 6, 2
*KINEMATIC COUPLING, REF NODE=5
EDGE, 1, 3
*SURFACE, NAME=SURF, TYPE=NODE
BOTH
*COUPLING, CONSTRAINT NAME=C1, REF NODE=5, SURFACE=SURF
*DISTRIBUTING
1, 6
*INCLUDE, INPUT=bc.inp
"""
BC = """*BOUNDARY
BOTH, 3
"""


def test_sets_include_continuation_rigids_masses_and_solids():
    m, r = _model({"m.inp": SETS, "bc.inp": BC})
    assert r.includes == ["bc.inp"] and r.missing == []
    assert m.quads[0].nodes == (1, 2, 3, 4)                         # 끝 쉼표로 이어진 요소 줄
    assert m.properties[m.quads[0].pid]["t"] == 8.0
    assert m.unsupported == {"C3D8R": 1} and "solid_elements: 1" in m.warnings
    assert m.masses == [(8, 5, 2.5)]
    rig = sorted((x.card, x.center, sorted(x.others)) for x in m.rigids)
    assert rig == [("RBE2", 2, [6]), ("RBE2", 5, [1, 2]), ("RBE3", 5, [1, 2, 4])]
    assert all(x.eid > 8 for x in m.rigids)                        # 요소 번호와 겹치지 않는 번호
    assert m.spcs == {1: "3", 2: "3", 4: "3"}


def test_missing_include_and_parts_warn():
    m, r = _model({"m.inp": "*PART, NAME=P1\n*NODE\n1,0,0,0\n2,1,0,0\n*ELEMENT,TYPE=T3D2\n1,1,2\n"
                            "*END PART\n*INCLUDE, INPUT=nope.inp\n"})
    assert r.missing == ["nope.inp"] and "include_missing: nope.inp" in m.warnings
    assert "parts_flat" in m.warnings and m.counts()["T3D2"] == 1


def test_lbm_card_lists_keep_bdf_order_and_append_abaqus_names():
    m, _r = _model({"m.inp": PIPE + "*NODE\n11,0,0\n12,1,0\n13,1,1\n14,0,1\n*ELEMENT,TYPE=CPS4R\n10,11,12,13,14\n"})
    header, blocks = read_lbm(write_lbm(m))
    assert header["cards"]["beam"][:len(BEAM_CARDS)] == list(BEAM_CARDS)
    assert header["cards"]["beam"][len(BEAM_CARDS):] == ["B32", "B31", "CONN3D2", "SPRINGA"]
    names = [header["cards"]["beam"][i] for i in blocks["beam_cards"]]
    assert names == [e.card for e in m.beams]
    assert header["cards"]["quad"][blocks["quad_cards"][0]] == "CPS4R"

    # BDF 는 이름표가 예전과 똑같다(옛 lbm 과 번호가 맞는다)
    reader = DeckReader(lambda rel: b"GRID,1,,0.,0.,0.\nGRID,2,,1.,0.,0.\nGRID,3,,1.,1.,0.\nCTRIA3,1,1,1,2,3\n")
    bh, _b = read_lbm(write_lbm(build_model(reader.read("a.bdf"))))
    assert bh["cards"] == {"beam": list(BEAM_CARDS), "tri": list(TRI_CARDS), "quad": list(QUAD_CARDS),
                           "rigid": ["RBE2", "RBE3"]}


def test_inp_kind_stays_other_but_has_model_view():
    assert classify("a.inp") == "other"
    assert has_model_view("other", "Fuel.INP") and has_model_view("model", "a.bdf")
    assert not has_model_view("other", "a.odb")


def test_run_convert_inp(db, storage, make_entry_file):
    _e, f = make_entry_file(name="pipe.inp", kind="other", sha="d" * 64)
    p = file_path(db, storage, f)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as fh:
        fh.write(PIPE.encode())
    assert enqueue_convert(db, f)
    db.commit()
    assert [j.type for j in db.query(models.Job)] == ["convert_model"]
    run_convert(db, storage, f)
    s = db.get(models.ModelSummary, f.id)
    assert s.state == "done" and s.error is None, s.error
    assert s.counts["B32"] == 1 and s.sig_geometry is None and not s.lifting
    lbm, png = model_paths(storage, s.key)
    assert os.path.exists(to_long(lbm)) and os.path.exists(to_long(png))
    ft = db.query(models.FileText).filter_by(file_id=f.id, locator="model").one()
    assert "B32 1" in ft.text


def test_cli_enqueue_convert_all_includes_inp(db, make_entry_file):
    from app.cli import enqueue_convert_all

    _e, f = make_entry_file(name="a.inp", kind="other")
    _e2, pdf = make_entry_file(name="r.pdf", kind="report")
    assert enqueue_convert_all(db) == 1
    assert db.get(models.ModelSummary, f.id).state == "queued"
    assert db.get(models.ModelSummary, pdf.id) is None
