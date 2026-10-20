import {
  GROUP_NONE, apiQuery, filterHref, filterValues, highlightParts, locatorLabel, readSearch, sortsFor, toggleFilterValue, writeSearch,
} from './search.js';

test('주소 ↔ 검색 상태', () => {
  const s = readSearch(new URLSearchParams('q=9999%20강도&hull=9999&unit=file&drafts=1&bogus=x'));
  expect(s).toEqual({ q: '9999 강도', unit: 'file', drafts: true, fav: false, filters: { hull: ['9999'] }, sort: '', group: '', gsort: '' });
  expect(writeSearch(s).toString()).toBe('q=9999+%EA%B0%95%EB%8F%84&unit=file&drafts=1&hull=9999');
  expect(readSearch(new URLSearchParams(''))).toEqual({ q: '', unit: 'entry', drafts: false, fav: false, filters: {}, sort: '', group: '', gsort: '' });
});

test('API 질의는 drafts=true 와 쪽 정보를 붙인다', () => {
  const s = { q: 'a', unit: 'entry', drafts: true, filters: { zone: '선수부' } };
  expect(apiQuery(s, { offset: 50 })).toBe('/search?q=a&drafts=true&zone=%EC%84%A0%EC%88%98%EB%B6%80&limit=50&offset=50');
});

test('위치 라벨', () => {
  expect(locatorLabel('page:3')).toBe('3쪽');
  expect(locatorLabel('slide:5')).toBe('슬라이드 5');
  expect(locatorLabel('notes:5')).toBe('슬라이드 5 노트');
  expect(locatorLabel('sheet:응력:A')).toBe('시트 응력:A');
  expect(locatorLabel('body')).toBe('본문');
  expect(locatorLabel('model')).toBe('모델 지문');
});

test('강조 조각 — 위치는 서버(파이썬) 글자 수 기준', () => {
  expect(highlightParts('구조 강도 평가', [[3, 5]])).toEqual([
    { text: '구조 ', hit: false }, { text: '강도', hit: true }, { text: ' 평가', hit: false }]);
  // 이모지(서로게이트 쌍)가 앞에 있어도 파이썬 글자 위치로 자른다
  expect(highlightParts('😀강도', [[1, 3]])).toEqual([{ text: '😀', hit: false }, { text: '강도', hit: true }]);
  expect(highlightParts('abc', [])).toEqual([{ text: 'abc', hit: false }]);
});

test('태그 필터·정렬도 주소에 담는다(08)', () => {
  // 15 — 옛 주소의 year=(해석 연도)는 읽지 않고, sort=period(해석 시기)는 모르는 정렬로 버린다(서버 기본 = 최신순)
  const s = readSearch(new URLSearchParams('tag=%EA%B3%84%EB%A5%98&sort=recent&year=unknown'));
  expect(s.filters).toEqual({ tag: ['계류'] });
  expect(s.sort).toBe('recent');
  expect(writeSearch(s).toString()).toBe('tag=%EA%B3%84%EB%A5%98&sort=recent');
  expect(readSearch(new URLSearchParams('sort=bogus')).sort).toBe('');
  expect(readSearch(new URLSearchParams('sort=period')).sort).toBe('');
  // 42 — 옛 주소의 해석 종류 필터·묶기는 읽지 않는다(서버로 보내지 않는다)
  const old = readSearch(new URLSearchParams('analysis_type=FE%20%ED%95%B4%EC%84%9D&group=analysis_type'));
  expect(old.filters).toEqual({});
  expect(old.group).toBe('');
});

test('속성 값 하나로 거른 검색 주소(09)', () => {
  expect(filterHref('zone', '선미부')).toBe('/?zone=%EC%84%A0%EB%AF%B8%EB%B6%80');
  expect(filterHref('analysis_type', 'FE 해석')).toBe('/');   // 42 — 해석 종류 필터는 없앴다
  expect(filterHref('target', 'Unit')).toBe('/?target=Unit');
  expect(filterHref('hull', '9002')).toBe('/?hull=9002');
  expect(filterHref('bogus', 'x')).toBe('/');
  expect(filterHref('zone', '')).toBe('/');
});

test('보기 기준(11) — 주소와 서버 질의', () => {
  const s = readSearch(new URLSearchParams('group=zone&gsort=name&q=a'));
  expect(s.group).toBe('zone');
  expect(s.gsort).toBe('name');
  expect(writeSearch(s).toString()).toBe('q=a&group=zone&gsort=name');
  expect(readSearch(new URLSearchParams('group=bogus&gsort=name'))).toMatchObject({ group: '', gsort: '' });
  // 묶음 머리 + 처음 행
  expect(apiQuery(s, { limit: 50, groupRows: 5, groupLimit: 30 }))
    .toBe('/search?q=a&group=zone&group_sort=name&group_rows=5&group_limit=30&limit=50&offset=0');
  // 한 묶음 더 보기(없음 묶음은 토큰)
  expect(apiQuery(s, { limit: 20, offset: 5, groupValue: '선미부' }))
    .toBe('/search?q=a&group=zone&group_value=%EC%84%A0%EB%AF%B8%EB%B6%80&limit=20&offset=5');
  expect(apiQuery(s, { groupValue: null })).toContain(`group_value=${GROUP_NONE}`);
  // 파일 보기에서는 묶지 않는다
  expect(apiQuery({ ...s, unit: 'file' })).toBe('/search?q=a&unit=file&limit=50&offset=0');
});

test('한 칸 여러 값(19) — 같은 이름 되풀이, 옛 단일값 주소와 호환', () => {
  const s = readSearch(new URLSearchParams('hull=3496&hull=3497&zone=%EC%84%A0%EC%88%98%EB%B6%80&hull=3496&tag='));
  expect(s.filters).toEqual({ hull: ['3496', '3497'], zone: ['선수부'] });   // 중복·빈 값은 뺀다
  expect(writeSearch(s).toString()).toBe('hull=3496&hull=3497&zone=%EC%84%A0%EC%88%98%EB%B6%80');
  // 쉼표가 든 값은 나누지 않는다
  expect(readSearch(new URLSearchParams('tag=a%2Cb')).filters).toEqual({ tag: ['a,b'] });
  expect(writeSearch({ filters: { tag: ['a,b', 'c'] } }).toString()).toBe('tag=a%2Cb&tag=c');
  // 옛 모양(문자열 하나)도 그대로 쓴다
  expect(writeSearch({ filters: { zone: '선수부' } }).toString()).toBe('zone=%EC%84%A0%EC%88%98%EB%B6%80');
  expect(apiQuery({ unit: 'entry', filters: { hull: ['3496', '3497'] } })).toBe('/search?hull=3496&hull=3497&limit=50&offset=0');
});

test('필터 값 목록·켜고 끄기(19)', () => {
  expect(filterValues({ hull: '3496' }, 'hull')).toEqual(['3496']);
  expect(filterValues({ hull: ['3496', ' ', '3496'] }, 'hull')).toEqual(['3496']);
  expect(filterValues({}, 'hull')).toEqual([]);
  expect(filterValues(undefined, 'hull')).toEqual([]);
  let f = toggleFilterValue({ zone: ['선수부'] }, 'hull', '3496');
  expect(f).toEqual({ zone: ['선수부'], hull: ['3496'] });
  f = toggleFilterValue(f, 'hull', '3497');
  expect(f.hull).toEqual(['3496', '3497']);
  f = toggleFilterValue(toggleFilterValue(f, 'hull', '3496'), 'hull', '3497');
  expect(f).toEqual({ zone: ['선수부'] });
});

test('정렬·보기 기준 추가(19) — 호선순·제목순, 태그별', () => {
  expect(sortsFor(false).map((s) => s.id)).toEqual(['relevance', 'recent', 'hull', 'title']);
  expect(readSearch(new URLSearchParams('sort=hull')).sort).toBe('hull');
  expect(readSearch(new URLSearchParams('sort=title')).sort).toBe('title');
  expect(readSearch(new URLSearchParams('group=tag')).group).toBe('tag');
});
