import {
  groupByMonth, inPeriod, itemKey, listMonths, listYears, matchesUpdate, newIndexes, validPeriod, viewYearFor,
} from './updateHistory.js';

const A = { date: '2027-01-05', no: '50', kind: '개선', title: '가', summary: '요약 가' };
const B = { date: '2026-12-20', no: '49', kind: '기능', title: '나', summary: '요약 나', requester: '김도현 선임' };
const C = { date: '2026-12-20', no: '48', kind: '기능', title: '다', summary: '요약 다', status: '운영 확인 전' };
const D = { date: '2026-10-01', kind: '정리', title: '라', summary: '요약 라', points: ['세부 하나'] };
const ITEMS = [A, B, C, D];

test('새 항목 — 본 항목 앞에 있는 것, 같은 날 배포도 잡고, 처음 온 브라우저는 없음', () => {
  expect([...newIndexes(ITEMS, itemKey(C))]).toEqual([0, 1]);
  expect([...newIndexes(ITEMS, '2026-12-20')]).toEqual([0]);   // 옛 값(날짜만)
  expect(newIndexes(ITEMS, '').size).toBe(0);
});

test('기간 — 최근 N일(오늘 포함)·해·달', () => {
  const today = new Date(2027, 0, 5);
  expect(inPeriod(A, 'd7', today)).toBe(true);
  expect(inPeriod(B, 'd7', today)).toBe(false);
  expect(inPeriod(B, 'd30', today)).toBe(true);
  expect(inPeriod(B, '2026', today)).toBe(true);
  expect(inPeriod(B, '2026-12', today)).toBe(true);
  expect(inPeriod(D, '2026-12', today)).toBe(false);
});

test('찾기는 요청자·세부·번호도, 운영 확인 전만 보기', () => {
  expect(ITEMS.filter((it) => matchesUpdate(it, { q: '김도현' }))).toEqual([B]);
  expect(ITEMS.filter((it) => matchesUpdate(it, { q: '세부' }))).toEqual([D]);
  expect(ITEMS.filter((it) => matchesUpdate(it, { q: '#48' }))).toEqual([C]);
  expect(ITEMS.filter((it) => matchesUpdate(it, { pending: true }))).toEqual([C]);
  expect(ITEMS.filter((it) => matchesUpdate(it, { kind: '기능', period: '2026' }))).toEqual([B, C]);
});

test('해·달 목록과 둘째 단의 해, 주소 값 검사', () => {
  expect(listMonths(ITEMS)).toEqual(['2027-01', '2026-12', '2026-10']);
  expect(listYears(ITEMS)).toEqual(['2027', '2026']);
  expect(viewYearFor('', '', ['2027', '2026'])).toBe('2027');
  expect(viewYearFor('2026-10', '2027', ['2027', '2026'])).toBe('2026');
  expect(viewYearFor('d7', '2026', ['2027', '2026'])).toBe('2026');
  expect(validPeriod('2026', ITEMS)).toBe('2026');
  expect(validPeriod('2026-11', ITEMS)).toBe('');
  expect(validPeriod('1999', ITEMS)).toBe('');
  expect(validPeriod('d30', ITEMS)).toBe('d30');
});

test('달 묶음 — 날짜는 그날 첫 항목에만', () => {
  const g = groupByMonth(ITEMS.map((it, index) => ({ it, index })));
  expect(g.map((x) => x.label)).toEqual(['2027년 1월', '2026년 12월', '2026년 10월']);
  expect(g[1].rows.map((r) => r.showDate)).toEqual([true, false]);
});
