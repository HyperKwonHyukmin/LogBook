import { aggregate, buildModel, diffShort, explainAgg, explainPair, isMember, parentsOf, pivotHubs, searchNodes } from './graphModel.js';

const DATA = {
  hulls: { 3370: '컨테이너선', 3508: '컨테이너선' },
  entries: [
    { id: 'E000001', title: '권상 A', analysis_type: '권상', hulls: ['3370', '3508'], zones: ['상갑판'], free: [], projects: [], revisions: [] },
    { id: 'E000002', title: '권상 B', analysis_type: '권상', hulls: ['3508'], zones: [], free: ['Truss'], projects: [], revisions: [] },
    { id: 'E000003', title: '계류 C', analysis_type: '계류', hulls: ['3370'], zones: ['상갑판'], free: [], projects: [], revisions: [] },
    { id: 'E000004', title: '공용', analysis_type: null, hulls: [], zones: [], free: [], projects: [], revisions: [] },
  ],
  pairs: [
    { a: 'E000002', b: 'E000003', type: 'geom', differs: ['load'], files: ['b.bdf', 'c.bdf'], count: 1 },
    { a: 'E000001', b: 'E000003', type: 'dup', differs: [], files: ['a.bdf', 'c.bdf'], count: 1 },
    { a: 'E000001', b: 'E009999', type: 'geom', differs: ['load'], files: [], count: 1 },   // 모르는 자료 — 버린다
  ],
  unsigned_models: 2,
};

test('기준 점·없음 묶음·소속', () => {
  const m = buildModel(DATA);
  const h3370 = m.byId.get('hull:3370');
  expect(h3370).toMatchObject({ cnt: 2, ship: '컨테이너선' });
  expect(m.NONE.hull.cnt).toBe(1);
  expect(pivotHubs(m, 'hull').map((h) => h.id)).toEqual(['hull:3370', 'hull:3508', 'hull:__none']);
  const lone = m.entries[3];
  expect(parentsOf(m, lone, 'hull')).toEqual([m.NONE.hull]);
  expect(isMember(lone, m.NONE.hull)).toBe(true);
  expect(m.pairs).toHaveLength(2);
  expect(m.unsigned).toBe(2);
});

test('기준 사이 관계 = 함께 등록 + 모델 쌍(주 기준끼리)', () => {
  const m = buildModel(DATA);
  const [a] = aggregate(m, 'hull');
  // E000001 이 두 호선에 함께 등록(span 1), E000002(3508)·E000003(3370) 형상 같음(geom 1),
  // E000001(주 3370)·E000003(3370) 은 같은 호선 안이라 세지 않는다
  expect(a).toMatchObject({ span: 1, geom: 1, dup: 0, c: 2 });
  expect(explainAgg(a, 'hull')).toBe('3370 ↔ 3508 · 관계 2건\n· 두 호선에 함께 등록된 자료 1건\n'
    + '· 형상이 같은 BDF 1쌍 — 한쪽 모델을 가져다 물성·하중을 바꿔 다시 푼 경우');
});

test('선 설명 문장', () => {
  const m = buildModel(DATA);
  const [geom, dup] = m.pairs;
  expect(explainPair(m, geom, 'hull')).toBe('E000002(3508), E000003(3370) 두 자료의 BDF는 형상이 같고 하중만 다릅니다.\nb.bdf ↔ c.bdf');
  expect(explainPair(m, dup, 'hull')).toMatch(/똑같은 BDF가 있습니다[\s\S]*정리할지 확인/);
  expect(diffShort(['load'])).toBe('하중만 다름');
  expect(diffShort(['property', 'load'])).toBe('물성·하중이 다름');
});

test('색 범례 — 많은 순, 없는 값은 기타', () => {
  const m = buildModel(DATA);
  expect(m.colors.atype.items.map((i) => i.label)).toEqual(['권상', '계류', '기타·없음']);
  expect(m.colors.atype.colorOf(m.entries[3])).toBe('#9AA1AB');
});

test('찾기 — 지금 기준 먼저', () => {
  const m = buildModel(DATA);
  expect(searchNodes(m, '33', 'hull')[0].id).toBe('hull:3370');
  expect(searchNodes(m, 'e000002', 'hull').map((n) => n.eid)).toEqual(['E000002']);
  expect(searchNodes(m, '  ', 'hull')).toEqual([]);
});
