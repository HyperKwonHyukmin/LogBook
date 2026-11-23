/**
 * 69 — 대상 화면(업무 안내)의 순수 함수: 소개 문장, 예제를 고른 이유, 선종 분포, 보고서 쪽수 글자.
 * 서버 응답(GET /api/targets/page)만으로 만든다 — 결론이 거의 없어도 이미 있는 신호(보고서, 검증, 모델)로 채운다.
 */

const kc = (r, k) => (r?.kind_counts || {})[k] || 0;
const day = (s) => (s ? s.slice(0, 10) : '');

/** 선종 분포 — [{ value, count }] 많은 순. 선종이 없는 자료는 '선종 모름'. */
export function shipTypeCounts(rows) {
  const m = new Map();
  for (const r of rows || []) {
    const types = r.ship_types?.length ? r.ship_types : ['선종 모름'];
    for (const t of types) m.set(t, (m.get(t) || 0) + 1);
  }
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** 소개 문장 — "LNGC 9척, VLCC 4척 등 호선 15척에서 한 해석 44건, 2024-03 ~ 2026-11. 주 담당은 권혁민 님(38건)입니다." */
export function introSentence(d) {
  const recs = d.records || [];
  const hullsBy = new Map();
  for (const r of recs) for (const t of (r.ship_types?.length ? r.ship_types : [])) {
    if (!hullsBy.has(t)) hullsBy.set(t, new Set());
    for (const h of r.hulls || []) hullsBy.get(t).add(h);
  }
  const top = [...hullsBy.entries()].map(([t, s]) => [t, s.size]).sort((a, b) => b[1] - a[1]).slice(0, 2);
  const parts = [];
  const shipText = top.map(([t, n]) => `${t} ${n}척`).join(', ');
  const c = d.counts || {};
  if (c.hulls) parts.push(`${shipText ? `${shipText}${hullsBy.size > top.length ? ' 등 ' : ', '}` : ''}호선 ${c.hulls}척에서 한 해석 ${recs.length}건`);
  const dates = [...recs, ...(d.base_docs || [])].map((r) => day(r.posted_at)).filter(Boolean).sort();
  if (dates.length) parts.push(dates[0].slice(0, 7) === dates[dates.length - 1].slice(0, 7) ? dates[0].slice(0, 7) : `${dates[0].slice(0, 7)} ~ ${dates[dates.length - 1].slice(0, 7)}`);
  let s = parts.join(', ');
  const lead = (d.people || [])[0];
  if (lead && c.entries) s += `${s ? '. ' : ''}주 담당은 ${lead.name} 님(${lead.count}건)입니다`;
  return s ? `${s}.` : '';
}

/** 예제를 고른 이유 — 이미 있는 신호를 사람 말로. */
export function pickReasons(r) {
  const out = [];
  if (r.conclusion) out.push('결론 있음');
  if (r.reviewed) out.push('검토 서명');
  if (kc(r, 'model') && kc(r, 'report')) out.push('모델과 보고서 모두 있음');
  if (r.solve === 'pass') out.push('해석 검증 통과');
  return out;
}

const UNIT = { page: '쪽', slide: '장', sheet: '시트', paragraph: '문단' };
/** 보고서 한 줄 — "제목, 32쪽" (요약이 없으면 파일 이름). */
export function reportText(rep) {
  if (!rep) return '';
  const name = rep.title || rep.name || '';
  const n = rep.count ? `${rep.count}${UNIT[rep.unit] || ''}` : '';
  return [name, n].filter(Boolean).join(', ');
}

/** 시작 순서 — 내용이 있는 단계만(번호는 읽는 순서라 의미가 있다). */
export function steps(d) {
  const s = [];
  if (d.base_docs?.length) s.push({ id: 'base', label: '기준 문서', count: d.base_docs.length });
  if (d.start?.length) s.push({ id: 'example', label: '대표 예제', count: null });
  if (d.conclusions?.length) s.push({ id: 'conclusions', label: '지난 결론', count: d.conclusions.length });
  if (d.records?.length) s.push({ id: 'records', label: '실적', count: d.records.length });
  if (d.people?.length) s.push({ id: 'people', label: '물어볼 사람', count: d.people.length });
  return s;
}
