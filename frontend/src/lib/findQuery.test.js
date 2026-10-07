import { FIND_MAX_IDS, parseFindQuery, runFind } from './findQuery.js';
import { buildGeometry } from './modelGeometry.js';
import { createIdIndex, listRigids } from './modelIndex.js';
import { sampleModelV2 } from '../test/modelFixtures.js';

test('목록·범위·머리글자', () => {
  expect(parseFindQuery('101, 105 200-203', 'node')).toEqual({ kind: 'node', ids: [101, 105, 200, 201, 202, 203], invalid: [], truncated: false });
  expect(parseFindQuery('e 20', 'node').kind).toBe('element');
  expect(parseFindQuery('R30', 'node')).toMatchObject({ kind: 'rigid', ids: [30] });
  expect(parseFindQuery('7 - 5', 'element').ids).toEqual([5, 6, 7]);
  expect(parseFindQuery('12 abc', 'node')).toMatchObject({ ids: [12], invalid: ['abc'] });
  expect(parseFindQuery('', 'node').ids).toEqual([]);
  const big = parseFindQuery('1-100000', 'node');
  expect(big.ids.length).toBe(FIND_MAX_IDS);
  expect(big.truncated).toBe(true);
});

test('색인으로 풀기 — 절점·요소·RBE, 없는 번호', () => {
  const m = sampleModelV2();
  const g = buildGeometry(m);
  const idx = createIdIndex(m, g, listRigids(m));
  expect(runFind(idx, '101 113 999', 'node')).toMatchObject({
    kind: 'node', found: [{ id: 101, index: 0 }, { id: 113, index: 12 }], missing: [999],
  });
  expect(runFind(idx, 'e20', 'node').found).toEqual([{ kind: 'element', id: 20, index: 5 }]);
  expect(runFind(idx, '30', 'rigid').found[0].index).toBe(0);
  expect(idx.range('node')).toEqual({ min: 101, max: 113, count: 13 });
  expect(idx.range('element')).toEqual({ min: 1, max: 20, count: 6 });
});
