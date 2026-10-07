/**
 * 비교 패널(07 §3) — 특성 비교표·속성 차이 행 만들기. 순수 함수.
 *
 * 모델 한 칸 = { id, name, summary, pidCount, groupCount, properties }
 *   summary    = /api/files/{id}/model 응답(없으면 아직 모름 → 값 null)
 *   pidCount·groupCount·properties = 불러온 lbm 에서(없으면 null)
 * 값이 null 인 칸은 '모름' 이라 차이로 세지 않는다.
 */
import { sectionLabel } from './elementInfo.js';
import { solveBadge } from './solveCheck.js';

/** 요소 종류 행 순서 — 1D → 쉘 → 강체·질량. 목록에 없는 카드는 뒤에 이름순. */
const CARD_ORDER = ['CBAR', 'CBEAM', 'CROD', 'CONROD', 'CBUSH', 'CQUAD4', 'CQUAD8', 'CQUADR', 'CTRIA3', 'CTRIA6', 'CTRIAR',
  'RBE2', 'RBE3', 'CONM2'];
const cardRank = (c) => {
  const i = CARD_ORDER.indexOf(c);
  return i < 0 ? CARD_ORDER.length : i;
};

/** +12 / −3 / 0 (마이너스는 U+2212). 소수는 한 자리까지. */
export function formatDelta(d) {
  if (d == null || !Number.isFinite(d)) return '';
  const r = Math.round(d * 10) / 10;
  if (r === 0) return '0';
  const abs = Math.abs(r).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
  return r > 0 ? `+${abs}` : `−${abs}`;
}

const sizeOf = (summary, k) => {
  const b = summary?.bbox;
  if (!b?.min || !b?.max) return null;
  return Math.round((b.max[k] - b.min[k]) * 10) / 10;
};

/** 행의 칸들 — 기준 칸과 다른가(differs), 숫자면 차이(delta). */
function cellsOf(values, kind, baseline) {
  const base = values[baseline];
  return values.map((value, i) => {
    if (i === baseline || value == null || base == null) return { value, differs: false, delta: null };
    if (kind === 'number') {
      const delta = value - base;
      return { value, differs: Math.abs(delta) > 1e-9, delta };
    }
    return { value, differs: value !== base, delta: null };
  });
}

/**
 * 특성 비교표 행. @returns [{ key, label, group, kind: 'number'|'text', cells: [{ value, differs, delta }], differs }]
 * group: 'elements'(요소 종류별 개수) | 'model'(그 밖).
 */
export function characteristicRows(models, baseline = 0) {
  const b = Math.min(Math.max(baseline, 0), Math.max(models.length - 1, 0));
  const cards = new Set();
  for (const m of models) for (const c of Object.keys(m.summary?.counts || {})) if (c !== 'GRID') cards.add(c);
  const ordered = [...cards].sort((x, y) => cardRank(x) - cardRank(y) || x.localeCompare(y));
  const rows = [];
  const push = (key, label, group, kind, values) => {
    const cells = cellsOf(values, kind, b);
    rows.push({ key, label, group, kind, cells, differs: cells.some((c) => c.differs) });
  };
  for (const c of ordered) {
    push(`card:${c}`, c, 'elements', 'number', models.map((m) => (m.summary?.counts ? (m.summary.counts[c] ?? 0) : null)));
  }
  push('nodes', '노드 수', 'model', 'number', models.map((m) => m.summary?.counts?.GRID ?? null));
  ['X', 'Y', 'Z'].forEach((axis, k) => push(`size:${axis}`, `크기 ${axis}`, 'model', 'number', models.map((m) => sizeOf(m.summary, k))));
  push('sol', 'SOL', 'model', 'text', models.map((m) => (m.summary ? (m.summary.sol || '—') : null)));
  push('pids', 'PID 수', 'model', 'number', models.map((m) => m.pidCount ?? null));
  push('groups', '독립 그룹 수', 'model', 'number', models.map((m) => m.groupCount ?? null));
  push('warnings', '변환 경고 수', 'model', 'number', models.map((m) => (m.summary ? (m.summary.warnings || []).length : null)));
  push('solve', '해석 검증', 'model', 'text', models.map((m) => (m.summary ? solveBadge(m.summary.solve).text : null)));
  return rows;
}

/* ── 속성 차이 ───────────────────────────────────────────────────────────────── */

const round6 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(Number(v).toPrecision(6)));

/** 속성 카드 → 비교 칸. 없으면 { present: false }. */
export function propertyCell(p) {
  if (!p) return { present: false, text: '없음', key: 'none' };
  const dims = Array.isArray(p.dims) ? p.dims.map(round6) : null;
  const sig = [p.card || '', p.type || '', dims, round6(p.t), round6(p.A), p.mid ?? null];
  return {
    present: true,
    card: p.card || '',
    type: p.type || '',
    dims,
    mid: p.mid ?? null,
    approx: !!p.approx,
    text: sectionLabel(p) || p.card || '',
    key: JSON.stringify(sig),
  };
}

/**
 * 속성 차이 행 — PID 합집합 × 모델. properties 가 null 인 모델(아직 불러오는 중)은 칸이 null 이고 비교에서 빠진다.
 * @returns {{ rows: [{ pid, cells, changed }], total, changed }}
 *   cells[i] = propertyCell(...) + differs(기준 모델 칸과 다름) | null
 *   changed  = 불러온 모델들 사이에 다른 칸이 하나라도 있음(한 모델에만 있는 PID 포함)
 */
export function propertyDiffRows(models, { baseline = 0, diffOnly = true } = {}) {
  const pids = new Set();
  for (const m of models) for (const k of Object.keys(m.properties || {})) pids.add(Number(k));
  const all = [...pids].filter(Number.isFinite).sort((a, b) => a - b).map((pid) => {
    const cells = models.map((m) => (m.properties ? propertyCell(m.properties[pid] ?? m.properties[String(pid)]) : null));
    const known = cells.filter(Boolean);
    const changed = known.length > 1 && known.some((c) => c.key !== known[0].key);
    const base = cells[baseline] || null;
    const marked = cells.map((c, i) => (c ? { ...c, differs: i !== baseline && !!base && c.key !== base.key } : null));
    return { pid, cells: marked, changed };
  });
  const changedCount = all.filter((r) => r.changed).length;
  return { rows: diffOnly ? all.filter((r) => r.changed) : all, total: all.length, changed: changedCount };
}
