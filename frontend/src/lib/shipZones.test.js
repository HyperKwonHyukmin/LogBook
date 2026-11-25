import {
  breadthOf, COMPARTMENTS, entriesIn, filterEntries, heatColor, HEAT, HOLDS, kindOptions, SHIP_ZONES, targetOptions, UNPLACED, zoneCounts,
} from './shipZones.js';

const E = (id, o) => ({ id, title: id, rows: ['h:9001'], zones: [], target: null, confirmed_at: '2026-09', ...o });
const KINDS = { 9001: 'LNG', 9002: 'VLCC' };
const ENTRIES = [
  E('E1', { zones: ['상갑판', '기관실'], target: 'Unit' }),
  E('E2', { zones: ['상갑판'], target: 'Manifold', rows: ['h:9002'] }),
  E('E3', { zones: ['기타'], target: 'Unit' }),
  E('E4', { zones: [], rows: ['c:공용'] }),
  E('E5', { zones: ['정반'] }),   // 목록에 새로 생긴 값 — 그림에 자리 없음
];

test('선체 안의 칸 — 안쪽 구역마다 칸이 있고 화물창은 여러 칸', () => {
  const inside = SHIP_ZONES.filter((z) => z.inside).map((z) => z.name);
  for (const name of inside) expect(COMPARTMENTS.some((c) => c.zone === name)).toBe(true);
  expect(COMPARTMENTS.filter((c) => c.zone === '화물창')).toHaveLength(HOLDS);
  for (const c of COMPARTMENTS) { expect(c.x[0]).toBeLessThan(c.x[1]); expect(c.z[0]).toBeLessThan(c.z[1]); }
  // 길이 방향으로 겹치지 않는다(이중저는 화물창 아래)
  const row = COMPARTMENTS.filter((c) => c.zone !== '이중저').sort((a, b) => a.x[0] - b.x[0]);
  for (let i = 1; i < row.length; i += 1) expect(row[i].x[0]).toBeGreaterThan(row[i - 1].x[1]);
});

test('구역이 여럿인 자료는 칸마다 세고, 자리 없는 자료는 따로', () => {
  const s = zoneCounts(ENTRIES);
  expect(s.counts['상갑판']).toBe(2);
  expect(s.counts['기관실']).toBe(1);
  expect(s.counts['화물창']).toBe(0);
  expect(s.unplaced).toBe(3);
  expect(s.max).toBe(2);
  expect(s.covered).toBe(2);
  expect(s.total).toBe(5);
});

test('선종, 대상으로 거른다', () => {
  expect(filterEntries(ENTRIES, { kind: 'VLCC' }, KINDS).map((e) => e.id)).toEqual(['E2']);
  expect(filterEntries(ENTRIES, { target: 'Unit' }, KINDS).map((e) => e.id)).toEqual(['E1', 'E3']);
  expect(filterEntries(ENTRIES, {}, KINDS)).toHaveLength(5);
});

test('칸 자료 목록 — 자리 없는 칸 포함', () => {
  expect(entriesIn(ENTRIES, '상갑판').map((e) => e.id)).toEqual(['E2', 'E1']);
  expect(entriesIn(ENTRIES, UNPLACED).map((e) => e.id).sort()).toEqual(['E3', 'E4', 'E5']);
});

test('거르기 목록은 많은 값부터, 넓이는 호선과 대상과 선종 수', () => {
  expect(kindOptions(ENTRIES, KINDS)).toEqual([{ value: 'LNG', count: 3 }, { value: 'VLCC', count: 1 }]);
  expect(targetOptions(ENTRIES)[0]).toEqual({ value: 'Unit', count: 2 });
  expect(breadthOf(ENTRIES, KINDS)).toEqual({ hulls: 2, targets: 2, kinds: 2 });
});

test('색 — 0건은 바탕색, 많을수록 밝게', () => {
  expect(heatColor(0, 10)).toBe(HEAT.empty);
  expect(heatColor(1, 10).toLowerCase()).toBe(HEAT.stops[0].toLowerCase());
  expect(heatColor(10, 10).toLowerCase()).toBe(HEAT.stops[2].toLowerCase());
  expect(heatColor(1, 1).toLowerCase()).toBe(HEAT.stops[2].toLowerCase());
});
