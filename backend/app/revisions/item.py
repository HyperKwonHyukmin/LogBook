"""판 변경 3D 보기(16)의 전후 값 — 한 ID 의 앞 판(a)·뒤 판(b) 값.

두 판의 변환 결과(model.lbm, 20_Derived)에서 읽는다. 원본 BDF 는 다시 읽지 않는다(빠르고, DRM·공유 폴더 상태와 무관).
lbm 에 없는 칸(요소의 직접 입력 값 등)이 바뀐 것은 14 상세(.rdiff)의 목록 이름(`detail`)으로 알린다.

    element  card · pid · nodes(절점 ID) · coords(절점 좌표) · 1D 는 orient·offsets(lbm v2) · 질량 요소는 mass
    node     xyz
    rigid    card · center(기준 절점) · others(연결 절점)
"""
import gzip
import json
import math
import threading
from collections import OrderedDict

import numpy as np

from ..bdf.lbm import read_lbm
from ..convert.job import SERVABLE_STATES, model_paths
from ..storage.paths import StoragePaths, to_long

KINDS = ("element", "node", "rigid")
_CACHE_SIZE = 4
_cache: "OrderedDict[str, dict]" = OrderedDict()
_lock = threading.Lock()


class LbmMissing(Exception):
    """변환 결과(lbm)가 없다 — 라우터가 409 model_not_ready 로 바꾼다."""


def _load(storage: StoragePaths, summary) -> dict:
    """ModelSummary → 읽은 lbm(머리·블록). 최근 4개를 메모리에 둔다(key·형식 버전이 같으면 같은 내용)."""
    if summary is None or not summary.key or summary.state not in SERVABLE_STATES:
        raise LbmMissing()
    version = summary.format_version or 1
    path = model_paths(storage, summary.key, version)[0]
    ck = f"{summary.key}.v{version}"
    with _lock:
        hit = _cache.get(ck)
        if hit is not None:
            _cache.move_to_end(ck)
            return hit
    try:
        with open(to_long(path), "rb") as fh:
            raw = fh.read()
    except FileNotFoundError:
        raise LbmMissing()
    header, blocks = read_lbm(raw)
    m = {"header": header, "blocks": blocks}
    with _lock:
        _cache[ck] = m
        _cache.move_to_end(ck)
        while len(_cache) > _CACHE_SIZE:
            _cache.popitem(last=False)
    return m


def clear_cache() -> None:
    with _lock:
        _cache.clear()


def _xyz(m: dict, idx: int) -> list[float]:
    return [_round(v) for v in m["blocks"]["node_xyz"][idx].tolist()]


def _round(v: float) -> float:
    # lbm 좌표는 float32 — 7자리로 줄여 '1000.0000000001' 같은 꼬리를 없앤다
    return float(f"{float(v):.7g}")


def _node_index(m: dict, gid: int) -> int | None:
    ids = m["blocks"].get("node_ids")
    if ids is None or not len(ids):
        return None
    i = int(np.searchsorted(ids, gid))      # node_ids 는 오름차순(bdf.lbm.build_blocks)
    return i if i < len(ids) and int(ids[i]) == gid else None


def _first(rows: np.ndarray | None, eid: int) -> int | None:
    if rows is None or not len(rows):
        return None
    hit = np.flatnonzero(rows[:, 0] == eid)
    return int(hit[0]) if len(hit) else None


def _element(m: dict, eid: int) -> dict | None:
    b, cards = m["blocks"], m["header"].get("cards", {})
    node_ids = b["node_ids"]
    for block, width, card_block, card_list in (("beams", 4, "beam_cards", "beam"), ("tris", 5, "tri_cards", "tri"),
                                                 ("quads", 6, "quad_cards", "quad")):
        rows = b.get(block)
        if rows is None or not len(rows):
            continue
        rows = rows.reshape(-1, width)
        r = _first(rows, eid)
        if r is None:
            continue
        idx = [int(x) for x in rows[r, 2:]]
        k = int(b[card_block][r]) if card_block in b else 0
        names = cards.get(card_list) or []
        out = {"card": names[k] if k < len(names) else f"?{k}", "pid": int(rows[r, 1]),
               "nodes": [int(node_ids[i]) for i in idx], "coords": [_xyz(m, i) for i in idx]}
        if block == "beams":
            orient, offsets = b.get("beam_orient"), b.get("beam_offsets")
            if orient is not None and len(orient) == len(rows):
                out["orient"] = [_round(v) for v in orient[r].tolist()]
            if offsets is not None and len(offsets) == len(rows):
                out["offsets"] = [_round(v) for v in offsets[r].tolist()]
        return out
    masses = b.get("masses")
    if masses is not None and len(masses):
        masses = masses.reshape(-1, 2)
        r = _first(masses, eid)
        if r is not None:
            i = int(masses[r, 1])
            mv = b.get("mass_values")
            return {"card": "CONM2", "pid": None, "nodes": [int(node_ids[i])], "coords": [_xyz(m, i)],
                    "mass": _round(mv[r]) if mv is not None and r < len(mv) else None}
    return None


def _rigid(m: dict, eid: int) -> dict | None:
    b = m["blocks"]
    lines, kinds = b.get("rigid_lines"), b.get("rigid_kinds")
    if lines is None or not len(lines):
        return None
    lines = lines.reshape(-1, 3)
    rows = np.flatnonzero(lines[:, 0] == eid)
    if not len(rows):
        return None
    names = m["header"].get("cards", {}).get("rigid") or ["RBE2", "RBE3"]
    k = int(kinds[rows[0]]) if kinds is not None else 0
    ids = b["node_ids"]
    center = int(lines[rows[0], 1])
    return {"card": names[k] if k < len(names) else f"?{k}", "center": int(ids[center]),
            "center_xyz": _xyz(m, center), "others": sorted(int(ids[int(lines[r, 2])]) for r in rows)}


def _node(m: dict, gid: int) -> dict | None:
    i = _node_index(m, gid)
    return None if i is None else {"xyz": _xyz(m, i)}


def _find(m: dict, kind: str, ident: int) -> dict | None:
    return _element(m, ident) if kind == "element" else _node(m, ident) if kind == "node" else _rigid(m, ident)


def _changes(kind: str, a: dict | None, b: dict | None, tol: float) -> list[str]:
    if a is None or b is None:
        return []
    out = []
    if kind == "node":
        if math.dist(a["xyz"], b["xyz"]) > tol:
            out.append("xyz")
        return out
    for k in ("card", "pid", "nodes", "center", "others", "mass"):
        if a.get(k) != b.get(k):
            out.append(k)
    for k in ("orient", "offsets"):
        if a.get(k) is not None and b.get(k) is not None and any(abs(x - y) > 1e-6 * max(1.0, abs(x), abs(y))
                                                                 for x, y in zip(a[k], b[k])):
            out.append(k)
    if kind == "element" and "nodes" not in out and a.get("coords") and b.get("coords"):
        if any(math.dist(p, q) > tol for p, q in zip(a["coords"], b["coords"])):
            out.append("coords")          # 같은 절점이 움직였다(요소 자체는 그대로)
    return out


# 상세(.rdiff)에서 한 ID 가 들 수 있는 목록 — (경로, 항목이 dict 면 그 ID 칸)
_LISTS = {
    "element": (("elements.added", None), ("elements.removed", None), ("elements.conn", None),
                ("elements.pid", "eid"), ("elements.card", "eid"), ("elements.other", None),
                ("mass.added", None), ("mass.removed", None), ("mass.changed", "eid")),
    "node": (("nodes.added", None), ("nodes.removed", None), ("nodes.moved", None), ("loads.spc_nodes", None)),
    "rigid": (("rigids.added", None), ("rigids.removed", None), ("rigids.indep", None), ("rigids.dep", "eid"),
              ("rigids.other", None)),
}


def detail_hits(detail: dict | None, kind: str, ident: int) -> dict:
    """상세에서 그 ID 가 든 목록 이름 → 항목(dict 목록이면 그 항목, 아니면 True). 종속 변경은 추가/삭제 절점 ID 를 준다."""
    out: dict = {}
    if not detail:
        return out
    for path, key in _LISTS[kind]:
        group, name = path.split(".")
        values = (detail.get(group) or {}).get(name) or []
        if key is None:
            if ident in values:
                out[path] = True
        else:
            for x in values:
                if isinstance(x, dict) and x.get(key) == ident:
                    out[path] = x
                    break
    if kind == "node":
        for x in (detail.get("nodes") or {}).get("top_moved") or []:
            if x and x[0] == ident:
                out["move"] = x[1]
    return out


def read_detail_json(data: bytes | None) -> dict | None:
    if not data:
        return None
    try:
        return json.loads(gzip.decompress(data).decode("utf-8"))
    except (OSError, ValueError):
        return None


def _tol(m: dict) -> float:
    """절점 이동 허용오차 — 14 diff 와 같은 규칙(max(0.01, 1e-6 × 대각선))."""
    box = m["header"].get("bbox") or {}
    lo, hi = box.get("min") or [0, 0, 0], box.get("max") or [0, 0, 0]
    return max(0.01, 1e-6 * math.dist(lo, hi))


def describe_item(storage: StoragePaths, sa, sb, kind: str, ident: int, detail: dict | None) -> dict:
    """한 ID 의 전후 값. sa/sb = 두 판의 ModelSummary. lbm 이 없으면 LbmMissing."""
    ma, mb = _load(storage, sa), _load(storage, sb)
    a, b = _find(ma, kind, ident), _find(mb, kind, ident)
    changes = _changes(kind, a, b, _tol(ma))
    hits = detail_hits(detail, kind, ident)
    if a is None and b is None:
        status = "missing"
    elif a is None:
        status = "added"
    elif b is None:
        status = "removed"
    elif changes or any(k for k in hits if k != "move"):     # 구속만 바뀐 절점도 '변경'
        status = "changed"
    else:
        status = "same"
    out = {"kind": kind, "id": ident, "status": status, "changes": changes, "a": a, "b": b, "detail": hits}
    if kind == "node" and a is not None and b is not None:
        out["move"] = _round(math.dist(a["xyz"], b["xyz"]))
    return out
