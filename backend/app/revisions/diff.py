"""두 BDF 비교(14 B) — ID 단위로 무엇이 바뀌었는가.

read_facts(cards, control, sol) 는 카드 목록에서 비교에 필요한 사실만 간추린다(카드 목록은 부르는 쪽이 바로 버린다 —
큰 모델 두 개의 카드 목록을 동시에 들지 않게). compare(a, b) 는 두 사실 묶음을 비교해 (summary, detail) 을 낸다.

    summary  화면 칩·요약에 쓰는 작은 dict(DB revision_diffs.summary)
    detail   ID 목록·전후 값 문장(파생 폴더 .rdiff) — 목록은 LIST_LIMIT, 문장은 TEXT_LIMIT 개까지. 넘으면 truncated 에 원래 수

범주는 12 내용 서명(bdf.signature)과 같은 구분이다. 값 비교는 signature.norm_field(정수·실수 7자리·대문자).
"""
import hashlib
import math
import sys
from collections import Counter
from dataclasses import dataclass, field

from ..bdf.coords import CoordSystem, resolve_coords
from ..bdf.deck import Card
from ..bdf.fields import is_real, parse_float, parse_int
from ..bdf.model import DIM_COUNT, _rbe3_others
from ..bdf.signature import (ELEMENT_PID_CARDS, GEOMETRY_CARDS, INLINE_ELEMENTS, ORIENT_DEFAULT_CARDS, _category,
                             norm_field, split_control)

VERSION = 1
LIST_LIMIT = 5000           # 범주·종류마다 남기는 ID 수(C 3D 색 표시의 재료)
TEXT_LIMIT = 2000           # 문장 목록 상한
TOP_MOVED = 20
NODE_TOL_ABS = 0.01         # 절점 이동 허용오차(모델 단위 — 보통 mm)
NODE_TOL_REL = 1e-6         # … 또는 모델 대각선의 1e-6 배 중 큰 값

# 요소 카드의 절점 칸 [시작, 끝) — fields[0] = EID, fields[1] = PID. 표에 없는 카드는 절점 칸을 따로 보지 않는다(나머지 칸 비교)
CONN = {
    "CBAR": (2, 4), "CBEAM": (2, 4), "CBEND": (2, 4), "CROD": (2, 4), "CTUBE": (2, 4), "CVISC": (2, 4),
    "CBUSH": (2, 4), "CBUSH1D": (2, 4), "CGAP": (2, 4), "CSHEAR": (2, 6), "CTRIA3": (2, 5), "CTRIAR": (2, 5),
    "CTRIA6": (2, 8), "CQUAD4": (2, 6), "CQUADR": (2, 6), "CQUAD8": (2, 10), "CQUAD": (2, 11),
    "CTETRA": (2, 12), "CPENTA": (2, 17), "CHEXA": (2, 22), "CPYRAM": (2, 15), "CTRIAX6": (2, 8),
    "CELAS1": (2, 6), "CDAMP1": (2, 6), "CELAS3": (2, 4), "CDAMP3": (2, 4),
}
RIGID_CARDS = frozenset({"RBE1", "RBE2", "RBE3", "RBAR", "RBAR1", "RROD", "RTRPLT", "RTRPLT1", "RBEAM", "RSPLINE",
                         "RJOINT", "RSSCON"})
MASS_CARDS = frozenset({"CONM1", "CONM2", "CMASS1", "CMASS2", "CMASS3", "CMASS4"})
SPC_CARDS = frozenset({"SPC", "SPC1", "SPCADD"})

# 사람이 읽을 칸 이름 — fields[k] 의 이름(없으면 'k+2번째 칸')
FIELD_NAMES = {
    "PSHELL": ["PID", "MID1", "T", "MID2", "12I/T³", "MID3", "TS/T", "NSM", "Z1", "Z2", "MID4"],
    "PBAR": ["PID", "MID", "A", "I1", "I2", "J", "NSM", "", "C1", "C2", "D1", "D2", "E1", "E2", "F1", "F2",
             "K1", "K2", "I12"],
    "PROD": ["PID", "MID", "A", "J", "C", "NSM"],
    "PTUBE": ["PID", "MID", "OD", "T", "NSM", "OD2"],
    "PSOLID": ["PID", "MID", "CORDM", "IN", "STRESS", "ISOP", "FCTN"],
    "PSHEAR": ["PID", "MID", "T", "NSM", "F1", "F2"],
    "PELAS": ["PID", "K", "GE", "S"],
    "PDAMP": ["PID", "B"],
    "PGAP": ["PID", "U0", "F0", "KA", "KB", "KT", "MU1", "MU2"],
    "PBARL": ["PID", "MID", "GROUP", "TYPE"],
    "PBEAML": ["PID", "MID", "GROUP", "TYPE"],
    "MAT1": ["MID", "E", "G", "NU", "RHO", "A", "TREF", "GE", "ST", "SC", "SS", "MCSID"],
    "MAT2": ["MID", "G11", "G12", "G13", "G22", "G23", "G33", "RHO", "A1", "A2", "A3", "TREF", "GE", "ST", "SC",
             "SS", "MCSID"],
    "MAT8": ["MID", "E1", "E2", "NU12", "G12", "G1Z", "G2Z", "RHO", "A1", "A2", "TREF", "Xt", "Xc", "Yt", "Yc",
             "S", "GE", "F12", "STRN"],
    "MAT9": ["MID", "G11", "G12", "G13", "G14", "G15", "G16", "G22", "G23", "G24", "G25", "G26", "G33", "G34",
             "G35", "G36", "G44", "G45", "G46", "G55", "G56", "G66", "RHO"],
}


def _trim(vals) -> tuple:
    out = list(vals)
    while out and not out[-1]:
        out.pop()
    return tuple(out)


def _norm_all(fields) -> tuple:
    return _trim(norm_field(x) for x in fields)


def _ints(tokens) -> list[int]:
    """정수 칸만(THRU 풀기, 실수 거름). RBE2 의 종속 절점·SPC1 절점."""
    toks = [(t or "").strip() for t in tokens if (t or "").strip()]
    out: list[int] = []
    i = 0
    while i < len(toks):
        t = toks[i]
        if t.upper() == "THRU" and out and i + 1 < len(toks):
            b = parse_int(toks[i + 1])
            if b is not None and 0 <= b - out[-1] <= 1_000_000:
                out.extend(range(out[-1] + 1, b + 1))
            i += 2
            continue
        if not is_real(t):
            v = parse_int(t)
            if v is not None:
                out.append(v)
        i += 1
    return out


@dataclass
class LoadSet:
    cards: Counter = field(default_factory=Counter)
    force: list = field(default_factory=lambda: [0.0, 0.0, 0.0])
    moment: list = field(default_factory=lambda: [0.0, 0.0, 0.0])
    grav: list = field(default_factory=lambda: [0.0, 0.0, 0.0])
    pressure: float = 0.0
    lines: list = field(default_factory=list)       # 정규화 문자열(해시를 내고 비운다)
    digest: str = ""


@dataclass
class Facts:
    nodes: dict = field(default_factory=dict)        # gid → (x, y, z) 기본 좌표계
    elements: dict = field(default_factory=dict)     # eid → (card, pid, hash(conn), hash(rest))
    rigids: dict = field(default_factory=dict)       # eid → (card, indep, frozenset(dep), rest)
    props: dict = field(default_factory=dict)        # pid → (card, fields)
    mats: dict = field(default_factory=dict)         # mid → (card, fields)
    spc: dict = field(default_factory=dict)          # (sid, gid) → 성분 문자열
    spcadd: dict = field(default_factory=dict)       # sid → fields
    loads: dict = field(default_factory=dict)        # sid → LoadSet
    masses: dict = field(default_factory=dict)       # eid → (card, fields, mass)
    control: list = field(default_factory=list)      # 해석 선택 문장(SOL + Case Control)
    sol: str | None = None
    other: Counter = field(default_factory=Counter)  # 그 밖 카드 + Case Control 출력 요청


def _add_spc(facts: Facts, sid: str, gid: int | None, comp: str) -> None:
    if gid is None:
        return
    comp = "".join(c for c in (comp or "") if c in "0123456")
    key = (sid, gid)
    facts.spc[key] = "".join(sorted(set(facts.spc.get(key, "") + comp)))


def read_facts(cards: list[Card], control: list[str] | None = None, sol: str | None = None) -> Facts:
    """카드 목록 → 비교용 사실. 카드 목록은 바꾸지 않는다."""
    facts = Facts(sol=(sol or "").upper() or None)
    raw_grids: dict[int, tuple] = {}
    coord_defs: list[tuple] = []
    grdset_cp = 0
    pending_forces: list[tuple] = []     # (sid, card, gid, cid, vector) — 좌표 풀린 뒤 기본 좌표계로
    for c in cards:
        n, f = c.name, c.fields
        if n == "GRID":
            gid = parse_int(f[0] if f else None)
            if gid is None:
                continue
            g = list(f) + [""] * 5
            raw_grids[gid] = (parse_int(g[1]), parse_float(g[2]) or 0.0, parse_float(g[3]) or 0.0,
                              parse_float(g[4]) or 0.0)
        elif n == "GRDSET":
            g = list(f) + [""] * 2
            grdset_cp = parse_int(g[1]) or 0
        elif n in ("CORD2R", "CORD2C", "CORD2S"):
            g = list(f) + [""] * 11
            cid = parse_int(g[0])
            if cid:
                coord_defs.append(("2", n[-1], cid, parse_int(g[1]) or 0, [parse_float(x) or 0.0 for x in g[2:11]]))
        elif n in ("CORD1R", "CORD1C", "CORD1S"):
            g = list(f) + [""] * 8
            for k in (0, 4):
                cid = parse_int(g[k])
                gs = [parse_int(g[k + j]) for j in (1, 2, 3)]
                if cid and all(x is not None for x in gs):
                    coord_defs.append(("1", n[-1], cid, None, gs))
        elif n in ELEMENT_PID_CARDS or n in INLINE_ELEMENTS:
            eid = parse_int(f[0] if f else None)
            if eid is None:
                continue
            if n in INLINE_ELEMENTS:
                g_span, p_span = INLINE_ELEMENTS[n]
                conn = _norm_all(f[g_span[0]:g_span[1]])
                rest = _norm_all(f[p_span[0]:p_span[1]] if p_span[1] is not None else f[p_span[0]:])
                pid = ""
            else:
                pid = norm_field(f[1] if len(f) > 1 else "") or norm_field(f[0])   # PID 가 비면 EID
                span = CONN.get(n)
                if span:
                    conn = _norm_all(f[span[0]:span[1]])
                    rest = _norm_all(f[span[1]:])
                else:
                    conn, rest = (), _norm_all(f[2:])
            # 연결·나머지 칸은 같은지만 보면 되므로 해시 값(정수)으로 줄인다 — 수십만 요소의 문자열 튜플을 들지 않는다
            # (str 해시는 프로세스마다 다르지만 두 모델을 한 프로세스에서 비교하므로 문제없다)
            facts.elements[eid] = (sys.intern(n), sys.intern(pid), hash(conn), hash(rest))
        elif n in RIGID_CARDS:
            eid = parse_int(f[0] if f else None)
            if eid is None:
                continue
            g = list(f) + [""] * 4
            if n == "RBE2":
                indep, dep = _norm_all(g[1:3]), frozenset(_ints(g[3:]))
            elif n == "RBE3":
                indep, dep = _norm_all(g[2:4]), frozenset(_rbe3_others(g[4:]))
            else:
                indep, dep = _norm_all(f[1:]), frozenset()
            facts.rigids[eid] = (n, indep, dep, _norm_all(f[1:]))
        elif n in MASS_CARDS:
            eid = parse_int(f[0] if f else None)
            if eid is None:
                continue
            g = list(f) + [""] * 4
            mass = parse_float(g[3]) if n == "CONM2" else parse_float(g[1]) if n in ("CMASS2", "CMASS4") else None
            facts.masses[eid] = (n, _norm_all(f[1:]), mass or 0.0)
        elif n in SPC_CARDS:
            g = list(f) + [""] * 8
            sid = norm_field(g[0])
            if n == "SPC":
                for gi, ci in ((1, 2), (4, 5)):
                    _add_spc(facts, sid, parse_int(g[gi]), g[ci])
            elif n == "SPC1":
                for gid in _ints(g[2:]):
                    _add_spc(facts, sid, gid, g[1])
            else:
                facts.spcadd[sid] = _norm_all(g[1:])
        elif n in GEOMETRY_CARDS:
            continue          # GRDSET·SPOINT·PLOTEL 등 — 절점·좌표계 외 형상 카드는 따로 세지 않는다
        elif n in ORIENT_DEFAULT_CARDS:
            facts.other[n + " " + " ".join(_norm_all(f))] += 1
        else:
            cat = _category(n)
            if cat == "property":
                pid = parse_int(f[0] if f else None)
                if pid is not None:
                    facts.props[pid] = (n, _norm_all(f))
            elif cat == "material":
                mid = parse_int(f[0] if f else None)
                if mid is not None:
                    # 주 재료(MAT1·MAT2·MAT8…)는 MID 하나에 한 장 — 종류가 바뀌면 '카드 변경'. MATS1·MATT1·TABLEM 은 따로
                    group = "MAT" if n[:3] == "MAT" and n[3:4].isdigit() else n
                    facts.mats[(group, mid)] = (n, _norm_all(f))
            elif cat == "load":
                g = list(f) + [""] * 8
                sid = norm_field(g[0])
                ls = facts.loads.get(sid)
                if ls is None:
                    ls = facts.loads[sid] = LoadSet()
                ls.cards[n] += 1
                ls.lines.append(n + "\x1f" + "\x1f".join(_norm_all(f)))
                if n in ("FORCE", "MOMENT"):
                    s = parse_float(g[3]) or 0.0
                    vec = (s * (parse_float(g[4]) or 0.0), s * (parse_float(g[5]) or 0.0), s * (parse_float(g[6]) or 0.0))
                    pending_forces.append((sid, n, parse_int(g[1]), parse_int(g[2]) or 0, vec))
                elif n == "GRAV":
                    a = parse_float(g[2]) or 0.0
                    for k in range(3):
                        ls.grav[k] += a * (parse_float(g[3 + k]) or 0.0)
                elif n in ("PLOAD", "PLOAD2"):
                    ls.pressure += parse_float(g[1]) or 0.0
                elif n == "PLOAD4":
                    ls.pressure += parse_float(g[2]) or 0.0
            else:
                facts.other[n + " " + " ".join(_norm_all(f))] += 1

    grids = {gid: (grdset_cp if cp is None else cp, x, y, z) for gid, (cp, x, y, z) in raw_grids.items()}
    del raw_grids
    systems: dict[int, CoordSystem] = {}
    facts.nodes, _unresolved, _bad = resolve_coords(grids, coord_defs, systems=systems)
    del grids
    for sid, n, gid, cid, vec in pending_forces:
        if cid and cid in systems and gid in facts.nodes:
            vec = systems[cid].vector_to_basic(vec, facts.nodes[gid])
        target = facts.loads[sid].force if n == "FORCE" else facts.loads[sid].moment
        for k in range(3):
            target[k] += vec[k]
    for ls in facts.loads.values():
        ls.lines.sort()
        h = hashlib.sha256()
        for s in ls.lines:
            h.update(s.encode("utf-8"))
            h.update(b"\n")
        ls.digest = h.hexdigest()
        ls.lines = []
    case_load, case_other = split_control(control or [], sol)
    facts.control = case_load
    for s in case_other:
        facts.other["@CASE " + s] += 1
    return facts


# ── 표시 ────────────────────────────────────────────────────────────────

def show(v: str) -> str:
    """정규화 값 → 사람용('12.' → '12', '' → '빈칸')."""
    if v == "":
        return "빈칸"
    if v.endswith(".") and v[:-1].lstrip("-").isdigit():
        return v[:-1]
    return v


def _num(x: float) -> str:
    if x == 0:
        return "0"
    if abs(x) >= 1e5 or abs(x) < 1e-3:
        return f"{x:.4g}"
    return f"{x:.6g}"


def _vec(v) -> str:
    return "(" + ", ".join(_num(x) for x in v) + ")"


def _field_name(card: str, k: int) -> str:
    names = FIELD_NAMES.get(card) or []
    return names[k] if k < len(names) and names[k] else f"{k + 2}번째 칸"


def _dims(card: str, fields: tuple) -> tuple[str, list[str], tuple]:
    """PBARL·PBEAML → (형상, DIM 값(첫 단면), 나머지 칸)."""
    shape = fields[3] if len(fields) > 3 else ""
    tail = [x for x in fields[8:]]
    n = DIM_COUNT.get(shape, 4)
    dims = [x for x in tail if x][:n]
    return shape, dims, tuple(tail[len(dims):])


def _card_changes(card: str, a: tuple, b: tuple) -> list[dict]:
    out = []
    for k in range(max(len(a), len(b))):
        x = a[k] if k < len(a) else ""
        y = b[k] if k < len(b) else ""
        if x != y:
            out.append({"field": _field_name(card, k), "a": show(x), "b": show(y)})
    return out


def _describe_change(kind: str, ident: int, card_a: str, fa: tuple, card_b: str, fb: tuple) -> dict:
    """속성·재료 한 건의 전후 — 문장(text) + 칸별 변경(changes) + 분류 표시(thickness·section)."""
    if card_a != card_b:
        return {"id": ident, "card": card_b, "text": f"{kind} {ident}: {card_a} → {card_b}", "changes": [],
                "card_changed": True}
    if card_a in ("PBARL", "PBEAML"):
        sa, da, ra = _dims(card_a, fa)
        sb, db, rb = _dims(card_b, fb)
        parts, changes = [], []
        if sa != sb:
            parts.append(f"형상 {sa or '빈칸'} → {sb or '빈칸'}")
            changes.append({"field": "TYPE", "a": sa, "b": sb})
        if da != db:
            parts.append("DIM " + "×".join(show(x) for x in da) + " → " + "×".join(show(x) for x in db))
            changes.append({"field": "DIM", "a": "×".join(show(x) for x in da), "b": "×".join(show(x) for x in db)})
        head = [c for c in _card_changes(card_a, fa[:4], fb[:4]) if c["field"] != "TYPE"]
        changes = head + changes
        parts = [f"{c['field']} {c['a']} → {c['b']}" for c in head] + parts
        if ra != rb and not parts:
            parts.append("그 밖의 칸 변경")
        shape = sb or sa
        return {"id": ident, "card": card_a, "text": f"{card_a} {ident}{' ' + shape if shape else ''}: "
                + ", ".join(parts), "changes": changes, "section": da != db or sa != sb}
    changes = _card_changes(card_a, fa, fb)
    text = f"{card_a} {ident}: " + ", ".join(f"{c['field']} {c['a']} → {c['b']}" for c in changes[:6])
    if len(changes) > 6:
        text += f" 외 {len(changes) - 6}칸"
    return {"id": ident, "card": card_a, "text": text, "changes": changes,
            "thickness": card_a == "PSHELL" and any(c["field"] == "T" for c in changes)}


# ── 비교 ────────────────────────────────────────────────────────────────

class _Lists:
    """상한 있는 목록 모음 — 넘으면 truncated 에 원래 개수."""

    def __init__(self):
        self.truncated: dict[str, int] = {}

    def cap(self, name: str, values, limit: int | None = None) -> list:
        limit = LIST_LIMIT if limit is None else limit
        values = list(values)
        if len(values) > limit:
            self.truncated[name] = len(values)
            return values[:limit]
        return values


def _jaccard(a: set, b: set) -> float:
    u = len(a | b)
    return round(len(a & b) / u, 4) if u else 1.0


def _diag(nodes: dict) -> float:
    if not nodes:
        return 0.0
    xs, ys, zs = zip(*nodes.values())
    return math.sqrt((max(xs) - min(xs)) ** 2 + (max(ys) - min(ys)) ** 2 + (max(zs) - min(zs)) ** 2)


def compare(a: Facts, b: Facts) -> tuple[dict, dict]:
    L = _Lists()
    summary: dict = {"version": VERSION}
    detail: dict = {"version": VERSION, "limits": {"ids": LIST_LIMIT, "texts": TEXT_LIMIT}}

    # 절점
    na, nb = set(a.nodes), set(b.nodes)
    common = na & nb
    tol = max(NODE_TOL_ABS, NODE_TOL_REL * _diag(a.nodes))
    moved: list[tuple[int, float]] = []
    for g in common:
        p, q = a.nodes[g], b.nodes[g]
        d = math.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2)
        if d > tol:
            moved.append((g, d))
    moved.sort(key=lambda x: -x[1])
    summary["nodes"] = {"a": len(na), "b": len(nb), "added": len(nb - na), "removed": len(na - nb),
                        "moved": len(moved), "max_move": round(moved[0][1], 6) if moved else 0.0,
                        "mean_move": round(sum(d for _g, d in moved) / len(moved), 6) if moved else 0.0,
                        "tol": round(tol, 6)}
    detail["nodes"] = {"added": L.cap("nodes.added", sorted(nb - na)),
                       "removed": L.cap("nodes.removed", sorted(na - nb)),
                       "moved": L.cap("nodes.moved", sorted(g for g, _d in moved)),
                       "top_moved": [[g, round(d, 6)] for g, d in moved[:TOP_MOVED]]}

    # 요소
    ea, eb = a.elements, b.elements
    added = sorted(set(eb) - set(ea))
    removed = sorted(set(ea) - set(eb))
    conn, card, pid, rest = [], [], [], []
    for e in sorted(set(ea) & set(eb)):
        x, y = ea[e], eb[e]
        if x == y:
            continue
        if x[0] != y[0]:
            card.append({"eid": e, "a": x[0], "b": y[0]})
            continue
        if x[2] != y[2]:
            conn.append(e)
        if x[1] != y[1]:
            pid.append({"eid": e, "a": show(x[1]), "b": show(y[1])})
        if x[3] != y[3]:
            rest.append(e)
    summary["elements"] = {
        "a": len(ea), "b": len(eb), "added": len(added), "removed": len(removed),
        "added_by_card": dict(Counter(eb[e][0] for e in added).most_common()),
        "removed_by_card": dict(Counter(ea[e][0] for e in removed).most_common()),
        "conn_changed": len(conn), "card_changed": len(card), "pid_changed": len(pid), "other_changed": len(rest)}
    detail["elements"] = {"added": L.cap("elements.added", added), "removed": L.cap("elements.removed", removed),
                          "conn": L.cap("elements.conn", conn), "card": L.cap("elements.card", card),
                          "pid": L.cap("elements.pid", pid), "other": L.cap("elements.other", rest)}

    # 강체
    ra, rb = a.rigids, b.rigids
    r_added, r_removed = sorted(set(rb) - set(ra)), sorted(set(ra) - set(rb))
    indep, dep, r_other = [], [], []
    for e in sorted(set(ra) & set(rb)):
        x, y = ra[e], rb[e]
        if x == y:
            continue
        if x[0] != y[0] or x[1] != y[1]:
            indep.append(e)
        elif x[2] != y[2]:
            dep.append({"eid": e, "card": y[0], "added": len(y[2] - x[2]), "removed": len(x[2] - y[2]),
                        "added_ids": sorted(y[2] - x[2])[:50], "removed_ids": sorted(x[2] - y[2])[:50]})
        else:
            r_other.append(e)
    summary["rigids"] = {"a": len(ra), "b": len(rb), "added": len(r_added), "removed": len(r_removed),
                         "indep_changed": len(indep), "dep_changed": len(dep), "other_changed": len(r_other)}
    detail["rigids"] = {"added": L.cap("rigids.added", r_added), "removed": L.cap("rigids.removed", r_removed),
                        "indep": L.cap("rigids.indep", indep), "dep": L.cap("rigids.dep", dep, TEXT_LIMIT),
                        "other": L.cap("rigids.other", r_other)}

    # 속성·재료
    def keyed(kind: str, da: dict, db: dict, name: str) -> tuple[dict, dict]:
        def ident(k):        # 재료는 (묶음, MID) 열쇠 — 화면에는 MID
            return k[1] if isinstance(k, tuple) else k

        def order(k):
            return (str(k[0]), k[1]) if isinstance(k, tuple) else ("", k)

        add = [{"id": ident(k), "card": db[k][0], "text": f"{db[k][0]} {ident(k)} 추가"}
               for k in sorted(set(db) - set(da), key=order)]
        rem = [{"id": ident(k), "card": da[k][0], "text": f"{da[k][0]} {ident(k)} 삭제"}
               for k in sorted(set(da) - set(db), key=order)]
        chg = [_describe_change(kind, ident(k), da[k][0], da[k][1], db[k][0], db[k][1])
               for k in sorted(set(da) & set(db), key=order) if da[k] != db[k]]
        s = {"a": len(da), "b": len(db), "added": len(add), "removed": len(rem), "changed": len(chg)}
        d = {"added": L.cap(name + ".added", add, TEXT_LIMIT), "removed": L.cap(name + ".removed", rem, TEXT_LIMIT),
             "changed": L.cap(name + ".changed", chg, TEXT_LIMIT)}
        return s, d

    summary["properties"], detail["properties"] = keyed("PID", a.props, b.props, "properties")
    summary["properties"]["thickness"] = sum(1 for c in detail["properties"]["changed"] if c.get("thickness"))
    summary["properties"]["section"] = sum(1 for c in detail["properties"]["changed"] if c.get("section"))
    summary["materials"], detail["materials"] = keyed("MID", a.mats, b.mats, "materials")

    # 하중·경계조건
    spc_added = sorted(k for k in set(b.spc) - set(a.spc))
    spc_removed = sorted(k for k in set(a.spc) - set(b.spc))
    spc_changed = sorted(k for k in set(a.spc) & set(b.spc) if a.spc[k] != b.spc[k])
    sets = []
    for sid in sorted(set(a.loads) | set(b.loads), key=lambda s: (len(s), s)):
        x, y = a.loads.get(sid), b.loads.get(sid)
        if x is not None and y is not None and x.digest == y.digest:
            continue
        sets.append(_load_text(sid, x, y))
    for sid in sorted(set(a.spcadd) | set(b.spcadd)):
        if a.spcadd.get(sid) != b.spcadd.get(sid):
            sets.append({"sid": sid, "text": f"SPCADD {show(sid)}: "
                         + ("추가" if sid not in a.spcadd else "삭제" if sid not in b.spcadd else "구성 변경")})
    summary["loads"] = {"sets_a": len(a.loads), "sets_b": len(b.loads), "sets_changed": len(sets),
                        "spc_added": len(spc_added), "spc_removed": len(spc_removed), "spc_changed": len(spc_changed),
                        "spc_nodes_a": len({g for _s, g in a.spc}), "spc_nodes_b": len({g for _s, g in b.spc})}
    detail["loads"] = {
        "sets": L.cap("loads.sets", sets, TEXT_LIMIT),
        "spc_added": L.cap("loads.spc_added", [[show(s), g, b.spc[(s, g)]] for s, g in spc_added]),
        "spc_removed": L.cap("loads.spc_removed", [[show(s), g, a.spc[(s, g)]] for s, g in spc_removed]),
        "spc_changed": L.cap("loads.spc_changed", [[show(s), g, a.spc[(s, g)], b.spc[(s, g)]] for s, g in spc_changed]),
        "spc_nodes": L.cap("loads.spc_nodes", sorted({g for _s, g in spc_added + spc_removed + spc_changed}))}

    # 질량
    ma, mb = a.masses, b.masses
    m_added, m_removed = sorted(set(mb) - set(ma)), sorted(set(ma) - set(mb))
    m_changed = [{"eid": e, "card": mb[e][0], "a": _num(ma[e][2]), "b": _num(mb[e][2])}
                 for e in sorted(set(ma) & set(mb)) if ma[e] != mb[e]]
    total_a, total_b = sum(x[2] for x in ma.values()), sum(x[2] for x in mb.values())
    summary["mass"] = {"a": len(ma), "b": len(mb), "added": len(m_added), "removed": len(m_removed),
                       "changed": len(m_changed), "total_a": total_a, "total_b": total_b}
    detail["mass"] = {"added": L.cap("mass.added", m_added), "removed": L.cap("mass.removed", m_removed),
                      "changed": L.cap("mass.changed", m_changed, TEXT_LIMIT)}

    # 해석 설정 — SOL·Case Control 선택(순서 있는 문장) + 그 밖 카드(PARAM·EIGRL…)
    ca, cb = _labeled_control(a.control), _labeled_control(b.control)
    c_removed = [s for s in ca if s not in cb]
    c_added = [s for s in cb if s not in ca]
    o_added = sorted((b.other - a.other).elements())
    o_removed = sorted((a.other - b.other).elements())
    summary["control"] = {"sol_a": a.sol, "sol_b": b.sol, "changed": ca != cb, "added": len(c_added),
                          "removed": len(c_removed), "other_added": len(o_added), "other_removed": len(o_removed)}
    detail["control"] = {"added": L.cap("control.added", c_added, TEXT_LIMIT),
                         "removed": L.cap("control.removed", c_removed, TEXT_LIMIT),
                         "other_added": L.cap("control.other_added", o_added, TEXT_LIMIT),
                         "other_removed": L.cap("control.other_removed", o_removed, TEXT_LIMIT)}

    summary["overlap"] = {"nodes": _jaccard(na, nb), "elements": _jaccard(set(ea), set(eb))}
    summary["identical"] = _identical(summary)
    summary["truncated"] = L.truncated
    detail["truncated"] = L.truncated
    return summary, detail


def _labeled_control(stmts: list[str]) -> list[str]:
    """해석 선택 문장 → 사람용('SUBCASE 1 · LOAD = 10'). SUBCASE 안의 문장에는 그 SUBCASE 를 붙인다."""
    out, sub = [], ""
    for s in stmts:
        s = s.replace("\x1f", " ").replace(" =", " = ")
        if s.startswith("SUBCASE "):
            sub = s
            out.append(s)
        else:
            out.append(f"{sub} · {s}" if sub else s)
    return out


def _load_text(sid: str, x: LoadSet | None, y: LoadSet | None) -> dict:
    name = show(sid)
    if x is None:
        return {"sid": name, "text": f"SID {name}: 추가 ({_cards(y.cards)})"}
    if y is None:
        return {"sid": name, "text": f"SID {name}: 삭제 ({_cards(x.cards)})"}
    parts = []
    if x.cards != y.cards:
        parts.append(f"{_cards(x.cards)} → {_cards(y.cards)}")
    for label, u, v in (("힘 합", x.force, y.force), ("모멘트 합", x.moment, y.moment), ("GRAV", x.grav, y.grav)):
        if any(abs(p - q) > 1e-9 * max(1.0, abs(p), abs(q)) for p, q in zip(u, v)):
            parts.append(f"{label} {_vec(u)} → {_vec(v)}")
    if abs(x.pressure - y.pressure) > 1e-9 * max(1.0, abs(x.pressure)):
        parts.append(f"압력 합 {_num(x.pressure)} → {_num(y.pressure)}")
    if not parts:
        parts.append("값 변경")
    return {"sid": name, "text": f"SID {name}: " + ", ".join(parts),
            "a": {"force": x.force, "moment": x.moment, "grav": x.grav, "pressure": x.pressure},
            "b": {"force": y.force, "moment": y.moment, "grav": y.grav, "pressure": y.pressure}}


def _cards(c: Counter) -> str:
    return " ".join(f"{k} {v}" for k, v in sorted(c.items())) + "개"


def _identical(s: dict) -> bool:
    keys = (("nodes", ("added", "removed", "moved")),
            ("elements", ("added", "removed", "conn_changed", "card_changed", "pid_changed", "other_changed")),
            ("rigids", ("added", "removed", "indep_changed", "dep_changed", "other_changed")),
            ("properties", ("added", "removed", "changed")), ("materials", ("added", "removed", "changed")),
            ("loads", ("sets_changed", "spc_added", "spc_removed", "spc_changed")),
            ("mass", ("added", "removed", "changed")),
            ("control", ("added", "removed", "other_added", "other_removed")))
    return not any(s[k][f] for k, fs in keys for f in fs) and not s["control"]["changed"]
