import {
  entriesIn, filterEntries, heatColor, HEAT, hullZoneAt, kindOptions, targetOptions, UNPLACED, zoneCounts,
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

test('겉판 자리 → 구역', () => {
  expect(hullZoneAt(0.05, 0.5)).toBe('선미부');
  expect(hullZoneAt(0.2, 0.05)).toBe('기관실');
  expect(hullZoneAt(0.5, 0.05)).toBe('이중저');
  expect(hullZoneAt(0.5, 0.5)).toBe('화물창');
  expect(hullZoneAt(0.95, 0.5)).toBe('선수부');
});

test('구역이 여럿인 자료는 칸마다 세고, 자리 없는 자료는 따로', () => {
  const s = zoneCounts(ENTRIES);
  expect(s.counts['상갑판']).toBe(2);
  expect(s.counts['기관실']).toBe(1);
  expect(s.counts['화물창']).toBe(0);
  expect(s.unplaced).toBe(3);
  expect(s.max).toBe(2);
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

test('거르기 목록은 많은 값부터', () => {
  expect(kindOptions(ENTRIES, KINDS)).toEqual([{ value: 'LNG', count: 3 }, { value: 'VLCC', count: 1 }]);
  expect(targetOptions(ENTRIES)[0]).toEqual({ value: 'Unit', count: 2 });
});

test('색 — 0건은 무채색, 최대는 가장 진함', () => {
  expect(heatColor(0, 10)).toBe(HEAT.empty);
  expect(heatColor(10, 10).toLowerCase()).toBe(HEAT.high.toLowerCase());
  expect(heatColor(1, 10).toLowerCase()).toBe(HEAT.low.toLowerCase());
  expect(heatColor(1, 1).toLowerCase()).toBe(HEAT.high.toLowerCase());
});
