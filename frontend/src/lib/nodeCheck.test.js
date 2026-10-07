import { NODE_FREE, NODE_ORPHAN, NODE_SHARED, classifyNodes, nodesOfClass } from './nodeCheck.js';
import { sampleModelV2 } from '../test/modelFixtures.js';

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
