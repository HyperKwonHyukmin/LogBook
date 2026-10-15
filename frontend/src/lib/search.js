/** 검색 상태는 주소가 원본이다(메신저로 공유하면 같은 결과가 열린다 — 설계 §6.1). */
// 15 — '해석 연도'(year)는 해석 시기와 함께 없앴다(옛 주소의 year= 는 읽지 않는다)
// 21 — 프로젝트(자료의 소속, 자료당 하나)
export const FILTER_KEYS = ['hull', 'project', 'ship_type', 'analysis_type', 'zone', 'tag', 'uploaded_by', 'kind'];

/**
 * 정렬(08·15) — 주소에 없으면 서버가 정한다(검색어가 있으면 관련도, 없으면 최신순 = 올린 날짜).
 * 19 — 호선순(대표 호선 번호 오름차순, 호선 없는 자료는 뒤)·제목순(파일 보기는 파일 이름순).
 */
export const SORTS = [{ id: 'relevance', label: '관련도' }, { id: 'recent', label: '최신순' },
  { id: 'hull', label: '호선순' }, { id: 'title', label: '제목순' }];
/** 즐겨찾기만 볼 때(10) 더하는 정렬 — 최근에 넣은 것부터. */
export const FAV_SORT = { id: 'favorited', label: '즐겨찾기한 순' };
export const sortsFor = (fav) => (fav ? [...SORTS, FAV_SORT] : SORTS);
/** 즐겨찾기만 볼 때는 검색어가 없으면 '즐겨찾기한 순'. */
export const defaultSort = (q, fav = false) => (q ? 'relevance' : fav ? FAV_SORT.id : 'recent');

/**
 * 보기 기준(11) — 결과를 속성 값으로 묶어 본다(문서 보기에서만). 주소 `group=`, 묶음 순서 `gsort=name`.
 * 값이 없는 Entry 의 묶음은 서버에 GROUP_NONE 으로 가리킨다(화면: 없음/미상, 맨 뒤).
 */
export const GROUPS = [
  { id: 'hull', label: '호선별', none: '호선 없음' },
  { id: 'zone', label: '구역별', none: '구역 없음' },
  { id: 'analysis_type', label: '해석 종류별', none: '해석 종류 없음' },
  { id: 'uploaded_by', label: '올린 사람별', none: '올린 사람 미상' },
  { id: 'tag', label: '태그별', none: '태그 없음' },   // 19 — 태그가 여러 개인 자료는 여러 묶음에 나온다
  { id: 'project', label: '프로젝트별', none: '프로젝트 없음' },   // 21
];
export const GROUP_IDS = GROUPS.map((g) => g.id);
export const GROUP_NONE = '__none__';
/** 20 — 호선별 묶기의 '호선 없음(공용)' 자료 묶음(서버 GROUP_SHARED). '호선 없음'(값 없음) 묶음과 따로 보인다. */
export const GROUP_SHARED = '__shared__';
export const isGroup = (v) => GROUP_IDS.includes(v);

/**
 * 필터 칸 하나의 값 목록(19) — 칸마다 값 여러 개(같은 칸 안은 OR, 칸끼리는 AND).
 * 옛 모양(문자열 하나)·서버 applied_filters(목록)·빈 값을 모두 받는다.
 */
export function filterValues(filters, key) {
  const v = filters?.[key];
  if (v == null || v === '') return [];
  const list = Array.isArray(v) ? v : [v];
  return [...new Set(list.map((x) => String(x ?? '').trim()).filter(Boolean))];
}

/** 칸 안 값 하나를 켜고 끈 새 filters(19). 빈 칸은 지운다. */
export function toggleFilterValue(filters, key, value) {
  const cur = filterValues(filters, key);
  const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
  const out = { ...filters };
  if (next.length) out[key] = next; else delete out[key];
  return out;
}

/**
 * 주소 → 검색 상태. 19 — 한 칸 여러 값은 같은 이름을 되풀이한다(`?hull=3496&hull=3497`).
 * 값에 쉼표가 들어갈 수 있어(태그·구역) 쉼표로 나누지 않는다. 옛 단일값 주소(`?zone=X`)는 값 하나짜리 목록이다.
 */
export function readSearch(params) {
  const filters = {};
  for (const k of FILTER_KEYS) {
    const vs = filterValues({ [k]: params.getAll(k) }, k);
    if (vs.length) filters[k] = vs;
  }
  const fav = params.get('fav') === '1';
  const sort = sortsFor(fav).some((s) => s.id === params.get('sort')) ? params.get('sort') : '';
  const group = isGroup(params.get('group')) ? params.get('group') : '';
  return { q: params.get('q') || '', unit: params.get('unit') === 'file' ? 'file' : 'entry',
           drafts: params.get('drafts') === '1', fav, filters, sort,
           group, gsort: group && params.get('gsort') === 'name' ? 'name' : '' };
}

export function writeSearch({ q = '', unit = 'entry', drafts = false, fav = false, filters = {}, sort = '', group = '', gsort = '' }) {
  const p = new URLSearchParams();
  if (fav) p.set('fav', '1');   // 10 — 내 즐겨찾기만
  if (q) p.set('q', q);
  if (unit === 'file') p.set('unit', 'file');
  if (drafts) p.set('drafts', '1');
  for (const k of FILTER_KEYS) for (const v of filterValues(filters, k)) p.append(k, v);
  if (sort && sortsFor(fav).some((x) => x.id === sort)) p.set('sort', sort);
  if (isGroup(group)) {
    p.set('group', group);
    if (gsort === 'name') p.set('gsort', 'name');
  }
  return p;
}

/**
 * 서버 질의 — 주소의 drafts=1 을 서버 형식(true)으로 바꾸고 쪽 정보를 붙인다.
 * 묶어 보기(11): 묶음 머리·처음 groupRows 행(groupOffset 부터 groupLimit 묶음), 또는 groupValue 하나의 행(더 보기).
 * 파일 보기에서는 묶지 않는다(group 을 보내지 않는다).
 */
export function apiQuery(state, { limit = 50, offset = 0, groupValue, groupRows, groupLimit, groupOffset } = {}) {
  const p = writeSearch(state);
  p.delete('gsort');
  if (p.has('drafts')) p.set('drafts', 'true');
  if (state.unit === 'file') p.delete('group');
  if (p.has('group')) {
    if (groupValue !== undefined) p.set('group_value', groupValue ?? GROUP_NONE);
    else {
      if (state.gsort === 'name') p.set('group_sort', 'name');
      if (groupRows) p.set('group_rows', String(groupRows));
      if (groupLimit) p.set('group_limit', String(groupLimit));
      if (groupOffset) p.set('group_offset', String(groupOffset));
    }
  }
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

/**
 * 속성 값 하나로 거른 검색 주소(09) — '선미부' 를 누르면 `/?zone=%EC%84%A0...`.
 * 동의어 값을 넘겨도 서버가 대표 값으로 정리해 거른다(applied_filters).
 */
export function filterHref(key, value) {
  if (!FILTER_KEYS.includes(key) || value == null || value === '') return '/';
  return `/?${writeSearch({ filters: { [key]: [String(value)] } })}`;
}
