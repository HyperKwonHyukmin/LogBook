import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { mockApi } from '../../test/mockApi.js';
import { encodeLbm } from '../../test/modelFixtures.js';
import { fakeEngine } from '../../test/fakeEngine.js';
import { ViewerEngineContext } from './ViewerEngineContext.js';
import ModelViewer from './ModelViewer.jsx';

function lbmBuffer(extra = {}) {
  return encodeLbm({
    version: 1, bbox: { min: [0, 0, 0], max: [1000, 1000, 0] },
    cards: { beam: ['CBAR', 'CBEAM', 'CROD', 'CONROD', 'CBUSH'], tri: ['CTRIA3'], quad: ['CQUAD4'], rigid: ['RBE2', 'RBE3'] },
    properties: { 1: { card: 'PBEAML', mid: 1, type: 'L', dims: [100, 100, 10, 10] }, 5: { card: 'PSHELL', mid: 1, t: 12 } },
    materials: { 1: { card: 'MAT1', E: 206000, nu: 0.3 } }, conrods: {},
  }, {
    node_ids: { dtype: '<i4', width: 1, data: new Int32Array([1, 2, 3, 4]) },
    node_xyz: { dtype: '<f4', width: 3, data: new Float32Array([0, 0, 0, 1000, 0, 0, 1000, 1000, 0, 0, 1000, 0]) },
    beams: { dtype: '<i4', width: 4, data: new Int32Array([10, 1, 0, 1]) },
    beam_cards: { dtype: '|u1', width: 1, data: new Uint8Array([1]) },
    tris: { dtype: '<i4', width: 5, data: new Int32Array(0) },
    tri_cards: { dtype: '|u1', width: 1, data: new Uint8Array(0) },
    quads: { dtype: '<i4', width: 6, data: new Int32Array([20, 5, 0, 1, 2, 3]) },
    quad_cards: { dtype: '|u1', width: 1, data: new Uint8Array([0]) },
    rigid_lines: { dtype: '<i4', width: 3, data: new Int32Array([30, 0, 1]) },
    rigid_kinds: { dtype: '|u1', width: 1, data: new Uint8Array([0]) },
    masses: { dtype: '<i4', width: 2, data: new Int32Array(0) },
    mass_values: { dtype: '<f4', width: 1, data: new Float32Array(0) },
    spcs: { dtype: '<i4', width: 2, data: new Int32Array([0, 123456]) },
    ...extra,
  });
}

function renderViewer(engine, map = { 'GET /api/files/7/model.lbm': { __binary: lbmBuffer() } }) {
  mockApi(map);
  const factory = vi.fn(async () => engine);
  render(
    <ViewerEngineContext.Provider value={factory}>
      <ModelViewer fileId={7} fullscreenHref="/v/7" />
    </ViewerEngineContext.Provider>,
  );
  return factory;
}

test('불러와서 엔진에 넘기고 PID 목록·표시물 칩을 보인다', async () => {
  const engine = fakeEngine();
  renderViewer(engine);
  const list = await screen.findByRole('list', { name: 'PID' });
  expect(within(list).getByText('PBEAML L 100x100x10x10')).toBeInTheDocument();
  expect(within(list).getByText('PSHELL t12')).toBeInTheDocument();
  expect(engine.setModel).toHaveBeenCalledWith(expect.objectContaining({ total: 2 }), expect.objectContaining({ edges: true }));
  expect(screen.getByRole('button', { name: /RBE2 1/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /SPC 1/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /CONM2/ })).toBeNull();
  expect(screen.getByRole('link', { name: '전체 화면' })).toHaveAttribute('href', '/v/7');
});

test('PID 표시 토글·모두 숨기기·시점·경계선·표시물', async () => {
  const engine = fakeEngine();
  renderViewer(engine);
  const list = await screen.findByRole('list', { name: 'PID' });
  await userEvent.click(within(list).getByRole('checkbox', { name: 'PID 5 표시' }));
  expect(engine.setGroupVisible).toHaveBeenCalledWith(5, false);
  await userEvent.click(screen.getByRole('button', { name: '모두 숨기기' }));
  expect(engine.setGroupVisible).toHaveBeenCalledWith(1, false);
  await userEvent.click(screen.getByRole('radio', { name: '평면' }));
  expect(engine.setView).toHaveBeenCalledWith('top');
  await userEvent.click(screen.getByRole('button', { name: '경계선' }));
  expect(engine.setEdges).toHaveBeenLastCalledWith(false);
  await userEvent.click(screen.getByRole('button', { name: /RBE2 1/ }));
  expect(engine.setMarkers).toHaveBeenLastCalledWith(expect.objectContaining({ rbe2: false, spc: true }));
});

test('클릭하면 요소 정보를 보인다, 드래그는 무시', async () => {
  const engine = fakeEngine(1);  // 요소 순번 1 = CQUAD4 20
  renderViewer(engine);
  await screen.findByRole('list', { name: 'PID' });
  const canvas = screen.getByTestId('viewer-canvas');
  fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerUp(canvas, { clientX: 140, clientY: 100, button: 0 });
  expect(engine.pickAt).not.toHaveBeenCalled();
  fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerUp(canvas, { clientX: 101, clientY: 101, button: 0 });
  const info = await screen.findByRole('region', { name: '선택 요소' });
  expect(info).toHaveTextContent('20');
  expect(info).toHaveTextContent('CQUAD4');
  expect(info).toHaveTextContent('PSHELL t12');
  expect(engine.highlight).toHaveBeenCalledWith({ kind: 'element', index: 1 });
  fireEvent.keyDown(canvas, { key: 'Escape' });
  expect(engine.highlight).toHaveBeenLastCalledWith(null);
});

test('키보드 F·숫자', async () => {
  const engine = fakeEngine();
  renderViewer(engine);
  await screen.findByRole('list', { name: 'PID' });
  const canvas = screen.getByTestId('viewer-canvas');
  fireEvent.keyDown(canvas, { key: 'f' });
  fireEvent.keyDown(canvas, { key: '1' });
  expect(engine.fit).toHaveBeenCalled();
  expect(engine.setView).toHaveBeenCalledWith('front');
});

test('준비 안 됨·엔진 실패', async () => {
  renderViewer(fakeEngine(), { 'GET /api/files/7/model.lbm': { __status: 404, detail: 'model_not_ready' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('변환');
});

test('언마운트 시 엔진 해제', async () => {
  const engine = fakeEngine();
  mockApi({ 'GET /api/files/7/model.lbm': { __binary: lbmBuffer() } });
  const { unmount } = render(
    <ViewerEngineContext.Provider value={async () => engine}><ModelViewer fileId={7} /></ViewerEngineContext.Provider>,
  );
  await screen.findByRole('list', { name: 'PID' });
  unmount();
  expect(engine.dispose).toHaveBeenCalled();
});

test('선택한 요소의 PID 를 숨기면 선택을 푼다', async () => {
  const engine = fakeEngine(1);  // CQUAD4 20, PID 5
  renderViewer(engine);
  const list = await screen.findByRole('list', { name: 'PID' });
  const canvas = screen.getByTestId('viewer-canvas');
  fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerUp(canvas, { clientX: 100, clientY: 100, button: 0 });
  expect(screen.getByRole('region', { name: '선택 요소' })).toHaveTextContent('CQUAD4');
  // 다른 PID 를 숨기면 그대로
  await userEvent.click(within(list).getByRole('checkbox', { name: 'PID 1 표시' }));
  expect(screen.getByRole('region', { name: '선택 요소' })).toHaveTextContent('CQUAD4');
  await userEvent.click(within(list).getByRole('checkbox', { name: 'PID 5 표시' }));
  expect(engine.highlight).toHaveBeenLastCalledWith(null);
  expect(screen.getByRole('region', { name: '선택 요소' })).toHaveTextContent('요소를 누르면 정보가 보입니다');
});

test('모두 숨기기도 선택을 푼다', async () => {
  const engine = fakeEngine(0);
  renderViewer(engine);
  await screen.findByRole('list', { name: 'PID' });
  const canvas = screen.getByTestId('viewer-canvas');
  fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, button: 0 });
  fireEvent.pointerUp(canvas, { clientX: 10, clientY: 10, button: 0 });
  await userEvent.click(screen.getByRole('button', { name: '모두 숨기기' }));
  expect(engine.highlight).toHaveBeenLastCalledWith(null);
});

test('SPC 칩은 구속된 절점 수(중복 없이)', async () => {
  const engine = fakeEngine();
  renderViewer(engine, { 'GET /api/files/7/model.lbm': { __binary: lbmBuffer({
    spcs: { dtype: '<i4', width: 2, data: new Int32Array([0, 123456, 0, 123, 2, 3]) },
  }) } });
  expect(await screen.findByRole('button', { name: /SPC 2/ })).toBeInTheDocument();
});

test('접근성 — 캔버스는 application, 선택 요소는 바뀌면 읽어 준다', async () => {
  renderViewer(fakeEngine());
  await screen.findByRole('list', { name: 'PID' });
  expect(screen.getByTestId('viewer-canvas')).toHaveAttribute('role', 'application');
  expect(screen.getByRole('application')).toHaveAccessibleName(/3D 모델/);
  expect(screen.getByRole('region', { name: '선택 요소' })).toHaveAttribute('aria-live', 'polite');
});

test('불러오는 동안 도구줄을 막고, 엔진은 모델을 받는 동안 미리 만든다', async () => {
  let release;
  const engine = fakeEngine();
  const factory = renderViewer(engine, {
    'GET /api/files/7/model.lbm': () => new Promise((r) => { release = () => r({ __binary: lbmBuffer() }); }),
  });
  expect(screen.getByRole('button', { name: '화면 맞춤' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '경계선' })).toBeDisabled();
  expect(screen.getByRole('radio', { name: '평면' })).toBeDisabled();
  await waitFor(() => expect(factory).toHaveBeenCalled());
  expect(engine.setModel).not.toHaveBeenCalled();
  release();
  await screen.findByRole('list', { name: 'PID' });
  expect(screen.getByRole('button', { name: '경계선' })).toBeEnabled();
});

test('모델을 못 받으면 미리 만든 엔진을 해제한다', async () => {
  const engine = fakeEngine();
  renderViewer(engine, { 'GET /api/files/7/model.lbm': { __status: 404, detail: 'model_missing' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('재변환');
  expect(engine.dispose).toHaveBeenCalled();
});
