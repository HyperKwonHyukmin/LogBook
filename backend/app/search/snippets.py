"""본문 발췌문 — 강조는 HTML 이 아니라 글자 위치로 준다(화면이 안전하게 칠한다)."""


def make_snippet(text: str, terms: list[str], width: int = 80) -> dict:
    low = text.lower()
    hits = [p for p in (low.find(t.lower()) for t in terms if t) if p >= 0]
    if not hits:
        head = text[: width * 2].replace("\n", " ")
        return {"text": head + ("…" if len(text) > len(head) else ""), "highlights": []}
    pos = min(hits)
    start, end = max(0, pos - width), min(len(text), pos + width)
    prefix = "…" if start > 0 else ""
    body = text[start:end].replace("\n", " ")
    out = prefix + body + ("…" if end < len(text) else "")
    body_low = body.lower()
    spans = []
    for t in terms:
        t = t.lower()
        if not t:
            continue
        i = body_low.find(t)
        while i >= 0:
            spans.append([i + len(prefix), i + len(prefix) + len(t)])
            i = body_low.find(t, i + 1)
    spans.sort()
    merged: list[list[int]] = []
    for s in spans:
        if merged and s[0] <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], s[1])
        else:
            merged.append(s)
    return {"text": out, "highlights": merged}
