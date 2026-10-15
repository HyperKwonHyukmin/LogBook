"""BDF 내용 서명(12) — '파일명이 달라도 같은 모델인가'를 가리는 범주별 정규화 해시.

카드 목록(DeckReader.cards)과 실행·케이스 제어 줄(DeckReader.control)을 범주로 나눠 정규화한 뒤
범주마다 sha256 을 낸다. 파일명·주석·줄 형식(고정/자유/대형 필드, 연속 줄)·카드 순서·실수 표기
(1.-3 과 0.001, 1.0 과 1., 후행 0)는 해시에 영향을 주지 않는다.

범주(판정 규칙 — docs/plans/2026-10-07-logbook-12-model-signature.md):
    geometry  GRID·GRDSET·SPOINT·CORD*·강체(RBE2·RBE3·RBAR…)·요소 연결 — 요소는 **PID 칸을 뺀** 나머지
              (EID·절점·방향 벡터·오프셋 등). BAROR·BEAMOR 도 PID 칸만 뺀다.
    property  P* 카드 전부 + 요소별 (EID→PID) 배정(PID 가 비면 EID — Nastran 규칙).
              CONROD 의 MID·A·J·C·NSM, CELAS2·CDAMP2·CELAS4·CDAMP4 의 K·B·GE·S 처럼 요소 카드에 직접 적힌
              단면·강성 값도 property 로 본다.
    material  MAT*·MATS*·MATT*·TABLEM*·CREEP
    load      하중·경계조건·질량 카드(FORCE·MOMENT·GRAV·LOAD·PLOAD·TEMP·SPC·MPC·CONM·CMASS·ACCEL·RFORCE·
              DAREA·TLOAD·RLOAD·TABLED·SUPORT·…) + SOL + Case Control 의 해석 선택(SUBCASE·LOAD=·SPC=·…).
              TITLE·SUBTITLE·LABEL·ECHO 같은 출력 꾸밈은 뺀다.
    other     나머지 카드(PARAM 등)와 Case Control 의 출력 요청(DISP·STRESS…) — 동일 판정에는 쓰지 않는다.

같은 모델 = geometry·property·material·load 가 모두 같다. 같은 형상 = geometry 만 같다.

메모리: 범주마다 '카드 한 장 = 짧은 문자열 하나' 목록을 만들어 제자리 정렬하고 차례로 해시에 넣는다.
목록을 하나의 큰 문자열로 잇지 않는다(카드 수십만 장이어도 카드 목록의 수 분의 1 수준).
"""
import hashlib
import re
from dataclasses import dataclass

from .deck import Card
from .fields import parse_float

# 서명 규칙 버전 — 규칙(범주·정규화)을 바꾸면 올린다. 다른 버전끼리는 비교하지 않는다(재변환으로 다시 낸다).
VERSION = 1
# 실수 비교 유효숫자 — 1.0000001 과 1.0000002 는 같게, 1.000001 과 1.000002 는 다르게(테스트로 고정)
REAL_DIGITS = 7
_REAL_FORMAT = f".{REAL_DIGITS}g"
CATEGORIES = ("geometry", "property", "material", "load", "other")
# '같은 모델' 판정에 쓰는 범주(other 는 뺀다)
MODEL_CATEGORIES = ("geometry", "property", "material", "load")

_INT_TOKEN = re.compile(r"^[+-]?\d+$")
_SEP = "\x1f"

# 형상 카드(전 필드)
GEOMETRY_CARDS = frozenset({
    "GRID", "GRDSET", "SPOINT", "EPOINT", "SEQGP",
    "CORD1R", "CORD1C", "CORD1S", "CORD2R", "CORD2C", "CORD2S", "CORD3G",
    "RBE1", "RBE2", "RBE3", "RBAR", "RBAR1", "RROD", "RTRPLT", "RTRPLT1", "RBEAM", "RSPLINE", "RJOINT", "RSSCON",
    "PLOTEL",
})
# 요소 카드 — fields[1] 이 PID(일부는 MID: CTRIAX6 등. 둘 다 '단면 배정'으로 property 에 둔다)
ELEMENT_PID_CARDS = frozenset({
    "CBAR", "CBEAM", "CBEND", "CROD", "CTUBE", "CVISC", "CBUSH", "CBUSH1D", "CBUSH2D", "CFAST", "CWELD", "CSEAM",
    "CGAP", "CSHEAR", "CTRIA3", "CTRIA6", "CTRIAR", "CQUAD4", "CQUAD8", "CQUADR", "CQUAD", "CTRIAX", "CTRIAX6",
    "CQUADX", "CTETRA", "CPENTA", "CHEXA", "CPYRAM", "CELAS1", "CELAS3", "CDAMP1", "CDAMP3", "CCONEAX",
})
# 요소 카드 중 PID 대신 값이 직접 적힌 것 — (형상 칸, 속성 칸) 위치. fields[0] 은 EID.
#   CONROD EID G1 G2 MID A J C NSM / CELAS2 EID K G1 C1 G2 C2 GE S / CELAS4 EID K S1 S2
INLINE_ELEMENTS: dict[str, tuple[tuple[int, int | None], tuple[int, int | None]]] = {
    "CONROD": ((1, 3), (3, None)),
    "CELAS2": ((2, 6), (1, 2)), "CDAMP2": ((2, 6), (1, 2)),
    "CELAS4": ((2, 4), (1, 2)), "CDAMP4": ((2, 4), (1, 2)),
}
ORIENT_DEFAULT_CARDS = frozenset({"BAROR", "BEAMOR"})   # (빈칸) PID … — PID 칸만 property
LOAD_PREFIXES = (
    "FORCE", "MOMENT", "GRAV", "LOAD", "PLOAD", "TEMP", "SPC", "MPC", "CONM", "CMASS", "ACCEL", "RFORCE", "DAREA",
    "TLOAD", "RLOAD", "TABLED", "DLOAD", "DELAY", "DPHASE", "SUPORT", "DEFORM", "LSEQ", "NSM", "SLOAD", "QVOL",
    "QBDY", "QHBDY", "QVECT", "PRESAX", "RANDPS", "BOLTFOR", "BOLTLD",
)
MATERIAL_PREFIXES = ("MAT", "TABLEM", "CREEP")
NOT_PROPERTY = frozenset({"PARAM", "PLOTEL", "PSET", "PVAL"})

# Case Control — 해석 선택(load 범주). 4글자 이상 줄임말은 이 목록의 앞쪽 일치로 원형으로 바꾼다.
CASE_LOAD_KEYS = (
    "SUBCASE", "SUBCOM", "SUBSEQ", "SYMCOM", "SYMSEQ", "LOAD", "SPC", "MPC", "TEMPERATURE", "DLOAD", "DEFORM",
    "SUPORT1", "LOADSET", "METHOD", "FREQUENCY", "TSTEP", "NLPARM", "STATSUB", "ANALYSIS", "BC", "K2GG", "M2GG",
    "B2GG", "P2G", "NSM", "IC", "CMETHOD", "SDAMPING", "RESVEC",
)
# 출력 꾸밈 — 해시에서 뺀다
CASE_DECOR_KEYS = ("TITLE", "SUBTITLE", "LABEL", "ECHO", "ECHOON", "ECHOOFF", "LINE", "MAXLINES", "PAGE",
                   "SKIP", "SKIPON", "SKIPOFF", "PLOTID", "OUTPUT", "XTITLE", "YTITLE", "PTITLE")
_CASE_TOKEN = re.compile(r"^\s*([A-Za-z][A-Za-z0-9]*)")
_SPACES = re.compile(r"\s+")
# SOL 이름 → 번호(같은 해석을 이름·번호로 적어도 같게)
SOL_ALIASES = {"SESTATIC": "101", "STATICS": "101", "SEMODES": "103", "MODES": "103", "SEBUCKL": "105",
               "BUCKLING": "105", "NLSTATIC": "106", "SEDCEIG": "107", "SEDFREQ": "108", "SEDTRAN": "109",
               "SEMCEIG": "110", "SEMFREQ": "111", "SEMTRAN": "112", "NLTRAN": "129", "SESTATICS": "101"}


@dataclass(frozen=True, slots=True)
class Signature:
    geometry: str
    property: str
    material: str
    load: str
    other: str
    version: int = VERSION


def norm_field(token: str | None) -> str:
    """필드 하나를 비교용 문자열로. 정수 → int, 실수 → 유효숫자 REAL_DIGITS(정수와 구별되게 '.' 를 남김),
    빈칸 → 빈칸, 그 밖(ALL·THRU·형상 이름) → 대문자."""
    t = (token or "").strip()
    if not t:
        return ""
    if _INT_TOKEN.match(t):
        return str(int(t))
    v = parse_float(t)
    if v is None:
        return t.upper()
    s = format(v, _REAL_FORMAT)
    if s in ("-0", "0"):
        return "0."
    if "." not in s and "e" not in s:
        s += "."
    return s


def _join(head: str, fields) -> str:
    out = [head]
    out.extend(norm_field(x) for x in fields)
    while len(out) > 1 and not out[-1]:
        out.pop()   # 줄 형식에 따라 생기는 끝 빈칸(8칸 채우기)은 지운다
    return _SEP.join(out)


def _category(name: str) -> str:
    if name in GEOMETRY_CARDS:
        return "geometry"
    if name.startswith(LOAD_PREFIXES):
        return "load"
    if name.startswith(MATERIAL_PREFIXES):
        return "material"
    if name.startswith("P") and name not in NOT_PROPERTY:
        return "property"
    return "other"


def _slice(fields: list[str], span: tuple[int, int | None]) -> list[str]:
    a, b = span
    return fields[a:b]


def _eid(fields: list[str]) -> str:
    return norm_field(fields[0] if fields else "")


def split_cards(cards: list[Card]) -> dict[str, list[str]]:
    """카드 → 범주별 정규화 문자열 목록(정렬 전)."""
    buckets: dict[str, list[str]] = {c: [] for c in CATEGORIES}
    geo, prop = buckets["geometry"].append, buckets["property"].append
    for card in cards:
        n, f = card.name, card.fields
        if n in ELEMENT_PID_CARDS:
            eid = _eid(f)
            pid = norm_field(f[1] if len(f) > 1 else "") or eid   # PID 가 비면 EID
            geo(_join(n, [f[0] if f else ""] + f[2:]))
            prop(_SEP.join(("@PID", n, eid, pid)))
        elif n in INLINE_ELEMENTS:
            g_span, p_span = INLINE_ELEMENTS[n]
            eid = f[0] if f else ""
            geo(_join(n, [eid] + _slice(f, g_span)))
            prop(_join("@" + n, [eid] + _slice(f, p_span)))
        elif n in ORIENT_DEFAULT_CARDS:
            geo(_join(n, [f[0] if f else ""] + f[2:]))
            prop(_join("@" + n, f[1:2]))
        else:
            buckets[_category(n)].append(_join(n, f))
    return buckets


def _statements(lines: list[str]) -> list[str]:
    """',' 로 끝나는 줄은 다음 줄과 잇는다(SET 1 = 1,2,\\n 3)."""
    out: list[str] = []
    cont = False
    for line in lines:
        s = line.strip()
        if not s:
            continue
        if cont and out:
            out[-1] += s
        else:
            out.append(s)
        cont = s.endswith(",")
    return out


def _canonical(token: str, keys: tuple[str, ...]) -> str | None:
    if token in keys:
        return token
    if len(token) >= 4:
        for k in keys:
            if k.startswith(token):
                return k
    return None


def split_control(control: list[str], sol: str | None) -> tuple[list[str], list[str]]:
    """실행·케이스 제어 줄 → (load 문장 — 순서 있음, other 문장 — 정렬 전).

    CEND 가 있으면 그 뒤만 Case Control 로 본다(실행 제어는 SOL 만 쓴다). SUBCASE 마다 묶음을 나눠 묶음 안의
    문장 순서는 무시하고, 묶음 순서는 지킨다(SUBCASE 위의 기본 선택과 각 SUBCASE 를 구별해야 한다)."""
    stmts = _statements(control)
    upper = [s.upper() for s in stmts]
    cend = next((i for i, s in enumerate(upper) if _CASE_TOKEN.match(s) and _CASE_TOKEN.match(s).group(1) == "CEND"),
                None)
    case = upper[cend + 1:] if cend is not None else upper
    sol_key = (sol or "").upper()
    load: list[str] = [_SEP.join(("SOL", SOL_ALIASES.get(sol_key, sol_key)))]
    other: list[str] = []
    block: list[str] = []
    for s in case:
        m = _CASE_TOKEN.match(s)
        if not m:
            continue
        token = m.group(1)
        if token in ("CEND", "BEGIN", "INCLUDE", "SOL") or _canonical(token, CASE_DECOR_KEYS):
            continue
        rest = _SPACES.sub("", s[m.end():])
        key = _canonical(token, CASE_LOAD_KEYS)
        if key is None:
            other.append(f"{token} {rest}")
            continue
        stmt = f"{key} {rest}"
        if key == "SUBCASE":
            block.sort()
            load.extend(block)
            block = []
            load.append(stmt)
        else:
            block.append(stmt)
    block.sort()
    load.extend(block)
    return load, other


def _digest(items: list[str], *, ordered: bool = False) -> str:
    if not ordered:
        items.sort()
    h = hashlib.sha256()
    for s in items:
        h.update(s.encode("utf-8"))
        h.update(b"\n")
    return h.hexdigest()


def compute_signature(cards: list[Card], control: list[str] | None = None, sol: str | None = None) -> Signature:
    buckets = split_cards(cards)
    case_load, case_other = split_control(control or [], sol)
    load = _digest(buckets.pop("load"))
    h = hashlib.sha256(load.encode())
    h.update(_digest(case_load, ordered=True).encode())    # 카드 하중 + 케이스 선택을 한 해시로
    other_cards = buckets.pop("other")
    other_cards.extend("@CASE" + _SEP + s for s in case_other)
    return Signature(geometry=_digest(buckets.pop("geometry")), property=_digest(buckets.pop("property")),
                     material=_digest(buckets.pop("material")), load=h.hexdigest(),
                     other=_digest(other_cards))


def differing(a: dict, b: dict) -> list[str]:
    """두 서명(dict: 범주 → 해시)에서 다른 범주 — geometry 를 뺀 동일 판정 범주만, 정해진 순서로."""
    return [c for c in MODEL_CATEGORIES if c != "geometry" and a.get(c) != b.get(c)]
