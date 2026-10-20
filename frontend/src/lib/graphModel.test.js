import {
  aggregate, aggText, buildModel, diffShort, explainAgg, explainPair, isLoudPair, isMember, isReportOnly, pairsOf, parentsOf,
  pivotHubs, searchNodes, stepText,
} from './graphModel.js';

const DATA = {
  hulls: { 3370: '컨테이너선', 3508: '컨테이너선' },
  entries: [
    { id: 'E000001', title: '권상 A', hulls: ['3370', '3508'], zones: ['상갑판'], free: [], revisions: [] },
    { id: 'E000002', title: '권상 B', hulls: ['3508'], zones: [], free: ['Truss'], revisions: [] },
    { id: 'E000003', title: '계류 C', hulls: ['3370'], zones: ['상갑판'], free: [], revisions: [] },
    { id: 'E000004', title: '공용', hulls: [], zones: [], free: [], revisions: [] },
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
  // 42 — 자료 점 색은 선종만(해석 종류 색은 없앴다)
  expect(Object.keys(m.colors)).toEqual(['ship']);
  expect(m.colors.ship.items.map((i) => i.label)).toEqual(['컨테이너선', '기타·없음']);
  expect(m.colors.ship.colorOf(m.entries[3])).toBe('#9AA1AB');
});

test('찾기 — 지금 기준 먼저', () => {
  const m = buildModel(DATA);
  expect(searchNodes(m, '33', 'hull')[0].id).toBe('hull:3370');
  expect(searchNodes(m, 'e000002', 'hull').map((n) => n.eid)).toEqual(['E000002']);
  expect(searchNodes(m, '  ', 'hull')).toEqual([]);
});

// ── 32 문서 관계 ──
const DOCS = {
  hulls: {},
  entries: [
    { id: 'E000011', title: '모델', hulls: ['3370'], zones: [], free: [], revisions: [], models: 1, reports: 0 },
    { id: 'E000012', title: '보고서', hulls: ['3508'], zones: [], free: [], revisions: [], models: 0, reports: 2 },
    { id: 'E000013', title: '보고서 2차', hulls: ['3508'], zones: [], free: [], revisions: [], models: 0, reports: 1 },
  ],
  pairs: [],
  doc_pairs: [
    { a: 'E000011', b: 'E000012', type: 'uses', from: 'E000012', files: ['r.pdf', 'm.bdf'], score: null, count: 1,
      kinds: { uses: 1, rrev: 0, text: 0 } },
    { a: 'E000012', b: 'E000013', type: 'rrev', files: ['r_r1.pdf', 'r_r2.pdf'], score: 0.82, count: 1,
      kinds: { uses: 0, rrev: 1, text: 0 } },
    { a: 'E000011', b: 'E000013', type: 'text', files: ['a.pdf', 'b.pdf'], score: 0.912, count: 1,
      kinds: { uses: 0, rrev: 0, text: 1 } },
  ],
  doc_index: { reports: 3, indexed: 2, vectors: 2, available: true },
};

test('문서 층 — 층별 선, 보고서만 있는 자료, 기준 사이 집계', () => {
  const m = buildModel(DOCS);
  expect(pairsOf(m, 'model')).toHaveLength(0);
  expect(pairsOf(m, 'doc')).toHaveLength(3);
  expect(pairsOf(m, 'all')).toHaveLength(3);
  expect(m.docPairs[0].from).toBe(m.entries[1]);
  expect(isReportOnly(m.entries[0])).toBe(false);
  expect(isReportOnly(m.entries[1])).toBe(true);
  expect(isLoudPair(m.docPairs[1])).toBe(true);
  expect(isLoudPair(m.docPairs[2])).toBe(false);
  const [a] = aggregate(m, 'hull', 'doc');
  expect(a).toMatchObject({ uses: 1, text: 1, rrev: 0, c: 2 });   // rrev 는 같은 호선(3508) 안이라 세지 않는다
  expect(aggregate(m, 'hull', 'model')).toEqual([]);
  expect(aggText(a)).toBe('사용한 모델 1 · 본문 비슷함 1');
  expect(m.docIndex.indexed).toBe(2);
});

test('문서 선 설명 문장', () => {
  const m = buildModel(DOCS);
  const [uses, rrev, text] = m.docPairs;
  expect(explainPair(m, uses, 'hull')).toBe('E000012(3508)의 보고서가 E000011(3370)의 모델을 사용했습니다.\nr.pdf → m.bdf');
  expect(explainPair(m, rrev, 'hull')).toMatch(/같은 보고서의 다른 판이 있습니다 — 본문이 82% 겹칩니다[\s\S]*한 자료로 모아/);
  expect(explainPair(m, { ...rrev, score: null }, 'hull')).toMatch(/이름이 같은 계열입니다\(본문 색인 전\)/);
  expect(explainPair(m, text, 'hull')).toMatch(/본문 내용이 비슷합니다\(의미 유사도 0\.91\)/);
});

test('보고서 판 단계 문장', () => {
  expect(stepText(null)).toBeNull();
  expect(stepText({ changed: 3, added: 2, removed: 0, overlap: 0.82 })).toBe('쪽 3곳 바뀜 · 쪽 +2 · 본문 82% 같음');
  expect(stepText({ changed: 0, added: 1, removed: 1, overlap: null })).toBe('쪽 +1 −1');
  expect(stepText({ changed: 0, added: 0, removed: 0, overlap: null })).toBe('바뀐 쪽 없음');
});

test('35 — 선종·크기급 기준: 호선들의 값을 모으고, 값 없는 자료는 없음 묶음', () => {
  const m = buildModel({
    ...DATA,
    hulls: { 3370: '174K LNG', 3508: '4500 CNTR', 3600: '180K LNG' },
    hull_kinds: { 3370: 'LNG', 3508: 'CNTR', 3600: 'LNG' },
    hull_sizes: { 3370: '174K급 LNG', 3508: '4500급 CNTR', 3600: '180K급 LNG' },
    entries: [
      ...DATA.entries,
      { id: 'E000005', title: '계류 E', hulls: ['3600'], zones: [], free: [], revisions: [] },
    ],
  });
  const [a, b, c, lone, e] = m.entries;
  expect(a.of.kind.map((h) => h.label)).toEqual(['LNG', 'CNTR'])         // 두 호선 → 두 선종
  expect(a.of.size.map((h) => h.label)).toEqual(['174K급 LNG', '4500급 CNTR']);
  expect(e.of.kind[0]).toBe(c.of.kind[0]);                               // 3600·3370 은 같은 LNG 점
  expect(e.of.size[0]).not.toBe(c.of.size[0]);                           // 크기급은 용량까지 달라 다른 점
  expect(m.byId.get('kind:LNG').cnt).toBe(3);
  expect(parentsOf(m, lone, 'kind')).toEqual([m.NONE.kind]);
  expect(m.NONE.size.label).toBe('크기급 없음');
  // 기준 사이 관계: E000002(CNTR)·E000003(LNG) 형상 같음 → LNG ↔ CNTR
  const agg = aggregate(m, 'kind');
  expect(agg).toHaveLength(1);
  expect(explainAgg(agg[0], 'kind')).toContain('두 선종에 함께 등록된 자료 1건');
  expect(b.of.kind.map((h) => h.label)).toEqual(['CNTR']);
});

test('30 — 선종 정보가 없는 응답(옛 서버)도 깨지지 않는다', () => {
  const m = buildModel(DATA);
  expect(m.NONE.kind.cnt).toBe(4);
  expect(pivotHubs(m, 'kind').map((h) => h.id)).toEqual(['kind:__none']);
});

test('35 — 같은 용량이라도 선종이 다르면 다른 크기급', () => {
  const m = buildModel({
    ...DATA,
    hulls: { 3370: '174K LNG', 3508: '174K B/C' },
    hull_kinds: { 3370: 'LNG', 3508: 'B/C' },
    hull_sizes: { 3370: '174K급 LNG', 3508: '174K급 B/C' },
  });
  expect(pivotHubs(m, 'size').filter((h) => !h.none).map((h) => h.label).sort()).toEqual(['174K급 B/C', '174K급 LNG']);
});
