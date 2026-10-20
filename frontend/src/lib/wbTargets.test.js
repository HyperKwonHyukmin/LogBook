import { needText, ruleFilter, ruleIsEmpty } from './wbTargets.js';

test('규칙이 비면 제한·필터가 없다', () => {
  expect(ruleIsEmpty(null)).toBe(true);
  expect(ruleIsEmpty({ zones: [], tags: [] })).toBe(true);
  expect(ruleFilter({ zones: [], tags: [] })).toBeNull();
  expect(needText({ zones: [], tags: [] })).toBe('');
});

test('좁은 자리 안내 — 태그만/구역만/둘 다', () => {
  expect(needText({ zones: [], tags: ['Truss'] })).toBe('태그 필요');
  expect(needText({ zones: ['선수부'], tags: [] })).toBe('구역 필요');
  expect(needText({ zones: ['선수부'], tags: ['Truss'] })).toBe('분류 필요');
  expect(needText({ zones: [], targets: ['Truss'], tags: [] })).toBe('대상 필요');   // 40
  expect(needText({ zones: [], targets: ['Truss'], tags: ['Truss'] })).toBe('분류 필요');
  expect(ruleIsEmpty({ zones: [], targets: ['Truss'], tags: [] })).toBe(false);
});

test('40 — 대상 칸: 태그가 없으면 대상으로 거르고, 나머지는 안내 라벨', () => {
  expect(ruleFilter({ zones: ['선수부'], targets: ['Truss'], tags: [] }))
    .toEqual({ key: 'target', values: ['Truss'], label: "대상 'Truss'", others: ["구역 '선수부'"] });
  expect(ruleFilter({ zones: [], targets: ['Truss'], tags: ['Truss'] }).others).toEqual(["대상 'Truss'"]);
});

test('검색 필터는 한 칸(태그 우선)에 그 칸 규칙 값 전부(OR) — 다른 칸은 안내용 라벨(19)', () => {
  expect(ruleFilter({ zones: [], tags: ['Truss'] })).toEqual({ key: 'tag', values: ['Truss'], label: "태그 'Truss'", others: [] });
  expect(ruleFilter({ zones: ['선수부'], tags: [] })).toEqual({ key: 'zone', values: ['선수부'], label: "구역 '선수부'", others: [] });
  const f = ruleFilter({ zones: ['선수부', '선미부'], tags: ['Truss', 'Frame'] });
  expect(f.key).toBe('tag');
  expect(f.values).toEqual(['Truss', 'Frame']);
  expect(f.label).toBe("태그 'Truss' 또는 'Frame'");
  expect(f.others).toEqual(["구역 '선수부'", "구역 '선미부'"]);
  expect(ruleFilter({ zones: ['선수부', '선미부'], tags: [] })).toMatchObject({ key: 'zone', values: ['선수부', '선미부'], others: [] });
});
