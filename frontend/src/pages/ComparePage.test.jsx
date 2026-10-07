import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { CompareBasketProvider } from '../components/compare/CompareBasket.jsx';
import { ViewerEngineContext } from '../components/viewer/ViewerEngineContext.js';
import { BASKET_KEY } from '../lib/compareBasket.js';
import { fakeEngine } from '../test/fakeEngine.js';
import { mockApi } from '../test/mockApi.js';
import { encodeModel, sampleModel } from '../test/modelFixtures.js';
import ComparePage from './ComparePage.jsx';

/** 개정판 둘 — rev2 는 PID 1 치수가 바뀌고 PID 9(PROD)가 더 있다. */
function lbm(rev) {
  const m = sampleModel();
  if (rev === 2) {
    m.header.properties = { ...m.header.properties, 1: { card: 'PBEAML', mid: 1, type: 'L', dims: [100, 100, 12, 12] },
                            9: { card: 'PROD', mid: 1, A: 50 } };
  }
  return encodeModel(m);
}
const meta = (id, name, entry) => ({ id, name, rel_path: `model/${name}`, kind: 'model', size: 10, entry_id: entry,
  entry_title: `${name} 자료`, entry_status: 'confirmed', drm_encrypted: false });
const summary = (key, counts, z) => ({ state: 'done', has_lbm: true, key, counts, bbox: { min: [0, 0, 0], max: [1000, 1000, z] },
  sol: '101', warnings: [], solve: null, format_version: 1 });

const API = {
  'GET /api/files/1': meta(1, 'rev1.bdf', 'E000001'),
  'GET /api/entries/E000001': { entry_id: 'E000001', hulls: [{ hull_no: '9999' }] },
  'GET /api/files/1/model': summary('k1', { CBEAM: 1, CQUAD4: 1, CTRIA3: 1, GRID: 5 }, 500),
  'GET /api/files/1/model.lbm': { __binary: lbm(1) },
  'GET /api/files/2': meta(2, 'rev2.bdf', 'E000002'),
  'GET /api/entries/E000002': { entry_id: 'E000002', hulls: [{ hull_no: '9999' }] },
  'GET /api/files/2/model': summary('k2', { CBEAM: 2, CQUAD4: 1, CTRIA3: 1, GRID: 6 }, 600),
  'GET /api/files/2/model.lbm': { __binary: lbm(2) },
  'GET /api/files/3': meta(3, 'wait.bdf', null),
  'GET /api/files/3/model': { state: 'queued', has_lbm: false, solve: null },
};

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

/** 칸마다 가짜 엔진 — 카메라 반지름은 10, 20 …, 카메라 알림 함수를 잡아 둔다. */
function setup(ids = '1,2', { from = null } = {}) {
  mockApi(API);
  const engines = [];
  const factory = vi.fn(async () => {
    const e = fakeEngine();
    const radius = 10 * (engines.length + 1);
    e.getCameraState.mockImplementation(() => ({
      projection: 'ortho', position: [4, -4, 3], target: [1, 0, 0], quaternion: [0, 0, 0, 1], up: [0, 0, 1],
      view: radius, radius, center: [radius * 100, 0, 0],
    }));
    e.onCameraChange.mockImplementation((cb) => { e.cameraCb = cb; return () => { e.cameraCb = null; }; });
    engines.push(e);
    return e;
  });
  render(
    <ViewerEngineContext.Provider value={factory}>
      <MemoryRouter initialEntries={from ? [from, `/compare?ids=${ids}`] : [`/compare?ids=${ids}`]} initialIndex={from ? 1 : 0}>
        <CompareBasketProvider>
          <Routes>
            <Route path="/compare" element={<><ComparePage /><Where /></>} />
            <Route path="*" element={<Where />} />
          </Routes>
        </CompareBasketProvider>
      </MemoryRouter>
    </ViewerEngineContext.Provider>,
  );
  return { engines, factory };
}

const ready = async (engines, n) => {
  await waitFor(() => expect(engines.filter((e) => e.setModel.mock.calls.length > 0)).toHaveLength(n));
  await waitFor(() => engines.forEach((e) => expect(e.onCameraChange).toHaveBeenCalled()));
};

test('칸 머리줄 — 이름·호선·Entry, 주소로 열면 바구니를 맞춘다', async () => {
  const { engines } = setup();
  await ready(engines, 2);
  const pane1 = screen.getByRole('article', { name: 'rev1.bdf' });
  expect(within(pane1).getByRole('heading', { name: 'rev1.bdf' })).toBeInTheDocument();
  expect(within(pane1).getByRole('link', { name: '9999' })).toHaveAttribute('href', '/h/9999');
  expect(within(pane1).getByRole('link', { name: 'E000001' })).toHaveAttribute('href', '/e/E000001?file=1');
  await waitFor(() => expect(JSON.parse(localStorage.getItem(BASKET_KEY))).toEqual([
    { id: 1, name: 'rev1.bdf', hull: '9999' }, { id: 2, name: 'rev2.bdf', hull: '9999' },
  ]));
});

test('공통 툴바는 모든 칸에 적용된다', async () => {
  const user = userEvent.setup();
  const { engines } = setup();
  await ready(engines, 2);
  await user.click(screen.getByRole('radio', { name: '그룹' }));
  engines.forEach((e) => expect(e.setColorMode).toHaveBeenLastCalledWith('group'));
  await user.click(screen.getByRole('radio', { name: '원근' }));
  engines.forEach((e) => expect(e.setProjection).toHaveBeenLastCalledWith('persp'));
  await user.click(screen.getByRole('button', { name: '자르기' }));
  await user.click(screen.getByRole('radio', { name: 'Z' }));
  engines.forEach((e) => expect(e.setClip).toHaveBeenLastCalledWith(expect.objectContaining({ on: true, axis: 'z' })));
});

test('카메라 동기화 — 각 모델 크기 기준(기본)과 같은 좌표, 끄면 따라가지 않는다', async () => {
  const user = userEvent.setup();
  const { engines } = setup();
  await ready(engines, 2);
  const [a, b] = engines;
  b.setCameraState.mockClear();
  act(() => { a.cameraCb(); });
  // 크기 기준: 반지름 10 → 20, 보이는 크기 10 → 20, target (1,0,0) → (2,0,0)
  await waitFor(() => expect(b.setCameraState).toHaveBeenCalledWith(expect.objectContaining({ view: 20, target: [2, 0, 0] })));
  expect(a.setCameraState).not.toHaveBeenCalled();

  await user.click(screen.getByRole('radio', { name: '같은 좌표' }));
  b.setCameraState.mockClear();
  act(() => { a.cameraCb(); });
  // 같은 좌표: 원래 좌표 target 1+1000 → b 좌표 1001−2000 = −999, 크기 그대로
  await waitFor(() => expect(b.setCameraState).toHaveBeenCalledWith(expect.objectContaining({ view: 10, target: [-999, 0, 0] })));

  // 주인이 바뀌면 반대로 따라간다
  a.setCameraState.mockClear();
  act(() => { b.cameraCb(); });
  await waitFor(() => expect(a.setCameraState).toHaveBeenCalled());

  await user.click(screen.getByRole('button', { name: '카메라 동기화' }));
  b.setCameraState.mockClear();
  act(() => { a.cameraCb(); });
  await new Promise((r) => { setTimeout(r, 40); });
  expect(b.setCameraState).not.toHaveBeenCalled();
});

test('시점·맞춤 — 동기화 중엔 주인 칸에, 끄면 모든 칸에', async () => {
  const user = userEvent.setup();
  const { engines } = setup();
  await ready(engines, 2);
  const [a, b] = engines;
  await user.click(screen.getByRole('radio', { name: '평면' }));
  expect(a.setView).toHaveBeenCalledWith('top');
  expect(b.setView).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '카메라 동기화' }));
  await user.keyboard('s');
  expect(a.setView).toHaveBeenLastCalledWith('front');
  expect(b.setView).toHaveBeenLastCalledWith('front');
  await user.keyboard('f');
  engines.forEach((e) => expect(e.fit).toHaveBeenCalled());
});

test('크게 보기 ↔ 나란히 보기(Esc), 빼기는 주소를 바꾸고 엔진을 정리한다', async () => {
  const user = userEvent.setup();
  const { engines } = setup();
  await ready(engines, 2);
  const pane1 = screen.getByRole('article', { name: 'rev1.bdf' });
  const pane2 = screen.getByRole('article', { name: 'rev2.bdf' });
  await user.click(within(pane1).getByRole('button', { name: '크게 보기' }));
  expect(pane2).toHaveClass('hidden');
  expect(within(pane1).getByRole('button', { name: '나란히 보기' })).toHaveAttribute('aria-pressed', 'true');
  await user.keyboard('{Escape}');
  expect(pane2).not.toHaveClass('hidden');

  await user.click(within(pane2).getByRole('button', { name: '빼기' }));
  expect(screen.getByTestId('where')).toHaveTextContent('/compare?ids=1');
  await waitFor(() => expect(engines[1].dispose).toHaveBeenCalled());
  expect(screen.queryByRole('article', { name: 'rev2.bdf' })).toBeNull();
});

test('변환 대기 모델은 칸 안 안내, 3개면 한 칸은 담기 안내', async () => {
  const { engines } = setup('1,2,3');
  await ready(engines, 2);
  const pane3 = await screen.findByRole('article', { name: 'wait.bdf' });
  expect(within(pane3).getByText(/변환/)).toBeInTheDocument();
  expect(screen.getByText(/모델을 하나 더 담을 수 있습니다/)).toBeInTheDocument();
});

test('특성 비교표 — 기준 모델과 다른 칸은 차이와 함께, 기준 바꾸기', async () => {
  const user = userEvent.setup();
  const { engines } = setup();
  await ready(engines, 2);
  const panel = screen.getByRole('region', { name: '비교 패널' });
  const beamRow = await within(panel).findByRole('row', { name: /^CBEAM/ });
  expect(within(beamRow).getByText('+1')).toBeInTheDocument();
  const nodes = within(panel).getByRole('row', { name: /노드 수/ });
  expect(within(nodes).getByText('+1')).toBeInTheDocument();
  await user.click(within(panel).getByRole('button', { name: '기준으로' }));
  expect(within(within(panel).getByRole('row', { name: /^CBEAM/ })).getByText('−1')).toBeInTheDocument();
});

test('속성 차이 — 다른 것만 · 모두 보기, 행을 누르면 모든 칸에서 PID 강조', async () => {
  const user = userEvent.setup();
  const { engines } = setup();
  await ready(engines, 2);
  const panel = screen.getByRole('region', { name: '비교 패널' });
  await user.click(within(panel).getByRole('tab', { name: /속성 차이/ }));
  await waitFor(() => expect(within(panel).getByText(/PID 3개 중 다른 것 2개/)).toBeInTheDocument());
  expect(within(panel).getByText('없음')).toBeInTheDocument();
  expect(within(panel).queryByRole('button', { name: '5' })).toBeNull();
  await user.click(within(panel).getByRole('radio', { name: '모두 보기' }));
  expect(within(panel).getByRole('button', { name: '5' })).toBeInTheDocument();

  engines[1].setPidHighlight.mockReturnValue(0);
  await user.click(within(panel).getByRole('button', { name: '1' }));
  engines.forEach((e) => expect(e.setPidHighlight).toHaveBeenLastCalledWith([1]));
  // 칸마다 강조했는지·없는지 알린다
  expect(within(screen.getByRole('article', { name: 'rev1.bdf' })).getByRole('status')).toHaveTextContent('PID 1 강조');
  expect(within(screen.getByRole('article', { name: 'rev2.bdf' })).getByRole('status')).toHaveTextContent('PID 1 없음');
  await user.click(within(panel).getByRole('button', { name: '1' }));
  engines.forEach((e) => expect(e.setPidHighlight).toHaveBeenLastCalledWith(null));
});

test('주소에 목록이 없으면 바구니로 연다, 둘 다 없으면 안내', async () => {
  mockApi({});
  render(
    <MemoryRouter initialEntries={['/compare']}>
      <CompareBasketProvider><Routes><Route path="/compare" element={<ComparePage />} /></Routes></CompareBasketProvider>
    </MemoryRouter>,
  );
  expect(screen.getByText('비교할 모델이 없습니다')).toBeInTheDocument();
});

test('초기화 — 툴바·크게 보기·PID 강조·칸 선택을 되돌리고 칸마다 처음 장면(등각 전체)으로', async () => {
  const user = userEvent.setup();
  const { engines } = setup();
  await ready(engines, 2);
  const [a, b] = engines;
  await user.click(screen.getByRole('radio', { name: '그룹' }));
  await user.click(screen.getByRole('radio', { name: '원근' }));
  await user.click(screen.getByRole('button', { name: '자르기' }));
  await user.click(screen.getByRole('button', { name: '카메라 동기화' }));
  const pane1 = screen.getByRole('article', { name: 'rev1.bdf' });
  const pane2 = screen.getByRole('article', { name: 'rev2.bdf' });
  // 칸 1 에서 요소를 누른다 → 정보 카드
  const canvas = screen.getByTestId('compare-canvas-1');
  fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerUp(canvas, { clientX: 100, clientY: 100, button: 0 });
  expect(await within(pane1).findByRole('button', { name: '선택 해제' })).toBeInTheDocument();
  const panel = screen.getByRole('region', { name: '비교 패널' });
  await user.click(within(panel).getByRole('tab', { name: /속성 차이/ }));
  await user.click(await within(panel).findByRole('button', { name: '1' }));
  await user.click(within(pane1).getByRole('button', { name: '크게 보기' }));
  expect(pane2).toHaveClass('hidden');
  engines.forEach((e) => { e.setView.mockClear(); e.highlight.mockClear(); e.setCameraState.mockClear(); });

  // 초기화 중의 카메라 바뀜은 다른 칸으로 옮기지 않는다
  a.setView.mockImplementation(() => { a.cameraCb?.(); });
  await user.click(screen.getByRole('button', { name: '초기화' }));

  expect(pane2).not.toHaveClass('hidden');
  expect(screen.getByRole('radio', { name: 'PID' })).toBeChecked();
  expect(screen.getByRole('radio', { name: '직교' })).toBeChecked();
  expect(screen.getByRole('radio', { name: '등각' })).toBeChecked();
  expect(screen.getByRole('button', { name: '자르기' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('button', { name: '카메라 동기화' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(pane1).queryByRole('button', { name: '선택 해제' })).toBeNull();
  engines.forEach((e) => {
    expect(e.setColorMode).toHaveBeenLastCalledWith('pid');
    expect(e.setProjection).toHaveBeenLastCalledWith('ortho');
    expect(e.setClip).toHaveBeenLastCalledWith(null);
    expect(e.setPidHighlight).toHaveBeenLastCalledWith(null);
    expect(e.setView).toHaveBeenCalledWith('iso');
    expect(e.setMarkers).toHaveBeenLastCalledWith({ rbe2: true, rbe3: true, conm2: true, spc: true });
    expect(e.setNodes).toHaveBeenLastCalledWith({ visible: false, classes: [true, true, true] });
  });
  expect(a.highlight).toHaveBeenLastCalledWith(null);
  await new Promise((r) => { setTimeout(r, 40); });
  expect(b.setCameraState).not.toHaveBeenCalled();

  // 단축키 R 도 같다
  b.setView.mockClear();
  await user.keyboard('r');
  expect(b.setView).toHaveBeenCalledWith('iso');
});

test('끝내기 — 앱 안 이전 화면으로 돌아가고 바구니는 남는다', async () => {
  const user = userEvent.setup();
  const { engines } = setup('1,2', { from: '/e/E000001' });
  await ready(engines, 2);
  await user.click(screen.getByRole('button', { name: '끝내기' }));
  expect(screen.getByTestId('where')).toHaveTextContent('/e/E000001');
  await waitFor(() => engines.forEach((e) => expect(e.dispose).toHaveBeenCalled()));
  expect(JSON.parse(localStorage.getItem(BASKET_KEY)).map((x) => x.id)).toEqual([1, 2]);
});

test('끝내기 — 바로 열어 이전 화면이 없으면 검색으로', async () => {
  const user = userEvent.setup();
  const { engines } = setup();
  await ready(engines, 2);
  await user.click(screen.getByRole('button', { name: '끝내기' }));
  expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
});
