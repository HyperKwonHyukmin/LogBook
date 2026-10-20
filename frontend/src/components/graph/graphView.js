/**
 * 관계 지도(25) 캔버스 엔진 — 그리기·배치(힘)·확대·끌기·마우스 올림. React 는 이것을 만들고 설정만 넘긴다.
 *
 * 배치 규칙
 *   · 배치 힘은 기준 → 자료 선(주 기준)에만 건다. 기준 점끼리만 서로 밀어낸다(hubSpacing) — 다른 기준이 자료를
 *     밀지 않아 자료가 자기 기준 둘레에 원으로 앉는다.
 *   · 관계가 많은 기준끼리는 가까이 놓인다(related 링크, 세기 ∝ 관계 수).
 * 움직임(사용자 결정 — 상호작용 때만)
 *   · 마우스를 올리면 주변이 0.32초 ease-in-out 으로 가라앉고, 0.56초 동안 초점 빛이 번지며 선이
 *     초점에서 바깥으로 1단계 → 2단계 차례로 그려진다. 카메라 이동 0.75초. 움직임 줄이기 설정이면 즉시.
 *   · 점 사이를 지날 때 깜빡이지 않게 새 점은 50ms, 빈 곳은 140ms 머물면 바꾼다.
 */
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';
import { pointer, select } from 'd3-selection';
import { drag as d3drag } from 'd3-drag';
import 'd3-transition';
import { easeCubicInOut } from 'd3-ease';
import {
  aggregate, explainAgg, explainPair, hubTip, isLoudPair, isMember, isReportOnly, membersOf, pairsOf, parentsOf,
  pivotHubs, primaryOf,
} from '../../lib/graphModel.js';

const FONT = '"Pretendard Variable", Pretendard, "Noto Sans KR", "Segoe UI", sans-serif';
const MONO = '"JetBrains Mono", Consolas, monospace';
// 지도 색: 중립 + 강조 하나(브랜드 남색). 범주색은 '점 색'을 켰을 때 자료 점에만 쓴다. 주황은 '똑같은 BDF' 경고 하나.
// 32 — 문서 층 선(사용한 모델·보고서 다른 판·본문 비슷함)은 청록 하나로 모델 층(남색)과 나눈다.
const K = {
  bg: '#FFFFFF', edge: 'rgba(19,23,28,0.15)', edgeCross: 'rgba(19,23,28,0.12)', edgeRing: 'rgba(19,23,28,0.07)',
  agg: 'rgba(52,72,102,0.3)', hot: 'rgba(0,37,84,0.72)', accent: '#002554', warn: '#C2620E', ring: '#2E6FD8',
  glow: '46,111,216', leaf: '#7D8794', hub: '#002554', hubNone: '#A3A9B1', tag: '#5B6573', label: '#24282E',
  labelSub: '#4E5359', halo: 'rgba(255,255,255,0.94)', doc: '#1F7A68',
};
// 선 모양 — [색 열쇠, 굵기, 점선]
const PAIR_STYLE = {
  geom: ['accent', 1.5, [5, 4]], dup: ['warn', 1.8, []],
  uses: ['doc', 1.5, []], rrev: ['doc', 1.9, []], text: ['doc', 1.3, [1.5, 3.5]],
};
export const GRAPH_COLORS = K;

const PDUR = 560;
const DIM_ALPHA = 0.08;
const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
const easeO = (t) => 1 - (1 - t) ** 3;
const mean = (arr, f) => (arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : undefined);

// 크기: 확대할수록 점도 함께 커진다(옵시디언처럼 다가가는 느낌). 기준 점은 30px 에서 멈춘다
const hubR = (h) => Math.min(16, 4 + 2 * Math.sqrt(h.cnt));
const LEAF_R = 2.6;
const ringR = (h) => hubR(h) + 10 + Math.sqrt(h.cnt) * 2.4;
const clusterR = (h) => ringR(h) + 10;
const zs = (k, lo) => Math.max(lo, k) ** 0.85;
const leafRad = (k) => LEAF_R * zs(k, 0.85);
const hubRad = (h, k) => Math.min(hubR(h) * zs(k, 0.7), 30);
const ringRad = (r, k) => (3 + Math.sqrt(r.cnt) * 1.1) * zs(k, 0.8);
const lineW = (w, k) => w * Math.max(1, Math.sqrt(k) * 0.9);
const aggWidth = (a, k) => (0.8 + 1.35 * Math.sqrt(a.c)) * Math.max(1, Math.sqrt(k) * 0.7);
/** 2026-10-20 — 기본으로 그리는 기준 사이 곡선의 가짓수 상한(기준 점 수 × 이 값). 넘으면 건수 문턱을 올린다. */
const AGG_PER_HUB = 1.5;
const AGG_FLOOR = 12;
const NONE_AT = 260;   // '○○ 없음' 점이 끌려가는 자리(지도 좌표) — 무리 가장자리 바로 밖
const shortTitle = (t) => (t.length > 22 ? `${t.slice(0, 21)}…` : t);
const segDist = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
};

export function createGraphView({ canvas, stage, tip, reducedMotion = false, on = {} }) {
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;   // jsdom 에는 없다 — 그리기만 건너뛴다
  const REDUCED = reducedMotion;
  let model = null;
  const S = { pivot: 'hull', color: 'none', hl: null, sel: null, hover: null, hoverLink: null,
    secondary: true, agg: true, rings: new Set(), alwaysPairs: false, userZoom: false, layer: 'all' };
  let W = 0, H = 0, dpr = 1, T = zoomIdentity;
  let gHubs = [], gLinks = [], gRings = [], gAgg = [], aggMin = 2;
  let drawnAgg = [], drawnPairs = [], labelBoxes = [];
  let L = null, focusKey = null, raf = 0, hoverTimer = 0, settleTimer = 0, destroyed = false;
  const A = { dim: 0, dimFrom: 0, dimTo: 0, dimT0: 0, dimDur: 320, p: 1, pT0: 0 };
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

  const parents = (e) => parentsOf(model, e, S.pivot);
  const primary = (e) => primaryOf(model, e, S.pivot);
  const members = (h) => membersOf(model, h);
  const P = () => pairsOf(model, S.layer);
  // 늘 그리는 '강한' 관계 — 건수가 문턱 이상이고 '○○ 없음' 점이 끼지 않은 것. 나머지는 점을 고르면 보인다(실타래 방지)
  const strong = (a) => a.c >= aggMin && !a.a.none && !a.b.none;
  function pickAggMin() {
    const cs = gAgg.filter((a) => !a.a.none && !a.b.none).map((a) => a.c);
    const cap = Math.max(AGG_FLOOR, Math.round(gHubs.length * AGG_PER_HUB));
    let t = 2;
    while (cs.filter((c) => c >= t).length > cap) t += 1;
    return t;
  }

  // 기준 점끼리만 서로 떨어뜨린다 — 다른 기준이 자료를 밀지 않아 둘레가 온전한 원이 된다
  function hubSpacing(alpha) {
    for (let i = 0; i < gHubs.length; i++) for (let j = i + 1; j < gHubs.length; j++) {
      const a = gHubs[i], b = gHubs[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      const min = clusterR(a) + clusterR(b) + 28, far = min + 150;
      if (d >= far) continue;
      const f = ((d < min ? (min - d) * 0.5 : (far - d) * 0.035) / d) * alpha;
      a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f;
    }
  }
  const sim = forceSimulation().alphaDecay(0.03).velocityDecay(0.45).alphaMin(0.004).on('tick', requestFrame).stop();

  function build() {
    if (!model) return;
    gHubs = pivotHubs(model, S.pivot);
    gRings = [...model.hubs.values()].filter((h) => h.g !== S.pivot && S.rings.has(h.g) && h.cnt > 0);
    gLinks = [];
    for (const e of model.entries) parents(e).forEach((p, i) => gLinks.push({ source: e, target: p, main: i === 0 }));
    gAgg = aggregate(model, S.pivot, S.layer);
    aggMin = pickAggMin();
    for (const h of gHubs) {
      if (h.x == null || h._pivot !== S.pivot) {
        const ms = members(h).filter((e) => e.x != null);
        h.x = ms.length ? mean(ms, (e) => e.x) : (rnd() - 0.5) * 300;
        h.y = ms.length ? mean(ms, (e) => e.y) : (rnd() - 0.5) * 300;
        h.vx = 0; h.vy = 0; h._pivot = S.pivot;
      }
    }
    for (const e of model.entries) if (e.x == null) { e.x = (rnd() - 0.5) * 400; e.y = (rnd() - 0.5) * 400; }
    sim.nodes([...gHubs, ...model.entries])
      .force('link', forceLink(gLinks.filter((l) => l.main)).distance((l) => ringR(l.target)).strength(0.9))
      .force('leaf', forceManyBody().strength((d) => (d.hub ? 0 : -24)).distanceMax(60))
      .force('collide', forceCollide((d) => (d.hub ? hubR(d) + 5 : LEAF_R + 2)).iterations(2))
      .force('hubs', hubSpacing)
      // 배치도 강한 관계만 당긴다 — 약한 관계까지 당기면 모든 기준 점이 가운데로 엉킨다
      .force('related', forceLink(gAgg.filter(strong).map((a) => ({ source: a.a, target: a.b, c: a.c })))
        .distance((l) => clusterR(l.source) + clusterR(l.target) + 60).strength((l) => 0.03 + 0.015 * Math.min(l.c, 6)))
      // '○○ 없음' 점은 진짜 기준 값이 아니라 가장자리(오른쪽 아래)로 보낸다
      .force('x', forceX((d) => (d.none ? NONE_AT : 0)).strength((d) => (d.hub ? (d.none ? 0.16 : 0.06) : 0)))
      .force('y', forceY((d) => (d.none ? NONE_AT * 0.6 : 0)).strength((d) => (d.hub ? (d.none ? 0.16 : 0.06) : 0)));
  }
  function settle(n = 320) { sim.alpha(1); for (let i = 0; i < n; i++) sim.tick(); sim.alpha(0); sim.stop(); requestFrame(); }
  function placeRings() { for (const r of gRings) { const ms = members(r); r.x = mean(ms, (e) => e.x); r.y = mean(ms, (e) => e.y); } }

  // ── 초점: 각 점까지의 단계(0 = 초점) ──
  function computeLit() {
    const f = S.hover || S.sel;
    if (f && model.byId.has(f)) {
      const n = model.byId.get(f), D = new Map([[f, 0]]);
      const put = (id, d) => { if (!D.has(id) || D.get(id) > d) D.set(id, d); };
      if (n.hub) {
        for (const e of members(n)) {
          put(e.id, 1); parents(e).forEach((p) => put(p.id, 2)); gRings.forEach((r) => { if (isMember(e, r)) put(r.id, 2); });
        }
        if (n.g === S.pivot) {
          gAgg.forEach((a) => { if (a.a === n) put(a.b.id, 1); if (a.b === n) put(a.a.id, 1); });
          for (const p of P()) {
            const ia = D.get(p.a.id) === 1, ib = D.get(p.b.id) === 1;
            if (ia && !D.has(p.b.id)) { put(p.b.id, 2); put(primary(p.b).id, 2); }
            if (ib && !D.has(p.a.id)) { put(p.a.id, 2); put(primary(p.a).id, 2); }
          }
        }
      } else {
        parents(n).forEach((p) => put(p.id, 1)); gRings.forEach((r) => { if (isMember(n, r)) put(r.id, 1); });
        for (const p of P()) {
          const o = p.a === n ? p.b : p.b === n ? p.a : null;
          if (o) { put(o.id, 1); put(primary(o).id, 2); }
        }
      }
      return D;
    }
    if (S.hl && model.byId.has(S.hl)) {
      const h = model.byId.get(S.hl), D = new Map([[h.id, 0]]);
      for (const e of members(h)) { D.set(e.id, 1); parents(e).forEach((p) => { if (!D.has(p.id)) D.set(p.id, 2); }); }
      return D;
    }
    return null;
  }
  function setFocus() {
    if (!model) return;
    const next = computeLit(), key = S.hover || S.sel || S.hl || null, now = performance.now();
    const want = next ? 1 : 0;
    if (want !== A.dimTo) { A.dimFrom = A.dim; A.dimTo = want; A.dimT0 = now; A.dimDur = want ? 320 : 260; }
    if (next) { if (key !== focusKey) { A.p = 0; A.pT0 = now; } L = next; }
    focusKey = next ? key : null;
    if (REDUCED) { A.dim = A.dimTo; A.p = 1; if (!next) L = null; }
    requestFrame();
  }
  function requestFrame() { if (!raf && !destroyed) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0; let busy = false;
    if (A.dim !== A.dimTo) {
      const t = Math.min(1, (now - A.dimT0) / A.dimDur);
      A.dim = A.dimFrom + (A.dimTo - A.dimFrom) * easeIO(t);
      if (t >= 1) { A.dim = A.dimTo; if (!A.dimTo) L = null; } else busy = true;
    }
    if (A.p < 1) { A.p = Math.min(1, (now - A.pT0) / PDUR); if (A.p < 1) busy = true; }
    draw();
    if (busy) requestFrame();
  }

  // ── 그리기 ──
  const sx = (x) => T.applyX(x), sy = (y) => T.applyY(y);
  const leafColor = (e) => (S.color === 'ship' ? model.colors.ship.colorOf(e) : K.leaf);
  const lineBatch = (list, style, width) => {
    if (!list.length) return;
    ctx.beginPath();
    for (const [a, b] of list) { ctx.moveTo(sx(a.x), sy(a.y)); ctx.lineTo(sx(b.x), sy(b.y)); }
    ctx.strokeStyle = style; ctx.lineWidth = width; ctx.stroke();
  };
  const fits = (b) => {
    for (const o of labelBoxes) if (b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y) return false;
    labelBoxes.push(b); return true;
  };
  function label(txt, x, y, font, color, force) {
    ctx.font = font;
    const w = ctx.measureText(txt).width, b = { x: x - w / 2 - 2, y: y - 1, w: w + 4, h: 15 };
    if (!force && !fits(b)) return;
    if (force) labelBoxes.push(b);
    ctx.lineWidth = 3; ctx.strokeStyle = K.halo; ctx.strokeText(txt, x, y); ctx.fillStyle = color; ctx.fillText(txt, x, y);
  }
  const aggGeom = (a) => {
    const x1 = sx(a.a.x), y1 = sy(a.a.y), x2 = sx(a.b.x), y2 = sy(a.b.y);
    const len = Math.hypot(x2 - x1, y2 - y1) || 1, bend = len * 0.1;
    const cx = (x1 + x2) / 2 - ((y2 - y1) / len) * bend, cy = (y1 + y2) / 2 + ((x2 - x1) / len) * bend;
    return { x1, y1, x2, y2, cx, cy, mx: 0.25 * x1 + 0.5 * cx + 0.25 * x2, my: 0.25 * y1 + 0.5 * cy + 0.25 * y2 };
  };

  function draw() {
    if (!ctx || !W || !model) return;
    placeRings();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = K.bg; ctx.fillRect(0, 0, W, H);
    const k = T.k, fid = S.hover || S.sel;
    const lit = (id) => !L || L.has(id), dep = (id) => (L ? L.get(id) : undefined);
    const dimA = 1 - A.dim * (1 - DIM_ALPHA), pe = easeO(A.p);
    const st1 = easeO(Math.min(1, A.p / 0.55)), st2 = easeO(Math.max(0, (A.p - 0.3) / 0.7));
    const lr = leafRad(k);
    ctx.lineCap = 'round';

    // 1) 기준 사이 관계: 굵기 = 건수인 곡선 — 강한 관계는 늘, 약한 관계는 초점에 닿을 때만
    const aggHot = []; drawnAgg = []; drawnPairs = [];
    if (S.agg) for (const a of gAgg) {
      const hot = L && lit(a.a.id) && lit(a.b.id) && (dep(a.a.id) === 0 || dep(a.b.id) === 0 || !fid);
      if (!strong(a) && !hot && S.hoverLink !== a) continue;
      const g = aggGeom(a), w = aggWidth(a, k), over = S.hoverLink === a;
      ctx.globalAlpha = L && !hot && !over ? dimA : 1; ctx.strokeStyle = over ? K.hot : K.agg; ctx.lineWidth = over ? w + 1.5 : w;
      ctx.beginPath(); ctx.moveTo(g.x1, g.y1); ctx.quadraticCurveTo(g.cx, g.cy, g.x2, g.y2); ctx.stroke();
      if (hot) aggHot.push([a, g]);
      drawnAgg.push({ a, g, w });
    }
    for (const [a, g] of aggHot) {
      ctx.globalAlpha = A.dim * st2; ctx.strokeStyle = K.hot; ctx.lineWidth = aggWidth(a, k);
      ctx.beginPath(); ctx.moveTo(g.x1, g.y1); ctx.quadraticCurveTo(g.cx, g.cy, g.x2, g.y2); ctx.stroke();
    }

    // 2) 기준 → 자료 선, 함께 등록된 둘째 기준 선, 태그 고리 선
    const base = [], cross = [], ringL = [], hotSeg = [];
    const consider = (a, b, bucket) => {
      bucket.push([a, b]);
      if (L && lit(a.id) && lit(b.id)) {
        const da = dep(a.id), db = dep(b.id);
        if (da === undefined || db === undefined) return;
        const [s, e] = da <= db ? [a, b] : [b, a];
        hotSeg.push({ s, e, stage: Math.min(da, db) === 0 ? 1 : 2 });
      }
    };
    // 함께 등록된 둘째 기준 선은 초점이 있을 때(또는 '늘 보기')만 — 평소에 그리면 지도를 가로지르는 실이 된다(2026-10-20)
    for (const l of gLinks) { if (!l.main && (!S.secondary || (!L && !S.alwaysPairs))) continue; consider(l.source, l.target, l.main ? base : cross); }
    for (const r of gRings) for (const e of members(r)) consider(e, r, ringL);
    ctx.globalAlpha = L ? dimA : 1;
    lineBatch(base, K.edge, lineW(0.6, k)); lineBatch(cross, K.edgeCross, lineW(0.6, k)); lineBatch(ringL, K.edgeRing, lineW(0.6, k));
    if (hotSeg.length && A.dim > 0) {
      ctx.strokeStyle = K.hot; ctx.lineWidth = lineW(1.15, k); ctx.globalAlpha = A.dim; ctx.beginPath();
      for (const h of hotSeg) {
        const f = h.stage === 1 ? st1 : st2;
        if (f <= 0) continue;
        const x1 = sx(h.s.x), y1 = sy(h.s.y);
        ctx.moveTo(x1, y1); ctx.lineTo(x1 + (sx(h.e.x) - x1) * f, y1 + (sy(h.e.y) - y1) * f);
      }
      ctx.stroke();
    }

    // 3) 자료 사이 선: 초점과 닿을 때·올렸을 때·'늘 보기'. 똑같은 BDF(주황)·보고서 다른 판(청록 실선)은 정리 신호라 늘 보인다
    for (const p of P()) {
      const touch = fid && L && lit(p.a.id) && lit(p.b.id) && (dep(p.a.id) <= 1 || dep(p.b.id) <= 1);
      const over = S.hoverLink === p;
      if (!touch && !over && !S.alwaysPairs && !isLoudPair(p)) continue;
      const [ck, lw, dash] = PAIR_STYLE[p.type] || PAIR_STYLE.geom;
      const [s, e] = !L || (dep(p.a.id) ?? 9) <= (dep(p.b.id) ?? 9) ? [p.a, p.b] : [p.b, p.a];
      const f = touch && !over ? (Math.min(dep(p.a.id), dep(p.b.id)) === 0 ? st1 : st2) : 1;
      ctx.globalAlpha = over ? 1 : touch ? 0.95 * Math.max(A.dim, 0.001) : (L ? dimA * 0.9 : 0.9);
      ctx.strokeStyle = K[ck];
      ctx.lineWidth = lineW(lw, k) + (over ? 1.2 : 0);
      ctx.setLineDash(dash);
      const x1 = sx(s.x), y1 = sy(s.y), x2 = x1 + (sx(e.x) - x1) * f, y2 = y1 + (sy(e.y) - y1) * f;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
      if (f >= 1) drawnPairs.push({ p, x1, y1, x2, y2 });
    }

    // 4) 초점 빛
    if (fid && L && A.dim > 0) {
      const n = model.byId.get(fid);
      if (n && n.x != null) {
        const r0 = n.hub ? hubRad(n, k) : lr, R = r0 * 3.2 + 26 + 10 * pe;
        const g = ctx.createRadialGradient(sx(n.x), sy(n.y), r0 * 0.6, sx(n.x), sy(n.y), R);
        g.addColorStop(0, `rgba(${K.glow},${0.22 * A.dim * pe})`); g.addColorStop(1, `rgba(${K.glow},0)`);
        ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx(n.x), sy(n.y), R, 0, Math.PI * 2); ctx.fill();
      }
    }

    // 5) 자료 점(색별로 묶고, 초점 이웃은 살짝 커진다). 보고서만 있는 자료는 속이 빈 점(32)
    const grow = 1 + 0.32 * pe * A.dim;
    const groups = new Map();
    for (const e of model.entries) {
      const on = lit(e.id);
      const key = `${leafColor(e)}|${on ? (L && dep(e.id) <= 1 ? '2' : '1') : '0'}|${isReportOnly(e) ? 'o' : 'f'}`;
      (groups.get(key) || groups.set(key, []).get(key)).push(e);
    }
    for (const [key, list] of groups) {
      const [c, lv, shape] = key.split('|');
      ctx.globalAlpha = lv === '0' ? dimA : 1;
      const r = lv === '2' ? lr * grow : lr;
      ctx.beginPath();
      for (const e of list) { ctx.moveTo(sx(e.x) + r, sy(e.y)); ctx.arc(sx(e.x), sy(e.y), r, 0, Math.PI * 2); }
      if (shape === 'o') {
        ctx.fillStyle = K.bg; ctx.fill(); ctx.lineWidth = Math.max(1, r * 0.45); ctx.strokeStyle = c; ctx.stroke();
      } else { ctx.fillStyle = c; ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    for (const n of [...model.entries, ...gHubs]) if (n.pinned) {
      ctx.beginPath(); ctx.arc(sx(n.x), sy(n.y), (n.hub ? hubRad(n, k) : lr) + 3, 0, Math.PI * 2);
      ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.strokeStyle = K.labelSub; ctx.stroke(); ctx.setLineDash([]);
    }

    // 6) 태그 고리 점 · 기준 점
    for (const r of gRings) {
      ctx.globalAlpha = lit(r.id) ? 1 : dimA;
      ctx.beginPath(); ctx.arc(sx(r.x), sy(r.y), ringRad(r, k), 0, Math.PI * 2);
      ctx.fillStyle = K.bg; ctx.fill(); ctx.lineWidth = 1.25; ctx.strokeStyle = K.tag; ctx.stroke();
    }
    for (const h of gHubs) {
      let r = hubRad(h, k);
      if (h.id === fid) r *= 1 + 0.12 * pe * A.dim;
      ctx.globalAlpha = lit(h.id) ? 1 : Math.max(dimA, 0.3);
      ctx.beginPath(); ctx.arc(sx(h.x), sy(h.y), r, 0, Math.PI * 2);
      if (h.none) {
        ctx.fillStyle = K.bg; ctx.fill(); ctx.lineWidth = 1.25; ctx.setLineDash([3, 2]); ctx.strokeStyle = K.hubNone; ctx.stroke(); ctx.setLineDash([]);
      } else { ctx.fillStyle = K.hub; ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    if (S.sel) {
      const n = model.byId.get(S.sel);
      if (n && n.x != null) {
        const r = (n.hub ? hubRad(n, k) * (n.id === fid ? 1 + 0.12 * pe * A.dim : 1) : lr * grow) + 3;
        ctx.beginPath(); ctx.arc(sx(n.x), sy(n.y), r, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = K.ring; ctx.stroke();
      }
    }

    // 7) 이름표: 초점 → 관계 건수 → 기준 점(큰 순) → 자료(확대 단계). 겹치면 버린다
    labelBoxes = []; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
    const hubFont = (h, px) => (h.g === 'hull' && !h.none ? `500 ${px}px ${MONO}` : `600 ${px}px ${FONT}`);
    if (fid && L) {
      const n = model.byId.get(fid);
      if (n && n.x != null) {
        const r = n.hub ? hubRad(n, k) * (1 + 0.12 * pe) : lr * grow;
        ctx.globalAlpha = Math.max(0.4, A.dim);
        label(n.hub ? n.label : shortTitle(n.label), sx(n.x), sy(n.y) + r + 5 + 3 * (1 - pe),
          n.hub ? hubFont(n, 12.5) : `600 12.5px ${FONT}`, K.label, true);
      }
    }
    const hubA = Math.max(0, Math.min(1, (k - 0.5) / 0.15));
    for (const h of [...gHubs].sort((a, b) => b.cnt - a.cnt)) {
      if (h.id === fid) continue;
      ctx.globalAlpha = hubA * (lit(h.id) ? 1 : dimA);
      if (ctx.globalAlpha < 0.03) continue;
      label(h.label, sx(h.x), sy(h.y) + hubRad(h, k) + 4, hubFont(h, 12), h.none ? K.labelSub : K.label);
    }
    // 초점 기준 점의 관계 곡선 위 — 건수만(이유는 오른쪽 '이어진 ○○' 목록과 곡선 설명에). 기준 점 이름표 다음에,
    // 건수 큰 것부터 놓고 겹치면 버린다(2026-10-20 — 이유 문장을 다 쓰면 서로 겹쳐 읽을 수 없었다)
    if (fid && aggHot.length && model.byId.get(fid)?.hub) for (const [a, g] of [...aggHot].sort((x, y) => y[0].c - x[0].c)) {
      ctx.globalAlpha = A.dim * st2;
      label(`${a.c}건`, g.mx, g.my - 7, `600 11.5px ${FONT}`, K.accent, false);
    }
    for (const r of gRings) {
      if (r.id === fid || !(L && lit(r.id) && A.dim > 0.4)) continue;
      ctx.globalAlpha = A.dim * pe;
      label(r.label, sx(r.x), sy(r.y) + ringRad(r, k) + 3, `500 11.5px ${FONT}`, K.labelSub);
    }
    const leafA = Math.max(0, Math.min(1, (k - 1.8) / 0.3));
    for (const e of model.entries) {
      if (e.id === fid || !lit(e.id)) continue;
      const near = L && dep(e.id) <= 1 && k >= 1.1, a = near ? Math.max(leafA, A.dim * pe) : leafA;
      if (a <= 0.02) continue;
      ctx.globalAlpha = a;
      const big = k >= 4.5;
      label(big ? shortTitle(e.label) : e.eid, sx(e.x), sy(e.y) + lr * (near ? grow : 1) + 3 + (near ? 3 * (1 - pe) : 0),
        big ? `500 11.5px ${FONT}` : `500 11px ${MONO}`, K.labelSub);
    }
    ctx.globalAlpha = 1;
  }

  // ── 찾기(점·선) ──
  function findAt(px, py) {
    if (!model) return null;
    const k = T.k;
    let best = null, bd = 1e9;
    for (const h of gHubs) { const d = Math.hypot(sx(h.x) - px, sy(h.y) - py); if (d <= hubRad(h, k) + 4 && d < bd) { bd = d; best = h; } }
    if (best) return best;
    for (const r of gRings) { const d = Math.hypot(sx(r.x) - px, sy(r.y) - py); if (d <= ringRad(r, k) + 5 && d < bd) { bd = d; best = r; } }
    if (best) return best;
    const lr = leafRad(k);
    for (const e of model.entries) { const d = Math.hypot(sx(e.x) - px, sy(e.y) - py); if (d <= lr + 6 && d < bd) { bd = d; best = e; } }
    return best;
  }
  function findLink(px, py) {
    let best = null, bd = 6;
    for (const d of drawnPairs) { const dd = segDist(px, py, d.x1, d.y1, d.x2, d.y2); if (dd < bd) { bd = dd; best = d.p; } }
    if (best) return best;
    for (const { a, g, w } of drawnAgg) {
      let px0 = g.x1, py0 = g.y1;
      for (let i = 1; i <= 24; i++) {
        const t = i / 24, u = 1 - t;
        const x = u * u * g.x1 + 2 * u * t * g.cx + t * t * g.x2, y = u * u * g.y1 + 2 * u * t * g.cy + t * t * g.y2;
        const dd = segDist(px, py, px0, py0, x, y) - w / 2;
        if (dd < bd) { bd = dd; best = a; }
        px0 = x; py0 = y;
      }
    }
    return best;
  }

  // ── 크기·확대·끌기 ──
  const zoomer = d3zoom().scaleExtent([0.3, 12]).on('zoom', (e) => { T = e.transform; if (e.sourceEvent) S.userZoom = true; requestFrame(); });
  function bounds() {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const h of gHubs) { const r = clusterR(h); x0 = Math.min(x0, h.x - r); x1 = Math.max(x1, h.x + r); y0 = Math.min(y0, h.y - r); y1 = Math.max(y1, h.y + r + 16); }
    for (const e of model.entries) { x0 = Math.min(x0, e.x); x1 = Math.max(x1, e.x); y0 = Math.min(y0, e.y); y1 = Math.max(y1, e.y); }
    return [x0 - 16, x1 + 16, y0 - 16, y1 + 24];
  }
  function fit(dur = 500) {
    if (!W || !model || !model.entries.length) return;
    const [x0, x1, y0, y1] = bounds();
    const k = Math.min(1.6, 0.92 * Math.min(W / (x1 - x0), H / (y1 - y0)));
    const t = zoomIdentity.translate(W / 2 - (k * (x0 + x1)) / 2, H / 2 - (k * (y0 + y1)) / 2).scale(k);
    S.userZoom = false;
    if (REDUCED || !dur) select(canvas).call(zoomer.transform, t);
    else select(canvas).transition().duration(dur).ease(easeCubicInOut).call(zoomer.transform, t);
  }
  function centerOn(n, k) {
    const t = zoomIdentity.translate(W / 2 - k * n.x, H / 2 - k * n.y).scale(k);
    if (REDUCED) select(canvas).call(zoomer.transform, t);
    else select(canvas).transition().duration(750).ease(easeCubicInOut).call(zoomer.transform, t);
  }
  function resize() {
    const r = stage.getBoundingClientRect();
    const changed = Math.abs(r.width - W) > 2 || Math.abs(r.height - H) > 2;
    dpr = window.devicePixelRatio || 1; W = r.width; H = r.height;
    canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
    if (changed && !S.userZoom) fit(0); else requestFrame();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(stage);

  let moved = false;
  const dragger = d3drag().container(canvas)
    .subject((e) => { const n = findAt(e.x, e.y); return n && !gRings.includes(n) ? n : null; })
    .on('start', (e) => { moved = false; if (!REDUCED) sim.alphaTarget(0.12).restart(); e.subject.fx = e.subject.x; e.subject.fy = e.subject.y; })
    .on('drag', (e) => {
      moved = true;
      const [x, y] = T.invert(pointer(e.sourceEvent, canvas));
      e.subject.fx = x; e.subject.fy = y;
      if (REDUCED) { e.subject.x = x; e.subject.y = y; }
      requestFrame();
    })
    .on('end', (e) => {
      sim.alphaTarget(0);
      if (moved && e.sourceEvent?.shiftKey) e.subject.pinned = true;
      if (!e.subject.pinned) { e.subject.fx = null; e.subject.fy = null; }
      if (!moved) selectNode(e.subject.id, true);
      requestFrame();
    });
  select(canvas).call(dragger).call(zoomer).on('dblclick.zoom', null);

  function placeTip(p) {
    if (!tip) return;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(p[0] + 14, W - r.width - 8))}px`;
    tip.style.top = `${p[1] + 18 + r.height > H - 8 ? p[1] - r.height - 12 : p[1] + 18}px`;
  }
  const listeners = [];
  const listen = (el, type, fn) => { el.addEventListener(type, fn); listeners.push([el, type, fn]); };
  listen(canvas, 'dblclick', (e) => {
    const p = pointer(e, canvas), n = findAt(p[0], p[1]);
    if (n && n.pinned) { n.pinned = false; n.fx = null; n.fy = null; if (!REDUCED) sim.alpha(0.2).restart(); requestFrame(); }
  });
  listen(canvas, 'click', (e) => {
    const p = pointer(e, canvas), n = findAt(p[0], p[1]);
    if (n && gRings.includes(n)) { on.onHighlight?.(S.hl === n.id ? null : n.id); return; }
    if (!n && (S.sel || S.hl)) { on.onSelect?.(null); on.onHighlight?.(null); }
  });
  listen(canvas, 'pointermove', (e) => {
    const p = pointer(e, canvas), n = findAt(p[0], p[1]), nid = n ? n.id : null;
    const link = n ? null : findLink(p[0], p[1]);
    if (link !== S.hoverLink) { S.hoverLink = link; requestFrame(); }
    canvas.style.cursor = n ? 'pointer' : link ? 'help' : 'grab';
    if (nid !== S.hover) {
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => { if (S.hover !== nid) { S.hover = nid; setFocus(); } }, nid ? 50 : 140);
    } else clearTimeout(hoverTimer);
    if (tip) {
      if (n || link) {
        tip.hidden = false;
        tip.textContent = link ? (link.type ? explainPair(model, link, S.pivot) : explainAgg(link, S.pivot))
          : n.hub ? hubTip(n) : `${n.eid} · ${n.label}`;
        placeTip(p);
      } else tip.hidden = true;
    }
  });
  listen(canvas, 'pointerleave', () => {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => { if (S.hover) { S.hover = null; setFocus(); } }, 140);
    if (tip) tip.hidden = true;
    if (S.hoverLink) { S.hoverLink = null; requestFrame(); }
  });

  // ← → 이웃 이동, Esc 해제
  function neighbors(n) {
    if (!n) return [...gHubs].sort((a, b) => b.cnt - a.cnt);
    if (n.hub) return members(n).sort((a, b) => (b.raw.confirmed_at || '').localeCompare(a.raw.confirmed_at || ''));
    return [...parents(n), ...P().filter((p) => p.a === n || p.b === n).map((p) => (p.a === n ? p.b : p.a))];
  }
  let navAnchor = null, navIdx = -1;
  listen(canvas, 'keydown', (e) => {
    if (!model) return;
    if (e.key === 'Escape') { on.onSelect?.(null); on.onHighlight?.(null); return; }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const cur = S.sel && model.byId.get(S.sel);
    if (!navAnchor || (cur && cur !== navAnchor && !neighbors(navAnchor).includes(cur))) { navAnchor = cur || null; navIdx = -1; }
    const list = neighbors(navAnchor);
    if (!list.length) return;
    navIdx = (navIdx + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
    const n = list[navIdx];
    selectNode(n.id, true);
    centerOn(n, Math.max(T.k, n.hub ? 1.2 : 2.2));
  });

  function selectNode(id, fromCanvas) {
    S.sel = id;
    setFocus();
    if (fromCanvas) on.onSelect?.(id);
  }

  return {
    setModel(m) {
      model = m; S.sel = null; S.hl = null; S.hover = null; S.hoverLink = null; navAnchor = null;
      build(); settle(300); fit(0);
    },
    setPivot(p) {
      if (S.pivot === p) return;
      S.pivot = p; S.rings.delete(p); S.hover = null; navAnchor = null;
      if (!model) return;
      build(); setFocus();
      if (REDUCED) { settle(); fit(0); } else { sim.alpha(0.7).restart(); clearTimeout(settleTimer); settleTimer = setTimeout(() => fit(), 900); }
    },
    setColor(c) { S.color = c; requestFrame(); },
    setOptions({ agg, secondary, alwaysPairs, rings, layer }) {
      const rebuild = (rings && [...rings].sort().join() !== [...S.rings].sort().join()) || (secondary !== undefined && secondary !== S.secondary)
        || (layer !== undefined && layer !== S.layer);
      if (layer !== undefined) S.layer = layer;
      if (agg !== undefined) S.agg = agg;
      if (secondary !== undefined) S.secondary = secondary;
      if (alwaysPairs !== undefined) S.alwaysPairs = alwaysPairs;
      if (rings) S.rings = new Set([...rings].filter((g) => g !== S.pivot));
      if (rebuild && model) { build(); if (!REDUCED) sim.alpha(0.3).restart(); else settle(); setFocus(); }
      requestFrame();
    },
    setSelection(id) { if (S.sel !== id) selectNode(id, false); },
    setHighlight(id) { if (S.hl !== id) { S.hl = id; if (id) S.sel = null; setFocus(); } },
    /** 목록·찾기에서 고른 점으로 카메라를 옮긴다. 다른 기준의 값이면 강조로 바꾼다. */
    goTo(id) {
      const n = model?.byId.get(id);
      if (!n) return;
      if (n.hub && n.g !== S.pivot) { on.onHighlight?.(S.hl === id ? null : id); return; }
      selectNode(id, true);
      if (n.x != null) centerOn(n, Math.max(T.k, n.hub ? 1.4 : 2.8));
    },
    fit: () => fit(),
    focus: () => canvas.focus(),
    destroy() {
      destroyed = true;
      sim.stop(); ro?.disconnect(); cancelAnimationFrame(raf); clearTimeout(hoverTimer); clearTimeout(settleTimer);
      listeners.forEach(([el, type, fn]) => el.removeEventListener(type, fn));
      select(canvas).on('.zoom', null).on('.drag', null).interrupt();
    },
  };
}
