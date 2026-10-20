/**
 * 갖춤 현황(26) — GET /api/coverage 의 자료 목록을 행 × 열 칸으로 놓는 순수 함수.
 * 44 — 행 기준은 호선 · 선종 · 크기급, 열 기준은 구역 · 대상(관계 지도 35 와 같은 이름). 기본은 호선 × 구역.
 * 42 — 해석 종류 거르기('해당 없음' 칸)는 없앴다.
 */

export const STATES = ['full', 'noreport', 'nomodel', 'fail', 'empty'];
export const STATE_INFO = {
  full: { name: '갖춤', desc: '모델과 문서가 있고, 해석 검증에 실패하지 않았습니다' },
  noreport: { name: '문서 없음', desc: '모델만 있고 보고서·발표자료가 없습니다' },
  nomodel: { name: '모델 없음', desc: '문서만 있고 모델이 없습니다' },
  fail: { name: '검증 실패만', desc: '모델이 모두 해석 검증에 실패했습니다' },
  empty: { name: '비어 있음', desc: '자료가 없습니다' },
};
export const MAX_ZONES = 14;          // 이보다 많은 열 값은 자료 수가 적은 쪽을 '기타' 한 열로 묶는다
export const OTHER_ZONE = '기타';
export const NO_ZONE = '구역 없음';
export const UNSET_ROW = 'x:미지정';

// 44 — 고를 수 있는 기준. 행 = 배 쪽(늘어난다 · 세로로 내린다), 열 = 구조물 쪽(값 수가 정해져 있다 · 화면 폭)
export const ROW_AXES = [{ id: 'hull', label: '호선' }, { id: 'kind', label: '선종' }, { id: 'size', label: '크기급' }];
export const COL_AXES = [{ id: 'zone', label: '구역' }, { id: 'target', label: '대상' }];
export const DEFAULT_AXES = { rows: 'hull', cols: 'zone' };
const ROW_PREFIX = { kind: 'k:', size: 's:' };
const COL_INFO = {
  zone: { values: (d) => d.zones || [], of: (e) => e.zones || [], none: NO_ZONE },
  target: { values: (d) => d.targets || [], of: (e) => (e.target ? [e.target] : []), none: '대상 없음' },
};
export const axisLabel = (list, id) => (list.find((a) => a.id === id) || list[0]).label;

const hullNo = (k) => k.slice(2);

/** 호선 행 열쇠(서버 rows) — 호선 · 공용. 둘 다 없으면 미지정. */
export const rowsOf = (e) => (e.rows?.length ? e.rows : [UNSET_ROW]);

/** 고른 행 기준에서 자료가 놓일 행 열쇠들. 선종 · 크기급은 호선마다의 값을 겹치지 않게(값이 없는 호선은 'none'). */
export function rowKeysFor(data, axis = 'hull') {
  if (axis === 'hull') return rowsOf;
  const map = axis === 'kind' ? data.hull_kinds || {} : data.hull_sizes || {};
  const pre = ROW_PREFIX[axis];
  return (e) => {
    const keys = [];
    for (const k of rowsOf(e)) {
      const key = k.startsWith('h:') ? `${pre}${map[hullNo(k)] || '__none'}` : k;
      if (!keys.includes(key)) keys.push(key);
    }
    return keys;
  };
}

/** 행 목록 — 호선이면 번호 순, 선종 · 크기급이면 호선 수 많은 순(값 없음은 뒤) → 공용 → 미지정. 자료가 있는 행만. */
export function buildRows(data, axis = 'hull') {
  const keysOf = rowKeysFor(data, axis);
  const used = new Set();
  for (const e of data.entries) for (const r of keysOf(e)) used.add(r);
  const rest = [...used].filter((k) => k.startsWith('c:') || k === UNSET_ROW).map((key) => ({
    key, kind: key === UNSET_ROW ? 'unset' : 'common',
    label: key === UNSET_ROW ? '미지정' : key.slice(2), sub: key === UNSET_ROW ? '호선 없음' : '공용 자료',
  }));
  if (axis === 'hull') {
    const hulls = [...used].filter((k) => k.startsWith('h:')).sort((a, b) => hullNo(a).localeCompare(hullNo(b), 'ko', { numeric: true }));
    return [...hulls.map((key) => ({ key, kind: 'hull', label: hullNo(key), sub: data.hulls?.[hullNo(key)] || '선종 미입력' })), ...rest];
  }
  const map = axis === 'kind' ? data.hull_kinds || {} : data.hull_sizes || {};
  const pre = ROW_PREFIX[axis];
  const ships = new Map();   // 행 열쇠 → 그 값의 호선들
  for (const no of Object.keys(data.hulls || {})) {
    const key = `${pre}${map[no] || '__none'}`;
    if (!ships.has(key)) ships.set(key, []);
    ships.get(key).push(no);
  }
  const noneLabel = axis === 'kind' ? '선종 없음' : '크기급 없음';
  const groups = [...used].filter((k) => k.startsWith(pre)).sort((a, b) => (a.endsWith('__none') - b.endsWith('__none'))
    || (ships.get(b)?.length || 0) - (ships.get(a)?.length || 0) || a.localeCompare(b, 'ko'));
  return [...groups.map((key) => ({
    key, kind: axis, none: key.endsWith('__none'),
    label: key.endsWith('__none') ? noneLabel : key.slice(2),
    sub: `호선 ${ships.get(key)?.length || 0}척`, hulls: ships.get(key) || [],
  })), ...rest];
}

/** 열 목록 — 자료 많은 값부터 MAX_ZONES 개, 나머지는 '기타', 값이 없는 자료가 있으면 '○○ 없음'. col.test(e) = 그 열의 자료인가. */
export function buildCols(data, axis = 'zone') {
  const info = COL_INFO[axis] || COL_INFO.zone;
  const values = info.values(data);
  const main = values.slice(0, MAX_ZONES);
  const other = new Set(values.slice(MAX_ZONES));
  const cols = main.map((z) => ({ key: z, label: z, test: (e) => info.of(e).includes(z) }));
  if (other.size) cols.push({ key: OTHER_ZONE, label: OTHER_ZONE, members: other, test: (e) => info.of(e).some((z) => other.has(z)) });
  if (data.entries.some((e) => !info.of(e).length)) cols.push({ key: info.none, label: info.none, test: (e) => !info.of(e).length });
  return cols;
}

/** 구역 열 목록(26 그대로 — buildCols(data, 'zone')). */
export const buildZones = (data) => buildCols(data, 'zone');

/** 옛 구역 열 맞춤(열에 test 가 없을 때). */
export function zoneMatch(e, col) {
  if (col.test) return col.test(e);
  if (col.key === NO_ZONE) return !e.zones?.length;
  if (col.members) return (e.zones || []).some((z) => col.members.has(z));
  return (e.zones || []).includes(col.key);
}

/** 칸 하나의 상태. keysOf = 고른 행 기준의 행 열쇠 함수. */
export function cellOf(data, row, col, keysOf = rowsOf) {
  const entries = data.entries.filter((e) => keysOf(e).includes(row.key) && zoneMatch(e, col));
  const models = entries.filter((e) => e.models > 0);
  const docs = entries.filter((e) => e.reports > 0 || e.doc_linked);
  let state = 'empty';
  let linkedOnly = false;
  if (entries.length) {
    if (models.length && models.every((e) => e.solve === 'fail')) state = 'fail';
    else if (models.length && docs.length) state = 'full';
    else if (models.length) state = 'noreport';
    else if (entries.every((e) => e.model_linked)) { state = 'full'; linkedOnly = true; }
    else state = 'nomodel';
  }
  return { entries, models, docs, state, linkedOnly };
}

/** 격자 전체 — rows × cols 칸, 상태별 칸 수, 행마다 채운 칸 수, 열마다 자료가 있는 행 수. axes = { rows, cols }. */
export function buildGrid(data, axes = DEFAULT_AXES) {
  const a = { ...DEFAULT_AXES, ...axes };
  const keysOf = rowKeysFor(data, a.rows);
  const rows = buildRows(data, a.rows);
  const cols = buildCols(data, a.cols);
  const cells = new Map();
  const counts = { full: 0, noreport: 0, nomodel: 0, fail: 0, empty: 0 };
  const rowFilled = new Map(rows.map((r) => [r.key, 0]));
  const colFilled = new Map(cols.map((c) => [c.key, 0]));
  for (const r of rows) {
    for (const c of cols) {
      const cell = cellOf(data, r, c, keysOf);
      cells.set(`${r.key}|${c.key}`, cell);
      counts[cell.state] += 1;
      if (cell.state !== 'empty') {
        rowFilled.set(r.key, rowFilled.get(r.key) + 1);
        colFilled.set(c.key, colFilled.get(c.key) + 1);
      }
    }
  }
  return { rows, cols, cells, counts, rowFilled, colFilled, keysOf, axes: a,
    rowLabel: axisLabel(ROW_AXES, a.rows), colLabel: axisLabel(COL_AXES, a.cols) };
}

export const cellKey = (rowKey, colKey) => `${rowKey}|${colKey}`;

const latest = (entries) => entries.map((e) => e.confirmed_at || '').sort().pop() || '';

/** 정렬 — hull(기본: 만든 순서) | recent(최근 확정 행 먼저) | gaps(빈 칸 많은 행 먼저). */
export function sortRows(grid, data, mode) {
  const keysOf = grid.keysOf || rowsOf;
  if (mode === 'recent') {
    const last = new Map(grid.rows.map((r) => [r.key, latest(data.entries.filter((e) => keysOf(e).includes(r.key)))]));
    return [...grid.rows].sort((a, b) => last.get(b.key).localeCompare(last.get(a.key)));
  }
  if (mode === 'gaps') return [...grid.rows].sort((a, b) => grid.rowFilled.get(a.key) - grid.rowFilled.get(b.key));
  return grid.rows;
}

/** '먼저 볼 칸' — 검증 실패만 → 문서 없음, 같은 순위면 최근 확정 자료가 있는 칸부터. */
export function todoCells(grid) {
  const out = [];
  for (const r of grid.rows) {
    for (const c of grid.cols) {
      const cell = grid.cells.get(cellKey(r.key, c.key));
      if (cell.state === 'fail') out.push({ row: r, col: c, cell, rank: 0, why: `모델 ${cell.models.length}개가 모두 검증 실패` });
      else if (cell.state === 'noreport') out.push({ row: r, col: c, cell, rank: 1, why: `모델 ${cell.models.length}개 · 문서 없음` });
    }
  }
  return out.sort((a, b) => a.rank - b.rank || latest(b.cell.entries).localeCompare(latest(a.cell.entries)));
}

export const LIST_TABS = [
  { id: 'no_report', label: '문서 없는 모델', note: '모델은 있는데 보고서·발표자료가 없고, 다른 자료의 문서가 이 모델을 연결한 적도 없습니다.',
    test: (e) => e.models > 0 && !e.reports && !e.doc_linked },
  { id: 'no_model', label: '모델 없는 문서', note: '문서만 있고, 다른 자료의 모델과 연결한 적도 없습니다.',
    test: (e) => !e.models && !e.model_linked },
  { id: 'solve_fail', label: '해석 검증 실패', note: '원본을 바꾸지 않은 사본으로 Nastran 을 돌렸을 때 모든 모델이 실패한 자료입니다.',
    test: (e) => e.solve === 'fail' },
  { id: 'needs_fix', label: '분류 보완 필요', note: '호선(또는 공용)이 빠진 모델 자료입니다. 구역·대상은 선택 칸입니다(43).',
    test: (e) => e.needs_fix },
  { id: 'unsigned', label: '서명 없는 모델', note: '옛 방식으로 변환되어 내용 서명이 없습니다. 관리자가 다시 변환하면 채워집니다.',
    test: (e) => e.unsigned },
];

/** 목록 탭 — scope({rowKey, col})가 있으면 그 칸 자료만. keysOf = 고른 행 기준(없으면 호선). */
export function listRows(data, scope, keysOf = rowsOf) {
  let base = data.entries;
  if (scope) base = base.filter((e) => keysOf(e).includes(scope.rowKey) && zoneMatch(e, scope.col));
  return Object.fromEntries(LIST_TABS.map((t) => [t.id, base.filter(t.test)]));
}

/** 칸 설명 한 줄(툴팁·스크린 리더). */
export function cellSentence(row, col, cell) {
  const info = STATE_INFO[cell.state];
  const parts = [];
  if (cell.models?.length) parts.push(`모델 ${cell.models.length}`);
  if (cell.docs?.length) parts.push(`문서 ${cell.docs.length}`);
  const fails = (cell.models || []).filter((e) => e.solve === 'fail').length;
  if (fails) parts.push(`검증 실패 ${fails}`);
  return { title: `${row.label} · ${col.label}`, state: info.name, desc: `${info.desc}.`, parts: parts.join(' · ') };
}

/** 열 머리(폭 45px) 두 줄 표기 — 띄어쓰기가 있으면 그 자리, 붙은 다섯 글자 이상이면 두 글자 뒤에서 나눈다('데크 / 하우스'). */
export function headerLines(label) {
  const s = String(label || '');
  if (s.includes(' ')) { const i = s.indexOf(' '); return [s.slice(0, i), s.slice(i + 1)]; }
  if (s.length >= 5 && /^[가-힣]+$/.test(s)) return [s.slice(0, 2), s.slice(2)];
  return [s];
}
