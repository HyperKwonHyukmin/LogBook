"""32 — 보고서 판(이름 규칙 + 본문 겹침)과 관계 지도의 문서 관계(사용한 모델·같은 보고서의 다른 판·본문 비슷함).

합성 데이터만(가상 호선 9001·9002·9003). 본문 색인은 conftest 의 임시 SQLite."""
import random
from datetime import datetime

import numpy as np
import pytest

from app import models
from app.report_index import features as rf
from app.report_index.config import load_config
from app.report_index.store import open_store
from app.revisions import reports as rr

MODEL = "bge-m3:latest:abc"
WORDS = ("갑판", "하중", "응력", "허용", "보강", "해치", "코밍", "피로", "좌굴", "용접", "판두께", "격벽", "선체", "크레인",
         "받침", "기초", "검토", "결과", "만족", "조건", "해석", "모델", "요소", "경계", "구속", "중량", "가속도", "파랑")


def _text(seed, n=400):
    rng = random.Random(seed)
    return " ".join(rng.choice(WORDS) + str(rng.randint(0, 99)) for _ in range(n))


def _pages(text, size=600):
    return [{"locator": f"page:{i // size + 1}", "text": text[i:i + size]} for i in range(0, len(text), size)]


def _index(f, e, text, vector=None):
    store = open_store(load_config().index_path)
    chunks = _pages(text)
    if vector is not None:
        v = np.asarray(vector, dtype=np.float32)
        chunks = [{**c, "vector": v} for c in chunks]
    store.upsert_document(file_id=f.id, entry_id=e.id, name=f.name, path=f"x/{f.name}", sha256=f.sha256, version="t",
                          chunks=chunks, embedding_model=MODEL if vector is not None else None,
                          metadata={"registered_sha256": f.sha256, "rel_path": f.rel_path, "vault_rel": e.vault_rel,
                                    "entry_id": e.id})
    return store


def _unit(i, dim=8):
    v = np.zeros(dim, dtype=np.float32)
    v[i] = 1.0
    return v


# ── 특징(순수 함수) ──────────────────────────────────────────────────────

def test_minhash_separates_revision_from_other_report():
    base = _text(1)
    edited = base[:1500] + " 보강재 추가 검토 결과 만족 " + base[1500:]
    a = rf.Feature(rf.minhash_of(base), {}, None, None)
    b = rf.Feature(rf.minhash_of(edited), {}, None, None)
    c = rf.Feature(rf.minhash_of(_text(2)), {}, None, None)
    assert rf.jaccard(a, b) >= 0.8
    assert rf.jaccard(a, c) < 0.3
    assert rf.jaccard(a, rf.Feature(None, {}, None, None)) is None
    assert rf.text_pairs({1: a, 2: b, 3: c}, 0.5) .keys() == {frozenset((1, 2))}


def test_page_key_and_changes():
    assert rf.page_key("page:3:part:2") == "page:3"
    assert rf.page_key("page:3:ocr") == "page:3"
    assert rf.page_key("sheet:요약") == "sheet:요약"
    a = rf.Feature(None, {"page:1": 1, "page:2": 2, "page:3": 3}, None, None)
    b = rf.Feature(None, {"page:1": 1, "page:2": 9, "page:4": 4, "page:5": 5}, None, None)
    ch = rf.page_changes(a, b)
    assert (ch["pages_a"], ch["pages_b"], ch["changed"], ch["added"], ch["removed"]) == (3, 4, 1, 2, 1)
    assert rf.page_changes(a, None) is None


def test_similar_pairs_top_and_model():
    f = lambda v, m=MODEL: rf.Feature(None, {}, v / np.linalg.norm(v), m)  # noqa: E731
    feats = {1: f(np.array([1, 0.1, 0], np.float32)), 2: f(np.array([1, 0, 0], np.float32)),
             3: f(np.array([0, 0, 1], np.float32)), 4: f(np.array([1, 0, 0], np.float32), "other")}
    pairs = rf.similar_pairs(feats, 0.9, top=3)
    assert set(pairs) == {frozenset((1, 2))}          # 3 은 멀고, 4 는 다른 모델 벡터라 비교하지 않는다


# ── 같은 자료 안 보고서 판 ───────────────────────────────────────────────

def test_entry_series_name_and_text_rules(db, make_entry_file):
    e, r1 = make_entry_file(title="해치 검토", name="hatch_report_r1.pdf")
    _, r2 = make_entry_file(entry=e, name="hatch_report_r2.pdf")
    _, plain = make_entry_file(entry=e, name="검토서.pdf")           # 이름 표시 없음 — 본문으로 '정리본.pdf' 와 판
    _, plain2 = make_entry_file(entry=e, name="정리본.pdf")
    _, slide = make_entry_file(entry=e, name="발표.pptx")             # 같은 본문이라도 발표자료는 판이 아니다
    text = _text(7)
    _index(plain, e, text)
    _index(plain2, e, text[:2400] + " 판두께 변경 반영 " + text[2400:])
    _index(slide, e, text)
    files = rr.report_files(db, [e.id])[e.id]
    feats = rr.current_features(open_store(load_config().index_path), {e.id: files}, {e.id: e})
    series = rr.entry_series(files, feats)
    names = [[x["name"] for x in s["items"]] for s in series]
    assert ["hatch_report_r1.pdf", "hatch_report_r2.pdf"] in names
    assert ["검토서.pdf", "정리본.pdf"] in names
    assert not any("발표.pptx" in n for n in names)
    hatch = next(s for s in series if s["items"][0]["name"].startswith("hatch"))
    assert [x["display"] for x in hatch["items"]] == ["R1", "R2"] and hatch["items"][-1]["is_latest"]
    assert hatch["steps"] == [None]                                   # 색인 전 — 쪽 변화 없음
    text_series = next(s for s in series if s["items"][0]["name"] == "검토서.pdf")
    assert text_series["steps"][0]["overlap"] >= 0.5 and text_series["steps"][0]["changed"] >= 1


def test_stale_index_is_ignored(db, make_entry_file):
    e, a = make_entry_file(title="옛 색인", name="가.pdf")
    _, b = make_entry_file(entry=e, name="나.pdf")
    text = _text(9)
    _index(a, e, text)
    _index(b, e, text)
    b.sha256 = "f" * 64                                               # 파일이 바뀌었는데 색인은 옛 본문
    db.commit()
    files = rr.report_files(db, [e.id])[e.id]
    feats = rr.current_features(open_store(load_config().index_path), {e.id: files}, {e.id: e})
    assert set(feats) == {a.id}
    assert rr.entry_series(files, feats) == []


# ── 관계 지도 문서 관계 ──────────────────────────────────────────────────

@pytest.fixture
def docs(db, make_user, make_entry_file):
    make_user("M100001", name="일반", level=2)
    model_e, bdf = make_entry_file(title="크레인 기초 모델", hulls=("9001",), name="crane.bdf", kind="model",
                                   uploaded_by="M100001", confirmed_at=datetime(2026, 9, 1))
    uses_e, rep = make_entry_file(title="크레인 기초 보고서", hulls=("9001",), name="crane_check.pdf",
                                  uploaded_by="M100001", confirmed_at=datetime(2026, 9, 2))
    rev1_e, rv1 = make_entry_file(title="코밍 보고서 1차", hulls=("9002",), name="coaming_strength_rev.A.pdf",
                                  uploaded_by="M100001", confirmed_at=datetime(2026, 9, 3))
    rev2_e, rv2 = make_entry_file(title="코밍 보고서 2차", hulls=("9003",), name="coaming_strength_rev.B.pdf",
                                  uploaded_by="M100001", confirmed_at=datetime(2026, 9, 4))
    near_e, near = make_entry_file(title="피로 검토", hulls=("9003",), name="fatigue.pdf",
                                   uploaded_by="M100001", confirmed_at=datetime(2026, 9, 5))
    hidden_e, hid = make_entry_file(title="숨은 보고서", hulls=("9002",), name="secret.pdf", uploaded_by="U100001",
                                    confirmed_at=datetime(2026, 9, 6))
    for e in (model_e, uses_e, rev1_e, rev2_e, near_e):
        e.access = "shared"
    hidden_e.access = "blocked"
    db.add(models.ReportModelLink(report_file_id=rep.id, model_file_id=bdf.id))
    db.commit()
    text = _text(11)
    _index(rv1, rev1_e, text, _unit(0))
    _index(rv2, rev2_e, text[:3000] + " 개정 반영 " + text[3000:], _unit(1))
    v = np.zeros(8, np.float32)
    v[0], v[2] = 0.95, 0.31
    _index(near, near_e, _text(12), v)                                # rv1 과 벡터만 가깝다(본문은 다름)
    _index(hid, hidden_e, text, _unit(0))                             # 본문이 같지만 숨은 자료 — 이어지지 않는다
    return {k: e.entry_id for k, e in dict(model=model_e, uses=uses_e, rev1=rev1_e, rev2=rev2_e, near=near_e,
                                            hidden=hidden_e).items()}


def _graph(client, auth_headers, emp="M100001"):
    r = client.get("/api/graph", headers=auth_headers(emp))
    assert r.status_code == 200, r.text
    return r.json()


def test_doc_pairs(docs, client, auth_headers):
    g = _graph(client, auth_headers)
    by = {e["id"]: e for e in g["entries"]}
    assert docs["hidden"] not in by
    assert by[docs["uses"]]["reports"] == 1 and by[docs["uses"]]["models"] == 0
    assert by[docs["model"]]["models"] == 1
    pairs = {frozenset((p["a"], p["b"])): p for p in g["doc_pairs"]}
    uses = pairs[frozenset((docs["model"], docs["uses"]))]
    assert uses["type"] == "uses" and uses["from"] == docs["uses"]
    assert uses["files"] == ["crane_check.pdf", "crane.bdf"]
    rrev = pairs[frozenset((docs["rev1"], docs["rev2"]))]
    assert rrev["type"] == "rrev" and rrev["score"] >= 0.6
    text = pairs[frozenset((docs["rev1"], docs["near"]))]
    assert text["type"] == "text" and 0.85 <= text["score"] < 1
    assert all(docs["hidden"] not in (p["a"], p["b"]) for p in g["doc_pairs"])
    assert g["doc_index"] == {"reports": 4, "indexed": 3, "vectors": 3, "available": True}


def test_doc_pairs_threshold_env(docs, client, auth_headers, monkeypatch):
    monkeypatch.setenv("LOGBOOK_GRAPH_TEXT_SIM", "0.99")
    g = _graph(client, auth_headers)
    assert not any(p["type"] == "text" for p in g["doc_pairs"])


def test_name_only_cross_revision_without_index(db, make_user, make_entry_file, client, auth_headers):
    make_user("M100001", name="일반", level=2)
    a, _ = make_entry_file(title="해치 1", name="hatch_cover_strength_r1.pdf", uploaded_by="M100001")
    b, _ = make_entry_file(title="해치 2", name="hatch_cover_strength_r2.pdf", uploaded_by="M100001")
    c, _ = make_entry_file(title="흔한 이름 1", name="보고서_r1.pdf", uploaded_by="M100001")
    d, _ = make_entry_file(title="흔한 이름 2", name="보고서_r2.pdf", uploaded_by="M100001")
    g = _graph(client, auth_headers)
    pairs = {frozenset((p["a"], p["b"])): p for p in g["doc_pairs"]}
    assert pairs[frozenset((a.entry_id, b.entry_id))]["type"] == "rrev"
    assert pairs[frozenset((a.entry_id, b.entry_id))]["score"] is None
    assert frozenset((c.entry_id, d.entry_id)) not in pairs        # 줄기가 짧은 흔한 이름은 본문 없이 잇지 않는다


def test_report_revisions_in_entry(db, make_user, make_entry_file, client, auth_headers):
    make_user("M100001", name="일반", level=2)
    e, _ = make_entry_file(title="보고서만", name="deck_report_Rev.A.pdf", uploaded_by="M100001")
    make_entry_file(entry=e, name="deck_report_Rev.B.pdf")
    g = _graph(client, auth_headers)
    entry = next(x for x in g["entries"] if x["id"] == e.entry_id)
    s = entry["report_revisions"][0]
    assert s["count"] == 2 and s["name"] == "deck_report_Rev.B.pdf"
    assert [x["display"] for x in s["items"]] == ["Rev.A", "Rev.B"]
