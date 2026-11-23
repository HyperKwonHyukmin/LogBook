import { NODE_FREE, NODE_ORPHAN, NODE_SHARED, classifyNodes, nodesOfClass } from './nodeCheck.js';
import { sampleModel, sampleModelV2 } from '../test/modelFixtures.js';

test('자유단 1연결 · 고립 0연결 · 공유 2+ · RBE 절점은 공유', () => {
  const c = classifyNodes(sampleModelV2());
  expect(c.counts).toEqual({ shared: 4, free: 8, orphan: 1 });
  expect(c.cls[1]).toBe(NODE_SHARED);     // 1D 둘 + 쉘
  expect(c.degree[1]).toBe(3);
  expect(c.cls[0]).toBe(NODE_FREE);
  expect(c.cls[11]).toBe(NODE_SHARED);    // RBE 종속(요소 0개)
  expect(c.cls[12]).toBe(NODE_ORPHAN);
  expect(nodesOfClass(c, NODE_FREE, 3)).toEqual([0, 3, 4]);
});

test('솔리드 겉면은 세지 않고 solid_nodes 로 센다 — 속 절점이 고립이 되지 않게', () => {
  const m = sampleModel();
  m.header.cards.tri = [...m.header.cards.tri, 'CTETRA'];
  m.blocks.tri_cards = new Uint8Array([3]);                 // 삼각형(2-3-5)이 솔리드 겉면
  m.blocks.solid_nodes = new Int32Array([1, 2, 2, 2, 4, 1]);  // 절점 순번 1, 2 는 솔리드 2개, 4 는 1개
  const c = classifyNodes(m);
  expect(Array.from(c.degree)).toEqual([2, 4, 3, 1, 1]);
});
