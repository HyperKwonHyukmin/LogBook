"""Abaqus 입력(.inp) → Model(61). BDF 와 같은 Model 틀로 옮겨 lbm·썸네일·3D 뷰어를 그대로 쓴다.

표시에 필요한 것만 읽는다.
    *NODE                         절점(2D 모델은 z = 0)
    *ELEMENT, TYPE=               쉘·평면(S·CPS·CPE·CAX·M3D…) → 삼각형·사각형(모서리 절점만),
                                  보·트러스·파이프·커넥터·스프링(B·PIPE·ELBOW·T·CONN·SPRING…) → 선(양 끝 절점),
                                  MASS → 질량. 솔리드(C3D…)는 아직 그리지 않고 미지원으로 센다.
    *NSET·*ELSET(GENERATE)        묶음 — 단면·구속·연결이 이름으로 가리킨다
    *…SECTION, ELSET=, MATERIAL=  단면 하나 = PID 하나(Abaqus 에는 PID 가 없다). 단면이 없는 요소는 *ELEMENT 의 ELSET 마다 PID
    *MATERIAL + *ELASTIC·*DENSITY 재료(E·ν·ρ)
    *BOUNDARY                     구속 성분(1~6, ENCASTRE·PINNED·XSYMM 등 이름 포함)
    *MASS                         질량 값
    *MPC TIE·BEAM·LINK·PIN, *KINEMATIC COUPLING, *COUPLING+*KINEMATIC, *RIGID BODY → 뷰어의 RBE2(강체)
    *COUPLING+*DISTRIBUTING       → 뷰어의 RBE3
    *INCLUDE, INPUT=              BDF INCLUDE 와 같은 규칙(같은 자료 안 상대 경로)

*PART·*INSTANCE(Abaqus/CAE 형식)의 위치 이동·회전은 아직 풀지 않는다 — 경고(parts_flat)를 남기고 평면으로 읽는다.
"""
import hashlib
import math
import re
from collections import Counter
from dataclasses import dataclass
from typing import Callable

from ..bdf.deck import MAX_NAME_CHARS, DeckReader, DeckTooLarge, _iter_lines
from ..bdf.model import Element, Model, Rigid, _add_comp, _check_ids

MAX_DEPTH = 10
MAX_GENERATE = 5_000_000          # GENERATE 한 줄이 만드는 번호 수 상한(깨진 줄이 메모리를 다 먹지 않게)
# 줄 끝 쉼표가 다음 줄로 이어지는 키워드(요소 절점이 많을 때·묶음 목록)
_CONTINUED = {"ELEMENT", "NSET", "ELSET"}

# 요소 종류 → 분류. 모서리 절점만 쓴다(2차 요소의 중간 절점은 버린다).
_TRI = re.compile(r"^(S3|STRI|CPS3|CPE3|CPS6|CPE6|CAX3|CAX6|CGAX3|CGAX6|M3D3|M3D6|SFM3D3|SFM3D6|R3D3|DS3|CPEG3|CPEG6)")
_QUAD = re.compile(r"^(S4|S8|S9|CPS4|CPS8|CPE4|CPE8|CAX4|CAX8|CGAX4|CGAX8|M3D4|M3D8|M3D9|SFM3D4|SFM3D8|R3D4|DS4|DS8"
                   r"|CPEG4|CPEG8)")
_LINE = re.compile(r"^(B2|B3|PIPE|ELBOW|T2D|T3D|CONN|SPRINGA|SPRING2|DASHPOTA|DASHPOT2|FRAME|GAPUNI|JOINTC|RB2D2|RB3D2)")
# 3절점 2차 선 요소(끝·가운데·끝) — 양 끝은 1번째와 3번째. B31 등의 3번째 절점은 방향 절점이라 쓰지 않는다
_LINE3 = re.compile(r"^((B|PIPE|ELBOW)\d2|T\dD3)")
_GROUNDED = re.compile(r"^(SPRING1|DASHPOT1)$")
# 구속 이름 → 성분(Abaqus 매뉴얼 *BOUNDARY)
_BC_TYPES = {"ENCASTRE": "123456", "PINNED": "123", "XSYMM": "156", "YSYMM": "246", "ZSYMM": "345",
             "XASYMM": "234", "YASYMM": "135", "ZASYMM": "126"}
# 첫 해석 단계의 절차 → Model.sol
_PROCEDURES = ("STATIC", "FREQUENCY", "BUCKLE", "DYNAMIC", "HEAT TRANSFER", "VISCO", "STEADY STATE DYNAMICS",
               "MODAL DYNAMIC", "RESPONSE SPECTRUM", "RANDOM RESPONSE", "COUPLED TEMPERATURE-DISPLACEMENT",
               "SUBSTRUCTURE GENERATE", "COMPLEX FREQUENCY")
_RIGID_MPC = {"TIE", "BEAM", "LINK", "PIN"}


@dataclass(slots=True)
class Block:
    name: str                 # 대문자 키워드("*ELEMENT" → "ELEMENT")
    params: dict[str, str]    # 대문자 키 → 값(값 없는 표식은 "")
    rows: list[list[str]]


def parse_keyword(line: str) -> tuple[str, dict[str, str]]:
    parts = [p.strip() for p in line[1:].split(",")]
    name = re.sub(r"\s+", " ", parts[0]).upper()
    params: dict[str, str] = {}
    for p in parts[1:]:
        if not p:
            continue
        k, _, v = p.partition("=")
        params[re.sub(r"\s+", " ", k.strip()).upper()] = v.strip().strip('"')
    return name, params


def _f(s: str) -> float | None:
    try:
        v = float(s)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _i(s: str) -> int | None:
    s = s.strip()
    if not s or not (s.isdigit() or (s[0] in "+-" and s[1:].isdigit())):
        return None
    return int(s)


def _name(s: str) -> str:
    """묶음 이름 — 대문자, 따옴표·인스턴스 접두("Part-1-1.Set-1" → "SET-1")를 뗀다."""
    s = s.strip().strip('"').upper()
    return s.rsplit(".", 1)[-1] if "." in s and _f(s) is None else s


class InpReader:
    """opener(rel_posix) → bytes. 본 파일을 못 읽으면 opener 의 예외가 그대로 올라간다(DeckReader 와 같은 계약)."""

    def __init__(self, opener: Callable[[str], bytes], *, max_bytes: int | None = None):
        self.opener = opener
        self.max_bytes = max_bytes
        self.total_bytes = 0
        self.blocks: list[Block] = []
        self.warnings: list[str] = []
        self.includes: list[str] = []
        self.missing: list[str] = []
        self.sol: str | None = None
        self.control: list[str] = []     # BDF 와 같은 모양(권상 판정이 읽는다) — inp 는 비워 둔다
        self._seen: set[str] = set()
        # BDF 와 같은 파일이어도 열쇠가 겹치지 않게 앞에 표식을 넣는다
        self._hash = hashlib.sha256(b"abaqus-inp\0")

    @property
    def digest(self) -> str:
        return self._hash.hexdigest()

    def read(self, rel: str) -> list[Block]:
        self._read_file(rel, 0)
        return self.blocks

    def _read_file(self, rel: str, depth: int) -> None:
        key = rel.casefold()
        if key in self._seen:
            self.warnings.append(f"include_loop: {rel}")
            return
        self._seen.add(key)
        data = self.opener(rel)
        self.total_bytes += len(data)
        if self.max_bytes is not None and self.total_bytes > self.max_bytes:
            raise DeckTooLarge(rel)
        self._hash.update(rel.encode("utf-8") + b"\0")
        self._hash.update(data)
        cur: Block | None = None
        pending_kw: str | None = None     # 쉼표로 끝나 다음 줄로 이어지는 키워드 줄
        carry: list[str] | None = None    # 쉼표로 끝나 다음 줄로 이어지는 자료 줄
        for raw in _iter_lines(data):
            line = raw.strip()
            if not line or line.startswith("**"):
                continue
            if pending_kw is not None:
                line, pending_kw = pending_kw + line, None
                if line.endswith(","):
                    pending_kw = line
                    continue
                cur = self._keyword(rel, line, depth)
                continue
            if line.startswith("*"):
                if carry is not None and cur is not None:
                    cur.rows.append(carry)
                carry = None
                if line.endswith(","):
                    pending_kw = line
                    continue
                cur = self._keyword(rel, line, depth)
                continue
            if cur is None:
                continue
            tokens = [t.strip() for t in line.split(",")]
            if carry is not None:
                tokens = carry + tokens
                carry = None
            if cur.name in _CONTINUED and line.endswith(","):
                carry = tokens[:-1]       # 끝 쉼표가 만든 빈 칸은 버린다
                continue
            cur.rows.append(tokens)
        if carry is not None and cur is not None:
            cur.rows.append(carry)

    def _keyword(self, rel: str, line: str, depth: int) -> Block | None:
        name, params = parse_keyword(line)
        if name == "INCLUDE":
            self._include(rel, params.get("INPUT", ""), depth)
            return None
        block = Block(name, params, [])
        self.blocks.append(block)
        return block

    def _include(self, rel: str, name: str, depth: int) -> None:
        if not name:
            return
        if depth >= MAX_DEPTH:
            self.warnings.append(f"include_depth: {name[:MAX_NAME_CHARS]}")
            return
        try:
            target = DeckReader._resolve(rel, name)
            self._read_file(target, depth + 1)
            if target not in self.includes:
                self.includes.append(target)
        except (OSError, ValueError):
            short = name[:MAX_NAME_CHARS]
            self.missing.append(short)
            self.warnings.append(f"include_missing: {short}")


def _generate(row: list[str]) -> list[int]:
    a, b = _i(row[0]) if row else None, _i(row[1]) if len(row) > 1 else None
    step = (_i(row[2]) if len(row) > 2 and row[2] else None) or 1
    if a is None or b is None or step <= 0 or b < a or (b - a) // step > MAX_GENERATE:
        return []
    return list(range(a, b + 1, step))


def _section_prop(b: Block, name: str, mid: int | None) -> tuple[dict, tuple[float, float, float] | None]:
    """단면 블록 → (속성, 보 방향 벡터 n1). 형상 DIM 은 뷰어의 PBARL 규약(sectionProfile.js)으로 옮긴다.
    둥근 단면(PIPE·CIRC)은 방향과 무관해 정확하고, 그 밖의 형상은 축 방향이 달라 approx 로 둔다."""
    kind = b.name.replace(" SECTION", "")
    prop: dict = {"card": b.name, "abaqus": True, "name": name, "mid": mid}
    first = [v for v in (_f(x) for x in (b.rows[0] if b.rows else [])) if v is not None]
    n1 = None
    if first:
        prop["data"] = first[:7]      # 단면 첫 줄 원값(라벨용 — 형상 DIM 은 뷰어 규약으로 바꾼 값이라 다르다)
    if b.name in ("SHELL SECTION", "SHELL GENERAL SECTION", "MEMBRANE SECTION", "SOLID SECTION"):
        if first and first[0] > 0:
            prop["t"] = first[0]
    elif b.name == "BEAM SECTION":
        shape = (b.params.get("SECTION") or "").upper()
        prop["section"] = shape
        d = first
        if shape in ("PIPE", "ELBOW", "THICK PIPE") and len(d) >= 2:
            prop |= {"type": "TUBE", "dims": [d[0], max(d[0] - d[1], 0.0)]}
        elif shape == "CIRC" and d:
            prop |= {"type": "ROD", "dims": [d[0]]}
        elif shape == "RECT" and len(d) >= 2:
            prop |= {"type": "BAR", "dims": [d[1], d[0]], "approx": True}
        elif shape == "BOX" and len(d) >= 4:
            prop |= {"type": "BOX", "dims": [d[1], d[0], d[2], d[3]], "approx": True}
        elif shape == "I" and len(d) >= 7:
            prop |= {"type": "I", "dims": [d[1], d[2], d[3], d[6], d[4], d[5]], "approx": True}
        elif shape == "L" and len(d) >= 4:
            prop |= {"type": "L", "dims": d[:4], "approx": True}
        if len(b.rows) > 1:
            v = [x for x in (_f(t) for t in b.rows[1][:3]) if x is not None]
            if len(v) == 3 and any(v):
                n1 = (v[0], v[1], v[2])
    elif b.name == "BEAM GENERAL SECTION":
        prop["section"] = (b.params.get("SECTION") or "GENERAL").upper()
        if first and first[0] > 0:
            prop |= {"A": first[0], "type": "BAR", "dims": [math.sqrt(first[0])] * 2, "approx": True}
    elif b.name == "TRUSS SECTION":
        if first and first[0] > 0:
            prop |= {"A": first[0], "type": "ROD", "dims": [math.sqrt(first[0] / math.pi)], "approx": True}
    prop["kind"] = kind
    return prop, n1


def _unit(v):
    n = math.sqrt(sum(x * x for x in v))
    return tuple(x / n for x in v) if n > 0 else None


def build_inp_model(blocks: list[Block], *, warnings=(), includes=(), missing=()) -> Model:
    m = Model(warnings=list(warnings), includes=list(includes), missing_includes=list(missing))
    nodes: dict[int, tuple[float, float, float]] = {}
    # eid → (분류, 종류, 절점, *ELEMENT 의 ELSET)
    elements: dict[int, tuple[str, str, tuple[int, ...], str]] = {}
    nsets: dict[str, list[int]] = {}
    elsets: dict[str, list[int]] = {}
    surfaces: dict[str, list[tuple[str, str]]] = {}    # 이름 → [(종류 NODE|ELEMENT, 묶음/번호)]
    materials: dict[str, dict] = {}
    sections: list[Block] = []
    later: list[tuple[Block, Block | None]] = []          # 묶음이 다 모인 뒤 푸는 블록(다음 블록과 함께)
    unsupported: Counter = Counter()
    duplicates = grounded = 0
    material: dict | None = None
    saw_parts = False

    def node_list(tokens, sets) -> list[int]:
        out: list[int] = []
        for t in tokens:
            if not t:
                continue
            n = _i(t)
            if n is not None:
                out.append(n)
            else:
                out.extend(sets.get(_name(t), ()))
        return out

    def add_set(sets: dict, b: Block, key: str) -> None:
        set_name = _name(b.params.get(key, ""))
        if not set_name:
            return
        target = sets.setdefault(set_name, [])
        if key == "NSET" and "ELSET" in b.params:     # *NSET, NSET=a, ELSET=b — b 요소들의 절점
            for e in elsets.get(_name(b.params["ELSET"]), ()):
                if e in elements:
                    target.extend(elements[e][2])
            return
        gen = "GENERATE" in b.params
        for row in b.rows:
            target.extend(_generate(row) if gen else node_list(row, sets))

    for k, b in enumerate(blocks):
        nxt = blocks[k + 1] if k + 1 < len(blocks) else None
        n = b.name
        if n == "NODE":
            if b.params.get("SYSTEM", "R").upper() not in ("R", ""):
                m.warnings.append(f"node_system: {b.params['SYSTEM']}")
            ids = []
            for row in b.rows:
                nid = _i(row[0]) if row else None
                if nid is None:
                    continue
                xyz = [(_f(x) or 0.0) for x in row[1:4]] + [0.0] * (3 - len(row[1:4]))
                if nid in nodes:
                    duplicates += 1
                nodes[nid] = (xyz[0], xyz[1], xyz[2])
                ids.append(nid)
            if b.params.get("NSET"):
                nsets.setdefault(_name(b.params["NSET"]), []).extend(ids)
        elif n == "ELEMENT":
            etype = (b.params.get("TYPE") or "").upper()
            eset = _name(b.params.get("ELSET", ""))
            ids = []
            if _TRI.match(etype):
                cat, k_nodes = "tri", 3
            elif _QUAD.match(etype):
                cat, k_nodes = "quad", 4
            elif _LINE.match(etype):
                cat, k_nodes = "beam", 2
            elif etype == "MASS":
                cat, k_nodes = "mass", 1
            else:
                cat, k_nodes = "", 0
            for row in b.rows:
                eid = _i(row[0]) if row else None
                if eid is None:
                    continue
                ids.append(eid)
                conn = [x for x in (_i(t) for t in row[1:] if t) if x is not None]
                if not cat:
                    if _GROUNDED.match(etype):
                        grounded += 1
                    else:
                        unsupported[etype or "ELEMENT"] += 1
                    continue
                if cat == "beam":
                    if len(conn) < 2:
                        grounded += 1           # 한 절점 커넥터(땅에 붙은 것) — 정상 모델링
                        continue
                    conn = [conn[0], conn[2]] if _LINE3.match(etype) and len(conn) >= 3 else conn[:2]
                elif len(conn) < k_nodes:
                    unsupported[etype] += 1
                    continue
                if eid in elements:
                    duplicates += 1
                elements[eid] = (cat, etype, tuple(conn[:k_nodes]), eset)
            if eset:
                elsets.setdefault(eset, []).extend(ids)
        elif n == "NSET":
            add_set(nsets, b, "NSET")
        elif n == "ELSET":
            add_set(elsets, b, "ELSET")
        elif n == "SURFACE":
            sname = _name(b.params.get("NAME", ""))
            stype = (b.params.get("TYPE") or "ELEMENT").upper()
            surfaces.setdefault(sname, []).extend((stype, row[0]) for row in b.rows if row and row[0])
        elif n == "MATERIAL":
            material = materials.setdefault(_name(b.params.get("NAME", "")), {})
        elif n in ("ELASTIC", "DENSITY") and material is not None and b.rows:
            vals = [_f(x) for x in b.rows[0]]
            if n == "ELASTIC" and (b.params.get("TYPE") or "ISOTROPIC").upper() == "ISOTROPIC":
                material.setdefault("E", vals[0] if vals else None)
                material.setdefault("nu", vals[1] if len(vals) > 1 else None)
            elif n == "DENSITY":
                material.setdefault("rho", vals[0] if vals else None)
        elif n.endswith(" SECTION") and "ELSET" in b.params:
            sections.append(b)
        elif n in ("BOUNDARY", "MPC", "KINEMATIC COUPLING", "COUPLING", "RIGID BODY", "MASS"):
            if not (n == "BOUNDARY" and (b.params.get("TYPE") or "DISPLACEMENT").upper() != "DISPLACEMENT"):
                later.append((b, nxt))
        elif n == "STEP":
            if m.sol is None and nxt is not None and nxt.name in _PROCEDURES:
                m.sol = nxt.name
        elif n in ("PART", "INSTANCE"):
            saw_parts = True
        # 재료 밑 키워드(*ELASTIC 등)는 다음 *MATERIAL·구조 키워드가 나올 때까지 앞 재료에 붙는다
        if n.endswith("SECTION") or n in ("STEP", "NODE", "ELEMENT", "PART", "ASSEMBLY"):
            material = None

    # 재료 — 이름 순번이 MID
    mids = {name: i + 1 for i, name in enumerate(materials)}
    for name, mat in materials.items():
        m.materials[mids[name]] = {"card": "MATERIAL", "abaqus": True, "name": name,
                                   "E": mat.get("E"), "nu": mat.get("nu"), "rho": mat.get("rho")}

    # 단면 → PID(나온 순서). 요소는 처음 맞는 단면을 갖는다
    pid_of: dict[int, int] = {}
    v_of: dict[int, tuple] = {}
    for i, b in enumerate(sections):
        pid = i + 1
        sname = _name(b.params["ELSET"])
        prop, n1 = _section_prop(b, sname, mids.get(_name(b.params.get("MATERIAL", ""))))
        m.properties[pid] = prop
        u = _unit(n1) if n1 else None
        for e in elsets.get(sname, ()):
            if e not in pid_of:
                pid_of[e] = pid
                if u:
                    v_of[e] = u
    # 단면이 없는 요소 — *ELEMENT 의 ELSET 마다 PID 하나(HyperMesh 의 컴포넌트)
    by_set: dict[str, int] = {}
    for eid, (cat, etype, conn, eset) in elements.items():
        if eid in pid_of or cat == "mass":
            continue
        if eset not in by_set:
            by_set[eset] = len(m.properties) + 1
            m.properties[by_set[eset]] = {"card": "ELSET", "abaqus": True, "name": eset or "-", "kind": "ELSET"}
        pid_of[eid] = by_set[eset]

    def members(token: str) -> list[int]:
        n = _i(token)
        return [n] if n is not None else list(nsets.get(_name(token), ()))

    def elset_nodes(name: str) -> list[int]:
        out: list[int] = []
        for e in elsets.get(_name(name), ()):
            if e in elements:
                out.extend(elements[e][2])
        return out

    def surface_nodes(name: str) -> list[int]:
        out: list[int] = []
        for stype, ref in surfaces.get(_name(name), ()):
            if stype == "NODE":
                out.extend(members(ref))
                continue
            eid = _i(ref)          # 요소 면 — 면 구분(S1…) 없이 그 요소들의 절점 전체로 근사
            out.extend(elements[eid][2] if eid is not None and eid in elements else elset_nodes(ref))
        return out

    rigid_raw: list[tuple[str, int, list[int]]] = []
    masses_raw: list[tuple[int, int, float]] = []
    mass_value: dict[int, float] = {}
    for b, nxt in later:
        n = b.name
        if n == "BOUNDARY":
            for row in b.rows:
                if len(row) < 2:
                    continue
                spec = row[1].strip().upper()
                if spec in _BC_TYPES:
                    comp = _BC_TYPES[spec]
                else:
                    a = _i(spec)
                    last = _i(row[2]) if len(row) > 2 and row[2].strip() else a
                    if a is None or last is None:
                        continue
                    comp = "".join(str(d) for d in range(max(a, 1), min(last, 6) + 1))
                if comp:
                    for g in members(row[0]):
                        _add_comp(m.spcs, g, comp)
        elif n == "MPC":
            for row in b.rows:
                kind = row[0].strip().upper() if row else ""
                toks = [t for t in row[1:] if t.strip()]
                if kind not in _RIGID_MPC or len(toks) < 2:
                    if kind:
                        unsupported[f"MPC {kind}"] += 1
                    continue
                dep, ind = members(toks[0]), [g for t in toks[1:] for g in members(t)]
                if len(ind) == 1:
                    rigid_raw.append(("RBE2", ind[0], dep))
                elif len(ind) == len(dep):
                    rigid_raw.extend(("RBE2", c, [o]) for o, c in zip(dep, ind))
        elif n == "KINEMATIC COUPLING":
            ref = members(b.params.get("REF NODE", ""))
            if ref:
                rigid_raw.append(("RBE2", ref[0], [g for row in b.rows if row for g in members(row[0])]))
        elif n == "COUPLING":
            ref = members(b.params.get("REF NODE", ""))
            card = "RBE3" if nxt is not None and nxt.name == "DISTRIBUTING" else "RBE2"
            if ref:
                rigid_raw.append((card, ref[0], surface_nodes(b.params.get("SURFACE", ""))))
        elif n == "RIGID BODY":
            ref = members(b.params.get("REF NODE", ""))
            others = elset_nodes(b.params.get("ELSET", "")) if b.params.get("ELSET") else []
            for key in ("PIN NSET", "TIE NSET"):
                if b.params.get(key):
                    others += members(b.params[key])
            if ref and others:
                rigid_raw.append(("RBE2", ref[0], others))
        elif n == "MASS" and b.rows:
            val = _f(b.rows[0][0]) or 0.0
            for e in elsets.get(_name(b.params.get("ELSET", "")), ()):
                mass_value[e] = val

    missing_nodes = 0
    for eid, (cat, etype, conn, _) in elements.items():
        if not all(g in nodes for g in conn):
            missing_nodes += 1
            continue
        if cat == "mass":
            masses_raw.append((eid, conn[0], mass_value.get(eid, 0.0)))
            continue
        e = Element(eid, etype, pid_of.get(eid, 0), conn, v=v_of.get(eid) if cat == "beam" else None)
        (m.beams if cat == "beam" else m.tris if cat == "tri" else m.quads).append(e)
    m.nodes = nodes
    next_eid = max(elements, default=0) + 1
    for card, center, others in rigid_raw:
        others = [g for g in dict.fromkeys(others) if g in nodes and g != center]
        if center in nodes and others:
            m.rigids.append(Rigid(next_eid, card, center, others))
            next_eid += 1
        else:
            missing_nodes += 1
    m.masses = masses_raw
    m.spcs = {g: c for g, c in m.spcs.items() if g in nodes}

    solids = sum(c for t, c in unsupported.items() if t.startswith(("C3D", "SC")))
    if solids:
        m.warnings.append(f"solid_elements: {solids}")
    if saw_parts:
        m.warnings.append("parts_flat")
    if grounded:
        m.warnings.append(f"grounded_element: {grounded}")
    if missing_nodes:
        m.warnings.append(f"missing_node: {missing_nodes}")
    if duplicates:
        m.warnings.append(f"duplicate_id: {duplicates}")
    m.unsupported = dict(unsupported.most_common(30))
    _check_ids(m)
    return m
