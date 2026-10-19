/**
 * 검색 결과 통찰(09) — 결과 행의 모델·보고서 한 줄과 요약 띠의 글자·막대 계산. 순수 함수.
 * 서버 모양은 backend/app/search/insight.py(model_brief·report_lines·summarize).
 */

/** 요소 묶음 — 막대에 쌓는 순서·이름. 색은 남색 한 계열의 밝기 단계(진한 것이 많이 쓰는 보). */
export const FAMILIES = [
  { key: 'beam', label: '보', className: 'bg-navy-900' },
  { key: 'shell', label: '쉘', className: 'bg-navy-500' },
  { key: 'rigid', label: 'RBE', className: 'bg-brand-ring' },
  { key: 'mass', label: '질량', className: 'bg-n-300' },
  { key: 'other', label: '기타', className: 'bg-n-250' },
];

// 요소 카드 → 묶음(서버 search/insight.FAMILIES 와 같은 표) — 자료 상세는 파일의 counts 로 직접 센다(38)
const FAMILY_CARDS = {
  beam: ['CBAR', 'CBEAM', 'CROD', 'CONROD', 'CBUSH'],
  shell: ['CQUAD4', 'CQUAD8', 'CQUADR', 'CTRIA3', 'CTRIA6', 'CTRIAR'],
  rigid: ['RBE2', 'RBE3'],
  mass: ['CONM2'],
};
const FAMILY_OF = Object.fromEntries(Object.entries(FAMILY_CARDS).flatMap(([fam, cards]) => cards.map((c) => [c, fam])));

/** 카드별 개수(model_summaries.counts) → 묶음별 개수. GRID 는 요소가 아니라 뺀다(서버 family_counts 와 같다). */
export function familyCounts(counts) {
  const out = { beam: 0, shell: 0, rigid: 0, mass: 0, other: 0 };
  for (const [card, n] of Object.entries(counts || {})) {
    if (card === 'GRID') continue;
    out[FAMILY_OF[card] || 'other'] += Number(n) || 0;
  }
  return out;
}

/**
 * 38 — 모델 구성 한 낱말. 보(빔) 요소와 판(쉘) 요소가 있느냐로만 나눈다(비율은 보지 않는다 —
 * 판 모델의 보강재는 보 요소 수가 적어도 판+보강재다). 보·판 요소가 하나도 없으면 null.
 */
export const STRUCTURES = { beam: '빔 모델', shell: '판 모델', stiffened: '판+보강재' };
export function structureOf(families) {
  const beam = families?.beam || 0;
  const shell = families?.shell || 0;
  if (beam && shell) return 'stiffened';
  if (shell) return 'shell';
  if (beam) return 'beam';
  return null;
}

export const num = (n) => Number(n ?? 0).toLocaleString('ko-KR', { maximumFractionDigits: 0 });

/** 1,234 → '1.2천', 12,431 → '1.2만'. 막대 옆 짧은 수치·범위용. */
export function compact(n) {
  const v = Number(n ?? 0);
  if (v >= 10000) return `${Math.round(v / 1000) / 10}만`;
  if (v >= 1000) return `${Math.round(v / 100) / 10}천`;
  return String(v);
}

/** 막대 조각 — 0 인 묶음은 뺀다. pct 합은 100. */
export function familySegments(families) {
  const total = FAMILIES.reduce((s, f) => s + (families?.[f.key] || 0), 0);
  if (!total) return [];
  return FAMILIES.filter((f) => families[f.key] > 0)
    .map((f) => ({ ...f, count: families[f.key], pct: (families[f.key] / total) * 100 }));
}

/** 막대의 글자 대안 — '보 700 · 쉘 300 · RBE 20'. */
export const familyText = (families) => familySegments(families).map((s) => `${s.label} ${num(s.count)}`).join(' · ');

/**
 * 크기 — BDF 에는 단위가 없어 모델 좌표 그대로 보인다(ModelPreview 와 같은 규칙).
 * 사내 모델은 보통 mm 라 툴팁에 m 환산을 '추정' 으로 덧붙인다(가장 긴 변이 1,000 이상일 때만).
 */
export function formatSize(size) {
  if (!Array.isArray(size) || size.length !== 3 || size.some((v) => !Number.isFinite(Number(v)))) return null;
  const text = size.map((v) => num(Math.round(v))).join(' × ');
  const hint = Math.max(...size) >= 1000
    ? `mm 로 보면 ${size.map((v) => (v / 1000).toFixed(1)).join(' × ')} m (BDF 에는 단위가 없습니다)` : 'BDF 에는 단위가 없습니다';
  return { text, hint };
}

const UNIT_TEXT = { page: (n) => `${num(n)}쪽`, slide: (n) => `슬라이드 ${num(n)}장`, sheet: (n) => `시트 ${num(n)}개`,
  paragraph: (n) => `문단 ${num(n)}개` };

/** 대표 보고서 한 줄 — { title, meta }. 제목이 없으면 파일 이름. 아무것도 없으면 null. */
export function reportText(report) {
  if (!report) return null;
  const title = report.title || report.name;
  if (!title) return null;
  const parts = [];
  if (report.count && UNIT_TEXT[report.unit]) parts.push(UNIT_TEXT[report.unit](report.count));
  if (report.author) parts.push(report.author);
  return { title, meta: parts.join(' · '), fromName: !report.title };
}

/** 요약 띠 해석 검증 — 보이는 순서·이름·색 톤. 모델이 없는 자료는 따로 센다. */
export const SOLVE_SUMMARY = [
  { key: 'pass', label: '해석 가능', tone: 'ok' },
  { key: 'fail', label: '해석 불가', tone: 'err' },
  { key: 'error', label: '확인 못 함', tone: 'wait' },
  { key: 'stale', label: '다시 검증 필요', tone: 'wait' },
  { key: 'pending', label: '검증 중', tone: 'none' },
  { key: 'none', label: '미검증', tone: 'none' },
];

/** 모델 규모 구간 이름 — [min, max). */
export function bucketLabel({ min, max }) {
  if (max == null) return `${compact(min)} 이상`;
  if (!min) return `${compact(max)} 미만`;
  return `${compact(min)}~${compact(max)}`;
}

/** 막대 길이(%) — 가장 큰 값 대비. 값이 있으면 최소 4% 는 보이게. */
export const barPct = (n, max) => (max > 0 && n > 0 ? Math.max(4, Math.round((n / max) * 100)) : 0);
