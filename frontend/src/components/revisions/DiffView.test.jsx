import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { CompareBasketProvider } from '../compare/CompareBasket.jsx';
import { ViewerEngineContext } from '../viewer/ViewerEngineContext.js';
import { fakeEngine } from '../../test/fakeEngine.js';
import { calls, mockApi } from '../../test/mockApi.js';
import { encodeModel, sampleModel } from '../../test/modelFixtures.js';
import ComparePage from '../../pages/ComparePage.jsx';

// 16 — 판 변경 보기(/compare?ids=a,b&view=diff). 가짜 엔진에 무엇을 넘기는지, 범례·토글·전후 값 카드·진입 토글.
const meta = (id, name) => ({ id, name, rel_path: `model/${name}`, kind: 'model', size: 10, entry_id: 'E000001',
  entry_title: '9999 판 자료', entry_status: 'confirmed', drm_encrypted: false });
const summary = (key) => ({ state: 'done', has_lbm: true, key, counts: { CBEAM: 1, CQUAD4: 1, CTRIA3: 1, GRID: 5 },
  bbox: { min: [0, 0, 0], max: [1000, 1000, 500] }, sol: '101', warnings: [], solve: null, format_version: 1 });
const SUMMARY = { identical: false, nodes: { added: 1 }, elements: {}, rigids: {}, properties: {}, materials: {}, loads: {}, mass: {}, control: {} };
const DETAIL = {
  limits: { ids: 5000 },
  nodes: { added: [5], removed: [3], moved: [2] },
  elements: { added: [10], removed: [21], conn: [20], pid: [], card: [], other: [] },
  rigids: { added: [], removed: [], indep: [], dep: [], other: [] },
  loads: { spc_nodes: [] },
  truncated: { 'elements.added': 9000 },
};
const ITEM = {
  a_file: 1, b_file: 2, diff_ready: true, kind: 'element', id: 20, status: 'changed', changes: ['nodes'],
  a: { card: 'CQUAD4', pid: 5, nodes: [1, 2, 3, 4], coords: [[0, 0, 0], [1000, 0, 0], [1000, 1000, 0], [0, 1000, 0]] },
  b: { card: 'CQUAD4', pid: 5, nodes: [1, 2, 5, 4], coords: [[0, 0, 0], [1000, 0, 0], [1000, 1000, 500], [0, 1000, 0]] },
  detail: { 'elements.conn': true },
};
const REVISIONS = {
  entry_id: 'E000001', token: 't', manual: false, can_edit: false, others: [],
  series: [{ key: 'n:deck', manual: false, diffs: [], items: [{ file_id: 1, name: 'deck.bdf', display: 'R0' }, { file_id: 2, name: 'deck_r1.bdf', display: 'R1' }] }],
};

const API = {
  'GET /api/files/1': meta(1, 'deck.bdf'),
  'GET /api/files/2': meta(2, 'deck_r1.bdf'),
  'GET /api/entries/E000001': { entry_id: 'E000001', hulls: [{ hull_no: '9999' }] },
  'GET /api/entries/E000001/revisions': REVISIONS,
  'GET /api/files/1/model': summary('k1'),
  'GET /api/files/2/model': summary('k2'),
  'GET /api/files/1/model.lbm': { __binary: encodeModel(sampleModel()) },
  'GET /api/files/2/model.lbm': { __binary: encodeModel(sampleModel()) },
  'POST /api/files/1/diff/2': { a: 1, b: 2, id: 7, state: 'done', summary: SUMMARY, stale: false },
  'GET /api/files/1/diff/2/detail': DETAIL,
  'GET /api/files/1/diff/2/item?kind=element&id=20': ITEM,
  'POST /api/me/compares': { ok: true },
};

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function setup(url = '/compare?ids=1,2&view=diff', extra = {}) {
  const fetch = mockApi({ ...API, ...extra });
  const engines = [];
  const factory = vi.fn(async () => {
    const e = fakeEngine({ kind: 'element', index: 2 });
    engines.push(e);
    return e;
  });
  render(
    <ViewerEngineContext.Provider value={factory}>
      <MemoryRouter initialEntries={[url]}>
        <CompareBasketProvider>
          <Routes>
            <Route path="/compare" element={<><ComparePage /><Where /></>} />
            <Route path="*" element={<Where />} />
          </Routes>
        </CompareBasketProvider>
      </MemoryRouter>
    </ViewerEngineContext.Provider>,
  );
  return { engines, fetch };
}

test('변경 보기 — 뒤 판 하나만 그리고 엔진에 범주 spec 을 넘긴다, 범례 개수·잘림', async () => {
  const { engines, fetch } = setup();
  await waitFor(() => expect(engines[0]?.setDiff).toHaveBeenCalledWith(expect.objectContaining({ elemClass: expect.any(Uint8Array) })));
  expect(engines).toHaveLength(1);                                  // 칸 하나(뒤 판)
  expect(calls(fetch)).toContain('POST /api/files/1/diff/2');       // 비교 요청(있으면 그대로)
  const spec = engines[0].setDiff.mock.calls.at(-1)[0];
  expect([...spec.elemClass]).toEqual([1, 0, 2]);
  expect(spec.ghost.items.map((x) => x.id)).toEqual([21]);
  const legend = await screen.findByRole('region', { name: '변경 범례' });
  const row = (name) => within(legend).getByRole('checkbox', { name: `${name} 표시` }).closest('li');
  expect(row('추가')).toHaveTextContent('2');                       // 요소 1 + 절점 1
  expect(row('추가')).toHaveTextContent('추가 요소 9,000개 중 5,000개만 표시');
  expect(row('변경')).toHaveTextContent('1');
  expect(row('삭제')).toHaveTextContent('요소 1 · 절점 1');
  expect(row('이동한 절점')).toHaveTextContent('1');
  expect(within(legend).getByRole('checkbox', { name: '구속이 바뀐 절점 표시' })).toBeDisabled();   // 0개
  // 머리줄 — 앞 판 → 뒤 판, 공통 툴바 색 기준은 잠김
  const pane = screen.getByRole('article', { name: '변경 보기' });
  expect(within(pane).getByRole('heading', { level: 2 })).toHaveTextContent('deck.bdf에서deck_r1.bdf');
  expect(screen.queryByRole('radiogroup', { name: '색 기준' })).toBeNull();
  expect(screen.getByText('변경 범주')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '카메라 동기화' })).toBeNull();
});

test('범주 켜기/끄기·바뀐 것만 보기·바뀐 곳으로 맞춤', async () => {
  const user = userEvent.setup();
  const { engines } = setup();
  const legend = await screen.findByRole('region', { name: '변경 범례' });
  const e = engines[0];
  await user.click(within(legend).getByRole('checkbox', { name: '삭제 표시' }));
  expect(e.setDiffLayers).toHaveBeenLastCalledWith(expect.objectContaining({ removed: false, added: true }));
  await user.click(within(legend).getByRole('button', { name: '바뀐 것만 보기' }));
  expect(e.setDiffLayers).toHaveBeenLastCalledWith(expect.objectContaining({ onlyChanged: true, unchanged: false }));
  expect(within(legend).getByRole('button', { name: '바뀐 것만 보기' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(legend).getByRole('checkbox', { name: '변경 없음 표시' })).not.toBeChecked();
  await user.click(within(legend).getByRole('button', { name: '바뀐 곳으로 맞춤' }));
  expect(e.frameDiff).toHaveBeenCalled();
  // 초기화(R) — 범주를 처음으로
  await user.click(screen.getByRole('button', { name: /초기화/ }));
  await waitFor(() => expect(e.setDiffLayers).toHaveBeenLastCalledWith(expect.objectContaining({ removed: true, onlyChanged: false })));
  // 범례 접기(제목) — 이 브라우저에 기억
  await user.click(within(legend).getByRole('button', { name: '변경 보기' }));
  expect(within(legend).queryByRole('checkbox', { name: '추가 표시' })).toBeNull();
  expect(localStorage.getItem('lb.diff.legend.collapsed.v1')).toBe('1');
  await user.click(within(legend).getByRole('button', { name: '변경 보기' }));
  expect(within(legend).getByRole('checkbox', { name: '추가 표시' })).toBeInTheDocument();
});

test('누르면 전후 값 카드 — 앞/뒤 값, 바뀐 행, 비교 결과 이유, 이동 전 모양', async () => {
  const { engines, fetch } = setup();
  await screen.findByRole('region', { name: '변경 범례' });
  const canvas = screen.getByTestId('diff-canvas-2');
  fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerUp(canvas, { clientX: 100, clientY: 100, button: 0 });
  const card = await screen.findByRole('region', { name: '요소 20 전후 값' });
  expect(calls(fetch)).toContain('GET /api/files/1/diff/2/item?kind=element&id=20');
  await within(card).findByText('1 · 2 · 3 · 4');
  expect(within(card).getByText('1 · 2 · 5 · 4')).toBeInTheDocument();
  expect(within(card).getByText('변경')).toBeInTheDocument();
  expect(within(card).getByText(/비교 결과: 절점 연결 변경/)).toBeInTheDocument();
  expect(within(card).getAllByText('(바뀜)').length).toBeGreaterThan(0);
  await waitFor(() => expect(engines[0].setDiffFocus).toHaveBeenLastCalledWith(expect.objectContaining({ segs: expect.any(Array) })));
  await userEvent.setup().click(within(card).getByRole('button', { name: '선택 해제' }));
  expect(screen.queryByRole('region', { name: '요소 20 전후 값' })).toBeNull();
});

test('비교가 아직이면 상태 문구, 같으면 같다고', async () => {
  setup('/compare?ids=1,2&view=diff', { 'POST /api/files/1/diff/2': { a: 1, b: 2, id: 7, state: 'queued', summary: null, stale: false },
                                       'GET /api/files/1/diff/2': { a: 1, b: 2, id: 7, state: 'queued', summary: null, stale: false } });
  expect(await screen.findByText(/비교 중입니다/)).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '변경 범례' })).toBeNull();
});

test('같은 모델이면 바뀐 것이 없다고', async () => {
  setup('/compare?ids=1,2&view=diff', { 'POST /api/files/1/diff/2': { a: 1, b: 2, id: 7, state: 'done', summary: { identical: true }, stale: false } });
  expect(await screen.findByText(/두 판의 모델 내용이 같습니다/)).toBeInTheDocument();
});

test('나란히 비교에서 같은 계열 두 판이면 [나란히 | 변경 보기] 토글 — 계열 순서로 연다', async () => {
  const user = userEvent.setup();
  const { engines } = setup('/compare?ids=2,1');
  await waitFor(() => expect(engines).toHaveLength(2));
  const toggle = await screen.findByRole('radiogroup', { name: '비교 방식' });
  expect(within(toggle).getByRole('radio', { name: '나란히' })).toBeChecked();
  await user.click(within(toggle).getByRole('radio', { name: '변경 보기' }));
  await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/compare?ids=1,2&view=diff'));
  expect(await screen.findByRole('article', { name: '변경 보기' })).toBeInTheDocument();
  await user.click(screen.getByRole('radio', { name: '나란히' }));
  await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/compare?ids=1,2'));
  expect(screen.getByTestId('where').textContent).not.toContain('view=diff');
});

test('계열이 아니면 토글이 없다', async () => {
  const { engines } = setup('/compare?ids=1,2', { 'GET /api/entries/E000001/revisions': { ...REVISIONS, series: [] } });
  await waitFor(() => expect(engines).toHaveLength(2));
  await new Promise((r) => { setTimeout(r, 30); });
  expect(screen.queryByRole('radiogroup', { name: '비교 방식' })).toBeNull();
});
