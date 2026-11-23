"""솔리드 요소 → 바깥 면(2026-11-24, CTETRA 만 든 BDF 가 '요소 없음'으로 미리보기가 안 되던 것).

뷰어와 lbm 은 보, 삼각형, 사각형만 안다. 솔리드는 다른 솔리드와 나누지 않는 면(모델 겉면)만 골라
삼각형, 사각형 쉘처럼 넘긴다. 속 면은 겉에서 보이지 않고 수가 요소의 몇 배라 그리지 않는다.
겉면은 원래 솔리드의 EID, PID, 카드 이름을 그대로 달고 나가므로 같은 EID 가 여러 면에 붙는다
(면을 누르면 그 솔리드의 정보가 보인다). 2차 요소(CTETRA 10절점 등)는 꼭짓점만 쓴다.
"""
import numpy as np

# 카드 → 꼭짓점 수(MSC QRG 의 G1 부터 꼭짓점이 먼저 온다)
SOLID_CARDS = {"CTETRA": 4, "CPYRAM": 5, "CPENTA": 6, "CHEXA": 8}

# 꼭짓점 수 → (삼각형 면, 사각형 면). 순번은 꼭짓점 순번(0부터).
FACES: dict[int, tuple[tuple, tuple]] = {
    4: (((0, 1, 2), (0, 1, 3), (1, 2, 3), (0, 2, 3)), ()),
    5: (((0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)), ((0, 1, 2, 3),)),
    6: (((0, 1, 2), (3, 4, 5)), ((0, 1, 4, 3), (1, 2, 5, 4), (2, 0, 3, 5))),
    8: ((), ((0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7))),
}


def _outer(faces: list[np.ndarray], owners: list[np.ndarray], width: int):
    """같은 절점 묶음의 면이 한 번만 나오면 겉면이다. → (면 절점 (n, width), 주인 순번 (n,))."""
    if not faces:
        return np.empty((0, width), np.int64), np.empty(0, np.int64)
    f = np.concatenate(faces)
    o = np.concatenate(owners)
    key = np.sort(f, axis=1)
    _, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    keep = cnt[inv.reshape(-1)] == 1
    return f[keep], o[keep]


def outer_faces(solids: list[tuple[int, int, str, tuple[int, ...]]],
                skip: set[tuple[int, ...]] | None = None) -> tuple[list[tuple], list[tuple]]:
    """solids = [(eid, pid, card, 꼭짓점 절점 번호)] → (삼각형 겉면, 사각형 겉면), 각 항목 (eid, pid, card, 절점).

    skip: 이미 쉘 요소가 있는 면(절점 번호 정렬 튜플) — 같은 자리에 두 번 그리면 면이 깜박인다."""
    by_k: dict[int, list[int]] = {}
    for i, s in enumerate(solids):
        by_k.setdefault(len(s[3]), []).append(i)
    tri_f, tri_o, quad_f, quad_o = [], [], [], []
    for k, rows in by_k.items():
        if k not in FACES:
            continue
        idx = np.asarray(rows, np.int64)
        nodes = np.asarray([solids[i][3] for i in rows], np.int64)
        tris, quads = FACES[k]
        for face in tris:
            tri_f.append(nodes[:, face])
            tri_o.append(idx)
        for face in quads:
            quad_f.append(nodes[:, face])
            quad_o.append(idx)
    out = []
    for faces, owners, width in ((tri_f, tri_o, 3), (quad_f, quad_o, 4)):
        f, o = _outer(faces, owners, width)
        rows = []
        for nodes, i in zip(f.tolist(), o.tolist()):
            t = tuple(nodes)
            if skip and tuple(sorted(t)) in skip:
                continue
            eid, pid, card, _ = solids[i]
            rows.append((eid, pid, card, t))
        out.append(rows)
    return out[0], out[1]
