"""12 — BDF 내용 서명(범주별 정규화 해시)과 '같은 BDF' 조회. 합성 모델만 쓴다(가상 호선 9999·9001·9002)."""
import os

import pytest

from app import models
from app.bdf.deck import DeckReader
from app.bdf.signature import REAL_DIGITS, VERSION, compute_signature, norm_field

# ── 기준 모델(자유 형식) ─────────────────────────────────────────────
BASE = """SOL 101
CEND
TITLE = 9999 합성 시험
SUBCASE 1
  LOAD = 10
  SPC = 1
  DISP = ALL
BEGIN BULK
$ 형상
GRID,1,,0.,0.,0.
GRID,2,,1000.,0.,0.
GRID,3,,1000.,1000.,0.
GRID,4,,0.,1000.,0.
GRID,5,,0.001,0.,500.
CQUAD4,1,5,1,2,3,4
CBAR,2,7,1,5,0.,0.,1.
RBE2,3,5,123456,4
PSHELL,5,1,12.
PBARL,7,1,,ROD
,25.
MAT1,1,206000.,,0.3,7.85-9
FORCE,10,3,,1000.,0.,0.,-1.
SPC1,1,123456,1,2
PARAM,POST,-1
ENDDATA
"""


def fx(*fields: str) -> str:
    """고정 소형 필드 줄(8칸씩)."""
    return "".join(f"{x:<8}" for x in fields).rstrip() + "\n"


def lg(*fields: str) -> str:
    """고정 대형 필드 줄(이름 8칸 + 16칸씩)."""
    return f"{fields[0]:<8}" + "".join(f"{x:<16}" for x in fields[1:]).rstrip() + "\n"


# 같은 모델 — 고정·대형 필드, 카드 순서 섞기, 주석, 실수 표기 차이(1.-3, 1.0E+3, 후행 0), TITLE 다름, 케이스 문장 순서
SAME_FIXED = (
    "$ 다른 사람이 다른 도구로 저장한 같은 모델\nSOL 101\nCEND\nTITLE = 다른 제목\nSUBTITLE = 부제\n"
    "SUBCASE 1\n  DISP = ALL\n  SPC=1\n  LOAD   =   10\nBEGIN BULK\n"
    + fx("PARAM", "POST", "-1")
    + fx("MAT1", "1", "2.06+5", "", ".3", "7.85E-9")
    + fx("FORCE", "10", "3", "", "1.0E+3", "0.0", "0.", "-1.0")
    + fx("CBAR", "2", "7", "1", "5", "0.", "0.", "1.")
    + "$ 주석 줄\n"
    + fx("CQUAD4", "1", "5", "1", "2", "3", "4")
    + lg("GRID*", "5", "", "1.-3", "0.0") + lg("*", "500.000")
    + fx("GRID", "1", "", "0.", "0.", "0.")
    + fx("GRID", "2", "", "1000.0", "0.", "0.")
    + fx("GRID", "3", "", "1.+3", "1000.", "0.")
    + fx("GRID", "4", "", "0.", "1000.", "0.")
    + fx("RBE2", "3", "5", "123456", "4")
    + fx("PSHELL", "5", "1", "12.00")
    + fx("PBARL", "7", "1", "", "ROD") + fx("", "25.0")
    + fx("SPC1", "1", "123456", "1", "2")
    + "ENDDATA\n")


def sig_of(text: str, files: dict[str, str] | None = None):
    store = {"main.bdf": text} | (files or {})
    reader = DeckReader(lambda rel: store[rel].encode("utf-8"))
    cards = reader.read("main.bdf")
    return compute_signature(cards, reader.control, reader.sol)


def diff(a, b) -> set[str]:
    return {c for c in ("geometry", "property", "material", "load", "other") if getattr(a, c) != getattr(b, c)}


def test_format_order_comments_and_real_notation_do_not_matter():
    assert diff(sig_of(BASE), sig_of(SAME_FIXED)) == set()


def test_include_split_is_same_model():
    main = BASE.replace("MAT1,1,206000.,,0.3,7.85-9\n", "INCLUDE 'mat.bdf'\n")
    assert diff(sig_of(BASE), sig_of(main, {"mat.bdf": "MAT1,1,206000.,,0.3,7.85-9\n"})) == set()


def test_real_digits_constant_fixed():
    """실수 비교는 유효숫자 7자리 — 규칙이 바뀌면 서명이 모두 달라지므로 테스트로 묶는다."""
    assert REAL_DIGITS == 7 and VERSION == 1
    assert norm_field("1.0000001") == norm_field("1.00000012")
    assert norm_field("1.000001") != norm_field("1.000002")
    assert norm_field("1.-3") == norm_field("0.001") == norm_field("1.0E-3") == norm_field("1.0D-3")
    assert norm_field("1.") == norm_field("1.000") and norm_field("1.") != norm_field("1")   # 실수·정수 구별
    assert norm_field("-0.") == norm_field("0.0")
    assert norm_field(" 007 ") == "7" and norm_field("all") == "ALL" and norm_field("") == ""


def test_grid_coordinate_change_is_geometry():
    assert diff(sig_of(BASE), sig_of(BASE.replace("GRID,3,,1000.,1000.,0.", "GRID,3,,1000.,1000.,1."))) == {"geometry"}


def test_pshell_thickness_is_property_only():
    assert diff(sig_of(BASE), sig_of(BASE.replace("PSHELL,5,1,12.", "PSHELL,5,1,14."))) == {"property"}


def test_element_pid_change_is_property_only():
    changed = BASE.replace("CQUAD4,1,5,", "CQUAD4,1,6,").replace("PSHELL,5,1,12.", "PSHELL,5,1,12.\nPSHELL,6,1,12.")
    assert diff(sig_of(BASE), sig_of(changed)) == {"property"}


def test_blank_pid_equals_eid():
    a = sig_of("GRID,1,,0.,0.,0.\nGRID,2,,1.,0.,0.\nCROD,7,,1,2\nPROD,7,1,10.\n")
    b = sig_of("GRID,1,,0.,0.,0.\nGRID,2,,1.,0.,0.\nCROD,7,7,1,2\nPROD,7,1,10.\n")
    assert diff(a, b) == set()


def test_mat_change_is_material_only():
    assert diff(sig_of(BASE), sig_of(BASE.replace("206000.", "210000."))) == {"material"}


def test_force_and_spc_are_load_only():
    assert diff(sig_of(BASE), sig_of(BASE.replace("1000.,0.,0.,-1.", "2000.,0.,0.,-1."))) == {"load"}
    assert diff(sig_of(BASE), sig_of(BASE.replace("SPC1,1,123456,1,2", "SPC1,1,123456,1,2\nSPC1,1,3,3"))) == {"load"}


def test_case_title_ignored_but_load_selection_matters():
    assert diff(sig_of(BASE), sig_of(BASE.replace("9999 합성 시험", "9001 다른 제목"))) == set()
    changed = BASE.replace("LOAD = 10", "LOAD = 20").replace("FORCE,10,", "FORCE,10,") + ""
    assert diff(sig_of(BASE), sig_of(changed)) == {"load"}
    assert diff(sig_of(BASE), sig_of(BASE.replace("SOL 101", "SOL 103"))) == {"load"}
    assert diff(sig_of(BASE), sig_of(BASE.replace("SOL 101", "SOL SESTATIC"))) == set()


def test_output_request_and_param_are_other_only():
    assert diff(sig_of(BASE), sig_of(BASE.replace("DISP = ALL", "STRESS = ALL"))) == {"other"}
    assert diff(sig_of(BASE), sig_of(BASE.replace("PARAM,POST,-1", "PARAM,POST,0"))) == {"other"}


def test_inline_element_values_are_property():
    a = "GRID,1,,0.,0.,0.\nGRID,2,,1.,0.,0.\nCONROD,1,1,2,1,10.\nCELAS2,2,100.,1,1,2,1\n"
    assert diff(sig_of(a), sig_of(a.replace("CONROD,1,1,2,1,10.", "CONROD,1,1,2,1,12."))) == {"property"}
    assert diff(sig_of(a), sig_of(a.replace("CELAS2,2,100.", "CELAS2,2,200."))) == {"property"}
    assert diff(sig_of(a), sig_of(a.replace("CONROD,1,1,2,", "CONROD,1,2,1,"))) == {"geometry"}


def test_conm_is_load():
    a = BASE.replace("PARAM,POST,-1", "CONM2,90,5,,1.5")
    assert diff(sig_of(a), sig_of(a.replace("CONM2,90,5,,1.5", "CONM2,90,5,,2.5"))) == {"load"}


# ── 변환 작업 · API ─────────────────────────────────────────────────

def _write(db, storage, f, text: str):
    from app.entries.locate import file_path

    p = file_path(db, storage, f)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as fh:
        fh.write(text.encode("utf-8"))


@pytest.fixture
def convert(db, storage):
    from app.convert.job import run_convert

    def _go(f, text):
        _write(db, storage, f, text)
        run_convert(db, storage, f)
        return db.get(models.ModelSummary, f.id)

    return _go


def test_convert_stores_signature(db, convert, make_entry_file):
    _e, f = make_entry_file(name="a.bdf", kind="model", hulls=("9999",))
    s = convert(f, BASE)
    assert s.state == "done" and s.sig_version == VERSION
    expected = sig_of(BASE)
    assert (s.sig_geometry, s.sig_property, s.sig_material, s.sig_load, s.sig_other) == (
        expected.geometry, expected.property, expected.material, expected.load, expected.other)


def test_include_piece_has_no_signature(db, storage, convert, make_entry_file):
    e, main = make_entry_file(name="main.bdf", kind="model", sha="1" * 64)
    _e, mesh = make_entry_file(entry=e, name="mat.bdf", kind="model", sha="2" * 64)
    convert(mesh, "MAT1,1,206000.,,0.3\nGRID,101,,0.,0.,0.\nGRID,102,,1.,0.,0.\nCROD,101,101,101,102\n"
                  "PROD,101,1,1.\n")
    assert db.get(models.ModelSummary, mesh.id).sig_geometry is not None
    convert(main, BASE.replace("MAT1,1,206000.,,0.3,7.85-9\n", "INCLUDE 'mat.bdf'\n"))
    row = db.get(models.ModelSummary, mesh.id)
    db.refresh(row)
    assert row.state == "include" and row.sig_geometry is None


def test_api_same_model_and_same_geometry(client, db, convert, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    e1, f1 = make_entry_file(name="9999_원본.bdf", kind="model", hulls=("9999",), title="9999 원본", sha="1" * 64)
    e2, f2 = make_entry_file(name="9001_사본_이름만다름.bdf", kind="model", hulls=("9001",), sha="2" * 64)
    e3, f3 = make_entry_file(name="9002_두께변경.bdf", kind="model", hulls=("9002",), sha="3" * 64)
    _e, f4 = make_entry_file(name="9002_다른형상.bdf", kind="model", hulls=("9002",), sha="4" * 64)
    convert(f1, BASE)
    convert(f2, SAME_FIXED)
    convert(f3, BASE.replace("PSHELL,5,1,12.", "PSHELL,5,1,14.").replace("LOAD = 10", "LOAD = 20"))
    convert(f4, BASE.replace("GRID,5,,0.001,0.,500.", "GRID,5,,0.001,0.,600."))

    model = client.get(f"/api/entries/{e1.entry_id}", headers=h).json()["files"][0]["model"]
    assert model["same_model_total"] == 1
    assert model["same_model"] == [{"file_id": f2.id, "name": f2.name, "rel_path": f2.rel_path,
                                    "entry_id": e2.entry_id, "entry_title": e2.title, "entry_status": "confirmed"}]
    assert model["same_geometry_total"] == 1
    g = model["same_geometry"][0]
    assert g["entry_id"] == e3.entry_id and g["differs"] == ["property", "load"]

    # 휴지통 Entry 는 빠진다
    e2.status = "trashed"
    db.commit()
    model = client.get(f"/api/entries/{e1.entry_id}", headers=h).json()["files"][0]["model"]
    assert model["same_model"] == [] and model["same_model_total"] == 0


def test_drafts_in_same_batch_see_each_other_and_byte_dup_shown_once(db, convert, make_entry_file):
    from app.entries.service import entry_to_dict

    _v, vault = make_entry_file(name="9999_원본.bdf", kind="model", sha="9" * 64)
    convert(vault, BASE)
    draft, a = make_entry_file(name="a.bdf", kind="model", status="draft", sha="9" * 64)
    _d, b = make_entry_file(entry=draft, name="b_이름다름.bdf", kind="model", sha="8" * 64)
    a.duplicate_of_id = vault.id          # 바이트 동일 — 기존 '…에 이미 있음' 이 이미 알린다
    db.commit()
    convert(a, BASE)
    convert(b, SAME_FIXED)
    files = {f["id"]: f for f in entry_to_dict(db, draft)["files"]}
    assert [r["file_id"] for r in files[a.id]["model"]["same_model"]] == [b.id]     # vault 는 바이트 표시로 한 번만
    assert [r["file_id"] for r in files[b.id]["model"]["same_model"]] == [vault.id, a.id]   # 확정 먼저
    assert files[b.id]["model"]["same_model"][1]["entry_status"] == "draft"


def test_list_limit_and_total(db, convert, make_entry_file):
    from app.entries.same_model import SAME_LIMIT
    from app.entries.service import entry_to_dict

    e0, f0 = make_entry_file(name="0.bdf", kind="model", sha="0" * 64)
    convert(f0, BASE)
    for i in range(SAME_LIMIT + 2):
        _e, f = make_entry_file(name=f"{i}_copy.bdf", kind="model", sha=f"{i + 1}" * 64)
        convert(f, BASE)
    model = entry_to_dict(db, e0)["files"][0]["model"]
    assert len(model["same_model"]) == SAME_LIMIT and model["same_model_total"] == SAME_LIMIT + 2


def test_unconverted_file_has_empty_lists(db, make_entry_file):
    from app.entries.service import entry_to_dict

    e, f = make_entry_file(name="a.bdf", kind="model")
    db.add(models.ModelSummary(file_id=f.id, state="queued"))
    db.commit()
    model = entry_to_dict(db, e)["files"][0]["model"]
    assert model["state"] == "queued" and model["same_model"] == [] and model["same_geometry_total"] == 0


def test_cli_enqueue_convert_missing_signature(db, make_entry_file, capsys):
    from app.cli import enqueue_convert_all, main

    files = [make_entry_file(name=f"{n}.bdf", kind="model")[1] for n in "abcd"]
    a, b, c, d = files
    db.add_all([models.ModelSummary(file_id=a.id, state="done", key="k" * 64),                         # 서명 없음
                models.ModelSummary(file_id=b.id, state="done", key="k" * 64, sig_version=VERSION - 1,
                                    sig_geometry="g" * 64),                                             # 옛 규칙
                models.ModelSummary(file_id=c.id, state="done", key="k" * 64, sig_version=VERSION,
                                    sig_geometry="g" * 64),                                             # 최신
                models.ModelSummary(file_id=d.id, state="failed", error="x")])
    db.commit()
    assert enqueue_convert_all(db, missing_signature=True) == 2
    assert {j.target_id for j in db.query(models.Job).filter_by(type="convert_model")} == {a.id, b.id}
    assert main(["enqueue-convert", "--missing-signature"]) == 0
    assert "0건" in capsys.readouterr().out
    with pytest.raises(SystemExit):
        main(["enqueue-convert", "--missing-signature", "--outdated"])
