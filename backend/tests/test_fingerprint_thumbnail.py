import io

import pytest
from PIL import Image

from app.bdf.deck import DeckReader
from app.bdf.fingerprint import fingerprint, section_label
from app.bdf.model import build_model
from app.bdf.thumbnail import HEIGHT, WIDTH, render_thumbnail


def _model(text):
    r = DeckReader(lambda rel: text.encode())
    return build_model(r.read("m.bdf"), sol=r.sol)


PLATE = (
    "SOL 101\nCEND\nBEGIN BULK\n"
    + "".join(f"GRID,{i * 3 + j + 1},,{j * 500.},{i * 500.},0.\n" for i in range(3) for j in range(3))
    + "CQUAD4,1,5,1,2,5,4\nCQUAD4,2,5,2,3,6,5\nCQUAD4,3,5,4,5,8,7\nCQUAD4,4,5,5,6,9,8\n"
    "GRID,20,,0.,0.,800.\nCBEAM,10,1,1,20,1.,0.,0.\n"
    "PSHELL,5,1,12.\nPBEAML,1,1,,L\n,100.,100.,10.,10.\nMAT1,1,206000.,,0.3\nENDDATA\n"
)


def test_section_labels():
    assert section_label({"card": "PBEAML", "type": "L", "dims": [100.0, 100.0, 10.0, 10.0]}) == "PBEAML L 100x100x10x10"
    assert section_label({"card": "PSHELL", "t": 12.0}) == "PSHELL t12"
    assert section_label({"card": "PROD", "A": 50.5}) == "PROD A50.5"
    assert section_label({"card": "PELAS"}) == "PELAS"


def test_fingerprint_text():
    fp = fingerprint(_model(PLATE))
    assert fp.startswith("CQUAD4 4 · CBEAM 1")
    assert "크기 1000x1000x800" in fp
    assert "PBEAML L 100x100x10x10" in fp and "PSHELL t12" in fp
    assert "MAT1 E206000" in fp and fp.endswith("SOL 101")


def test_thumbnail_png():
    png = render_thumbnail(_model(PLATE))
    img = Image.open(io.BytesIO(png))
    assert img.format == "PNG" and img.size == (WIDTH, HEIGHT)
    colors = img.convert("RGB").getcolors(maxcolors=100000)
    assert len(colors) > 3  # 바탕만 있는 빈 그림이 아니다


def test_thumbnail_needs_nodes():
    with pytest.raises(ValueError):
        render_thumbnail(_model("PSHELL,1,1,1.\n"))
