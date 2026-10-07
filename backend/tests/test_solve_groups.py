"""연결 그룹(06 §2.4) — 프런트 lib/modelGroups.js 와 같은 규칙."""
from app.bdf.deck import DeckReader
from app.bdf.groups import connected_groups
from app.bdf.model import build_model


def _model(text: str):
    r = DeckReader(lambda rel: text.encode())
    return build_model(r.read("m.bdf"))


def test_two_groups_sorted_by_element_count():
    m = _model("GRID,1,,0.,0.,0.\nGRID,2,,1.,0.,0.\nGRID,3,,2.,0.,0.\nGRID,4,,3.,0.,0.\n"
               "GRID,11,,0.,5.,0.\nGRID,12,,1.,5.,0.\n"
               "CROD,1,1,1,2\nCBAR,2,1,2,3,0.,0.,1.\nCBEAM,3,1,3,4,0.,0.,1.\n"
               "CONROD,4,11,12,1,1.\n")
    groups = connected_groups(m)
    assert groups == [{1, 2, 3, 4}, {11, 12}]


def test_shells_and_rigids_connect():
    m = _model("GRID,1,,0.,0.,0.\nGRID,2,,1.,0.,0.\nGRID,3,,1.,1.,0.\nGRID,4,,0.,1.,0.\n"
               "GRID,5,,5.,5.,5.\nGRID,6,,6.,5.,5.\nGRID,7,,7.,5.,5.\nGRID,8,,9.,9.,9.\n"
               "CQUAD4,1,1,1,2,3,4\nCTRIA3,2,1,5,6,7\nRBE2,10,4,123456,5\nRBE3,11,,8,123,1.,123,7\n")
    # RBE2 가 쉘 두 덩어리를 잇고, RBE3 의 기준 절점 8 도 같은 그룹이다
    assert connected_groups(m) == [{1, 2, 3, 4, 5, 6, 7, 8}]


def test_rigid_only_cluster_is_not_a_group():
    m = _model("GRID,1,,0.,0.,0.\nGRID,2,,1.,0.,0.\nGRID,3,,9.,0.,0.\nGRID,4,,9.,1.,0.\nGRID,5,,50.,0.,0.\n"
               "CROD,1,1,1,2\nRBE2,10,3,123456,4\n")
    assert connected_groups(m) == [{1, 2}]


def test_tie_breaks_by_smallest_node():
    m = _model("GRID,5,,0.,0.,0.\nGRID,6,,1.,0.,0.\nGRID,1,,0.,9.,0.\nGRID,2,,1.,9.,0.\n"
               "CROD,1,1,5,6\nCROD,2,1,1,2\n")
    assert connected_groups(m) == [{1, 2}, {5, 6}]
