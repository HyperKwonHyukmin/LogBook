import { apiQuery, highlightParts, locatorLabel, readSearch, writeSearch } from './search.js';

test('주소 ↔ 검색 상태', () => {
  const s = readSearch(new URLSearchParams('q=9999%20강도&hull=9999&unit=file&drafts=1&bogus=x'));
  expect(s).toEqual({ q: '9999 강도', unit: 'file', drafts: true, filters: { hull: '9999' } });
  expect(writeSearch(s).toString()).toBe('q=9999+%EA%B0%95%EB%8F%84&unit=file&drafts=1&hull=9999');
  expect(readSearch(new URLSearchParams(''))).toEqual({ q: '', unit: 'entry', drafts: false, filters: {} });
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
});

test('강조 조각 — 위치는 서버(파이썬) 글자 수 기준', () => {
  expect(highlightParts('구조 강도 평가', [[3, 5]])).toEqual([
    { text: '구조 ', hit: false }, { text: '강도', hit: true }, { text: ' 평가', hit: false }]);
  // 이모지(서로게이트 쌍)가 앞에 있어도 파이썬 글자 위치로 자른다
  expect(highlightParts('😀강도', [[1, 3]])).toEqual([{ text: '😀', hit: false }, { text: '강도', hit: true }]);
  expect(highlightParts('abc', [])).toEqual([{ text: 'abc', hit: false }]);
});
