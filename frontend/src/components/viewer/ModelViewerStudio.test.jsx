import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { mockApi } from '../../test/mockApi.js';
import { encodeModel, sampleModelV2 } from '../../test/modelFixtures.js';
import { fakeEngine } from '../../test/fakeEngine.js';
import { ViewerEngineContext } from './ViewerEngineContext.js';
import ModelViewer from './ModelViewer.jsx';

// 04c — 3D 단면·연결 그룹·확인 기능. 합성 v2 모델(그룹 3개, 자유단·고립 절점, RBE2).

function v1Model() {
  const m = sampleModelV2();
  m.header.version = 1;
  delete m.blocks.beam_orient;
  delete m.blocks.beam_offsets;
  return m;
}

function renderViewer(engine, { variant = 'compact', model = sampleModelV2(), formatVersion = null, solve = null, api = {} } = {}) {
  mockApi({ 'GET /api/files/7/model.lbm': { __binary: encodeModel(model) }, ...api });
  render(
    <ViewerEngineContext.Provider value={async () => engine}>
      <ModelViewer fileId={7} fullscreenHref="/v/7" variant={variant} formatVersion={formatVersion} solve={solve}
                   className={variant === 'full' ? 'h-[700px]' : ''} />
    </ViewerEngineContext.Provider>,
  );
}

const ready = () => screen.findByRole('list', { name: 'PID' });

describe('작은 뷰어', () => {
  test('엔진에 그룹·점검·단면 계획을 넘긴다', async () => {
    const engine = fakeEngine();
    renderViewer(engine);
    await ready();
    const [, opts] = engine.setModel.mock.calls[0];
    expect(opts.extras.groups.count).toBe(3);
    expect(opts.extras.check.counts).toEqual({ shared: 4, free: 8, orphan: 1 });
    expect(opts.extras.plan.beams).toBe(5);
    expect(opts.extras.orient).toBeInstanceOf(Float32Array);
  });

  test('그룹 탭 — 색이 그룹으로, 목록·숨기기·이 그룹만 보기·그룹으로 이동', async () => {
    const engine = fakeEngine();
    renderViewer(engine);
    await ready();
    await userEvent.click(screen.getByRole('tab', { name: '그룹' }));
    expect(engine.setColorMode).toHaveBeenLastCalledWith('group');
    const list = screen.getByRole('list', { name: '그룹' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('그룹 1');
    expect(rows[0]).toHaveTextContent('요소 4 · 절점 7');
    expect(rows[2]).toHaveTextContent('RBE 1');
    await userEvent.click(within(list).getByRole('checkbox', { name: '그룹 2 표시' }));
    expect(Array.from(engine.setGroupsVisible.mock.lastCall[0])).toEqual([1, 0, 1]);
    await userEvent.click(within(list).getByRole('button', { name: '그룹 3만 보기' }));
    expect(Array.from(engine.setGroupsVisible.mock.lastCall[0])).toEqual([0, 0, 1]);
    await userEvent.click(within(list).getByRole('button', { name: '그룹 1로 이동' }));
    const pred = engine.frameNodes.mock.lastCall[0];
    expect([0, 1, 7, 12].map(pred)).toEqual([true, true, false, false]);
    await userEvent.click(screen.getByRole('button', { name: '모두 보이기' }));
    expect(Array.from(engine.setGroupsVisible.mock.lastCall[0])).toEqual([1, 1, 1]);
    await userEvent.click(screen.getByRole('tab', { name: 'PID' }));
    expect(engine.setColorMode).toHaveBeenLastCalledWith('pid');
  });

  test('3D 단면 전환 — v2 는 안내 없음, v1 은 다시 변환 안내 한 줄', async () => {
    const engine = fakeEngine();
    renderViewer(engine);
    await ready();
    await userEvent.click(screen.getByRole('radio', { name: '3D 단면' }));
    expect(engine.setRenderMode).toHaveBeenCalledWith('section', expect.objectContaining({ onProgress: expect.any(Function) }));
    expect(screen.queryByText('다시 변환하면 단면 방향이 정확해집니다')).toBeNull();
  });

  test('v1 파일도 열리고 3D 단면에서 안내', async () => {
    const engine = fakeEngine();
    renderViewer(engine, { model: v1Model() });
    await ready();
    expect(engine.setModel.mock.calls[0][1].extras.orient).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: '3D 단면' }));
    expect(await screen.findByText('다시 변환하면 단면 방향이 정확해집니다')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: '선' }));
    expect(screen.queryByText('다시 변환하면 단면 방향이 정확해집니다')).toBeNull();
  });

  test('API 형식 버전이 lbm 머리보다 우선', async () => {
    renderViewer(fakeEngine(), { formatVersion: 1 });
    await ready();
    await userEvent.click(screen.getByRole('radio', { name: '3D 단면' }));
    expect(await screen.findByText('다시 변환하면 단면 방향이 정확해집니다')).toBeInTheDocument();
  });

  test('그룹을 숨기면 그 그룹의 선택을 푼다', async () => {
    const engine = fakeEngine(3);  // 1D 순번 3 = BOX, 그룹 2
    renderViewer(engine);
    await ready();
    const canvas = screen.getByTestId('viewer-canvas');
    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5, button: 0 });
    fireEvent.pointerUp(canvas, { clientX: 5, clientY: 5, button: 0 });
    expect(screen.getByRole('region', { name: '선택 요소' })).toHaveTextContent('그룹 2');
    await userEvent.click(screen.getByRole('tab', { name: '그룹' }));
    await userEvent.click(screen.getByRole('checkbox', { name: '그룹 2 표시' }));
    expect(engine.highlight).toHaveBeenLastCalledWith(null);
  });
});

describe('전체 화면 뷰어', () => {
  test('패널 탭·색 기준·레이어·투영·자르기', async () => {
    const engine = fakeEngine();
    renderViewer(engine, { variant: 'full' });
    await ready();
    expect(screen.getByRole('tab', { name: '모델' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/PID 6 · 요소 6 · 절점 13/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: '요소' }));
    expect(engine.setColorMode).toHaveBeenLastCalledWith('type');
    const legend = screen.getByRole('group', { name: '범례' });
    expect(legend).toHaveTextContent('색 기준 · 요소 종류');
    expect(legend).toHaveTextContent('CBEAM');
    await userEvent.click(screen.getByRole('checkbox', { name: /절점/ }));
    expect(engine.setNodes).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }));
    expect(legend).toHaveTextContent('자유단 절점');
    await userEvent.click(screen.getByRole('radio', { name: '원근' }));
    expect(engine.setProjection).toHaveBeenLastCalledWith('persp');
    await userEvent.click(screen.getByRole('button', { name: '자르기' }));
    expect(engine.setClip).toHaveBeenLastCalledWith(expect.objectContaining({ on: true, axis: 'x', position: 0.5 }));
    const clip = screen.getByRole('group', { name: '자르기' });
    await userEvent.click(within(clip).getByRole('radio', { name: 'Z' }));
    expect(engine.setClip).toHaveBeenLastCalledWith(expect.objectContaining({ axis: 'z' }));
    fireEvent.change(within(clip).getByRole('slider'), { target: { value: '250' } });
    expect(engine.setClip).toHaveBeenLastCalledWith(expect.objectContaining({ position: 0.25 }));
    await userEvent.click(within(clip).getByRole('button', { name: '뒤집기' }));
    expect(engine.setClip).toHaveBeenLastCalledWith(expect.objectContaining({ flip: true }));
    await userEvent.click(within(clip).getByRole('button', { name: '자르기 끄기' }));
    expect(engine.setClip).toHaveBeenLastCalledWith(null);
  });

  test('PID 색 기준이 처음, 범례는 숨긴 PID 를 표시한다', async () => {
    renderViewer(fakeEngine(), { variant: 'full' });
    await ready();
    const modes = screen.getByRole('radiogroup', { name: '색 기준' });
    expect(within(modes).getAllByRole('radio').map((r) => r.textContent)).toEqual(['PID', '그룹', '단면', '요소']);
    expect(within(modes).getByRole('radio', { name: 'PID' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('group', { name: '범례' })).toHaveTextContent('색 기준 · PID');
    await userEvent.click(screen.getByRole('checkbox', { name: 'PID 4 표시' }));
    const row = within(screen.getByRole('group', { name: '범례' })).getByText('PID 4').closest('li');
    expect(row).toHaveTextContent('숨김');
  });

  test('그룹 탭으로 가면 그룹 색, 점검 탭의 절점 점검', async () => {
    const engine = fakeEngine();
    renderViewer(engine, { variant: 'full' });
    await ready();
    await userEvent.click(screen.getByRole('tab', { name: '그룹' }));
    expect(engine.setColorMode).toHaveBeenLastCalledWith('group');
    expect(screen.getByText(/주 구조에서 떨어진 그룹 2/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: '점검' }));
    const check = screen.getByRole('list', { name: '절점 점검' });
    expect(check).toHaveTextContent('자유단');
    expect(check).toHaveTextContent('8');
    expect(within(check).getByRole('checkbox', { name: '고립 절점 표시' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /^절점 표시/ }));
    await userEvent.click(within(check).getByRole('checkbox', { name: '자유단 절점 표시' }));
    expect(engine.setNodes).toHaveBeenLastCalledWith({ visible: true, classes: [true, false, true] });
    // 고립 절점 ID 를 누르면 그 절점으로
    await userEvent.click(within(check).getByRole('button', { name: '113' }));
    expect(engine.highlight).toHaveBeenLastCalledWith({ kind: 'node', index: 12 });
    expect(engine.frameNodes).toHaveBeenLastCalledWith([12]);
    expect(screen.getByRole('complementary', { name: '정보 도크' })).toHaveTextContent('고립');
  });

  test('점검 탭 해석 검증 — 고정 노드 표시를 켜면 그 절점을 엔진에 강조한다', async () => {
    const engine = fakeEngine();
    const detail = { state: 'pass', error_types: [], fatals: [], warning_count: 0, stale: false, has_f06: false,
      fixed_node_ids: [101, 113, 999], spc_nodes: 3, groups: 3 };
    renderViewer(engine, { variant: 'full', solve: { state: 'pass', error_types: [], stale: false },
                           api: { 'GET /api/files/7/solve-check': detail } });
    await ready();
    await userEvent.click(screen.getByRole('tab', { name: '점검' }));
    expect(screen.getByText('해석 가능')).toBeInTheDocument();
    const toggle = await screen.findByRole('checkbox', { name: /고정 노드 표시/ });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(engine.setNodeSet).not.toHaveBeenCalledWith(expect.any(Array), expect.anything());
    await userEvent.click(toggle);
    // 모델에 없는 999 는 건너뛴다(101 → 0번, 113 → 12번), 색은 SPC 초록.
    expect(engine.setNodeSet).toHaveBeenLastCalledWith([0, 12], { color: '#22DD66' });
    await userEvent.click(toggle);
    expect(engine.setNodeSet).toHaveBeenLastCalledWith(null, expect.anything());
  });

  test('Ctrl+F 찾기 — 목록·다음·없음', async () => {
    const engine = fakeEngine();
    renderViewer(engine, { variant: 'full' });
    await ready();
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    const bar = await screen.findByRole('search', { name: 'ID 로 찾기' });
    const input = within(bar).getByRole('textbox');
    await waitFor(() => expect(input).toHaveFocus());
    await userEvent.type(input, '101, 103{Enter}');
    expect(engine.highlight).toHaveBeenLastCalledWith({ kind: 'node', index: 0 });
    expect(bar).toHaveTextContent('1 / 2');
    await userEvent.type(input, '{Enter}');
    expect(engine.highlight).toHaveBeenLastCalledWith({ kind: 'node', index: 2 });
    await userEvent.clear(input);
    await userEvent.type(input, 'e20{Enter}');
    expect(engine.highlight).toHaveBeenLastCalledWith({ kind: 'element', index: 5 });
    expect(within(bar).getByRole('radio', { name: '요소' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.clear(input);
    await userEvent.type(input, '999{Enter}');
    expect(bar).toHaveTextContent('요소 999 없음 · 이 모델의 요소 범위 1~20 (6개)');
    // 입력칸 안의 글자는 단축키가 아니다
    expect(engine.fit).not.toHaveBeenCalled();
    await userEvent.type(input, '{Escape}');
    expect(screen.queryByRole('search', { name: 'ID 로 찾기' })).toBeNull();
  });

  test('절점·RBE 선택 정보와 선택만 보기', async () => {
    const engine = fakeEngine({ kind: 'node', index: 11 });
    renderViewer(engine, { variant: 'full' });
    await ready();
    const canvas = screen.getByTestId('viewer-canvas');
    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5, button: 0 });
    fireEvent.pointerUp(canvas, { clientX: 5, clientY: 5, button: 0 });
    const dock = screen.getByRole('complementary', { name: '정보 도크' });
    expect(dock).toHaveTextContent('선택 절점');
    expect(dock).toHaveTextContent('112');
    expect(dock).toHaveTextContent('공유');
    await userEvent.click(within(dock).getByRole('button', { name: '선택만 보기' }));
    expect(engine.setIsolate).toHaveBeenLastCalledWith({ kind: 'node', index: 11 });
    // 선택만 보기 중에 빈 곳을 눌러도 선택을 그대로 둔다
    engine.pickAt.mockReturnValue(null);
    fireEvent.pointerDown(canvas, { clientX: 9, clientY: 9, button: 0 });
    fireEvent.pointerUp(canvas, { clientX: 9, clientY: 9, button: 0 });
    expect(dock).toHaveTextContent('112');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(engine.setIsolate).toHaveBeenLastCalledWith(null);
    engine.pickAt.mockReturnValue({ kind: 'rbe', index: 0 });
    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5, button: 0 });
    fireEvent.pointerUp(canvas, { clientX: 5, clientY: 5, button: 0 });
    expect(dock).toHaveTextContent('선택 RBE');
    expect(dock).toHaveTextContent('RBE2');
    expect(dock).toHaveTextContent('111');
  });

  test('단축키 — A·S·D 시점, N 절점, P 투영, ? 도움말', async () => {
    const engine = fakeEngine();
    renderViewer(engine, { variant: 'full' });
    await ready();
    fireEvent.keyDown(window, { key: 'a' });
    expect(engine.setView).toHaveBeenLastCalledWith('top');
    fireEvent.keyDown(window, { key: 's' });
    expect(engine.setView).toHaveBeenLastCalledWith('front');
    fireEvent.keyDown(window, { key: 'd' });
    expect(engine.setView).toHaveBeenLastCalledWith('side');
    fireEvent.keyDown(window, { key: 'n' });
    expect(engine.setNodes).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }));
    fireEvent.keyDown(window, { key: 'p' });
    expect(engine.setProjection).toHaveBeenLastCalledWith('persp');
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByRole('dialog', { name: '단축키' })).toHaveTextContent('화면 맞춤');
  });

  test('3D 단면 진행률을 보이고 끝나면 걷는다', async () => {
    let finish;
    const engine = fakeEngine();
    engine.setRenderMode = vi.fn((mode, { onProgress }) => new Promise((resolve) => {
      onProgress(0.4);
      finish = () => { onProgress(1); resolve({ fallbacks: 0 }); };
    }));
    renderViewer(engine, { variant: 'full' });
    await ready();
    const toolbar = screen.getByRole('toolbar', { name: '뷰 도구' });
    await userEvent.click(within(toolbar).getByRole('radio', { name: '3D 단면' }));
    expect(await screen.findByText('단면 만드는 중 40%')).toBeInTheDocument();
    finish();
    await waitFor(() => expect(screen.queryByText(/단면 만드는 중/)).toBeNull());
  });
});
