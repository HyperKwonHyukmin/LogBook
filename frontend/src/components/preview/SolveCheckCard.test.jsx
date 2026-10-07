import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { calls, mockApi } from '../../test/mockApi.js';
import SolveCheckCard from './SolveCheckCard.jsx';

const BASE = { error_types: [], fatals: [], warning_count: null, message: null, spc_nodes: null, groups: null,
  fixed_node_ids: [], elapsed: null, stale: false, has_f06: false, requested_by: null, requested_by_name: null,
  requested_at: null, finished_at: null };
const row = (patch) => ({ ...BASE, ...patch });
const PASS = row({ state: 'pass', warning_count: 2, spc_nodes: 12, groups: 2, fixed_node_ids: [101, 102], elapsed: 42.3,
  has_f06: true, requested_by: 'A123', requested_by_name: '권혁민', requested_at: '2026-10-06T10:00:00',
  finished_at: '2026-10-06T10:00:42' });

function renderCard(map, props = {}) {
  const fetch = mockApi(map);
  render(<SolveCheckCard fileId={7} fileName="m.bdf" {...props} />);
  return fetch;
}
const gets = (fetch) => calls(fetch).filter((c) => c === 'GET /api/files/7/solve-check').length;
async function tick(n) {
  for (let i = 0; i < n; i += 1) {
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  }
}
afterEach(() => { vi.useRealTimers(); });

test('미검증 — 자세한 행을 묻지 않고 해석 검증 단추와 원본 불변 안내', () => {
  const fetch = renderCard({}, { initial: { state: null, error_types: [], stale: false } });
  expect(screen.getByText('미검증')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '해석 검증' })).toBeEnabled();
  expect(screen.getByText('원본 파일은 바뀌지 않습니다. 해석용 사본으로만 확인합니다.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '자세히' })).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

test('변환 전에는 단추를 잠근다', () => {
  renderCard({}, { ready: false });
  expect(screen.getByRole('button', { name: '해석 검증' })).toBeDisabled();
});

test('요청 → 검증 중 → 해석 가능(확인을 이어 가다 끝나면 멈춘다)', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const answers = [row({ state: 'running' }), PASS];
  const onData = vi.fn();
  const fetch = renderCard({
    'POST /api/files/7/solve-check': row({ state: 'queued' }),
    'GET /api/files/7/solve-check': () => answers.shift() || PASS,
  }, { onData });
  await userEvent.click(screen.getByRole('button', { name: '해석 검증' }));
  expect(await screen.findByText('검증 중…')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '다시 검증' })).toBeDisabled();
  await tick(1);
  expect(screen.getByText('검증 중…')).toBeInTheDocument();
  await tick(1);
  expect(await screen.findByText('해석 가능 · 경고 2')).toBeInTheDocument();
  expect(onData).toHaveBeenLastCalledWith(expect.objectContaining({ fixed_node_ids: [101, 102] }));
  await tick(3);
  expect(gets(fetch)).toBe(2);
  await userEvent.click(screen.getByRole('button', { name: '자세히' }));
  expect(screen.getByText('그룹 2개 · 최하단 노드 12개 고정 · GRAV −Z')).toBeInTheDocument();
  expect(screen.getByText('권혁민')).toHaveAttribute('title', 'A123');
  expect(screen.getByText(/소요/)).toHaveTextContent('42초');
  expect(screen.getByRole('button', { name: 'f06 받기' })).toBeInTheDocument();
});

test('해석 불가 — 유형 배지와 FATAL 목록', async () => {
  renderCard({
    'GET /api/files/7/solve-check': row({ state: 'fail', error_types: ['rbe_dependent_dup', 'other'],
      fatals: [{ code: 2101, type: 'rbe_dependent_dup', message: 'GRID 5 COMPONENT 1 DEPENDENT MORE THAN ONCE' },
        { code: 4276, type: 'other', message: 'ERROR IN SUBROUTINE' }], spc_nodes: 3, groups: 1 }),
  }, { initial: { state: 'fail', error_types: ['rbe_dependent_dup', 'other'], stale: false } });
  expect(screen.getByText('해석 불가 · RBE 종속 자유도 중복 외 1')).toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: '자세히' }));
  const list = await screen.findByRole('list', { name: 'FATAL 목록' });
  expect(list).toHaveTextContent('FATAL 2101 · RBE 종속 자유도 중복');
  expect(list).toHaveTextContent('DEPENDENT MORE THAN ONCE');
  expect(list).toHaveTextContent('FATAL 4276 · 기타 FATAL 4276');
  expect(screen.queryByRole('button', { name: 'f06 받기' })).toBeNull();
});

test('확인 못 함 — 모델 결함이 아님을 유형과 사유로', async () => {
  renderCard({
    'GET /api/files/7/solve-check': row({ state: 'error', error_types: ['license'], message: '라이선스를 얻지 못했습니다.' }),
  }, { initial: { state: 'error', error_types: ['license'], stale: false } });
  expect(screen.getByText('확인 못 함 · 라이선스 문제')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '자세히' }));
  expect(await screen.findByText('라이선스를 얻지 못했습니다.')).toBeInTheDocument();
});

test('모델이 바뀌었으면 다시 검증 필요', async () => {
  renderCard({ 'GET /api/files/7/solve-check': { ...PASS, stale: true } },
    { initial: { state: 'pass', error_types: [], stale: true } });
  expect(screen.getByText('다시 검증 필요')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '다시 검증' })).toBeEnabled();
});

test('409 model_not_ready — 안내하고 확인을 시작하지 않는다', async () => {
  const fetch = renderCard({ 'POST /api/files/7/solve-check': { __status: 409, detail: 'model_not_ready' } });
  await userEvent.click(screen.getByRole('button', { name: '해석 검증' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('아직 3D 변환이 끝나지 않았습니다.');
  expect(screen.getByText('미검증')).toBeInTheDocument();
  expect(gets(fetch)).toBe(0);
});

test('f06 받기는 인증 GET 으로 받는다', async () => {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:f06');
  globalThis.URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const fetch = renderCard({
    'GET /api/files/7/solve-check': PASS,
    'GET /api/files/7/solve-check.f06': { __blob: new Blob(['f06']) },
  }, { initial: { state: 'pass', error_types: [], stale: false } });
  await userEvent.click(await screen.findByRole('button', { name: '자세히' }));
  await userEvent.click(await screen.findByRole('button', { name: 'f06 받기' }));
  expect(calls(fetch)).toContain('GET /api/files/7/solve-check.f06');
  expect(click).toHaveBeenCalled();
  expect(click.mock.contexts[0].download).toBe('m.f06');
  click.mockRestore();
});
