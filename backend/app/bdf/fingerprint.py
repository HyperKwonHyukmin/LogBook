"""모델 지문(설계 §7.6) — 요소 수·크기·단면·재료·SOL 을 한 줄로. 검색 색인(file_texts locator 'model')에 들어간다."""
from collections import Counter

from .model import Model

MAX_SECTIONS = 200


def fmt(v) -> str:
    return f"{float(v):.6g}"


def section_label(p: dict) -> str:
    card = p.get("card", "")
    if card in ("PBARL", "PBEAML") and p.get("dims"):
        return f"{card} {p.get('type', '')} " + "x".join(fmt(d) for d in p["dims"])
    if card in ("PSHELL", "PCOMP") and p.get("t"):
        return f"{card} t{fmt(p['t'])}"
    if card in ("PBAR", "PBEAM", "PROD") and p.get("A"):
        return f"{card} A{fmt(p['A'])}"
    return card


def fingerprint(m: Model) -> str:
    counts = Counter(e.card for e in (*m.beams, *m.tris, *m.quads))
    counts.update(r.card for r in m.rigids)
    parts = [f"{card} {n}" for card, n in sorted(counts.items(), key=lambda x: (-x[1], x[0]))]
    box = m.bbox()
    if box:
        dims = [box["max"][k] - box["min"][k] for k in range(3)]
        parts.append("크기 " + "x".join(fmt(d) for d in dims))
    parts += sorted({section_label(p) for p in m.properties.values()} - {""})[:MAX_SECTIONS]
    parts += sorted({f"MAT1 E{fmt(x['E'])}" for x in m.materials.values() if x.get("card") == "MAT1" and x.get("E")})
    if m.sol:
        parts.append(f"SOL {m.sol}")
    return " · ".join(parts)
