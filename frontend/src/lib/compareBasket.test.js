import {
  BASKET_KEY, BASKET_MAX, addItem, cleanItems, compareHref, itemsFromIds, parseIds, patchItem, readBasket, removeItem,
  writeBasket,
} from './compareBasket.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

test('담기 — 추가 · 중복 · 최대 4개 · 잘못된 값', () => {
  let items = [];
  let r = addItem(items, { id: 12, name: 'a.bdf', hull: '9999' });
  expect(r.result).toBe('added');
  items = r.items;
  r = addItem(items, { id: 12, name: 'a.bdf' });
  expect(r.result).toBe('exists');
  expect(r.items).toBe(items);
  for (const id of [13, 14, 15]) items = addItem(items, { id }).items;
  expect(items).toHaveLength(BASKET_MAX);
  r = addItem(items, { id: 16 });
  expect(r.result).toBe('full');
  expect(r.items).toBe(items);
  expect(addItem(items, { id: 'abc' }).result).toBe('invalid');
});

test('이미 담긴 항목은 모르던 이름·호선만 채운다', () => {
  const items = [{ id: 3, name: '', hull: '' }];
  const r = addItem(items, { id: 3, name: 'b.bdf', hull: '9001' });
  expect(r.result).toBe('exists');
  expect(r.items[0]).toEqual({ id: 3, name: 'b.bdf', hull: '9001' });
  expect(patchItem(r.items, 3, { name: 'b.bdf' })).toBe(r.items);
  expect(patchItem(r.items, 3, { name: 'c.bdf' })[0].name).toBe('c.bdf');
});

test('빼기', () => {
  const items = [{ id: 1, name: '', hull: '' }, { id: 2, name: '', hull: '' }];
  expect(removeItem(items, 1).map((x) => x.id)).toEqual([2]);
  expect(removeItem(items, 9)).toBe(items);
});

test('주소 ↔ 목록', () => {
  expect(parseIds('12,34,,abc,12,0,-3,56,78,90')).toEqual([12, 34, 56, 78]);
  expect(parseIds('')).toEqual([]);
  expect(parseIds(null)).toEqual([]);
  expect(compareHref([12, 34])).toBe('/compare?ids=12,34');
  expect(compareHref([])).toBe('/compare');
  const known = [{ id: 34, name: 'x.bdf', hull: '9001' }];
  expect(itemsFromIds([12, 34], known)).toEqual([{ id: 12, name: '', hull: '' }, { id: 34, name: 'x.bdf', hull: '9001' }]);
});

test('저장 — 왕복, 깨진 값, 막힌 저장소', () => {
  const s = memory();
  const items = cleanItems([{ id: 1, name: 'a', hull: '9999' }, { id: 1 }, { id: 2 }]);
  expect(items).toHaveLength(2);
  expect(writeBasket(s, items)).toBe(true);
  expect(readBasket(s)).toEqual(items);
  expect(writeBasket(s, [])).toBe(true);
  expect(s.m.has(BASKET_KEY)).toBe(false);
  s.setItem(BASKET_KEY, '{broken');
  expect(readBasket(s)).toEqual([]);
  const denied = () => { throw new Error('denied'); };
  const blocked = { getItem: denied, setItem: denied, removeItem: denied };
  expect(readBasket(blocked)).toEqual([]);
  expect(writeBasket(blocked, items)).toBe(false);
  expect(readBasket(null)).toEqual([]);
});
