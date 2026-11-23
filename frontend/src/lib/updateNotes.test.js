import { groupByMonth, noteImageSrc, notePath, noteUrl, unseenCount } from './updateNotes.js';

const ITEMS = [
  { id: 'c', date: '2026-11-24' }, { id: 'b', date: '2026-11-02' }, { id: 'a', date: '2026-10-30' },
];

test('공유 주소와 그림 주소', () => {
  expect(notePath('2026-11-24-x')).toBe('/update-notes/2026-11-24-x');
  expect(noteUrl('n1', 'http://10.14.42.145:9095')).toBe('http://10.14.42.145:9095/update-notes/n1');
  expect(noteImageSrc('a b.png')).toBe('/api/update-notes/img/a%20b.png');
});

test('달 묶음은 목록 순서 그대로', () => {
  const g = groupByMonth(ITEMS);
  expect(g.map((x) => x.label)).toEqual(['2026년 11월', '2026년 10월']);
  expect(g[0].items.map((x) => x.id)).toEqual(['c', 'b']);
});

test('안 본 안내 수 — 본 기록 뒤의 것, 처음이면 최근 14일', () => {
  expect(unseenCount(ITEMS, 'b')).toBe(1);
  expect(unseenCount(ITEMS, 'c')).toBe(0);
  expect(unseenCount(ITEMS, 'gone')).toBe(3);
  expect(unseenCount(ITEMS, '', new Date('2026-11-25T00:00:00Z'))).toBe(1);
  expect(unseenCount([], 'x')).toBe(0);
});
