import { compareLayout } from './compareLayout.js';

const kinds = (l) => l.cells.map((c) => (c.kind === 'pane' ? c.index : 'empty'));

test('개수별 배치', () => {
  expect(compareLayout(0)).toMatchObject({ cols: 1, rows: 1 });
  expect(kinds(compareLayout(0))).toEqual(['empty']);
  expect(compareLayout(1)).toMatchObject({ cols: 1, rows: 1 });
  expect(compareLayout(2)).toMatchObject({ cols: 2, rows: 1 });
  expect(compareLayout(3)).toMatchObject({ cols: 2, rows: 2 });
  expect(kinds(compareLayout(3))).toEqual([0, 1, 2, 'empty']);
  expect(kinds(compareLayout(4))).toEqual([0, 1, 2, 3]);
});

test('좁은 창은 위아래로 쌓는다(안내 칸 없음)', () => {
  const l = compareLayout(3, { width: 900 });
  expect(l).toMatchObject({ cols: 1, rows: 3, stacked: true });
  expect(kinds(l)).toEqual([0, 1, 2]);
  expect(compareLayout(3, { width: 1024 }).stacked).toBe(false);
});

test('크게 보기는 그 칸 하나, 범위 밖이면 무시', () => {
  expect(kinds(compareLayout(4, { maximized: 2 }))).toEqual([2]);
  expect(kinds(compareLayout(2, { maximized: 5 }))).toEqual([0, 1]);
});
