import { compareLines, titleWithoutHull, likeWord, longest, mixText, orderResults, sectionUnion, sizeText } from './similar.js';

const base = { dims: [22, 7.7, 1.5], elems: 960, mix: [0.92, 0, 0.06, 0.02], sections: ['L 100x100x10', 'H 300x300x10x15'],
  zone: '정반' };

test('말과 표기', () => {
  expect(likeWord(0.95)).toBe('거의 같음');
  expect(likeWord(0.75)).toBe('많이 비슷');
  expect(likeWord(0.55)).toBe('일부 비슷');
  expect(likeWord(0.2)).toBe('참고만');
  expect(sizeText([22, 7.73, 1.5])).toBe('22 × 7.7 × 1.5 m');
  expect(longest([128.4, 64, 41])).toBe('128 m');
  expect(mixText([0.9, 0.05, 0, 0.05])).toBe('보 위주(보 90%)');
  expect(mixText([0.2, 0.75, 0, 0.05])).toBe('쉘 위주(쉘 75%)');
});

test('같은 설계는 같은 점에, 차이는 다른 점에', () => {
  const other = { ...base, elems: 3000, sections: ['L 100x100x10', 'T 250x90x10x15'], zones: ['블록'] };
  const c = compareLines(base, other, { shape: true, raw: { size: 0.9, mix: 0.95 }, same_sections: ['L 100x100x10'] });
  expect(c.same).toEqual(['형상 같음(같은 설계)', '크기 비슷', '보 위주']);
  expect(c.diff[0]).toBe('요소 3.1배 (3,000개)');
  expect(c.diff).toContain('단면 1개 다름 (T 250x90x10x15)');
  expect(c.diff).toHaveLength(3);
});

test('단면 합집합과 검증 통과 먼저 정렬', () => {
  expect(sectionUnion(base, { sections: ['L 100x100x10', 't12'] })).toEqual([
    { label: 'H 300x300x10x15', where: 'base' }, { label: 'L 100x100x10', where: 'both' }, { label: 't12', where: 'other' },
  ]);
  const rs = [
    { best: 0.9, lead: { solve: 'fail', reports: 1 } },
    { best: 0.7, lead: { solve: 'pass', reports: 0 } },
    { best: 0.6, lead: { solve: 'pass', reports: 2 } },
  ];
  expect(orderResults(rs, 'pass').map((r) => r.best)).toEqual([0.6, 0.7, 0.9]);
  expect(orderResults(rs, 'like')).toBe(rs);
});

test('제목 머리의 같은 호선은 뺀다', () => {
  expect(titleWithoutHull('3515 · Unit · 강도 평가', ['3515'])).toBe('Unit · 강도 평가');
  expect(titleWithoutHull('3515 · Unit · 강도 평가', ['3600'])).toBe('3515 · Unit · 강도 평가');
  expect(titleWithoutHull('특수선 모델', ['3515'])).toBe('특수선 모델');
});
