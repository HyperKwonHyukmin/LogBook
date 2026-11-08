"""모델 지문(설계 §7.6) — 요소 수·크기·단면·재료·SOL 을 한 줄로. 검색 색인(file_texts locator 'model')에 들어간다."""
from collections import Counter

from .model import Model

MAX_SECTIONS = 200


def fmt(v) -> str:
    return f"{float(v):.6g}"


def abaqus_label(p: dict) -> str:
    """Abaqus 단면(61) — '묶음이름 형상 원값' (예: LINE1 PIPE 36.5,14 · SKIN SHELL 12)."""
    data = ",".join(fmt(v) for v in p.get("data") or [])
    return " ".join(x for x in (p.get("name"), p.get("section") or p.get("kind"), data) if x)


def section_label(p: dict) -> str:
    if p.get("abaqus"):
        return abaqus_label(p)
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
    parts += sorted({f"{'MAT1' if x.get('card') == 'MAT1' else x.get('name') or 'MAT'} E{fmt(x['E'])}"
                     for x in m.materials.values() if x.get("card") in ("MAT1", "MATERIAL") and x.get("E")})
    if m.sol:
        parts.append(f"SOL {m.sol}")
    return " · ".join(parts)
