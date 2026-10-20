import { buildGrid, headerLines, buildZones, cellKey, listRows, MAX_ZONES, NO_ZONE, OTHER_ZONE, sortRows, todoCells, UNSET_ROW } from './coverage.js';

const E = (id, o) => ({ id, title: id, rows: ['h:9001'], zones: ['정반'], models: 1, reports: 1,
  doc_linked: false, model_linked: false, solve: 'pass', needs_fix: false, unsigned: false, confirmed_at: '2026-09', ...o });

const DATA = {
  hulls: { 9001: 'LNGC', 9002: null },
  zones: ['정반', '블록'],
  entries: [
    E('full'),
    E('noreport', { rows: ['h:9002'], reports: 0 }),
    E('fail', { rows: ['h:9001'], zones: ['블록'], reports: 0, solve: 'fail' }),
    E('doc', { rows: ['h:9002'], zones: ['블록'], models: 0, solve: null, model_linked: true }),
    E('nomodel', { rows: ['c:공용'], models: 0, solve: null }),
    E('unset', { rows: [], zones: [], needs_fix: true }),
  ],
};

test('행은 호선 → 공용 → 미지정, 열은 자료 많은 구역 + 구역 없음', () => {
  const g = buildGrid(DATA);
  expect(g.rows.map((r) => r.key)).toEqual(['h:9001', 'h:9002', 'c:공용', UNSET_ROW]);
  expect(g.rows[0].sub).toBe('LNGC');
  expect(g.rows[1].sub).toBe('선종 미입력');
  expect(g.cols.map((c) => c.key)).toEqual(['정반', '블록', NO_ZONE]);
});

test('칸 상태 — 갖춤 · 문서 없음 · 검증 실패만 · 모델 연결로 갖춤 · 모델 없음 · 비어 있음', () => {
  const g = buildGrid(DATA);
  const st = (r, c) => g.cells.get(cellKey(r, c)).state;
  expect(st('h:9001', '정반')).toBe('full');
  expect(st('h:9002', '정반')).toBe('noreport');
  expect(st('h:9001', '블록')).toBe('fail');
  expect(st('h:9002', '블록')).toBe('full');
  expect(g.cells.get(cellKey('h:9002', '블록')).linkedOnly).toBe(true);
  expect(st('c:공용', '정반')).toBe('nomodel');
  expect(st('c:공용', '블록')).toBe('empty');
  expect(st(UNSET_ROW, NO_ZONE)).toBe('full');
  expect(g.rowFilled.get('h:9001')).toBe(2);
  expect(g.colFilled.get('정반')).toBe(3);
});

test('42 — 해석 종류 거르기는 없다: 옛 analysis_type 이 실려 와도 칸은 그대로 센다', () => {
  const data = { ...DATA, entries: DATA.entries.map((e) => ({ ...e, analysis_type: '권상' })) };
  expect(buildGrid(data).cells.get(cellKey('h:9001', '정반')).state).toBe('full');
  expect(Object.keys(buildGrid(data).counts)).not.toContain('na');
});

test('구역이 많으면 적은 쪽을 기타로 묶는다', () => {
  const zones = Array.from({ length: MAX_ZONES + 3 }, (_, i) => `Z${i}`);
  const cols = buildZones({ zones, entries: [E('a', { zones: [zones.at(-1)] })] });
  expect(cols).toHaveLength(MAX_ZONES + 1);
  expect(cols.at(-1).key).toBe(OTHER_ZONE);
  expect(cols.at(-1).members.has(zones.at(-1))).toBe(true);
});

test('먼저 볼 칸은 검증 실패 → 문서 없음, 정렬과 목록', () => {
  const g = buildGrid(DATA);
  expect(todoCells(g).map((t) => `${t.row.key}|${t.col.key}`)).toEqual(['h:9001|블록', 'h:9002|정반']);
  expect(sortRows(g, DATA, 'gaps')[0].key).not.toBe('h:9001');
  const l = listRows(DATA, null);
  expect(l.no_report.map((e) => e.id)).toEqual(['noreport', 'fail']);
  expect(l.no_model.map((e) => e.id)).toEqual(['nomodel']);       // 다른 자료 모델과 연결된 문서는 빠진다
  expect(l.solve_fail.map((e) => e.id)).toEqual(['fail']);
  expect(l.needs_fix.map((e) => e.id)).toEqual(['unset']);
  const scoped = listRows(DATA, { rowKey: 'h:9002', col: { key: '정반', label: '정반' } });
  expect(scoped.no_report.map((e) => e.id)).toEqual(['noreport']);
});

test('열 머리 두 줄 표기', () => {
  expect(headerLines('데크하우스')).toEqual(['데크', '하우스']);
  expect(headerLines('크레인 받침')).toEqual(['크레인', '받침']);
  expect(headerLines('SidePassage')).toEqual(['SidePassage']);
  expect(headerLines('정반')).toEqual(['정반']);
});

/* ── 44 — 행 기준(선종 · 크기급) × 열 기준(대상) ── */
const DATA44 = {
  hulls: { 9001: '174K LNG', 9002: '174K LNG', 9003: '300K VLCC', 9004: null },
  hull_kinds: { 9001: 'LNG', 9002: 'LNG', 9003: 'VLCC', 9004: null },
  hull_sizes: { 9001: '174K급 LNG', 9002: '174K급 LNG', 9003: '300K급 VLCC', 9004: null },
  zones: ['선수부'], targets: ['계류 의장품', 'Unit'],
  entries: [
    E('a', { rows: ['h:9001'], zones: ['선수부'], target: '계류 의장품' }),
    E('b', { rows: ['h:9002'], zones: [], target: '계류 의장품', reports: 0 }),
    E('c', { rows: ['h:9003'], zones: [], target: 'Unit' }),
    E('d', { rows: ['h:9004', 'h:9001'], zones: [], target: null }),
    E('e', { rows: ['c:공용'], zones: [], target: 'Unit' }),
  ],
};

test('44 — 선종 행 × 대상 열: 호선마다의 선종으로 묶고, 대상 없음 열을 둔다', () => {
  const g = buildGrid(DATA44, { rows: 'kind', cols: 'target' });
  expect(g.rows.map((r) => r.key)).toEqual(['k:LNG', 'k:VLCC', 'k:__none', 'c:공용']);   // 호선 많은 선종 먼저, 값 없음 · 공용은 뒤
  expect(g.rows[0]).toMatchObject({ label: 'LNG', sub: '호선 2척' });
  expect(g.rows[2].label).toBe('선종 없음');
  expect(g.cols.map((c) => c.key)).toEqual(['계류 의장품', 'Unit', '대상 없음']);
  expect(g.cells.get(cellKey('k:LNG', '계류 의장품')).entries.map((e) => e.id)).toEqual(['a', 'b']);   // 두 척이 한 칸
  // 호선 둘(9004 · 9001)인 자료는 선종 없음 · LNG 두 행에
  expect(g.keysOf(DATA44.entries[3])).toEqual(['k:__none', 'k:LNG']);
  expect(g.cells.get(cellKey('k:LNG', '대상 없음')).entries.map((e) => e.id)).toEqual(['d']);
  expect(g.rowLabel).toBe('선종');
  expect(g.colLabel).toBe('대상');
});

test('44 — 크기급 행, 칸만 목록, 기본은 호선 × 구역', () => {
  const g = buildGrid(DATA44, { rows: 'size', cols: 'target' });
  expect(g.rows.map((r) => r.label)).toEqual(['174K급 LNG', '300K급 VLCC', '크기급 없음', '공용']);
  const scoped = listRows(DATA44, { rowKey: 's:174K급 LNG', col: g.cols[0] }, g.keysOf);
  expect(scoped.no_report.map((e) => e.id)).toEqual(['b']);
  const d = buildGrid(DATA44);
  expect(d.axes).toEqual({ rows: 'hull', cols: 'zone' });
  expect(d.rows[0].key).toBe('h:9001');
});
