import {
  addItem, briefFromSeries, diffChips, diffErrorText, diffStatus, editorState, hasPending, layoutBody, moveItem,
  removeItem, revisionBrief, setLabel, setLatest, singletonSeries,
} from './revisions.js';

const ZERO = {
  nodes: { added: 0, removed: 0, moved: 0 }, elements: { added: 0, removed: 0, conn_changed: 0, card_changed: 0, pid_changed: 0, other_changed: 0 },
  rigids: {}, properties: { added: 0, removed: 0, changed: 0, thickness: 0, section: 0 }, materials: {}, loads: {}, mass: {}, control: {},
};

test('칩 — 요소 증감·두께·하중', () => {
  const s = { ...ZERO, elements: { ...ZERO.elements, added: 120, removed: 8 },
    properties: { added: 0, removed: 0, changed: 3, thickness: 3, section: 0 }, loads: { sets_changed: 1 } };
  expect(diffChips(s)).toEqual(['요소 +120 −8', '두께 3건', '하중 변경']);
});

test('칩 — 같으면 변경 없음, 많으면 외 N', () => {
  expect(diffChips({ identical: true })).toEqual(['변경 없음']);
  const s = { ...ZERO, nodes: { added: 1, removed: 0, moved: 5 }, elements: { ...ZERO.elements, added: 1, pid_changed: 2 },
    properties: { added: 1, removed: 0, changed: 1, thickness: 1, section: 0 }, materials: { changed: 1 }, mass: { changed: 1 },
    control: { changed: true } };
  const chips = diffChips(s, 4);
  expect(chips).toHaveLength(5);
  expect(chips[4]).toMatch(/^외 \d+$/);
  expect(diffChips(s, 20)).toEqual(['요소 +1', 'PID 변경 2', '절점 +1', '절점 이동 5', '두께 1건', '속성 1건', '재료 1건', '질량 변경', '해석 설정 변경']);
});

test('상태 문구', () => {
  expect(diffStatus(null).text).toBe('비교 전');
  expect(diffStatus({ state: 'waiting' }).text).toBe('변환 대기');
  expect(diffStatus({ state: 'running' })).toEqual({ tone: 'busy', text: '비교 중' });
  expect(diffStatus({ state: 'error', error: 'drm' }).text).toBe('비교 실패: DRM 암호화 파일입니다');
  expect(diffStatus({ state: 'done', summary: { identical: true } }).text).toBe('변경 없음');
  expect(diffErrorText('file_missing: x')).toBe('원본 파일을 찾을 수 없습니다');
  expect(diffErrorText('Boom')).toBe('Boom');
  expect(hasPending([{ state: 'done' }, { state: 'queued' }])).toBe(true);
  expect(hasPending([{ state: 'done' }])).toBe(false);
});

test('검색 행 한 줄', () => {
  expect(revisionBrief({ series: 1, files: 3, latest: 'R2' })).toBe('판 3개 · 최신 R2');
  expect(revisionBrief({ series: 2, files: 2, latest: 'R1' })).toBe('계열 2 · 판 2개 · 최신 R1');
  expect(revisionBrief(null)).toBe('');
  expect(briefFromSeries([{ items: [{ display: 'R0' }, { display: 'R1', is_latest: true }] },
    { items: [{ display: 'R0' }, { display: 'R1' }, { display: 'R2', is_latest: true }] }]))
    .toEqual({ series: 2, files: 3, latest: 'R2' });
});

const DATA = {
  token: 't1',
  series: [{ key: 'n:a', items: [
    { file_id: 1, name: 'deck.bdf', label: null, auto_label: 'R0', is_latest: false },
    { file_id: 2, name: 'deck_r1.bdf', label: null, auto_label: 'R1', is_latest: false },
    { file_id: 3, name: 'deck_r2.bdf', label: '최종', auto_label: 'R2', is_latest: true }] }],
  others: [{ file_id: 9, name: 'other.bdf' }],
};

test('판 정리 — 옮기기·빼기·넣기·최신판·이름 → 저장 본문', () => {
  let st = editorState(DATA);
  expect(st.series[0].latest).toBe(3);
  expect(st.series[0].items[2].label).toBe('최종');
  st = moveItem(st, 0, 3, -1);                         // r2 를 위로
  expect(st.series[0].items.map((x) => x.file_id)).toEqual([1, 3, 2]);
  expect(moveItem(st, 0, 1, -1)).toBe(st);             // 맨 위는 그대로
  st = removeItem(st, 0, 1);
  expect(st.others.map((x) => x.file_id)).toEqual([9, 1]);
  st = addItem(st, 9, 0);                              // 끝에 — 최신판이 끝이 아니었으므로 그대로
  expect(st.series[0].items.map((x) => x.file_id)).toEqual([3, 2, 9]);
  expect(st.series[0].latest).toBe(3);
  st = setLatest(st, 0, 9);
  st = setLabel(st, 0, 9, '  중간판  ');
  st = addItem(st, 1, 'new');
  expect(singletonSeries(st)).toBe(1);
  expect(layoutBody(st, 't1')).toEqual({ token: 't1', series: [
    { file_ids: [3, 2, 9], latest: 9, labels: { 3: '최종', 9: '중간판' } },
    { file_ids: [1], latest: 1, labels: {} }] });
});

test('최신판을 빼면 남은 마지막이 최신판, 마지막 판을 빼면 계열이 사라진다', () => {
  let st = editorState(DATA);
  st = removeItem(st, 0, 3);
  expect(st.series[0].latest).toBe(2);
  st = removeItem(removeItem(st, 0, 1), 0, 2);
  expect(st.series).toEqual([]);
  expect(st.others.map((x) => x.file_id)).toEqual([9, 3, 1, 2]);
});

test('끝이 최신판이면 새로 넣은 판이 최신판', () => {
  const st = addItem(editorState(DATA), 9, 0);
  expect(st.series[0].latest).toBe(9);
});
