import { afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from '../ui/Toast.jsx';
import { SendToWorkbenchButton, WorkbenchPickBanner } from './WorkbenchSend.jsx';
import { WB_SESSION_KEY } from '../../lib/workbenchBridge.js';
import { WB_FILTER_APPLIED_KEY, invalidateWbEligibility, resetWbTargetsForTests } from '../../lib/wbTargets.js';
import { calls, mockApi } from '../../test/mockApi.js';

const MODEL = { id: 4512, name: 'gmu.bdf', kind: 'model' };
const TRUSS_REASON = "태그 'Truss' 가 붙은 자료만 Truss Structural Assessment 로 보낼 수 있습니다.";
const TARGETS = [
  { target: 'gmu', label: 'Group & Module Unit 권상 구조 해석', zones: [], tags: [], condition: null, reason: null },
  { target: 'truss', label: 'Truss Structural Assessment', zones: [], tags: ['Truss'],
    condition: "태그 'Truss' 가 붙은 자료만 보낼 수 있습니다", reason: TRUSS_REASON },
];

function setup({ bridge = true, pick = { target: 'gmu', slot: 2 }, sendModel = vi.fn().mockResolvedValue({ ok: true }),
                 api = {} } = {}) {
  if (bridge) window.hitessBridge = { version: 1, sendModel };
  if (pick) sessionStorage.setItem(WB_SESSION_KEY, JSON.stringify(pick));
  const fetch = mockApi({ 'GET /api/wb-targets': TARGETS, ...api });
  return { sendModel, fetch };
}

function renderButton(props = {}) {
  return render(<ToastProvider><SendToWorkbenchButton file={MODEL} entryId="E000123" {...props} /></ToastProvider>);
}

afterEach(() => {
  delete window.hitessBridge;
  sessionStorage.clear();
  resetWbTargetsForTests();
});

test('다리가 없으면(브라우저 직접 접속) 버튼이 없다', () => {
  setup({ bridge: false });
  renderButton();
  expect(screen.queryByRole('button', { name: /WorkBench로 보내기/ })).toBeNull();
});

test('선택 모드가 없으면 버튼이 없다', () => {
  setup({ pick: null });
  renderButton();
  expect(screen.queryByRole('button', { name: /WorkBench로 보내기/ })).toBeNull();
});

test('선택 대상 없이 WorkBench 를 거친 세션({})도 버튼이 없다', () => {
  setup({ pick: {} });
  renderButton();
  expect(screen.queryByRole('button', { name: /WorkBench로 보내기/ })).toBeNull();
});

test('BDF 가 아니면 버튼이 없다', () => {
  setup();
  renderButton({ file: { id: 1, name: 'r.pdf', kind: 'report' } });
  expect(screen.queryByRole('button', { name: /WorkBench로 보내기/ })).toBeNull();
});

test('다리와 선택 모드가 있으면 보이고, 누르면 계약대로 보내고 토스트', async () => {
  let resolve;
  const { sendModel, fetch } = setup({ sendModel: vi.fn(() => new Promise((r) => { resolve = r; })) });
  renderButton();
  const btn = screen.getByRole('button', { name: 'WorkBench로 보내기' });
  await waitFor(() => expect(btn).not.toBeDisabled());   // 규칙 없는 대상(gmu) — 판정을 묻지 않고 켠다
  expect(calls(fetch).some((c) => c.includes('/eligible'))).toBe(false);
  await userEvent.click(btn);
  expect(sendModel).toHaveBeenCalledWith({ target: 'gmu', slot: 2, fileId: 4512, entryId: 'E000123', name: 'gmu.bdf' });
  expect(btn).toBeDisabled();                       // 보내는 동안 잠근다
  await userEvent.click(btn);
  expect(sendModel).toHaveBeenCalledTimes(1);
  resolve({ ok: true });
  expect(await screen.findByRole('status')).toHaveTextContent('WorkBench 작업 2으로 보냈습니다');
  expect(btn).not.toBeDisabled();
});

test('거절되면 다리가 준 사유를 토스트로', async () => {
  setup({ sendModel: vi.fn().mockResolvedValue({ ok: false, message: '작업 2가 이미 진행 중입니다' }) });
  renderButton();
  const btn = screen.getByRole('button', { name: 'WorkBench로 보내기' });
  await waitFor(() => expect(btn).not.toBeDisabled());
  await userEvent.click(btn);
  expect(await screen.findByRole('status')).toHaveTextContent('작업 2가 이미 진행 중입니다');
});

test('목록 행 안(stop)에서는 행 고르기로 번지지 않는다 — 아이콘 단추', async () => {
  setup();
  const onRow = vi.fn();
  render(<ToastProvider><ul><li onClick={onRow}><SendToWorkbenchButton file={MODEL} compact stop /></li></ul></ToastProvider>);
  const btn = screen.getByRole('button', { name: 'gmu.bdf WorkBench로 보내기' });
  await waitFor(() => expect(btn).not.toBeDisabled());
  await userEvent.click(btn);
  expect(onRow).not.toHaveBeenCalled();
});

// ---- 18-b 분류 규칙 ----

test('판정을 받는 동안은 사유 없이 비활성', async () => {
  const { fetch } = setup({ pick: { target: 'truss', slot: 1 },
                           api: { 'POST /api/wb-targets/truss/eligible': () => new Promise(() => {}) } });
  renderButton();
  const btn = screen.getByRole('button', { name: 'WorkBench로 보내기' });
  expect(btn).toBeDisabled();
  await waitFor(() => expect(calls(fetch)).toContain('POST /api/wb-targets/truss/eligible'));
  expect(btn).toBeDisabled();
  expect(screen.queryByText(TRUSS_REASON)).toBeNull();
});

test('규칙에 맞지 않으면 회색 비활성 + 사유를 옆에 보인다(넓은 자리)', async () => {
  const sendModel = vi.fn();
  setup({ pick: { target: 'truss', slot: 1 }, sendModel,
          api: { 'POST /api/wb-targets/truss/eligible': { E000123: { ok: false, reason: TRUSS_REASON } } } });
  renderButton();
  expect(await screen.findByText(TRUSS_REASON)).toBeInTheDocument();
  const btn = screen.getByRole('button', { name: 'WorkBench로 보내기' });
  expect(btn).toBeDisabled();
  expect(btn).toHaveAccessibleDescription(TRUSS_REASON);
  await userEvent.click(btn);
  expect(sendModel).not.toHaveBeenCalled();
});

test('좁은 자리 — 자물쇠 + "태그 필요", 감싼 칸의 title 에 사유', async () => {
  setup({ pick: { target: 'truss', slot: 1 },
          api: { 'POST /api/wb-targets/truss/eligible': { E000123: { ok: false, reason: TRUSS_REASON } } } });
  renderButton({ compact: true });
  expect(await screen.findByText('태그 필요')).toBeInTheDocument();
  const btn = screen.getByRole('button', { name: 'gmu.bdf WorkBench로 보내기' });
  expect(btn).toBeDisabled();
  expect(btn.closest('span[title]')).toHaveAttribute('title', TRUSS_REASON);
});

test('맞는 자료는 켜지고, 같은 Entry 의 여러 줄·여러 Entry 는 한 번에 묻는다', async () => {
  const { fetch } = setup({ pick: { target: 'truss', slot: 1 }, api: {
    'POST /api/wb-targets/truss/eligible': { E000123: { ok: true, reason: null }, E000124: { ok: false, reason: TRUSS_REASON } },
  } });
  render(
    <ToastProvider>
      <SendToWorkbenchButton file={MODEL} entryId="E000123" compact />
      <SendToWorkbenchButton file={{ ...MODEL, id: 2, name: 'b.bdf' }} entryId="E000123" compact />
      <SendToWorkbenchButton file={{ ...MODEL, id: 3, name: 'c.bdf' }} entryId="E000124" compact />
    </ToastProvider>,
  );
  await waitFor(() => expect(screen.getByRole('button', { name: 'gmu.bdf WorkBench로 보내기' })).not.toBeDisabled());
  expect(screen.getByRole('button', { name: 'b.bdf WorkBench로 보내기' })).not.toBeDisabled();
  await screen.findByText('태그 필요');
  const posts = fetch.mock.calls.filter(([u, i = {}]) => i.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0][1].body)).toEqual({ entry_ids: ['E000123', 'E000124'] });
});

test('판정 요청이 실패하면 켜 둔다(서버가 보낼 때 다시 막는다)', async () => {
  setup({ pick: { target: 'truss', slot: 1 }, api: { 'POST /api/wb-targets/truss/eligible': { __status: 500, detail: 'x' } } });
  renderButton();
  await waitFor(() => expect(screen.getByRole('button', { name: 'WorkBench로 보내기' })).not.toBeDisabled());
});

test('Entry 에 속하지 않은 파일은 규칙이 있으면 묻지 않고 막는다', async () => {
  const { fetch } = setup({ pick: { target: 'truss', slot: 1 } });
  renderButton({ entryId: null });
  expect(await screen.findByText(TRUSS_REASON)).toBeInTheDocument();
  expect(calls(fetch).some((c) => c.includes('/eligible'))).toBe(false);
});

test('Entry 분류가 바뀌면(invalidate) 다시 묻는다 — 태그를 붙이면 바로 켜진다', async () => {
  let ok = false;
  setup({ pick: { target: 'truss', slot: 1 }, api: {
    'POST /api/wb-targets/truss/eligible': () => ({ E000123: ok ? { ok: true, reason: null } : { ok: false, reason: TRUSS_REASON } }),
  } });
  renderButton();
  expect(await screen.findByText(TRUSS_REASON)).toBeInTheDocument();
  ok = true;
  invalidateWbEligibility('E000123');
  await waitFor(() => expect(screen.getByRole('button', { name: 'WorkBench로 보내기' })).not.toBeDisabled());
  expect(screen.queryByText(TRUSS_REASON)).toBeNull();
});

// ---- 선택 띠 ----

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{`${loc.pathname}${loc.search}`}</output>;
}

function renderBanner(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <WorkbenchPickBanner />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  );
}

test('선택 띠 — 다리와 선택 모드가 있을 때만', () => {
  setup({ bridge: false });
  const { unmount } = renderBanner();
  expect(screen.queryByText(/보낼 BDF를 고르세요/)).toBeNull();
  unmount();
  window.hitessBridge = { version: 1, sendModel: vi.fn() };
  renderBanner();
  expect(screen.getByText('WorkBench · GMU 권상 작업 2에 보낼 BDF를 고르세요')).toBeInTheDocument();
});

test('규칙이 없는 대상(gmu)은 조건·필터가 없다', async () => {
  const { fetch } = setup();
  renderBanner();
  await waitFor(() => expect(calls(fetch)).toContain('GET /api/wb-targets'));
  expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
  expect(screen.queryByText(/필터/)).toBeNull();
  expect(sessionStorage.getItem(WB_FILTER_APPLIED_KEY)).toBeNull();
});

test('truss — 조건을 띠에 보이고 첫 검색 화면에 태그 필터를 한 번 켠다, 끄면 다시 강제하지 않는다', async () => {
  setup({ pick: { target: 'truss', slot: 1 } });
  const { unmount } = renderBanner('/?q=frame');
  expect(await screen.findByText(/태그 'Truss' 가 붙은 자료만 보낼 수 있습니다/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/?q=frame&tag=Truss'));
  expect(screen.getByText("태그 'Truss' 필터를 켜 두었습니다")).toBeInTheDocument();
  expect(sessionStorage.getItem(WB_FILTER_APPLIED_KEY)).toBe('1');

  await userEvent.click(screen.getByRole('button', { name: '필터 끄기' }));
  expect(screen.getByTestId('where')).toHaveTextContent(/^\/\?q=frame$/);
  expect(screen.getByText("태그 'Truss' 필터를 껐습니다")).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '다시 켜기' }));
  expect(screen.getByTestId('where')).toHaveTextContent('/?q=frame&tag=Truss');
  unmount();

  // 같은 창에서 다시 그려도(표시가 남아 있으면) 필터를 다시 켜지 않는다
  renderBanner('/');
  await screen.findByText(/태그 'Truss' 가 붙은 자료만/);
  expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
});

test('규칙 값이 여러 개면 태그 칸에 값 전부(OR)를 켜고 구역 조건은 안내한다 · 검색 밖에서는 검색으로 가는 단추(19)', async () => {
  const multi = [{ target: 'truss', label: 'Truss Structural Assessment', zones: ['선수부'], tags: ['Truss', 'Frame'],
    condition: "구역 '선수부' 또는 태그 'Truss' 또는 태그 'Frame' 가 붙은 자료만 보낼 수 있습니다", reason: 'x' }];
  setup({ pick: { target: 'truss', slot: 1 }, api: { 'GET /api/wb-targets': multi } });
  sessionStorage.setItem(WB_FILTER_APPLIED_KEY, '1');   // 이미 한 번 적용한 창
  renderBanner('/browse');
  expect(await screen.findByText(/구역 '선수부' 자료도 보낼 수 있습니다/)).toBeInTheDocument();
  expect(screen.getByText("태그 'Truss' 또는 'Frame' 자료만 보려면")).toBeInTheDocument();
  expect(screen.getByTestId('where')).toHaveTextContent('/browse');
  await userEvent.click(screen.getByRole('button', { name: '검색에서 보기' }));
  expect(screen.getByTestId('where')).toHaveTextContent(/^\/\?tag=Truss&tag=Frame$/);
  expect(screen.getByText("태그 'Truss' 또는 'Frame' 필터를 켜 두었습니다")).toBeInTheDocument();
});

test('자동 필터는 칸의 규칙 값 전부를 켜고, 끌 때는 사용자가 더 고른 값을 남긴다(19)', async () => {
  const multi = [{ target: 'truss', label: 'Truss', zones: [], tags: ['Truss', 'Frame'], condition: '', reason: 'x' }];
  setup({ pick: { target: 'truss', slot: 1 }, api: { 'GET /api/wb-targets': multi } });
  const { unmount } = renderBanner('/?q=a');
  await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/?q=a&tag=Truss&tag=Frame'));
  unmount();
  // 사용자가 태그 하나를 더 고른 주소에서 끄면 규칙 값만 빠진다
  renderBanner('/?tag=Truss&tag=Frame&tag=Beam');
  await userEvent.click(await screen.findByRole('button', { name: '필터 끄기' }));
  expect(screen.getByTestId('where')).toHaveTextContent(/^\/\?tag=Beam$/);
  await userEvent.click(screen.getByRole('button', { name: '다시 켜기' }));
  expect(screen.getByTestId('where')).toHaveTextContent('/?tag=Beam&tag=Truss&tag=Frame');
});
