import { buildGeometry } from './modelGeometry.js';
import { listRigids } from './modelIndex.js';
import {
  CLS_ADDED, CLS_CHANGED, DEFAULT_LAYERS, buildDiffSpec, changedNodeIndices, classifyModel, detailReasons, diffHref,
  diffIndexBuffers, diffLegend, diffSets, elementIdAt, focusFromItem, ghostGeometry, hasDrawn, itemRows, nodeIndexOf,
  rigidIndexBuffers, toggleLayer, truncNotes,
} from './revisionDiff3d.js';
import { sampleModel } from '../test/modelFixtures.js';

// sampleModel: 절점 1..5 · CBEAM 10(1-2) · CTRIA3 21(2-3-5) · CQUAD4 20(1-2-3-4) · RBE2 30(1→2,3) · RBE3 31(4←1)
// 요소 순번 = 1D → 삼각형 → 사각형 → 0: 10, 1: 21, 2: 20
function modelB() {
  const lbm = sampleModel();
  const geometry = buildGeometry(lbm);
  return { lbm, geometry, rigids: listRigids(lbm) };
}

const DETAIL = {
  limits: { ids: 5000 },
  nodes: { added: [5], removed: [3], moved: [2] },
  elements: { added: [10], removed: [21], conn: [20], pid: [{ eid: 20, a: '5', b: '6' }], card: [], other: [999] },
  rigids: { added: [], removed: [30], indep: [], dep: [{ eid: 31, card: 'RBE3', added: 1, removed: 0 }], other: [] },
  loads: { spc_nodes: [1, 77] },
  truncated: { 'elements.conn': 12000 },
};

test('diffSets — 범주 묶기(변경 = 연결·PID·카드·그 밖, 중복 없이)', () => {
  const s = diffSets(DETAIL);
  expect(s.elements).toEqual({ added: [10], removed: [21], changed: [20, 999] });
  expect(s.rigids).toEqual({ added: [], removed: [30], changed: [31] });
  expect(s.nodes).toEqual({ added: [5], removed: [3], moved: [2] });
  expect(s.spc).toEqual([1, 77]);
  expect(diffSets(null).elements.added).toEqual([]);
});

test('nodeIndexOf — 오름차순 ID 이분 탐색', () => {
  const ids = Int32Array.from([2, 5, 9, 40]);
  expect([2, 5, 9, 40, 1, 6, 41].map((x) => nodeIndexOf(ids, x))).toEqual([0, 1, 2, 3, -1, -1, -1]);
  expect(nodeIndexOf(null, 3)).toBe(-1);
});

test('classifyModel — ID 목록 → 요소·강체 범주 버퍼 + 절점 순번, 3D 에 없는 수', () => {
  const m = modelB();
  const c = classifyModel(m.lbm, m.geometry, diffSets(DETAIL), m.rigids);
  expect([...c.elemClass]).toEqual([CLS_ADDED, 0, CLS_CHANGED]);
  expect([...c.rigidClass]).toEqual([0, CLS_CHANGED]);
  expect([...c.nodes.added]).toEqual([4]);
  expect([...c.nodes.moved]).toEqual([1]);
  expect([...c.nodes.spc]).toEqual([0]);
  expect(c.found).toMatchObject({ elementsAdded: 1, elementsChanged: 1, rigidsChanged: 1, nodesAdded: 1, nodesMoved: 1, spc: 1 });
  expect(c.missing).toMatchObject({ elementsChanged: 1, spc: 1, elementsAdded: 0 });
  expect(elementIdAt(m.lbm, m.geometry, 2)).toBe(20);
});

test('diffIndexBuffers — 범주마다 공유 위치를 가리키는 인덱스(쉘 삼각형·테두리·1D)', () => {
  const m = modelB();
  const b = diffIndexBuffers(m.lbm, m.geometry, Uint8Array.from([1, 0, 2]));
  expect([...b[1].beams]).toEqual([0, 1]);
  expect([...b[1].beamElem]).toEqual([0]);
  expect(b[1].shell.length).toBe(0);
  expect([...b[2].shell]).toEqual([0, 1, 2, 0, 2, 3]);
  expect([...b[2].shellElem]).toEqual([2, 2]);
  expect([...b[2].edges]).toEqual([0, 1, 1, 2, 2, 3, 3, 0]);
  expect(b[2].count).toBe(1);
});

test('rigidIndexBuffers — 범주 강체의 줄', () => {
  const m = modelB();
  const r = rigidIndexBuffers(m.lbm, m.rigids, Uint8Array.from([1, 2]));
  expect([...r[1].segs]).toEqual([0, 1, 0, 2]);
  expect([...r[1].item]).toEqual([0, 0]);
  expect([...r[2].segs]).toEqual([3, 0]);
});

test('ghostGeometry — 앞 판 삭제 요소·강체·절점을 b 좌표로, 쓰인 절점만', () => {
  const a = sampleModel();
  const g = ghostGeometry(a, [500, 500, 250], diffSets(DETAIL));
  // 삼각형 21(절점 순번 1,2,4) → 압축 0,1,2 / RBE2 30(0→1,2) → 기준 0 은 새 3, 1·2 는 그대로 / 절점 3(순번 2) 재사용
  expect([...g.shell]).toEqual([0, 1, 2]);
  expect([...g.edges]).toEqual([0, 1, 1, 2, 2, 0]);
  expect([...g.rigid]).toEqual([3, 0, 3, 1]);
  expect([...g.nodes]).toEqual([1]);
  expect(g.nodeIds).toEqual([3]);
  expect(g.items.map((x) => [x.type, x.id])).toEqual([['element', 21], ['rigid', 30]]);
  expect([...g.positions.slice(0, 3)]).toEqual([500, -500, -250]);   // 절점 2 (1000,0,0) − 중심
  expect(g.found).toEqual({ elements: 1, rigids: 1, nodes: 1 });
  expect(g.missing).toEqual({ elements: 0, rigids: 0, nodes: 0 });
});

test('범례 — 범주별 칠한 수 · 잘림 문구 · 3D 에 없는 수 · 변경 없음', () => {
  const m = modelB();
  const sets = diffSets(DETAIL);
  const cls = classifyModel(m.lbm, m.geometry, sets, m.rigids);
  const ghost = ghostGeometry(sampleModel(), m.geometry.center, sets);
  const rows = diffLegend(sets, cls, ghost, { totalElements: m.geometry.total });
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  expect(by.added).toMatchObject({ count: 2, parts: '요소 1 · 절점 1', missing: 0 });
  expect(by.changed).toMatchObject({ count: 2, parts: '요소 1 · 강체 1', missing: 1 });
  expect(by.changed.notes).toEqual(['연결 변경 12,000개 중 5,000개만 표시']);
  expect(by.removed).toMatchObject({ count: 3, parts: '요소 1 · 강체 1 · 절점 1' });
  expect(by.moved.count).toBe(1);
  expect(by.spc).toMatchObject({ count: 1, missing: 1 });
  expect(by.unchanged.count).toBe(1);
  expect(hasDrawn(rows)).toBe(true);
  expect(truncNotes({ 'nodes.moved': 7000 }, 'moved', 5000)).toEqual(['이동한 절점 7,000개 중 5,000개만 표시']);
});

test('buildDiffSpec — 한 번에 spec·범례, 앞 판이 없으면 삭제는 3D 에 없는 수로', () => {
  const m = modelB();
  const t = [0, 12.34];
  const out = buildDiffSpec(m, sampleModel(), DETAIL, { now: () => t.shift() });
  expect(out.ms).toBe(12.3);
  expect(out.spec.ghost.items).toHaveLength(2);
  expect([...out.spec.elemClass]).toEqual([1, 0, 2]);
  expect(out.spec.frameNodes.sort()).toEqual([0, 1, 2, 3, 4]);
  const noA = buildDiffSpec(m, null, DETAIL);
  expect(noA.spec.ghost).toBeNull();
  expect(noA.legend.find((r) => r.key === 'removed')).toMatchObject({ count: 0, missing: 3 });
  // 바뀐 게 없으면 그릴 것도 없다
  const none = buildDiffSpec(m, sampleModel(), { nodes: {}, elements: {}, rigids: {}, loads: {} });
  expect(hasDrawn(none.legend)).toBe(false);
  expect(changedNodeIndices(m.lbm, m.geometry, classifyModel(m.lbm, m.geometry, diffSets({}), m.rigids))).toEqual([]);
});

test('범주 켜기/끄기 — 변경 없음과 바뀐 것만 보기는 서로 반대', () => {
  let l = toggleLayer(DEFAULT_LAYERS, 'removed');
  expect(l.removed).toBe(false);
  l = toggleLayer(l, 'onlyChanged');
  expect(l).toMatchObject({ onlyChanged: true, unchanged: false });
  l = toggleLayer(l, 'unchanged');
  expect(l).toMatchObject({ onlyChanged: false, unchanged: true });
  expect(DEFAULT_LAYERS.onlyChanged).toBe(false);
});

const ITEM = {
  kind: 'element', id: 3, status: 'changed', changes: ['nodes'], diff_ready: true,
  a: { card: 'CBAR', pid: 7, nodes: [2, 5], coords: [[1000, 0, 0], [0, 0, 500]] },
  b: { card: 'CBAR', pid: 7, nodes: [3, 5], coords: [[1000, 1000, 0], [0, 0, 500]] },
  detail: { 'elements.conn': true },
};

test('전후 값 표 — 카드·PID·연결·좌표, 바뀐 행 표시', () => {
  const rows = itemRows(ITEM);
  expect(rows.map((r) => r.label)).toEqual(['카드', 'PID', '절점 연결', '절점 좌표']);
  expect(rows.find((r) => r.label === '절점 연결')).toEqual({ label: '절점 연결', a: '2 · 5', b: '3 · 5', changed: true });
  expect(rows.find((r) => r.label === 'PID').changed).toBe(false);
  const removed = itemRows({ ...ITEM, status: 'removed', b: null, changes: [] });
  expect(removed[0]).toEqual({ label: '카드', a: 'CBAR', b: '—', changed: false });
  const node = itemRows({ kind: 'node', changes: ['xyz'], a: { xyz: [1000, 0, 0] }, b: { xyz: [1010, 0, 0] } });
  expect(node).toEqual([{ label: '좌표', a: '1000, 0, 0', b: '1010, 0, 0', changed: true }]);
  const rbe = itemRows({ kind: 'rigid', changes: ['others'], a: { card: 'RBE2', center: 5, others: [4] }, b: { card: 'RBE2', center: 5, others: [3, 4] } });
  expect(rbe.map((r) => [r.label, r.changed])).toEqual([['카드', false], ['기준 절점', false], ['연결 절점', true]]);
  expect(detailReasons({ 'rigids.dep': { added_ids: [3], removed_ids: [] }, move: 3, 'elements.pid': {} }))
    .toEqual(['종속 절점 변경 +3', 'PID 변경']);
});

test('이동 전 표시 — 절점 화살표, 연결이 바뀐 요소는 앞 판 모양', () => {
  const c = [500, 500, 250];
  expect(focusFromItem({ kind: 'node', changes: ['xyz'], a: { xyz: [1000, 0, 0] }, b: { xyz: [1010, 0, 0] } }, c))
    .toEqual({ points: [500, -500, -250], arrow: { from: [500, -500, -250], to: [510, -500, -250] } });
  const f = focusFromItem(ITEM, c);
  expect(f.segs).toEqual([500, -500, -250, -500, -500, 250]);
  expect(focusFromItem({ ...ITEM, changes: ['pid'] }, c)).toBeNull();
  expect(focusFromItem({ ...ITEM, b: null }, c)).toBeNull();
  expect(diffHref(4, 5)).toBe('/compare?ids=4,5&view=diff');
});
