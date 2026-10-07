"""연결 그룹 — 부재·쉘·RBE 로 이어진 절점을 union-find 로 묶는다(06 §2.4).

프런트 `frontend/src/lib/modelGroups.js` 와 같은 규칙: 보(CBAR·CBEAM·CROD·CONROD·CBUSH)·삼각형·사각형 요소가
절점을 잇고, RBE2·RBE3 는 기준 절점과 나머지 절점을 잇는다. 그룹은 요소 수 내림차순(0번 = 주 구조), 같으면
가장 작은 절점 번호 순. 요소가 하나도 없는 덩어리(RBE 끼리만 이어진 절점·고립 GRID)는 그룹이 아니다.
"""
from .model import Model


def _find(parent: dict[int, int], a: int) -> int:
    while parent[a] != a:
        parent[a] = parent[parent[a]]   # 경로 반감
        a = parent[a]
    return a


def connected_groups(model: Model) -> list[set[int]]:
    """그룹마다 절점 번호 집합(요소 수 내림차순)."""
    parent: dict[int, int] = {}

    def add(n: int) -> None:
        if n not in parent:
            parent[n] = n

    def union(a: int, b: int) -> None:
        add(a)
        add(b)
        ra, rb = _find(parent, a), _find(parent, b)
        if ra != rb:
            # 작은 번호를 뿌리로 — 프런트(순번이 작은 쪽)와 같은 정렬 기준이 된다
            if ra < rb:
                parent[rb] = ra
            else:
                parent[ra] = rb

    elements = (*model.beams, *model.tris, *model.quads)
    for e in elements:
        first = e.nodes[0]
        add(first)
        for n in e.nodes[1:]:
            union(first, n)
    for r in model.rigids:
        for n in r.others:
            union(r.center, n)

    elem_count: dict[int, int] = {}
    for e in elements:
        root = _find(parent, e.nodes[0])
        elem_count[root] = elem_count.get(root, 0) + 1
    members: dict[int, set[int]] = {root: set() for root in elem_count}
    for n in parent:
        root = _find(parent, n)
        if root in members:
            members[root].add(n)
    roots = sorted(elem_count, key=lambda r: (-elem_count[r], r))
    return [members[r] for r in roots]
