"""선례 찾기(27) — 기준 BDF 와 비슷한 확정 모델을 순위로 찾는다. 새로 저장하는 값은 없다.

특징은 변환(04a)·서명(12)이 이미 남긴 model_summaries 에서 읽는다.
    크기      bbox → 정렬한 L ≥ W ≥ H. 가장 긴 변이 500 을 넘으면 mm 로 보고 m 로 바꾼다(LogBook 모델 대부분이 mm)
    규모      요소 수(보·쉘) + 촘촘함(크기 대각 / √요소 수 — 단위가 같은 상대값으로만 쓴다)
    구성      보 · 쉘 · 강체 · 질량 비율
    단면      fingerprint 의 단면 표기(PBEAML L 100x100x10 · PSHELL t12 …) 집합
    형상      sig_geometry 가 같으면 '같은 설계' — 점수와 상관없이 맨 위(0.9 + 0.1 × 나머지)
    분류      같은 구역(기준 쪽 값을 알 때만, 42 — 해석 종류는 없앴다)

점수는 항목별(raw 0~1)로 돌려준다 — 화면이 '같은 점 · 다른 점' 문장을 만든다(frontend lib/similar.js).
같은 형상 서명은 한 줄로 묶는다(표준 설계를 여러 척이 다시 쓴 경우). 같은 자료 안 여러 BDF(판)는 가장 닮은 하나만.

기준은 두 가지
    file_id   LogBook 의 BDF(보는 사람이 볼 수 있어야 한다). 그 자료의 구역을 기본값으로 쓴다
    올린 BDF  저장하지 않고 이 프로세스 안에서 읽는다(features_from_bdf). INCLUDE 는 따라가지 않는다(본 파일만)

권한(13·15): 비교 대상은 보는 사람이 볼 수 있는 확정 자료의 BDF 만.
"""
import math
from collections import defaultdict

from sqlalchemy.orm import Session

from . import access, models
from .bdf.deck import DeckReader, DeckTooLarge
from .bdf.fingerprint import fingerprint
from .bdf.model import BEAM_CARDS, QUAD_CARDS, RIGID_CARDS, TRI_CARDS, ModelError, build_model
from .bdf.signature import VERSION as SIG_VERSION, compute_signature
from .vocab import Vocab

WEIGHTS = {"size": .30, "scale": .20, "mix": .20, "sec": .20, "tag": .10}
MAX_CANDIDATES = 5000
MAX_RESULTS = 10
MAX_MEMBERS = 30
MAX_UPLOAD_BYTES = 32 * 1024 ** 2     # 올린 BDF 는 요청 안에서 읽는다 — 17 동기 검사와 같은 상한
DRM_MAGIC = b"HHIDRMC"
SECTION_CARDS = ("PBARL", "PBEAML", "PSHELL", "PCOMP", "PBAR", "PBEAM", "PROD")
MM_THRESHOLD = 500


class BdfUnreadable(ValueError):
    """올린 파일을 BDF 로 읽지 못했다 — code 는 화면 문구 열쇠."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


# ---------- 특징 ----------

def sections_of(fp: str | None) -> list[str]:
    """fingerprint 문자열에서 단면 표기만. 'PBEAML L 100x100x10x10' → 'L 100x100x10x10', 'PSHELL t12' → 't12'."""
    out = []
    for part in (fp or "").split(" · "):
        card, _, rest = part.strip().partition(" ")
        if card in SECTION_CARDS and rest:
            out.append(rest.strip())
    return sorted(set(out))


def features(counts: dict | None, bbox: dict | None, fp: str | None, sol: str | None, sig_geometry: str | None) -> dict | None:
    counts = counts or {}
    beams = sum(counts.get(c, 0) for c in BEAM_CARDS)
    shells = sum(counts.get(c, 0) for c in (*TRI_CARDS, *QUAD_CARDS))
    rigids = sum(counts.get(c, 0) for c in RIGID_CARDS)
    masses = counts.get("CONM2", 0)
    elems = beams + shells
    if not elems or not bbox:
        return None
    dims = sorted((abs(bbox["max"][k] - bbox["min"][k]) for k in range(3)), reverse=True)
    scale = 1 / 1000 if dims[0] > MM_THRESHOLD else 1
    dims_m = [round(d * scale, 2) for d in dims]
    total = beams + shells + rigids + masses
    diag = math.sqrt(sum(d * d for d in dims_m)) or 1e-6
    return {"dims": dims_m, "elems": elems, "nodes": counts.get("GRID", 0),
            "density": diag / math.sqrt(elems),
            "mix": [beams / total, shells / total, rigids / total, masses / total],
            "sections": sections_of(fp), "sol": sol, "sig": sig_geometry}


def features_from_bdf(data: bytes, name: str) -> dict:
    """올린 BDF 바이트에서 특징을 만든다(저장하지 않는다). INCLUDE 는 '찾지 못함'으로 넘어간다."""
    if data.startswith(DRM_MAGIC):
        raise BdfUnreadable("drm")

    def opener(rel: str) -> bytes:
        if rel == name:
            return data
        raise FileNotFoundError(rel)

    reader = DeckReader(opener, max_bytes=MAX_UPLOAD_BYTES)
    try:
        cards = reader.read(name)
        model = build_model(cards, sol=reader.sol, warnings=reader.warnings,
                            includes=reader.includes, missing=reader.missing)
    except DeckTooLarge as exc:
        raise BdfUnreadable("too_large") from exc
    except ModelError as exc:
        raise BdfUnreadable("model_error") from exc
    if model.element_total() == 0:
        raise BdfUnreadable("no_elements")
    sig = compute_signature(cards, reader.control, reader.sol)
    f = features(model.counts(), model.bbox(), fingerprint(model), model.sol, sig.geometry)
    if f is None:
        raise BdfUnreadable("no_elements")
    f["missing_includes"] = list(reader.missing)
    return f


# ---------- 점수 ----------

def score(base: dict, other: dict, weights: dict | None = None) -> dict:
    w = weights or WEIGHTS
    d = math.sqrt(sum(math.log(max(a, .05) / max(b, .05)) ** 2 for a, b in zip(base["dims"], other["dims"])))
    size = math.exp(-d)          # 높이처럼 짧은 변의 차이가 크게 벌어지지 않게 완만하게
    scale = math.exp(-(abs(math.log10(base["elems"] / other["elems"])) * 1.4
                       + abs(math.log(base["density"] / other["density"])) * .8))
    dot = sum(a * b for a, b in zip(base["mix"], other["mix"]))
    norm = math.hypot(*base["mix"]) * math.hypot(*other["mix"])
    mix = max(0.0, dot / norm) ** 3 if norm else 0.0
    A, B = set(base["sections"]), set(other["sections"])
    sec = len(A & B) / len(A | B) if (A | B) else 0.0
    tag = 1.0 if base.get("zone") and base["zone"] in other.get("zones", ()) else 0.0   # 42 — 구역만
    raw = {"size": size, "scale": scale, "mix": mix, "sec": sec, "tag": tag}
    total_w = sum(w.values()) or 1
    weighted = sum(raw[k] * w[k] for k in raw) / total_w
    shape = bool(base.get("sig") and base["sig"] == other.get("sig"))
    return {"total": round(.9 + .1 * weighted if shape else weighted, 4), "shape": shape,
            "raw": {k: round(v, 4) for k, v in raw.items()}, "same_sections": sorted(A & B)}


# ---------- 후보 ----------

def _candidates(db: Session, user, exclude_file: int | None) -> list[dict]:
    E, F, S = models.Entry, models.File, models.ModelSummary
    q = (db.query(F.id, F.name, F.entry_id, E.entry_id.label("code"), E.title, E.uploaded_by,
                  E.confirmed_at, S.key, S.counts, S.bbox, S.fingerprint, S.sol, S.sig_geometry, S.sig_version)
         .join(E, E.id == F.entry_id).join(S, S.file_id == F.id)
         .filter(E.status == "confirmed", access.visible_entries_filter(user), F.kind == "model",
                 F.location != "trash", S.state == "done")
         .order_by(E.confirmed_at.desc()).limit(MAX_CANDIDATES))
    rows = [r for r in q if r.id != exclude_file]
    pks = {r.entry_id for r in rows}
    zones: dict[int, list[str]] = defaultdict(list)
    hulls: dict[int, list[str]] = defaultdict(list)
    if pks:
        zv = Vocab(db, "zone")
        for eid, tag in (db.query(models.EntryTag.entry_id, models.Tag)
                         .join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
                         .filter(models.EntryTag.entry_id.in_(pks), models.Tag.kind == "zone")):
            v = zv.root(tag).value
            if v not in zones[eid]:
                zones[eid].append(v)
        for eid, h in (db.query(models.EntryHull.entry_id, models.EntryHull.hull_no)
                       .filter(models.EntryHull.entry_id.in_(pks))
                       .order_by(models.EntryHull.is_primary.desc(), models.EntryHull.hull_no)):
            hulls[eid].append(h)
    solve = dict(db.query(models.SolveCheck.file_id, models.SolveCheck.state)
                 .filter(models.SolveCheck.file_id.in_([r.id for r in rows] or [0])))
    reports: dict[int, int] = defaultdict(int)
    for (eid,) in db.query(F.entry_id).filter(F.entry_id.in_(pks or {0}), F.kind == "report", F.location != "trash"):
        reports[eid] += 1
    names = dict(db.query(models.User.employee_id, models.User.name)
                 .filter(models.User.employee_id.in_({r.uploaded_by for r in rows if r.uploaded_by} or {""})))
    out = []
    for r in rows:
        f = features(r.counts, r.bbox, r.fingerprint, r.sol,
                     r.sig_geometry if r.sig_version == SIG_VERSION else None)
        if f is None:
            continue
        out.append({**f, "file_id": r.id, "file_name": r.name, "model_key": r.key, "entry_pk": r.entry_id,
                    "entry_id": r.code, "title": r.title,
                    "zones": zones.get(r.entry_id, []), "hulls": hulls.get(r.entry_id, []),
                    "reports": reports.get(r.entry_id, 0), "solve": solve.get(r.id),
                    "uploaded_by": r.uploaded_by, "uploader_name": names.get(r.uploaded_by or ""),
                    "confirmed_at": r.confirmed_at.strftime("%Y-%m") if r.confirmed_at else None})
    return out


def _public(c: dict) -> dict:
    keys = ("file_id", "file_name", "model_key", "entry_id", "title", "zones", "hulls", "reports", "solve",
            "uploaded_by", "uploader_name", "confirmed_at", "dims", "elems", "mix", "sections", "sol")
    return {k: c[k] for k in keys}


def find_similar(db: Session, user, base: dict, *, exclude_file: int | None = None,
                 weights: dict | None = None, limit: int = MAX_RESULTS) -> dict:
    """base(features + zone) 와 비슷한 선례. 같은 형상 서명은 한 줄(lead + members)."""
    cands = _candidates(db, user, exclude_file)
    # 같은 자료 안 여러 BDF 는 가장 닮은 하나만
    best_in_entry: dict[int, tuple[dict, dict]] = {}
    for c in cands:
        s = score(base, c, weights)
        cur = best_in_entry.get(c["entry_pk"])
        if cur is None or s["total"] > cur[1]["total"]:
            best_in_entry[c["entry_pk"]] = (c, s)
    groups: dict[str, list[tuple[dict, dict]]] = defaultdict(list)
    for c, s in best_in_entry.values():
        groups[c["sig"] or f"file:{c['file_id']}"].append((c, s))
    rows = []
    for members in groups.values():
        members.sort(key=lambda m: (-m[1]["total"], m[0]["solve"] != "pass", m[0]["confirmed_at"] or ""))
        top = members[0][1]["total"]
        # 대표 = 거의 같은 점수 중 검증 통과한 것 → 문서 있는 것 → 가장 닮은 것
        near = [m for m in members if m[1]["total"] >= top - .03]
        lead = sorted(near, key=lambda m: (m[0]["solve"] != "pass", m[0]["reports"] == 0, -m[1]["total"]))[0]
        rows.append({"lead": _public(lead[0]), "score": lead[1], "best": top,
                     "members": [{**_public(m[0]), "total": m[1]["total"]} for m in members[:MAX_MEMBERS]],
                     "member_total": len(members)})
    rows.sort(key=lambda r: -r["best"])
    return {"results": rows[:limit], "candidates": len(best_in_entry), "weights": weights or WEIGHTS}


def base_from_file(db: Session, user, file_id: int) -> dict | None:
    """LogBook BDF 를 기준으로 — 볼 수 없거나 변환이 안 됐으면 None."""
    f = db.get(models.File, file_id)
    if f is None or f.kind != "model" or f.location == "trash" or not access.file_visible(db, user, f):
        return None
    s = db.get(models.ModelSummary, f.id)
    if s is None or s.state != "done":
        return None
    feat = features(s.counts, s.bbox, s.fingerprint, s.sol, s.sig_geometry if s.sig_version == SIG_VERSION else None)
    if feat is None:
        return None
    e = db.get(models.Entry, f.entry_id) if f.entry_id else None
    zone = None
    if e is not None:
        zv = Vocab(db, "zone")
        z = (db.query(models.Tag).join(models.EntryTag, models.EntryTag.tag_id == models.Tag.id)
             .filter(models.EntryTag.entry_id == e.id, models.Tag.kind == "zone").order_by(models.Tag.value).first())
        zone = zv.root(z).value if z is not None else None
    return {**feat, "name": f.name, "file_id": f.id, "model_key": s.key,
            "entry_id": e.entry_id if e is not None else None, "entry_title": e.title if e is not None else None,
            "zone": zone}
