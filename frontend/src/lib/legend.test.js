import { legendItems } from './legend.js';
import { buildGeometry } from './modelGeometry.js';
import { elementTable } from './modelIndex.js';
import { computeGroups } from './modelGroups.js';
import { sampleModelV2 } from '../test/modelFixtures.js';

function setup() {
  const m = sampleModelV2();
  const g = buildGeometry(m);
  const groups = computeGroups(m);
  return { table: elementTable(m, g), elemGroup: groups.elemGroup, groupCount: groups.count };
}

test('PID 범례 — 개수와 숨김', () => {
  const s = setup();
  const l = legendItems({ ...s, mode: 'pid', hiddenPids: new Set([4]) });
  expect(l.items.map((i) => [i.label, i.count, i.hidden])).toEqual([
    ['PID 1', 1, false], ['PID 2', 1, false], ['PID 3', 1, false], ['PID 4', 1, true], ['PID 5', 1, false], ['PID 6', 1, false],
  ]);
});

test('그룹·단면·요소 종류 범례', () => {
  const s = setup();
  const g = legendItems({ ...s, mode: 'group', hiddenGroups: new Set([1]) });
  expect(g.items.map((i) => [i.label, i.count, i.hidden])).toEqual([['그룹 1', 4, false], ['그룹 2', 1, true], ['그룹 3', 1, false]]);
  const sec = legendItems({ ...s, mode: 'section' });
  expect(sec.items.map((i) => [i.label, i.count])).toEqual([['L', 1], ['I', 1], ['T', 1], ['BOX', 1], ['TUBE', 1], ['쉘', 1]]);
  const type = legendItems({ ...s, mode: 'type', hiddenPids: new Set([1, 2, 6]) });
  expect(type.items.map((i) => [i.label, i.count, i.visible, i.hidden])).toEqual([['CBAR', 2, 2, false], ['CBEAM', 3, 0, true], ['CQUAD4', 1, 1, false]]);
});

test('항목이 많으면 외 n개', () => {
  const pid = new Int32Array(15).map((_, i) => i + 1);
  const table = { pid, card: new Uint8Array(15), cards: ['CBAR'], section: new Uint8Array(15) };
  const l = legendItems({ table, elemGroup: new Int32Array(15), mode: 'pid' });
  expect(l.items).toHaveLength(10);
  expect(l.rest).toEqual({ count: 5, elements: 5 });
});

