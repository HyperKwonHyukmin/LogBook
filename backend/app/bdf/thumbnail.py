"""썸네일(설계 §7.5) — numpy + Pillow 로 등각 투영 PNG. 브라우저·GPU 가 필요 없다.

(1,1,1) 방향에서 바라본다(오른쪽 = (-1,1,0), 위 = (-1,-1,2)). 쉘은 먼 것부터 칠하고(화가 알고리즘)
1D 요소는 위에 선으로 그린다. 요소가 아주 많으면 고정 시드로 고르게 무작위 표본을 뽑아 몇 초 안에 끝낸다.
화면 틀은 요소가 쓰는 절점으로만 정한다(Model.framing_points) — 동떨어진 GRID 하나가 모델을 점으로 만들지 않게."""
import io
import math

import numpy as np
from PIL import Image, ImageDraw

from .model import Model

WIDTH, HEIGHT, MARGIN = 640, 400, 16
# 뷰어와 같은 바탕(--color-viewer)과 PID 팔레트(frontend/src/lib/pidPalette.js) — 한쪽을 바꾸면 같이 바꾼다
BACKGROUND = (26, 26, 46)
PALETTE = [(0x4D, 0x8F, 0xEF), (0xED, 0xAE, 0x3B), (0xE8, 0x58, 0x7D), (0x3D, 0xC5, 0x84), (0x9A, 0x79, 0xF2),
           (0xEE, 0x7D, 0x3E), (0x2D, 0xB5, 0xA3), (0xD8, 0x65, 0xC2), (0x9F, 0xCB, 0x55), (0x6E, 0x7F, 0xD8),
           (0xE3, 0xCF, 0x72), (0xB5, 0xBF, 0xCC)]
MAX_SHELLS, MAX_BEAMS, OUTLINE_LIMIT = 150_000, 200_000, 20_000
_EYE = np.array([1.0, 1.0, 1.0]) / math.sqrt(3)
_RIGHT = np.array([-1.0, 1.0, 0.0]) / math.sqrt(2)
_UP = np.array([-1.0, -1.0, 2.0]) / math.sqrt(6)


def color_for(pid: int) -> tuple[int, int, int]:
    return PALETTE[pid % len(PALETTE)]


def _thin(items: list, limit: int) -> list:
    """limit 개를 넘으면 고정 시드(0)로 고르게 무작위 표본을 뽑는다(순서 유지). 간격 솎기는 격자 모델에서
    줄무늬처럼 한쪽 방향 요소만 남기는 일이 있어 무작위로 바꿨다."""
    if len(items) <= limit:
        return items
    pick = np.sort(np.random.default_rng(0).choice(len(items), size=limit, replace=False))
    return [items[i] for i in pick.tolist()]


def _frame_points(m: Model) -> np.ndarray:
    return np.asarray(m.framing_points(), dtype=np.float64).reshape(-1, 3)


def render_thumbnail(m: Model) -> bytes:
    if not m.nodes:
        raise ValueError("절점이 없어 썸네일을 만들 수 없습니다")
    ids = list(m.nodes)
    index = {n: i for i, n in enumerate(ids)}
    p = np.array([m.nodes[n] for n in ids], dtype=np.float64)
    sx, sy, depth = p @ _RIGHT, p @ _UP, p @ _EYE
    frame = _frame_points(m)
    fx, fy = frame @ _RIGHT, frame @ _UP
    x0, y0 = float(fx.min()), float(fy.min())
    w = max(float(fx.max()) - x0, 1e-9)
    h = max(float(fy.max()) - y0, 1e-9)
    s = min((WIDTH - 2 * MARGIN) / w, (HEIGHT - 2 * MARGIN) / h)
    ox = (WIDTH - w * s) / 2
    oy = (HEIGHT - h * s) / 2
    X = ((sx - x0) * s + ox).tolist()
    Y = (HEIGHT - ((sy - y0) * s + oy)).tolist()

    img = Image.new("RGB", (WIDTH, HEIGHT), BACKGROUND)
    draw = ImageDraw.Draw(img)

    shells = _thin([*m.tris, *m.quads], MAX_SHELLS)
    if shells:
        idx = [[index[n] for n in e.nodes] for e in shells]
        first3 = np.array([v[:3] for v in idx], dtype=np.int64)
        sizes = np.array([len(v) for v in idx], dtype=np.float64)
        fourth = np.array([v[3] if len(v) > 3 else 0 for v in idx], dtype=np.int64)
        # 깊이 = 꼭짓점 평균(삼각형 3, 사각형 4) — 먼 것부터 칠한다(같은 깊이는 원래 순서)
        mean_depth = (depth[first3].sum(axis=1) + np.where(sizes > 3, depth[fourth], 0.0)) / sizes
        order = np.argsort(mean_depth, kind="stable").tolist()
        # 면 법선과 시선의 각도로 밝기를 정한다(앞 세 꼭짓점)
        a, b, c = p[first3[:, 0]], p[first3[:, 1]], p[first3[:, 2]]
        normal = np.cross(b - a, c - a)
        length = np.linalg.norm(normal, axis=1)
        length[length == 0] = 1.0
        shade = 0.55 + 0.45 * np.abs(normal @ _EYE) / length
        base = np.array([color_for(e.pid) for e in shells], dtype=np.float64)
        # 어두운 바탕이라 비스듬한 면일수록 바탕 쪽으로 어둡게 한다
        fill = (base * shade[:, None] * 0.9).astype(np.int64)
        fills = [tuple(row) for row in fill.tolist()]
        outline = len(shells) <= OUTLINE_LIMIT
        edges = [tuple(row) for row in (fill * 0.4).astype(np.int64).tolist()] if outline else None
        for k in order:
            draw.polygon([(X[i], Y[i]) for i in idx[k]], fill=fills[k], outline=edges[k] if edges else None)

    beams = _thin(m.beams, MAX_BEAMS)
    width = 2 if len(beams) < 20_000 else 1
    for e in beams:
        a, b = index[e.nodes[0]], index[e.nodes[1]]
        draw.line([(X[a], Y[a]), (X[b], Y[b])], fill=color_for(e.pid), width=width)

    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()
