import { computeGroups } from './modelGroups.js';
import { sampleModel, sampleModelV2 } from '../test/modelFixtures.js';

test('부재·쉘·RBE 연결로 묶고 요소 수 내림차순', () => {
  const g = computeGroups(sampleModelV2());
  expect(g.count).toBe(3);
  expect(g.groups.map((x) => [x.elements, x.nodes, x.rigids])).toEqual([[4, 7, 0], [1, 2, 0], [1, 3, 1]]);
  // 요소 순번 1D 0..4, 사각형 5
  expect(Array.from(g.elemGroup)).toEqual([0, 0, 0, 1, 2, 0]);
  expect(Array.from(g.nodeGroup)).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 2, -1]);
});

test('RBE3 와 쉘도 연결로 센다', () => {
  // sampleModel: CBEAM 0-1, 쉘 0-1-2-3, 1-2-4 → 한 덩어리
  const g = computeGroups(sampleModel());
  expect(g.count).toBe(1);
  expect(g.groups[0]).toMatchObject({ elements: 3, nodes: 5, rigids: 2 });
});

test('같은 크기는 작은 절점 순번이 먼저, 요소 없는 덩어리는 그룹이 아니다', () => {
  const m = sampleModelV2();
  m.blocks.rigid_lines = new Int32Array([30, 11, 12]);  // RBE 가 종속 절점과 고립 절점만 잇는다
  const g = computeGroups(m);
  expect(g.groups.map((x) => x.elements)).toEqual([4, 1, 1]);
  expect(g.nodeGroup[11]).toBe(-1);
  expect(g.nodeGroup[12]).toBe(-1);
  expect(g.nodeGroup[7]).toBe(1);
  expect(g.nodeGroup[9]).toBe(2);
});
