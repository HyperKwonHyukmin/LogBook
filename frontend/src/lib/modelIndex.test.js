import { buildGeometry } from './modelGeometry.js';
import { elementNodeIndices, elementTable, listRigids, rigidNodes } from './modelIndex.js';
import { beamOrientInfo, nodeInfo, rigidInfo } from './elementInfo.js';
import { classifyNodes } from './nodeCheck.js';
import { computeGroups } from './modelGroups.js';
import { sampleModel, sampleModelV2 } from '../test/modelFixtures.js';

test('RBE 목록 — EID 단위로 묶는다', () => {
  const m = sampleModel();
  const r = listRigids(m);
  expect(r.count).toBe(2);
  expect(Array.from(r.eid)).toEqual([30, 31]);
  expect(Array.from(r.kind)).toEqual([0, 1]);
  expect(Array.from(r.lines)).toEqual([2, 1]);
  expect(Array.from(r.ofLine)).toEqual([0, 0, 1]);
  expect(rigidNodes(m, r, 0)).toEqual([0, 1, 2]);
  expect(rigidInfo(m, r, 0)).toEqual({ eid: 30, card: 'RBE2', center: 1, others: [2, 3] });
});

test('요소 절점·요소표·방향 정보·절점 정보', () => {
  const m = sampleModelV2();
  const g = buildGeometry(m);
  expect(elementNodeIndices(m, g, 5)).toEqual([1, 4, 5, 6]);
  const t = elementTable(m, g);
  expect(t.cards).toEqual(['CBEAM', 'CBAR', 'CQUAD4']);
  expect(beamOrientInfo(m, g, 2)).toEqual({ v: '0, 1, 0', offset: 'A (0, 0, 50) · B (0, 0, 50)' });
  expect(beamOrientInfo(m, g, 5)).toBeNull();
  const info = nodeInfo(m, g, 0, { check: classifyNodes(m), groups: computeGroups(m) });
  expect(info).toEqual({ id: 101, xyz: [0, 0, 0], degree: 1, cls: 1, group: 0, spc: 123456, mass: null });
});
