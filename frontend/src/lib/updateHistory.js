/**
 * 46 — 업데이트 이력(관리 › 업데이트 이력) 순수 함수. 내용은 서버 GET /api/admin/updates(backend/app/changelog/changelog.json).
 * - '새 항목' = 이 브라우저에서 지난번에 본 맨 위 항목보다 앞(위)에 있는 것. 처음 보는 브라우저는 모두 본 것으로.
 * - 열쇠는 날짜|번호|제목 — 같은 날 여러 번 배포해도 구분된다.
 * - 기간 = ''(전체) | 'd7'·'d30'(오늘 포함 최근 N일) | 'YYYY'(해) | 'YYYY-MM'(달).
 */

export const KINDS = ['기능', '개선', '정리', '운영', '검토'];
export const RECENT_PERIODS = { d7: { days: 7, label: '최근 7일' }, d30: { days: 30, label: '최근 30일' } };

export const itemKey = (it) => [it?.date || '', it?.no || '', it?.title || ''].join('|');

/** 새 항목의 인덱스 집합. 본 항목이 목록에서 빠졌거나 옛 값(날짜만)이면 날짜로 판단한다. */
export function newIndexes(items, seen) {
  const fresh = new Set();
  if (!seen || !Array.isArray(items)) return fresh;
  const at = items.map(itemKey).indexOf(seen);
  const seenDate = seen.split('|')[0];
  items.forEach((it, i) => {
    if (at >= 0 ? i < at : (it?.date || '') > seenDate) fresh.add(i);
  });
  return fresh;
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 이 기간에 드는가 — 최근 N일은 오늘(이 PC 날짜) 포함. */
export function inPeriod(it, period, today = new Date()) {
  if (!period) return true;
  const date = it?.date || '';
  const recent = RECENT_PERIODS[period];
  if (recent) {
    const from = new Date(today); from.setDate(from.getDate() - (recent.days - 1));
    return date >= ymd(from);
  }
  return period.length === 4 ? date.slice(0, 4) === period : date.slice(0, 7) === period;
}

/** 기간·분류·찾기 글자·운영 확인 전 필터. 빠진 조건은 보지 않는다. */
export function matchesUpdate(it, { period = '', today, kind = '', q = '', pending = false } = {}) {
  if (!inPeriod(it, period, today)) return false;
  if (kind && it.kind !== kind) return false;
  if (pending && !it.status) return false;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [it.title, it.summary, it.no ? `#${it.no}` : '', it.status, it.date, it.kind, it.requester, it.screen,
    ...(it.points || [])].join(' ').toLowerCase().includes(needle);
}

export function monthLabel(ym) {
  const [y, m] = (ym || '').split('-');
  return y && m ? `${y}년 ${Number(m)}월` : '날짜 없음';
}

/** 기록이 있는 달(최근 달 먼저) — ['2026-10', '2026-09']. */
export function listMonths(items) {
  const out = [];
  for (const it of items || []) {
    const m = (it.date || '').slice(0, 7);
    if (m.length === 7 && !out.includes(m)) out.push(m);
  }
  return out.sort().reverse();
}

/** 기록이 있는 해(최근 해 먼저). */
export const listYears = (items) => [...new Set(listMonths(items).map((m) => m.slice(0, 4)))];

/** 둘째 단(달)에 보일 해 — 해·달을 골랐으면 그 해, 아니면 마지막으로 본 해(없으면 가장 최근 해). */
export function viewYearFor(period, lastYear, years) {
  if (period && !RECENT_PERIODS[period]) return period.slice(0, 4);
  return years.includes(lastYear) ? lastYear : (years[0] || '');
}

/** 고를 수 있는 기간인가(주소로 들어온 값 검사). */
export function validPeriod(period, items) {
  if (!period) return '';
  if (RECENT_PERIODS[period]) return period;
  const months = listMonths(items);
  if (period.length === 4) return months.some((m) => m.startsWith(`${period}-`)) ? period : '';
  return months.includes(period) ? period : '';
}

/** [{ month, label, rows:[{ it, index, showDate }] }] — 들어온 순서(최신 먼저), 날짜는 그날 첫 항목에만. */
export function groupByMonth(rows) {
  const groups = [];
  let last = null;
  let prevDate = null;
  for (const r of rows) {
    const month = (r.it.date || '').slice(0, 7);
    if (!last || last.month !== month) {
      last = { month, label: monthLabel(month), rows: [] };
      groups.push(last);
      prevDate = null;
    }
    last.rows.push({ ...r, showDate: r.it.date !== prevDate });
    prevDate = r.it.date;
  }
  return groups;
}

/** 항목 주소 조각 — 같은 번호가 여러 항목이어도 겹치지 않게 순서를 붙인다. */
export const anchorOf = (it, index) => `u-${it.no || 'x'}-${index}`;
