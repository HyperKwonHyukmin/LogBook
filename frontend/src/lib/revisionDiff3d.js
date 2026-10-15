/**
 * 판 변경 3D 보기(16) — 14 상세(ID 목록)를 3D 에 칠할 자료로 바꾸는 순수 함수(three 를 모른다, jsdom 에서 시험).
 *
 *  · diffSets(detail)            상세 → 범주별 ID 목록(+ 잘림 원래 수)
 *  · classifyModel(lbm, geom, s) 뒤 판(b): 요소·강체 순번마다 범주(0 없음·1 추가·2 변경) + 절점 순번 목록
 *  · diffIndexBuffers(...)       범주마다 쉘 삼각형·테두리·1D 선분 인덱스(기존 공유 위치 버퍼를 그대로 쓴다)
 *  · ghostGeometry(lbmA, c, s)   앞 판(a)의 삭제 요소·강체·절점 — 쓰인 절점만 모은 작은 위치 버퍼(b 뷰어 좌표)
 *  · diffLegend(...)             범례 행(개수·잘림·3D 에 없는 수)
 *  · DEFAULT_LAYERS·toggleLayer  범주 켜기/끄기, 바뀐 것만 보기
 * 모두 TypedArray 와 Set 한 번 훑기(O(요소 수))라 수십만 요소에서도 수십 ms 다.
 */
import { ELEM_BEAM, ELEM_TRI } from './modelGeometry.js';

export const CLS_NONE = 0;
export const CLS_ADDED = 1;
export const CLS_CHANGED = 2;

export const LAYER_KEYS = ['added', 'changed', 'removed', 'moved', 'spc', 'unchanged'];
export const LAYER_LABELS = {
  added: '추가', changed: '변경', removed: '삭제', moved: '이동한 절점', spc: '구속이 바뀐 절점', unchanged: '변경 없음',
};
/** 범례 모양(색약 보조) — 색과 함께 모양으로도 갈린다. */
export const LAYER_SHAPES = {
  added: 'solid', changed: 'solid', removed: 'ghost', moved: 'dot', spc: 'square', unchanged: 'dim',
};
export const DEFAULT_LAYERS = { added: true, changed: true, removed: true, moved: true, spc: true, unchanged: true, onlyChanged: false };

/** 범주 하나 켜기/끄기. '변경 없음'을 켜면 '바뀐 것만 보기'는 풀린다(둘은 같은 것의 두 이름이다). */
export function toggleLayer(layers, key) {
  if (key === 'onlyChanged') return { ...layers, onlyChanged: !layers.onlyChanged, unchanged: layers.onlyChanged };
  if (key === 'unchanged') return { ...layers, unchanged: !layers.unchanged, onlyChanged: layers.unchanged };
  return { ...layers, [key]: !layers[key] };
}

const uniq = (list) => [...new Set(list)];
const ids = (list) => (list || []).map((x) => (typeof x === 'object' && x ? x.eid : x)).filter((x) => x != null);

/** 상세(.rdiff) → 범주별 ID. 변경 요소 = 연결·PID·카드·방향/오프셋 등, 변경 강체 = 독립·종속·그 밖. */
export function diffSets(detail) {
  const el = detail?.elements || {};
  const nd = detail?.nodes || {};
  const rg = detail?.rigids || {};
  return {
    elements: {
      added: ids(el.added), removed: ids(el.removed),
      changed: uniq([...ids(el.conn), ...ids(el.pid), ...ids(el.card), ...ids(el.other)]),
    },
    rigids: {
      added: ids(rg.added), removed: ids(rg.removed),
      changed: uniq([...ids(rg.indep), ...ids(rg.dep), ...ids(rg.other)]),
    },
    nodes: { added: ids(nd.added), removed: ids(nd.removed), moved: ids(nd.moved) },
    spc: ids(detail?.loads?.spc_nodes),
    truncated: detail?.truncated || {},
  };
}

/** 오름차순 node_ids 에서 ID 의 순번(없으면 -1). */
export function nodeIndexOf(nodeIds, id) {
  let lo = 0; let hi = (nodeIds?.length || 0) - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = nodeIds[mid];
    if (v === id) return mid;
    if (v < id) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

function nodeIndices(nodeIds, list) {
  const out = [];
  let missing = 0;
  for (const id of list) {
    const i = nodeIndexOf(nodeIds, id);
    if (i >= 0) out.push(i); else missing += 1;
  }
  return { index: Uint32Array.from(out), missing };
}

const elemId = (blocks, kind, row) => (kind === ELEM_BEAM ? blocks.beams[row * 4] : kind === ELEM_TRI ? blocks.tris[row * 5] : blocks.quads[row * 6]);

/**
 * 뒤 판(b) 분류 — 요소 순번마다 0/1/2(elemClass), RBE 순번마다(rigidClass), 절점 순번 목록(added·moved·spc).
 * 같은 EID 가 둘이면(잘못된 덱) 모두 칠한다. found = 실제로 칠한 수, missing = 3D 에 없는 ID 수(솔리드·스프링 등).
 */
export function classifyModel(lbm, geometry, sets, rigids = null) {
  const { blocks } = lbm;
  const total = geometry.total;
  const elemClass = new Uint8Array(total);
  const addE = new Set(sets.elements.added);
  const chgE = new Set(sets.elements.changed);
  const hitA = new Set(); const hitC = new Set();
  if (addE.size || chgE.size) {
    for (let e = 0; e < total; e += 1) {
      const id = elemId(blocks, geometry.elemKind[e], geometry.elemRow[e]);
      if (addE.has(id)) { elemClass[e] = CLS_ADDED; hitA.add(id); } else if (chgE.has(id)) { elemClass[e] = CLS_CHANGED; hitC.add(id); }
    }
  }
  const rc = rigids?.count || 0;
  const rigidClass = new Uint8Array(rc);
  const addR = new Set(sets.rigids.added);
  const chgR = new Set(sets.rigids.changed);
  const hitRA = new Set(); const hitRC = new Set();
  for (let k = 0; k < rc; k += 1) {
    const id = rigids.eid[k];
    if (addR.has(id)) { rigidClass[k] = CLS_ADDED; hitRA.add(id); } else if (chgR.has(id)) { rigidClass[k] = CLS_CHANGED; hitRC.add(id); }
  }
  const nodeIds = blocks.node_ids || new Int32Array(0);
  const added = nodeIndices(nodeIds, sets.nodes.added);
  const moved = nodeIndices(nodeIds, sets.nodes.moved);
  const spc = nodeIndices(nodeIds, sets.spc);
  return {
    elemClass, rigidClass,
    nodes: { added: added.index, moved: moved.index, spc: spc.index },
    found: {
      elementsAdded: hitA.size, elementsChanged: hitC.size, rigidsAdded: hitRA.size, rigidsChanged: hitRC.size,
      nodesAdded: added.index.length, nodesMoved: moved.index.length, spc: spc.index.length,
    },
    missing: {
      elementsAdded: addE.size - hitA.size, elementsChanged: chgE.size - hitC.size,
      rigidsAdded: addR.size - hitRA.size, rigidsChanged: chgR.size - hitRC.size,
      nodesAdded: added.missing, nodesMoved: moved.missing, spc: spc.missing,
    },
  };
}

/** 요소 순번 → 절점 순번(블록에서 바로). */
function nodesOf(blocks, kind, row, out) {
  if (kind === ELEM_BEAM) { out[0] = blocks.beams[row * 4 + 2]; out[1] = blocks.beams[row * 4 + 3]; return 2; }
  if (kind === ELEM_TRI) { for (let k = 0; k < 3; k += 1) out[k] = blocks.tris[row * 5 + 2 + k]; return 3; }
  for (let k = 0; k < 4; k += 1) out[k] = blocks.quads[row * 6 + 2 + k];
  return 4;
}

/**
 * 범주(1 추가·2 변경)마다 인덱스 버퍼 — 기존 공유 위치 버퍼(뷰어 절점 순번)를 그대로 가리킨다.
 * @returns {{1: Buffers, 2: Buffers}} Buffers = { shell(삼각형 ×3), shellElem(삼각형마다 요소 순번), edges(선분 ×2),
 *          beams(선분 ×2), beamElem, count(요소 수) }
 */
export function diffIndexBuffers(lbm, geometry, elemClass) {
  const { blocks } = lbm;
  const total = geometry.total;
  const cnt = { 1: { t: 0, e: 0, b: 0, n: 0 }, 2: { t: 0, e: 0, b: 0, n: 0 } };
  for (let e = 0; e < total; e += 1) {
    const c = elemClass[e];
    if (!c) continue;
    const k = geometry.elemKind[e];
    const s = cnt[c];
    s.n += 1;
    if (k === ELEM_BEAM) s.b += 1;
    else if (k === ELEM_TRI) { s.t += 1; s.e += 3; } else { s.t += 2; s.e += 4; }
  }
  const out = {};
  for (const c of [1, 2]) {
    const s = cnt[c];
    out[c] = {
      count: s.n,
      shell: new Uint32Array(s.t * 3), shellElem: new Int32Array(s.t), edges: new Uint32Array(s.e * 2),
      beams: new Uint32Array(s.b * 2), beamElem: new Int32Array(s.b), at: { t: 0, e: 0, b: 0 },
    };
  }
  const v = [0, 0, 0, 0];
  for (let e = 0; e < total; e += 1) {
    const c = elemClass[e];
    if (!c) continue;
    const o = out[c];
    const n = nodesOf(blocks, geometry.elemKind[e], geometry.elemRow[e], v);
    if (n === 2) {
      o.beams[o.at.b * 2] = v[0]; o.beams[o.at.b * 2 + 1] = v[1]; o.beamElem[o.at.b] = e; o.at.b += 1;
      continue;
    }
    const tris = n === 3 ? [[0, 1, 2]] : [[0, 1, 2], [0, 2, 3]];
    for (const [a, b, d] of tris) {
      o.shell[o.at.t * 3] = v[a]; o.shell[o.at.t * 3 + 1] = v[b]; o.shell[o.at.t * 3 + 2] = v[d];
      o.shellElem[o.at.t] = e; o.at.t += 1;
    }
    for (let i = 0; i < n; i += 1) { o.edges[o.at.e * 2] = v[i]; o.edges[o.at.e * 2 + 1] = v[(i + 1) % n]; o.at.e += 1; }
  }
  for (const c of [1, 2]) delete out[c].at;
  return out;
}

/** 범주마다 RBE 줄(기준 → 다른 절점) 인덱스 + 줄마다 RBE 순번. */
export function rigidIndexBuffers(lbm, rigids, rigidClass) {
  const lines = lbm.blocks.rigid_lines || new Int32Array(0);
  const out = {};
  for (const c of [1, 2]) {
    let n = 0;
    for (let k = 0; k < (rigids?.count || 0); k += 1) if (rigidClass[k] === c) n += rigids.lines[k];
    const segs = new Uint32Array(n * 2);
    const item = new Int32Array(n);
    let at = 0;
    for (let k = 0; k < (rigids?.count || 0); k += 1) {
      if (rigidClass[k] !== c) continue;
      for (let i = rigids.start[k]; i < rigids.start[k] + rigids.lines[k]; i += 1) {
        segs[at * 2] = lines[i * 3 + 1]; segs[at * 2 + 1] = lines[i * 3 + 2]; item[at] = k; at += 1;
      }
    }
    out[c] = { segs, item };
  }
  return out;
}

/**
 * 앞 판(a)의 삭제 요소·강체·절점 — b 뷰어 좌표(= 원래 좌표 − b 의 bbox 중심)로 옮긴 작은 기하.
 * items[k] = { type: 'element'|'rigid', id, nodes: [압축 순번…] } (피킹·강조용). 쓰인 절점만 positions 에 담는다.
 * @returns {{ positions, shell, shellItem, edges, edgeItem, beams, beamItem, rigid, rigidItem, nodes, nodeIds, items, found, missing }}
 */
export function ghostGeometry(lbmA, center, sets) {
  const { blocks } = lbmA;
  const xyz = blocks.node_xyz || new Float32Array(0);
  const remap = new Map();
  const pos = [];
  const use = (i) => {
    let j = remap.get(i);
    if (j == null) {
      j = remap.size;
      remap.set(i, j);
      pos.push(xyz[i * 3] - center[0], xyz[i * 3 + 1] - center[1], xyz[i * 3 + 2] - center[2]);
    }
    return j;
  };
  const items = [];
  const shell = []; const shellItem = []; const edges = []; const edgeItem = []; const beams = []; const beamItem = [];
  const rigid = []; const rigidItem = [];
  const remE = new Set(sets.elements.removed);
  const hitE = new Set();
  if (remE.size) {
    const scan = (rows, width, n) => {
      const count = (rows?.length || 0) / width;
      for (let r = 0; r < count; r += 1) {
        const id = rows[r * width];
        if (!remE.has(id)) continue;
        hitE.add(id);
        const v = [];
        for (let k = 0; k < n; k += 1) v.push(use(rows[r * width + 2 + k]));
        const it = items.length;
        items.push({ type: 'element', id, nodes: v });
        if (n === 2) { beams.push(v[0], v[1]); beamItem.push(it); continue; }
        shell.push(v[0], v[1], v[2]); shellItem.push(it);
        if (n === 4) { shell.push(v[0], v[2], v[3]); shellItem.push(it); }
        for (let i = 0; i < n; i += 1) { edges.push(v[i], v[(i + 1) % n]); edgeItem.push(it); }
      }
    };
    scan(blocks.beams, 4, 2);
    scan(blocks.tris, 5, 3);
    scan(blocks.quads, 6, 4);
  }
  const remR = new Set(sets.rigids.removed);
  const hitR = new Set();
  const lines = blocks.rigid_lines || new Int32Array(0);
  if (remR.size) {
    let cur = null;
    for (let i = 0; i < lines.length / 3; i += 1) {
      const id = lines[i * 3];
      if (!remR.has(id)) { cur = null; continue; }
      if (!cur || cur.id !== id) {
        cur = { type: 'rigid', id, nodes: [use(lines[i * 3 + 1])] };
        items.push(cur);
        hitR.add(id);
      }
      const o = use(lines[i * 3 + 2]);
      cur.nodes.push(o);
      rigid.push(cur.nodes[0], o); rigidItem.push(items.length - 1);
    }
  }
  const nodeIds = blocks.node_ids || new Int32Array(0);
  const nodes = []; const removedIds = [];
  let nodeMissing = 0;
  for (const id of sets.nodes.removed) {
    const i = nodeIndexOf(nodeIds, id);
    if (i < 0) { nodeMissing += 1; continue; }
    nodes.push(use(i)); removedIds.push(id);
  }
  return {
    positions: Float32Array.from(pos),
    shell: Uint32Array.from(shell), shellItem: Int32Array.from(shellItem),
    edges: Uint32Array.from(edges), edgeItem: Int32Array.from(edgeItem),
    beams: Uint32Array.from(beams), beamItem: Int32Array.from(beamItem),
    rigid: Uint32Array.from(rigid), rigidItem: Int32Array.from(rigidItem),
    nodes: Uint32Array.from(nodes), nodeIds: removedIds, items,
    found: { elements: hitE.size, rigids: hitR.size, nodes: nodes.length },
    missing: { elements: remE.size - hitE.size, rigids: remR.size - hitR.size, nodes: nodeMissing },
  };
}

/** 요소 순번 → EID(뒤 판 블록에서). */
export const elementIdAt = (lbm, geometry, index) => elemId(lbm.blocks, geometry.elemKind[index], geometry.elemRow[index]);

/** 판 변경 보기 주소(07 비교 화면 안의 보기 하나). */
export const diffHref = (a, b) => `/compare?ids=${a},${b}&view=diff`;

/**
 * 전후 값(API item) → 엔진 '이동 전' 표시(setDiffFocus) — 뷰어 좌표(b 의 bbox 중심을 뺀 값).
 * 이동한 절점: 이동 전 위치 고리 + 이동 화살표. 연결·좌표가 바뀐 요소·강체: 앞 판 모양을 점선으로. 그 밖 null.
 */
export function focusFromItem(item, center) {
  if (!item?.a || !item?.b) return null;
  const sub = (p) => [p[0] - center[0], p[1] - center[1], p[2] - center[2]];
  const ch = new Set(item.changes || []);
  if (item.kind === 'node') {
    if (!ch.has('xyz')) return null;
    const from = sub(item.a.xyz);
    return { points: from, arrow: { from, to: sub(item.b.xyz) } };
  }
  if (item.kind === 'element' && (ch.has('nodes') || ch.has('coords')) && item.a.coords?.length >= 2) {
    const p = item.a.coords.map(sub);
    const segs = [];
    const m = p.length === 2 ? 1 : p.length;
    for (let i = 0; i < m; i += 1) segs.push(...p[i], ...p[(i + 1) % p.length]);
    return { segs, points: p.flat() };
  }
  if (item.kind === 'rigid' && (ch.has('others') || ch.has('center')) && item.a.center_xyz) {
    return { points: sub(item.a.center_xyz) };
  }
  return null;
}

/**
 * 한 번에 엔진 spec 만들기 — 분류 · 인덱스 버퍼 · 강체 · 고스트 · 맞춤 절점 · 범례. ms = 걸린 시간(성능 기록).
 * modelB = useModelViewer 의 model({ lbm, geometry, rigids }), lbmA = 앞 판 lbm(못 읽었으면 null — 삭제는 빠진다).
 */
export function buildDiffSpec(modelB, lbmA, detail, { now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) } = {}) {
  const t0 = now();
  const sets = diffSets(detail);
  const cls = classifyModel(modelB.lbm, modelB.geometry, sets, modelB.rigids);
  const buffers = diffIndexBuffers(modelB.lbm, modelB.geometry, cls.elemClass);
  const rigid = rigidIndexBuffers(modelB.lbm, modelB.rigids, cls.rigidClass);
  const ghost = lbmA ? ghostGeometry(lbmA, modelB.geometry.center, sets) : null;
  const frameNodes = changedNodeIndices(modelB.lbm, modelB.geometry, cls);
  const legend = diffLegend(sets, cls, ghost, { totalElements: modelB.geometry.total, limit: detail?.limits?.ids || 5000 });
  if (!ghost) {
    const removed = sets.elements.removed.length + sets.rigids.removed.length + sets.nodes.removed.length;
    legend.find((r) => r.key === 'removed').missing = removed;
  }
  return {
    spec: { elemClass: cls.elemClass, buffers, rigid, nodes: cls.nodes, ghost, frameNodes },
    sets, cls, legend, ms: Math.round((now() - t0) * 10) / 10,
  };
}

const num = (v) => Number(v || 0).toLocaleString('ko-KR');

/** 잘린 목록 문구 — '연결 변경 12,000개 중 5,000개만 표시'. */
const TRUNC_NAMES = {
  'elements.added': '추가 요소', 'rigids.added': '추가 강체', 'nodes.added': '추가 절점',
  'elements.conn': '연결 변경', 'elements.pid': 'PID 변경', 'elements.card': '카드 변경', 'elements.other': '방향·오프셋 등 변경',
  'rigids.indep': '강체 독립 절점 변경', 'rigids.dep': '강체 종속 절점 변경', 'rigids.other': '강체 그 밖 변경',
  'elements.removed': '삭제 요소', 'rigids.removed': '삭제 강체', 'nodes.removed': '삭제 절점',
  'nodes.moved': '이동한 절점', 'loads.spc_nodes': '구속이 바뀐 절점',
};
const LAYER_TRUNC = {
  added: ['elements.added', 'rigids.added', 'nodes.added'],
  changed: ['elements.conn', 'elements.pid', 'elements.card', 'elements.other', 'rigids.indep', 'rigids.dep', 'rigids.other'],
  removed: ['elements.removed', 'rigids.removed', 'nodes.removed'],
  moved: ['nodes.moved'],
  spc: ['loads.spc_nodes'],
};

export function truncNotes(truncated, key, limit = 5000) {
  return (LAYER_TRUNC[key] || []).filter((k) => truncated?.[k]).map((k) => `${TRUNC_NAMES[k]} ${num(truncated[k])}개 중 ${num(limit)}개만 표시`);
}

/**
 * 범례 행 — [{ key, label, shape, count, parts: '요소 3 · 강체 1', notes: [잘림 문구], missing }].
 * count = 3D 에 실제로 칠한 수. 변경 없음은 b 의 요소 수 − 칠한 요소 수.
 */
export function diffLegend(sets, cls, ghost, { totalElements = 0, limit = 5000 } = {}) {
  const f = cls?.found || {};
  const m = cls?.missing || {};
  const gf = ghost?.found || {};
  const gm = ghost?.missing || {};
  const parts = (pairs) => pairs.filter(([, n]) => n > 0).map(([l, n]) => `${l} ${num(n)}`).join(' · ');
  const row = (key, pairs, missing) => {
    const count = pairs.reduce((s, [, n]) => s + (n || 0), 0);
    return { key, label: LAYER_LABELS[key], shape: LAYER_SHAPES[key], count, parts: parts(pairs),
             notes: truncNotes(sets?.truncated, key, limit), missing };
  };
  const drawn = (f.elementsAdded || 0) + (f.elementsChanged || 0);
  return [
    row('added', [['요소', f.elementsAdded], ['강체', f.rigidsAdded], ['절점', f.nodesAdded]],
      (m.elementsAdded || 0) + (m.rigidsAdded || 0) + (m.nodesAdded || 0)),
    row('changed', [['요소', f.elementsChanged], ['강체', f.rigidsChanged]], (m.elementsChanged || 0) + (m.rigidsChanged || 0)),
    row('removed', [['요소', gf.elements], ['강체', gf.rigids], ['절점', gf.nodes]],
      (gm.elements || 0) + (gm.rigids || 0) + (gm.nodes || 0)),
    row('moved', [['절점', f.nodesMoved]], m.nodesMoved || 0),
    row('spc', [['절점', f.spc]], m.spc || 0),
    { key: 'unchanged', label: LAYER_LABELS.unchanged, shape: 'dim', count: Math.max(0, totalElements - drawn),
      parts: `요소 ${num(Math.max(0, totalElements - drawn))}`, notes: [], missing: 0 },
  ];
}

/** 바뀐 것이 하나라도 그려졌는가(바뀐 곳으로 맞춤·빈 안내). */
export const hasDrawn = (legend) => legend.some((r) => r.key !== 'unchanged' && r.count > 0);

/** 바뀐 것의 절점 순번(b) — '바뀐 곳으로 맞춤'. 고스트는 압축 좌표라 따로 준다. */
export function changedNodeIndices(lbm, geometry, cls) {
  const out = new Set();
  const v = [0, 0, 0, 0];
  for (let e = 0; e < geometry.total; e += 1) {
    if (!cls.elemClass[e]) continue;
    const n = nodesOf(lbm.blocks, geometry.elemKind[e], geometry.elemRow[e], v);
    for (let i = 0; i < n; i += 1) out.add(v[i]);
  }
  for (const k of ['added', 'moved', 'spc']) for (const i of cls.nodes[k]) out.add(i);
  return [...out];
}

/** 전후 값 카드의 범주 이름(API status → 글자). */
export const STATUS_LABELS = { added: '추가', removed: '삭제', changed: '변경', same: '변경 없음', missing: '두 판에 없음' };
export const STATUS_LAYER = { added: 'added', removed: 'removed', changed: 'changed', same: 'unchanged', missing: 'unchanged' };

/** 전후 값 카드 행 — [{ label, a, b, changed }]. API(item) 응답 → 표. */
export function itemRows(item) {
  if (!item) return [];
  const a = item.a || {};
  const b = item.b || {};
  const ch = new Set(item.changes || []);
  const fmtXyz = (p) => (p ? p.map((x) => +Number(x).toPrecision(7)).join(', ') : '—');
  const list = (l) => (l?.length ? l.join(' · ') : '—');
  const val = (x) => (x == null || x === '' ? '—' : String(x));
  const rows = [];
  const add = (label, key, f, changed = ch.has(key)) => {
    const va = item.a ? f(a) : '—';
    const vb = item.b ? f(b) : '—';
    rows.push({ label, a: va, b: vb, changed: item.a && item.b ? changed || va !== vb : false });
  };
  if (item.kind === 'node') {
    add('좌표', 'xyz', (x) => fmtXyz(x.xyz));
    return rows;
  }
  add('카드', 'card', (x) => val(x.card));
  if (item.kind === 'rigid') {
    add('기준 절점', 'center', (x) => val(x.center));
    add('연결 절점', 'others', (x) => list(x.others));
    return rows;
  }
  if (a.pid != null || b.pid != null) add('PID', 'pid', (x) => val(x.pid));
  add('절점 연결', 'nodes', (x) => list(x.nodes));
  const coords = (x) => (x.coords || []).map(fmtXyz).join(' / ');
  add('절점 좌표', 'coords', coords, ch.has('coords') || ch.has('nodes'));
  if (a.orient || b.orient) add('방향 벡터', 'orient', (x) => (x.orient ? fmtXyz(x.orient) : '—'));
  if (a.offsets || b.offsets) add('오프셋', 'offsets', (x) => (x.offsets ? fmtXyz(x.offsets) : '—'));
  if (a.mass != null || b.mass != null) add('질량', 'mass', (x) => val(x.mass));
  return rows;
}

/** 상세 목록 이름 → 사람 문구(전후 값 카드 아래 '바뀐 이유'). */
export const DETAIL_LABELS = {
  'elements.added': '추가된 요소', 'elements.removed': '삭제된 요소', 'elements.conn': '절점 연결 변경',
  'elements.pid': 'PID 변경', 'elements.card': '카드 종류 변경', 'elements.other': '방향 벡터·오프셋·직접 입력 값 변경',
  'mass.added': '추가된 질량', 'mass.removed': '삭제된 질량', 'mass.changed': '질량 변경',
  'nodes.added': '추가된 절점', 'nodes.removed': '삭제된 절점', 'nodes.moved': '이동한 절점', 'loads.spc_nodes': '구속(SPC) 변경',
  'rigids.added': '추가된 강체', 'rigids.removed': '삭제된 강체', 'rigids.indep': '독립 절점 변경',
  'rigids.dep': '종속 절점 변경', 'rigids.other': '그 밖 칸 변경',
};

export function detailReasons(detail) {
  const out = [];
  for (const [k, v] of Object.entries(detail || {})) {
    if (k === 'move' || !DETAIL_LABELS[k]) continue;
    if (k === 'rigids.dep' && v && typeof v === 'object') {
      const add = v.added_ids?.length ? ` +${v.added_ids.join(' ')}` : '';
      const rem = v.removed_ids?.length ? ` −${v.removed_ids.join(' ')}` : '';
      out.push(`${DETAIL_LABELS[k]}${add}${rem}`);
    } else {
      out.push(DETAIL_LABELS[k]);
    }
  }
  return out;
}
