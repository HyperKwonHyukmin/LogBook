"""해석 검증 입력 BDF 만들기(06 §2) — 순수 함수.

원본은 읽기만 한다. Bulk 줄 원문을 `DeckReader` 규칙(INCLUDE 경로 해석·깊이·순환·따옴표 여러 줄 이름)
그대로 모아 INCLUDE 를 그 자리에 풀고, Executive·Case Control 은 버리고 새로 쓴다:

    SOL 101 / CEND / ECHO = NONE / SPC = sid / LOAD = sid / BEGIN BULK
    <원본 Bulk 원문> / GRAV, sid, , 1.0, 0., 0., -1. / SPC1, sid, 123456, <고정 노드…> / ENDDATA

원본의 SPC·LOAD·GRAV·FORCE·PARAM 카드는 지우지도 고치지도 않는다 — Case Control 이 고르지 않으니 쓰이지
않을 뿐이다(PARAM 은 원본 모델의 성질이라 그대로 효력이 있다). 우리 sid 는 원본 세트 번호와 겹치지 않게 고른다.
고정 노드는 그룹(bdf/groups.py)마다 Z 최솟값에서 FIX_TOL 안의 노드다.
"""
from typing import Callable, Iterable

from ..bdf.deck import Card, DeckReader
from ..bdf.fields import is_real, parse_int
from ..bdf.groups import connected_groups
from ..bdf.model import Model

SID_START = 990001
FIX_TOL = 1.0              # 모델 단위(보통 mm) — 최하단에서 이 안의 노드를 모두 고정
NODES_PER_SPC1 = 6         # 자유 형식 한 줄(연속 줄 없이)에 넣는 고정 노드 수
# 세트 번호(SID)를 갖는 경계조건·하중 카드 — 우리 sid 가 이 번호들과 겹치면 안 된다
SID_CARDS = {"SPC", "SPC1", "SPCADD", "SPCD", "SPCAX", "LOAD", "GRAV", "FORCE", "FORCE1", "FORCE2", "MOMENT",
             "MOMENT1", "MOMENT2", "ACCEL", "ACCEL1", "RFORCE", "SLOAD", "TEMP", "TEMPD", "LSEQ", "DLOAD",
             "MPC", "MPCADD", "DAREA", "DEFORM", "SPCR"}
COMBINE_CARDS = {"SPCADD", "LOAD", "MPCADD", "DLOAD"}   # 다른 세트를 묶는 카드 — 묶인 번호도 피한다


class IncludeMissing(Exception):
    """찾지 못한 INCLUDE 가 있다 — 해석하지 않고 '확인 못 함 · INCLUDE 누락' 으로 끝낸다."""

    def __init__(self, names: Iterable[str]):
        self.names = list(names)
        super().__init__(", ".join(self.names))


def read_bulk(opener: Callable[[str], bytes], rel: str, sink: Callable[[str], None], *,
              max_bytes: int | None = None) -> DeckReader:
    """원본을 읽어 카드(DeckReader.cards)를 만들면서, INCLUDE 를 푼 Bulk 줄 원문을 sink 로 넘긴다.
    BEGIN BULK 가 없는 Bulk 만 있는 파일도 같다(DeckReader 의 판정). 빠진 INCLUDE 가 있으면 IncludeMissing."""
    reader = DeckReader(opener, max_bytes=max_bytes, raw_sink=sink)
    reader.read(rel)
    if reader.missing:
        raise IncludeMissing(reader.missing)
    return reader


def collect_bulk(opener: Callable[[str], bytes], rel: str, *,
                 max_bytes: int | None = None) -> tuple[DeckReader, list[str]]:
    """read_bulk 의 줄을 목록으로 모은다(테스트·작은 모델용)."""
    lines: list[str] = []
    return read_bulk(opener, rel, lines.append, max_bytes=max_bytes), lines


def used_sids(cards: Iterable[Card]) -> set[int]:
    """원본의 경계조건·하중 세트 번호(PLOAD* 포함). 묶음 카드(LOAD·SPCADD 등)는 묶인 번호도 넣는다."""
    used: set[int] = set()
    for c in cards:
        if c.name not in SID_CARDS and not c.name.startswith("PLOAD"):
            continue
        sid = parse_int(c.fields[0] if c.fields else None)
        if sid is not None:
            used.add(sid)
        if c.name in COMBINE_CARDS:
            used.update(v for v in (parse_int(t) for t in c.fields[1:] if t and not is_real(t)) if v is not None)
    return used


def pick_sid(used: set[int], start: int = SID_START) -> int:
    sid = start
    while sid in used:
        sid += 1
    return sid


def fixed_nodes(model: Model, tol: float = FIX_TOL) -> tuple[list[int], int]:
    """(고정할 노드 번호 오름차순, 그룹 수). 그룹마다 요소(보·쉘)가 쓰는 노드 중 Z 가 가장 낮은 곳에서
    tol 안의 노드를 고른다. RBE 종속 노드(RBE2 의 종속 절점·RBE3 의 기준 절점)는 고정하지 않는다 —
    종속 자유도에 SPC 를 걸면 모델 결함이 아닌데도 Nastran 이 FATAL 을 낸다. 요소 없는 GRID 는 AUTOSPC 몫이다."""
    dependent: set[int] = set()
    for r in model.rigids:
        if r.card == "RBE3":
            dependent.add(r.center)
        else:
            dependent.update(r.others)
    element_nodes: set[int] = set()
    for e in (*model.beams, *model.tris, *model.quads):
        element_nodes.update(e.nodes)
    groups = connected_groups(model)
    out: list[int] = []
    for nodes in groups:
        cand = [n for n in nodes if n in element_nodes and n not in dependent and n in model.nodes]
        if not cand:
            continue
        zmin = min(model.nodes[n][2] for n in cand)
        out.extend(n for n in cand if model.nodes[n][2] <= zmin + tol)
    return sorted(out), len(groups)


def header(sid: int, *, with_spc: bool = True) -> str:
    lines = ["SOL 101", "CEND", "ECHO = NONE"]
    if with_spc:
        lines.append(f"SPC = {sid}")
    lines += [f"LOAD = {sid}", "BEGIN BULK"]
    return "\n".join(lines) + "\n"


def trailer(sid: int, nodes: list[int]) -> str:
    lines = [f"GRAV,{sid},,1.0,0.,0.,-1."]
    for k in range(0, len(nodes), NODES_PER_SPC1):
        lines.append(f"SPC1,{sid},123456," + ",".join(str(n) for n in nodes[k:k + NODES_PER_SPC1]))
    lines.append("ENDDATA")
    return "\n".join(lines) + "\n"


def build_deck(bulk_lines: Iterable[str], sid: int, nodes: list[int]) -> str:
    """해석용 BDF 전체 본문(테스트·작은 모델용 — 작업은 write_deck 으로 파일에 바로 쓴다)."""
    body = "".join(line + "\n" for line in bulk_lines)
    return header(sid, with_spc=bool(nodes)) + body + trailer(sid, nodes)


def write_deck(out, body_path: str, sid: int, nodes: list[int], chunk: int = 1024 * 1024) -> None:
    """out(텍스트 파일, utf-8) 에 머리 + body_path(read_bulk 가 쓴 Bulk 원문) + 꼬리를 잇는다.
    큰 모델에서 Bulk 원문을 메모리에 다시 들지 않는다."""
    out.write(header(sid, with_spc=bool(nodes)))
    with open(body_path, "r", encoding="utf-8", newline="") as fh:
        while data := fh.read(chunk):
            out.write(data)
    out.write(trailer(sid, nodes))
