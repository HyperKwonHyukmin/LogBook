import { planSections } from './sectionPlan.js';
import { buildGeometry } from './modelGeometry.js';
import { sampleModel, sampleModelV2 } from '../test/modelFixtures.js';

test('PID·카드·단면별 묶음, 단면 없는 범위는 선으로', () => {
  const m = sampleModelV2();
  const plan = planSections(m, buildGeometry(m));
  expect(plan.beams).toBe(5);
  expect(plan.buckets.map((b) => [b.pid, b.card, b.section.type, Array.from(b.rows)])).toEqual([
    [1, 'CBEAM', 'L', [0]], [2, 'CBEAM', 'I', [1]], [3, 'CBAR', 'T', [2]], [4, 'CBAR', 'BOX', [3]], [6, 'CBEAM', 'TUBE', [4]],
  ]);
  expect(plan.ranges.get(1)).toEqual([{ sectioned: true, type: 'L' }]);
  expect(plan.ranges.get(5)).toEqual([]);
});

test('CONROD 는 요소마다 A, 하나라도 없으면 범위 전체가 선', () => {
  const m = sampleModel();
  m.blocks.beams = new Int32Array([10, 0, 0, 1, 11, 0, 1, 2]);
  m.blocks.beam_cards = new Uint8Array([3, 3]);
  m.header.conrods = { 10: { A: Math.PI * 4 }, 11: { A: Math.PI } };
  let plan = planSections(m, buildGeometry(m));
  expect(plan.buckets.map((b) => b.section.dims[0])).toEqual([2, 1]);
  m.header.conrods = { 10: { A: Math.PI * 4 } };
  plan = planSections(m, buildGeometry(m));
  expect(plan.buckets).toEqual([]);
  expect(plan.ranges.get(0)).toEqual([{ sectioned: false, type: 'LINE' }]);
});
