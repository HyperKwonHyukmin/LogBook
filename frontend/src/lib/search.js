/** 검색 상태는 주소가 원본이다(메신저로 공유하면 같은 결과가 열린다 — 설계 §6.1). */
export const FILTER_KEYS = ['hull', 'ship_type', 'analysis_type', 'zone', 'year', 'uploaded_by', 'kind'];

export function readSearch(params) {
  const filters = {};
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (v) filters[k] = v;
  }
  return { q: params.get('q') || '', unit: params.get('unit') === 'file' ? 'file' : 'entry',
           drafts: params.get('drafts') === '1', filters };
}

export function writeSearch({ q = '', unit = 'entry', drafts = false, filters = {} }) {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (unit === 'file') p.set('unit', 'file');
  if (drafts) p.set('drafts', '1');
  for (const k of FILTER_KEYS) if (filters[k]) p.set(k, filters[k]);
  return p;
}

/** 서버 질의 — 주소의 drafts=1 을 서버 형식(true)으로 바꾸고 쪽 정보를 붙인다. */
export function apiQuery(state, { limit = 50, offset = 0 } = {}) {
  const p = writeSearch(state);
  if (p.has('drafts')) p.set('drafts', 'true');
  p.set('limit', String(limit));
  p.set('offset', String(offset));
  return `/search?${p}`;
}

/** 발췌 위치(page:3, slide:5, notes:5, sheet:이름, body) → 화면 라벨. */
export function locatorLabel(loc) {
  if (loc === 'body') return '본문';
  if (loc === 'model') return '모델 지문';
  const i = loc.indexOf(':');
  const kind = i < 0 ? loc : loc.slice(0, i);
  const rest = i < 0 ? '' : loc.slice(i + 1);
  switch (kind) {
    case 'page': return `${rest}쪽`;
    case 'slide': return `슬라이드 ${rest}`;
    case 'notes': return `슬라이드 ${rest} 노트`;
    case 'sheet': return `시트 ${rest}`;
    default: return loc;
  }
}

/** 서버 강조 위치는 파이썬 글자(코드 포인트) 기준이라 Array.from 으로 자른다(UTF-16 과 다름). */
export function highlightParts(text, highlights = []) {
  const chars = Array.from(text);
  const parts = [];
  let pos = 0;
  for (const [a, b] of highlights) {
    if (a > pos) parts.push({ text: chars.slice(pos, a).join(''), hit: false });
    parts.push({ text: chars.slice(a, b).join(''), hit: true });
    pos = b;
  }
  if (pos < chars.length) parts.push({ text: chars.slice(pos).join(''), hit: false });
  return parts;
}
