"""카드 → Model. 표시에 필요한 것만 해석한다(설계 §7.1·§7.2)."""
import re
from collections import Counter
from dataclasses import dataclass, field

from .coords import resolve_coords
from .deck import Card
from .fields import is_real, parse_float, parse_int

BEAM_CARDS = ("CBAR", "CBEAM", "CROD", "CONROD", "CBUSH")
TRI_CARDS = ("CTRIA3", "CTRIA6", "CTRIAR")
QUAD_CARDS = ("CQUAD4", "CQUAD8", "CQUADR")
RIGID_CARDS = ("RBE2", "RBE3")
# PBARL/PBEAML 형상별 DIM 개수(MSC QRG). 표에 없는 형상은 4개로 본다.
DIM_COUNT = {"ROD": 1, "TUBE": 2, "TUBE2": 2, "BAR": 2, "BOX": 4, "BOX1": 6, "L": 4, "I": 6, "I1": 4, "T": 4,
             "T1": 4, "T2": 4, "CHAN": 4, "CHAN1": 4, "CHAN2": 4, "H": 4, "HAT": 4, "HAT1": 5, "Z": 4,
             "CROSS": 4, "HEXA": 3, "DBOX": 10}
# 표시와 무관해 조용히 넘기는 카드(하중·해석 제어 등)
IGNORED = {"PARAM", "EIGRL", "EIGR", "FORCE", "FORCE1", "FORCE2", "MOMENT", "MOMENT1", "GRAV", "LOAD",
           "PLOAD", "PLOAD1", "PLOAD2", "PLOAD4", "TEMP", "TEMPD", "SPCADD", "MPCADD", "LSEQ", "DLOAD",
           "RLOAD1", "RLOAD2", "TLOAD1", "TLOAD2", "TABLED1", "TABDMP1", "FREQ", "FREQ1", "NLPARM", "SPCD",
           "MPC", "DMIG", "ACCEL", "ACCEL1", "RFORCE", "SUPORT", "ASET", "ASET1", "OMIT1", "SESET",
           "DAREA", "DPHASE", "DELAY", "EIGB", "TSTEP", "PLOTEL"}
# 속성 카드 허용 목록 — 이 밖의 P 로 시작하는 카드는 IGNORED 가 아니면 미지원으로 센다
PROPERTY_CARDS = {"PSHELL", "PCOMP", "PCOMPG", "PBAR", "PBARL", "PBEAM", "PBEAML", "PROD", "PTUBE", "PBUSH",
                  "PELAS", "PDAMP", "PGAP", "PSOLID", "PSHEAR", "PVISC", "PMASS", "PBEND", "PWELD", "PFAST"}
# 재료 표에 넣는 주 재료 카드 — MATS*(비선형)·MATT*(온도 의존)는 같은 MID 를 덮어쓰지 않게 조용히 넘긴다
MATERIAL_CARDS = {"MAT1", "MAT2", "MAT8", "MAT9", "MAT10"}
_SPC_COMPONENT = re.compile(r"[0-6]+")
INT32_MIN, INT32_MAX = -2 ** 31, 2 ** 31 - 1


class ModelError(ValueError):
    """모델을 표시용으로 만들 수 없다 — code 가 그대로 변환 오류(ModelSummary.error)가 된다."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(slots=True)
class Element:
    eid: int
    card: str
    pid: int
    nodes: tuple[int, ...]


@dataclass(slots=True)
class Rigid:
    eid: int
    card: str
    center: int
    others: list[int]


@dataclass
class Model:
    nodes: dict[int, tuple[float, float, float]] = field(default_factory=dict)
    beams: list[Element] = field(default_factory=list)
    tris: list[Element] = field(default_factory=list)
    quads: list[Element] = field(default_factory=list)
    rigids: list[Rigid] = field(default_factory=list)
    masses: list[tuple[int, int, float]] = field(default_factory=list)
    spcs: dict[int, str] = field(default_factory=dict)
    properties: dict[int, dict] = field(default_factory=dict)
    materials: dict[int, dict] = field(default_factory=dict)
    conrods: dict[int, dict] = field(default_factory=dict)
    sol: str | None = None
    warnings: list[str] = field(default_factory=list)
    unsupported: dict[str, int] = field(default_factory=dict)
    includes: list[str] = field(default_factory=list)
    missing_includes: list[str] = field(default_factory=list)

    def element_total(self) -> int:
        return len(self.beams) + len(self.tris) + len(self.quads)

    def counts(self) -> dict[str, int]:
        c = Counter(e.card for e in (*self.beams, *self.tris, *self.quads))
        c.update(r.card for r in self.rigids)
        if self.masses:
            c["CONM2"] = len(self.masses)
        c["GRID"] = len(self.nodes)
        return dict(c)

    def framing_points(self) -> list[tuple[float, float, float]]:
        """화면 틀(bbox·썸네일)을 정할 절점 — 요소(보·쉘·강체)가 쓰는 절점만. 요소가 없으면 전체 절점.
        요소에 안 쓰인 먼 절점(기준점·잔여 GRID) 하나가 틀을 키워 모델이 점으로 보이는 것을 막는다."""
        used: set[int] = set()
        for e in (*self.beams, *self.tris, *self.quads):
            used.update(e.nodes)
        for r in self.rigids:
            used.add(r.center)
            used.update(r.others)
        pts = [self.nodes[n] for n in used if n in self.nodes]
        return pts or list(self.nodes.values())

    def bbox(self) -> dict | None:
        if not self.nodes:
            return None
        xs, ys, zs = zip(*self.framing_points())
        return {"min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]}


def _ints(tokens) -> list[int]:
    return [v for v in (parse_int(t) for t in tokens if t and not is_real(t)) if v is not None]


def _property(name: str, f: list[str]) -> tuple[int | None, dict]:
    pid = parse_int(f[0])
    mid = parse_int(f[1])
    if name == "PSHELL":
        return pid, {"card": name, "mid": mid, "t": parse_float(f[2])}
    if name in ("PBARL", "PBEAML"):
        shape = (f[3] or "").upper()
        dims = [v for v in (parse_float(x) for x in f[4:]) if v is not None][:DIM_COUNT.get(shape, 4)]
        return pid, {"card": name, "mid": mid, "type": shape, "dims": dims}
    if name in ("PBAR", "PBEAM", "PROD"):
        return pid, {"card": name, "mid": mid, "A": parse_float(f[2])}
    if name == "PCOMP":
        # 층마다 4칸(MID·T·THETA·SOUT). T 가 빈 층은 앞 층 T 를 잇고, LAM=SYM 이면 두께가 두 배다.
        plies = f[8:]
        t, prev = 0.0, None
        for k in range(0, len(plies), 4):
            ply = plies[k:k + 4]
            if not any((x or "").strip() for x in ply):
                continue
            v = parse_float(ply[1]) if len(ply) > 1 else None
            if v is None:
                v = prev
            if v is not None:
                t += v
                prev = v
        if (f[7] or "").strip().upper() == "SYM":
            t *= 2
        return pid, {"card": name, "t": t or None}
    return pid, {"card": name}


def _rbe3_others(tokens: list[str]) -> list[int]:
    others: list[int] = []
    expect_component = False
    for t in tokens:
        t = (t or "").strip().upper()
        if not t:
            continue
        if t in ("UM", "ALPHA"):
            break
        if is_real(t):
            expect_component = True
            continue
        v = parse_int(t)
        if v is None:
            continue
        if expect_component:
            expect_component = False
            continue
        others.append(v)
    return others


def _spc1_nodes(tokens: list[str]) -> list[int]:
    toks = [t for t in tokens if t]
    if len(toks) >= 3 and toks[1].upper() == "THRU":
        a, b = parse_int(toks[0]), parse_int(toks[2])
        if a is not None and b is not None and 0 <= b - a <= 1_000_000:
            return list(range(a, b + 1))
        return []
    return _ints(toks)


def _add_comp(spcs: dict[int, str], g: int, comp: str) -> None:
    """구속 성분은 0~6 숫자만 받는다(그 밖의 값은 lbm 의 int 변환을 깨뜨린다)."""
    if _SPC_COMPONENT.fullmatch(comp):
        spcs[g] = "".join(sorted(set(spcs.get(g, "") + comp)))


def _check_ids(m: Model) -> None:
    """lbm 블록은 int32 — 범위를 넘는 ID 는 numpy OverflowError 대신 분명한 오류로 끝낸다."""
    shells = (*m.beams, *m.tris, *m.quads)
    groups = (m.nodes.keys(), [e.eid for e in shells], [e.pid for e in shells],
              [r.eid for r in m.rigids], [x[0] for x in m.masses])
    for ids in groups:
        if ids and (min(ids) < INT32_MIN or max(ids) > INT32_MAX):
            raise ModelError("id_out_of_range")


def build_model(cards: list[Card], *, sol: str | None = None, warnings=(), includes=(), missing=()) -> Model:
    m = Model(sol=sol, warnings=list(warnings), includes=list(includes), missing_includes=list(missing))
    raw_grids: dict[int, tuple[int | None, float, float, float]] = {}
    coord_defs: list[tuple] = []
    # 요소 ID 는 보·쉘·강체·질량이 한 이름공간을 쓴다 — 같은 EID 가 또 나오면 뒤의 것이 이긴다
    elements: dict[int, tuple[str, object]] = {}
    unsupported: Counter = Counter()
    grounded = missing_gb = duplicates = 0
    grdset_cp = 0

    def put(eid: int, kind: str, obj) -> None:
        nonlocal duplicates
        if eid in elements:
            duplicates += 1
        elements[eid] = (kind, obj)

    for c in cards:
        n, f = c.name, c.fields + [""] * max(0, 24 - len(c.fields))
        if n == "GRID":
            gid = parse_int(f[0])
            if gid is not None:
                if gid in raw_grids:
                    duplicates += 1
                # CP 가 비면 None — 끝에서 GRDSET 의 CP(없으면 0)로 채운다(GRDSET 은 덱 어디에 있어도 된다)
                raw_grids[gid] = (parse_int(f[1]), parse_float(f[2]) or 0.0,
                                  parse_float(f[3]) or 0.0, parse_float(f[4]) or 0.0)
        elif n == "GRDSET":
            grdset_cp = parse_int(f[1]) or 0   # 3번째 칸 = CP
        elif n in ("CORD2R", "CORD2C", "CORD2S"):
            cid = parse_int(f[0])
            if cid:
                coord_defs.append(("2", n[-1], cid, parse_int(f[1]) or 0,
                                   [parse_float(x) or 0.0 for x in (f[2:8] + f[8:11])]))
        elif n in ("CORD1R", "CORD1C", "CORD1S"):
            for k in (0, 4):
                cid = parse_int(f[k])
                gs = [parse_int(f[k + j]) for j in (1, 2, 3)]
                if cid and all(g is not None for g in gs):
                    coord_defs.append(("1", n[-1], cid, None, gs))
        elif n in BEAM_CARDS:
            eid = parse_int(f[0])
            if eid is None:
                continue
            if n == "CONROD":
                g1, g2 = parse_int(f[1]), parse_int(f[2])
                m.conrods[eid] = {"mid": parse_int(f[3]), "A": parse_float(f[4])}
                put(eid, "beam", Element(eid, n, 0, (g1, g2)))
            else:
                ga, gb = parse_int(f[2]), parse_int(f[3])
                if gb is None:
                    if n == "CBUSH":
                        grounded += 1       # 접지 CBUSH — 정상 모델링
                    else:
                        missing_gb += 1     # CBAR·CBEAM·CROD 의 GB 누락 — 깨진 카드
                    continue
                pid = parse_int(f[1])       # PID 가 비면 EID(Nastran 규칙)
                put(eid, "beam", Element(eid, n, eid if pid is None else pid, (ga, gb)))
        elif n in TRI_CARDS or n in QUAD_CARDS:
            eid = parse_int(f[0])
            k = 3 if n in TRI_CARDS else 4
            if eid is not None:
                pid = parse_int(f[1])
                put(eid, "tri" if k == 3 else "quad",
                    Element(eid, n, eid if pid is None else pid, tuple(parse_int(x) for x in f[2:2 + k])))
        elif n == "RBE2":
            eid, gn = parse_int(f[0]), parse_int(f[1])
            if eid is not None and gn is not None:
                put(eid, "rigid", Rigid(eid, n, gn, _ints(f[3:])))
        elif n == "RBE3":
            eid, ref = parse_int(f[0]), parse_int(f[2])
            if eid is not None and ref is not None:
                put(eid, "rigid", Rigid(eid, n, ref, _rbe3_others(f[4:])))
        elif n == "CONM2":
            eid, g = parse_int(f[0]), parse_int(f[1])
            if eid is not None and g is not None:
                put(eid, "mass", (eid, g, parse_float(f[3]) or 0.0))
        elif n == "SPC":
            for g_i, c_i in ((1, 2), (4, 5)):
                g = parse_int(f[g_i])
                if g is not None:
                    _add_comp(m.spcs, g, (f[c_i] or "").strip())
        elif n == "SPC1":
            comp = (f[1] or "").strip()
            if _SPC_COMPONENT.fullmatch(comp):
                for g in _spc1_nodes(f[2:]):
                    _add_comp(m.spcs, g, comp)
        elif n in PROPERTY_CARDS:
            pid, prop = _property(n, f)
            if pid is not None:
                m.properties[pid] = prop
        elif n in MATERIAL_CARDS:
            mid = parse_int(f[0])
            if mid is not None:
                m.materials[mid] = ({"card": n, "E": parse_float(f[1]), "G": parse_float(f[2]),
                                     "nu": parse_float(f[3]), "rho": parse_float(f[4])}
                                    if n == "MAT1" else {"card": n})
        elif n.startswith(("MATS", "MATT")):
            continue
        elif n not in IGNORED:
            unsupported[n] += 1

    grids = {g: (grdset_cp if cp is None else cp, x, y, z) for g, (cp, x, y, z) in raw_grids.items()}
    m.nodes, unresolved, bad = resolve_coords(grids, coord_defs)
    if unresolved:
        m.warnings.append(f"coord_unresolved: {unresolved}")
    for cid in bad:
        m.warnings.append(f"coord_degenerate: {cid}")
    if grounded:
        m.warnings.append(f"grounded_cbush: {grounded}")
    if missing_gb:
        m.warnings.append(f"missing_gb: {missing_gb}")
    if duplicates:
        m.warnings.append(f"duplicate_id: {duplicates}")

    raw_beams = [o for k, o in elements.values() if k == "beam"]
    raw_tris = [o for k, o in elements.values() if k == "tri"]
    raw_quads = [o for k, o in elements.values() if k == "quad"]
    raw_rigids = [o for k, o in elements.values() if k == "rigid"]
    raw_masses = [o for k, o in elements.values() if k == "mass"]
    del elements

    missing = 0
    for raw, target in ((raw_beams, m.beams), (raw_tris, m.tris), (raw_quads, m.quads)):
        for e in raw:
            if all(nid in m.nodes for nid in e.nodes):
                target.append(e)
            else:
                missing += 1
    for r in raw_rigids:
        others = [g for g in r.others if g in m.nodes]
        if r.center in m.nodes and others:
            m.rigids.append(Rigid(r.eid, r.card, r.center, others))
        else:
            missing += 1
    m.masses = [x for x in raw_masses if x[1] in m.nodes]
    missing += len(raw_masses) - len(m.masses)
    m.spcs = {g: comp for g, comp in m.spcs.items() if g in m.nodes}
    if missing:
        m.warnings.append(f"missing_node: {missing}")
    m.unsupported = dict(unsupported.most_common(30))
    _check_ids(m)
    return m
