import { characteristicRows, formatDelta, propertyCell, propertyDiffRows } from './compareTable.js';

const A = {
  id: 1, name: 'rev1.bdf', pidCount: 3, groupCount: 1,
  summary: { counts: { CBEAM: 10, CQUAD4: 4, GRID: 20 }, bbox: { min: [0, 0, 0], max: [1000, 500, 200] }, sol: '101', warnings: [],
             solve: { state: 'pass', warning_count: 0 } },
  properties: { 1: { card: 'PBEAML', mid: 1, type: 'L', dims: [100, 100, 10, 10] }, 5: { card: 'PSHELL', mid: 1, t: 12 } },
};
const B = {
  id: 2, name: 'rev2.bdf', pidCount: 4, groupCount: 2,
  summary: { counts: { CBEAM: 11, CQUAD4: 4, RBE2: 1, GRID: 22 }, bbox: { min: [0, 0, 0], max: [1000, 500, 250] }, sol: '101',
             warnings: ['w'], solve: null },
  properties: { 1: { card: 'PBEAML', mid: 1, type: 'L', dims: [100, 100, 12, 12] }, 5: { card: 'PSHELL', mid: 1, t: 12 },
                7: { card: 'PROD', mid: 1, A: 50, type: 'ROD', dims: [3.99], approx: true } },
};
const LOADING = { id: 3, name: 'c.bdf', summary: null, pidCount: null, groupCount: null, properties: null };

const row = (rows, key) => rows.find((r) => r.key === key);

test('특성 비교표 — 요소 종류 합집합(GRID 제외), 순서, 차이', () => {
  const rows = characteristicRows([A, B]);
  expect(rows.filter((r) => r.group === 'elements').map((r) => r.label)).toEqual(['CBEAM', 'CQUAD4', 'RBE2']);
  expect(row(rows, 'card:RBE2').cells.map((c) => c.value)).toEqual([0, 1]);
  const beam = row(rows, 'card:CBEAM');
  expect(beam.cells[1]).toMatchObject({ value: 11, differs: true, delta: 1 });
  expect(beam.cells[0]).toMatchObject({ differs: false, delta: null });
  expect(row(rows, 'card:CQUAD4').differs).toBe(false);
  expect(row(rows, 'nodes').cells[1].delta).toBe(2);
  expect(row(rows, 'size:Z').cells.map((c) => c.value)).toEqual([200, 250]);
  expect(row(rows, 'size:X').differs).toBe(false);
  expect(row(rows, 'sol').differs).toBe(false);
  expect(row(rows, 'pids').cells[1].delta).toBe(1);
  expect(row(rows, 'groups').cells[1].differs).toBe(true);
  expect(row(rows, 'warnings').cells.map((c) => c.value)).toEqual([0, 1]);
  expect(row(rows, 'solve').cells.map((c) => c.value)).toEqual(['해석 가능', '미검증']);
  expect(row(rows, 'solve').cells[1].differs).toBe(true);
});

test('기준 모델을 바꾸면 차이 부호가 바뀐다', () => {
  const rows = characteristicRows([A, B], 1);
  expect(row(rows, 'card:CBEAM').cells[0]).toMatchObject({ differs: true, delta: -1 });
  expect(row(rows, 'card:CBEAM').cells[1].differs).toBe(false);
});

test('아직 모르는 모델은 null 이고 차이로 세지 않는다', () => {
  const rows = characteristicRows([A, LOADING]);
  expect(row(rows, 'card:CBEAM').cells[1]).toEqual({ value: null, differs: false, delta: null });
  expect(rows.every((r) => !r.differs)).toBe(true);
});

test('차이 글자', () => {
  expect(formatDelta(12)).toBe('+12');
  expect(formatDelta(-3)).toBe('−3');
  expect(formatDelta(0)).toBe('0');
  expect(formatDelta(1234.56)).toBe('+1,234.6');
  expect(formatDelta(null)).toBe('');
});

test('속성 칸', () => {
  expect(propertyCell(undefined)).toMatchObject({ present: false, text: '없음' });
  const c = propertyCell(A.properties[1]);
  expect(c).toMatchObject({ present: true, card: 'PBEAML', type: 'L', mid: 1, text: 'PBEAML L 100x100x10x10' });
  expect(propertyCell(B.properties[7]).approx).toBe(true);
  expect(propertyCell({ ...A.properties[1] }).key).toBe(c.key);
  expect(propertyCell({ ...A.properties[1], mid: 2 }).key).not.toBe(c.key);
});

test('속성 차이 — 합집합, 다른 것만, 한쪽에만 있는 PID', () => {
  const diff = propertyDiffRows([A, B]);
  expect(diff.total).toBe(3);
  expect(diff.changed).toBe(2);
  expect(diff.rows.map((r) => r.pid)).toEqual([1, 7]);
  const r7 = diff.rows[1];
  expect(r7.cells[0]).toMatchObject({ present: false, text: '없음', differs: false });
  expect(r7.cells[1]).toMatchObject({ present: true, differs: true });
  const all = propertyDiffRows([A, B], { diffOnly: false });
  expect(all.rows.map((r) => r.pid)).toEqual([1, 5, 7]);
  expect(all.rows[1].changed).toBe(false);
});

test('속성 차이 — 불러오는 중인 모델은 빈 칸이고 비교에서 빠진다', () => {
  const diff = propertyDiffRows([A, LOADING], { diffOnly: false });
  expect(diff.rows.map((r) => r.pid)).toEqual([1, 5]);
  expect(diff.rows[0].cells[1]).toBeNull();
  expect(diff.changed).toBe(0);
});
