/**
 * 갖춤 현황(26) — GET /api/coverage 의 자료 목록을 호선(·프로젝트·공용) × 구역 칸으로 놓는 순수 함수.
 * 해석 종류를 바꿔 걸러도 다시 부르지 않고 여기서 다시 센다.
 */

export const STATES = ['full', 'noreport', 'nomodel', 'fail', 'empty'];
export const STATE_INFO = {
  full: { name: '갖춤', desc: '모델과 문서가 있고, 해석 검증에 실패하지 않았습니다' },
  noreport: { name: '문서 없음', desc: '모델만 있고 보고서·발표자료가 없습니다' },
  nomodel: { name: '모델 없음', desc: '문서만 있고 모델이 없습니다' },
  fail: { name: '검증 실패만', desc: '모델이 모두 해석 검증에 실패했습니다' },
  empty: { name: '비어 있음', desc: '자료가 없습니다' },
  na: { name: '해당 없음', desc: '이 구역에는 고른 해석 종류의 자료가 어디에도 없습니다' },
};
export const ALL = '전체';
export const MAX_ZONES = 14;          // 이보다 많은 구역은 자료 수가 적은 쪽을 '기타' 한 열로 묶는다
export const OTHER_ZONE = '기타';
export const NO_ZONE = '구역 없음';
export const UNSET_ROW = 'x:미지정';

const hullNo = (k) => k.slice(2);

/** 행 목록 — 호선(번호 순) → 프로젝트 → 공용 → 미지정. 자료가 있는 행만. */
export function buildRows(data) {
  const used = new Set();
  for (const e of data.entries) for (const r of rowsOf(e)) used.add(r);
  const hulls = [...used].filter((k) => k.startsWith('h:')).sort((a, b) => hullNo(a).localeCompare(hullNo(b), 'ko', { numeric: true }));
  const projects = [...used].filter((k) => k.startsWith('p:')).sort();
  const rest = [...used].filter((k) => k.startsWith('c:') || k === UNSET_ROW);
  return [...hulls, ...projects, ...rest].map((key) => ({
    key,
    kind: key.startsWith('h:') ? 'hull' : key.startsWith('p:') ? 'project' : key === UNSET_ROW ? 'unset' : 'common',
    label: key === UNSET_ROW ? '미지정' : key.slice(2),
    sub: key.startsWith('h:') ? (data.hulls?.[hullNo(key)] || '선종 미입력') : key.startsWith('p:') ? '프로젝트' : key === UNSET_ROW ? '호선·프로젝트 없음' : '호선 없음',
  }));
}

export const rowsOf = (e) => (e.rows?.length ? e.rows : [UNSET_ROW]);

/** 열 목록 — 자료 많은 구역부터 MAX_ZONES 개, 나머지는 '기타', 구역 없는 자료가 있으면 '구역 없음'. */
export function buildZones(data) {
  const zones = data.zones || [];
  const main = zones.slice(0, MAX_ZONES);
  const other = new Set(zones.slice(MAX_ZONES));
  const cols = main.map((z) => ({ key: z, label: z }));
  if (other.size) cols.push({ key: OTHER_ZONE, label: OTHER_ZONE, members: other });
  if (data.entries.some((e) => !e.zones?.length)) cols.push({ key: NO_ZONE, label: NO_ZONE });
  return cols;
}

export function zoneMatch(e, col) {
  if (col.key === NO_ZONE) return !e.zones?.length;
  if (col.members) return (e.zones || []).some((z) => col.members.has(z));
  return (e.zones || []).includes(col.key);
}

export const atypeMatch = (e, atype) => atype === ALL || e.analysis_type === atype;

/** 해석 종류 목록(자료 많은 순). */
export function atypesOf(data) {
  const n = new Map();
  for (const e of data.entries) if (e.analysis_type) n.set(e.analysis_type, (n.get(e.analysis_type) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
}

/** 구역마다 자료가 있는 해석 종류 — 고른 해석 종류가 그 구역 어디에도 없으면 칸을 '해당 없음'으로 그린다. */
export function applicability(data, cols) {
  const out = new Map(cols.map((c) => [c.key, new Set()]));
  for (const e of data.entries) {
    if (!e.analysis_type) continue;
    for (const c of cols) if (zoneMatch(e, c)) out.get(c.key).add(e.analysis_type);
  }
  return out;
}

/** 칸 하나의 상태. */
export function cellOf(data, row, col, atype, applic) {
  if (atype !== ALL && applic && !applic.get(col.key)?.has(atype)) {
    return { entries: [], models: [], docs: [], state: 'na' };
  }
  const entries = data.entries.filter((e) => rowsOf(e).includes(row.key) && zoneMatch(e, col) && atypeMatch(e, atype));
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

/** 격자 전체 — rows × cols 칸, 상태별 칸 수, 행마다 채운 칸 수, 열마다 자료가 있는 행 수. */
export function buildGrid(data, atype) {
  const rows = buildRows(data);
  const cols = buildZones(data);
  const applic = applicability(data, cols);
  const cells = new Map();
  const counts = { full: 0, noreport: 0, nomodel: 0, fail: 0, empty: 0, na: 0 };
  const rowFilled = new Map(rows.map((r) => [r.key, 0]));
  const colFilled = new Map(cols.map((c) => [c.key, 0]));
  for (const r of rows) {
    for (const c of cols) {
      const cell = cellOf(data, r, c, atype, applic);
      cells.set(`${r.key}|${c.key}`, cell);
      counts[cell.state] += 1;
      if (cell.state !== 'empty' && cell.state !== 'na') {
        rowFilled.set(r.key, rowFilled.get(r.key) + 1);
        colFilled.set(c.key, colFilled.get(c.key) + 1);
      }
    }
  }
  const applicableCols = cols.filter((c) => atype === ALL || applic.get(c.key)?.has(atype)).length;
  return { rows, cols, cells, counts, rowFilled, colFilled, applicableCols };
}

export const cellKey = (rowKey, colKey) => `${rowKey}|${colKey}`;

const latest = (entries) => entries.map((e) => e.confirmed_at || '').sort().pop() || '';

/** 정렬 — hull(기본: 만든 순서) | recent(최근 확정 행 먼저) | gaps(빈 구역 많은 행 먼저). */
export function sortRows(grid, data, mode) {
  if (mode === 'recent') {
    const last = new Map(grid.rows.map((r) => [r.key, latest(data.entries.filter((e) => rowsOf(e).includes(r.key)))]));
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
  { id: 'needs_fix', label: '분류 보완 필요', note: '호선(또는 프로젝트)·구역·해석 종류 중 빠진 칸이 있는 BDF 자료입니다.',
    test: (e) => e.needs_fix },
  { id: 'unsigned', label: '서명 없는 모델', note: '옛 방식으로 변환되어 내용 서명이 없습니다. 관리자가 다시 변환하면 채워집니다.',
    test: (e) => e.unsigned },
];

/** 목록 탭 — 해석 종류 거르기를 따르고, scope({rowKey, col})가 있으면 그 칸 자료만. */
export function listRows(data, atype, scope) {
  let base = data.entries.filter((e) => atypeMatch(e, atype));
  if (scope) base = base.filter((e) => rowsOf(e).includes(scope.rowKey) && zoneMatch(e, scope.col));
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
