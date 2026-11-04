"""50 — 권상 Wire 모델에서 Wire 배치 요약을 뽑는다(Module Unit Studio 가 다른 Unit 의 권상 배치를 참조).

입력은 WorkBench `build_lifting_bdf`(Nastran_bridge) 가 만든 `<stem>_lifting.bdf` 를 읽은 Model 이다.
그 BDF 는 그룹(훅)마다 apex GRID 1개 + lug→apex `CROD` + apex `SPC1 123456` 을 넣는다
(강체 운동 막이용 `SPC1 12` 노드가 따로 있을 수 있다 — 병진 3성분이 다 없으면 apex 로 보지 않는다).
주석의 `PID=` 는 DeckReader 가 떼므로 쓰지 않는다 — 구조만 본다:

- apex = 병진 1·2·3 이 모두 구속되고, 그 노드를 쓰는 요소가 CROD 뿐인 노드.
- wire = 한쪽 끝이 apex 인 CROD. 같은 apex 를 쓰는 wire = 한 그룹(훅 하나).

순수 함수 — DB·파일을 만지지 않는다. 사람이 손으로 만든 권상 BDF 처럼 apex 를 못 찾으면 None.
"""
import math

from .model import Model

SCHEMA_VERSION = 1
MAX_PLAN_SEGMENTS = 3000   # 평면 그림용 부재 선분 상한(긴 것부터)


def _r(v: float, nd: int = 1) -> float:
    return round(float(v), nd)


def _apex_nodes(m: Model) -> set[int]:
    """병진 123 이 구속되고 CROD 에만 쓰이는 노드."""
    fixed = {g for g, comp in m.spcs.items() if all(c in comp for c in "123")}
    if not fixed:
        return set()
    users: dict[int, set[str]] = {}
    for e in (*m.beams, *m.tris, *m.quads):
        for n in e.nodes:
            if n in fixed:
                users.setdefault(n, set()).add(e.card)
    for r in m.rigids:
        for n in (r.center, *r.others):
            if n in fixed:
                users.setdefault(n, set()).add(r.card)
    return {n for n, cards in users.items() if cards == {"CROD"}}


def wire_summary(m: Model) -> dict | None:
    """Wire 배치 요약. apex 가 없으면 None."""
    apexes = _apex_nodes(m)
    if not apexes:
        return None
    groups: dict[int, list[tuple[int, int]]] = {}   # apex → [(wire eid, lug)]
    wire_eids: set[int] = set()
    for e in m.beams:
        if e.card != "CROD" or len(e.nodes) != 2:
            continue
        a, b = e.nodes
        if (a in apexes) == (b in apexes):
            continue
        apex, lug = (a, b) if a in apexes else (b, a)
        if apex not in m.nodes or lug not in m.nodes:
            continue
        groups.setdefault(apex, []).append((e.eid, lug))
        wire_eids.add(e.eid)
    if not groups:
        return None

    out_groups = []
    min_angle = None
    # 그룹 번호는 apex 노드 번호 순 — build_lifting_bdf 가 그룹 순서대로 apex 번호를 매긴다
    for gi, apex in enumerate(sorted(groups), start=1):
        ax, ay, az = m.nodes[apex]
        wires = []
        for eid, lug in sorted(groups[apex], key=lambda t: t[0]):
            lx, ly, lz = m.nodes[lug]
            length = math.dist((ax, ay, az), (lx, ly, lz))
            horiz = math.hypot(ax - lx, ay - ly)
            angle = math.degrees(math.atan2(az - lz, horiz)) if length > 0 else 0.0
            min_angle = angle if min_angle is None else min(min_angle, angle)
            wires.append({"wireElementId": eid, "lugNodeId": lug, "lugMm": [_r(lx), _r(ly), _r(lz)],
                          "lengthMm": _r(length), "slingAngleDeg": _r(angle, 2)})
        lugs = [w["lugMm"] for w in wires]
        span = max((math.dist(p[:2], q[:2]) for i, p in enumerate(lugs) for q in lugs[i + 1:]), default=0.0)
        out_groups.append({"id": gi, "apexNodeId": apex, "apexMm": [_r(ax), _r(ay), _r(az)],
                           "wires": wires, "lugSpanMm": _r(span)})

    # 구조 모델(wire·apex 제외) 경계상자와 평면 그림용 선분
    struct_nodes: set[int] = set()
    segments: list[tuple[float, list[float]]] = []
    for e in (*m.beams, *m.tris, *m.quads):
        if e.eid in wire_eids:
            continue
        pts = [m.nodes[n] for n in e.nodes if n in m.nodes]
        struct_nodes.update(n for n in e.nodes if n in m.nodes)
        for p, q in zip(pts, pts[1:] + pts[:1] if len(pts) > 2 else pts[1:]):
            d = math.hypot(q[0] - p[0], q[1] - p[1])
            if d > 0:
                segments.append((d, [round(p[0]), round(p[1]), round(q[0]), round(q[1])]))
    for r in m.rigids:
        struct_nodes.update(n for n in (r.center, *r.others) if n in m.nodes)
    struct_nodes -= apexes
    bbox = None
    if struct_nodes:
        xs, ys, zs = zip(*(m.nodes[n] for n in struct_nodes))
        bbox = {"min": [_r(min(xs)), _r(min(ys)), _r(min(zs))], "max": [_r(max(xs)), _r(max(ys)), _r(max(zs))]}
    segments.sort(key=lambda t: -t[0])
    plan = [s for _, s in segments[:MAX_PLAN_SEGMENTS]]

    return {
        "schemaVersion": SCHEMA_VERSION,
        "groupCount": len(out_groups),
        "wireCount": sum(len(g["wires"]) for g in out_groups),
        "minSlingAngleDeg": _r(min_angle, 2) if min_angle is not None else None,
        "bboxMm": bbox,
        "groups": out_groups,
        "planSegments": plan,
        "planSegmentsTruncated": len(segments) > MAX_PLAN_SEGMENTS,
    }
