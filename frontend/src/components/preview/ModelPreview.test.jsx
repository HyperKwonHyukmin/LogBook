import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { calls, mockApi } from '../../test/mockApi.js';
import { ViewerEngineContext } from '../viewer/ViewerEngineContext.js';
import ModelPreview from './ModelPreview.jsx';

const FILE = { id: 7, name: 'm.bdf', kind: 'model', rel_path: 'm.bdf', size: 10 };

function renderPreview(summary, { inline = false } = {}) {
  const fetch = mockApi({ 'GET /api/files/7/model': summary, 'GET /api/files/7/thumb.png': { __blob: new Blob(['png']) } });
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:thumb');
  globalThis.URL.revokeObjectURL = vi.fn();
  render(
    <ViewerEngineContext.Provider value={async () => ({ setModel() {}, dispose() {} })}>
      <MemoryRouter><ModelPreview file={FILE} inline={inline} /></MemoryRouter>
    </ViewerEngineContext.Provider>,
  );
  return fetch;
}

const modelCalls = (fetch) => calls(fetch).filter((c) => c === 'GET /api/files/7/model').length;
/** 가짜 시계를 n 번 3초씩 돌린다(돌 때마다 다시 확인 요청이 끝나기를 기다린다). */
async function tick(n) {
  for (let i = 0; i < n; i += 1) {
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  }
}
afterEach(() => { vi.useRealTimers(); });

test('변환 완료 — 요약·썸네일·전체 화면 링크', async () => {
  renderPreview({ state: 'done', counts: { CQUAD4: 3400, CBEAM: 1200, GRID: 5000 }, bbox: { min: [0, 0, 0], max: [12000, 8000, 3000] },
                  sol: '101', warnings: ['coord_unresolved: 2'], missing: [], has_lbm: true });
  expect(await screen.findByText(/CQUAD4 3,400/)).toBeInTheDocument();
  expect(screen.getByText(/크기 12,000×8,000×3,000/)).toBeInTheDocument();
  expect(screen.getByText(/SOL 101/)).toBeInTheDocument();
  expect(await screen.findByRole('img', { name: /m\.bdf/ })).toHaveAttribute('src', 'blob:thumb');
  expect(screen.getByRole('link', { name: '3D 로 보기' })).toHaveAttribute('href', '/v/7');
  expect(screen.getByText('경고 1')).toBeInTheDocument();
});

test('INCLUDE 누락 안내', async () => {
  renderPreview({ state: 'done', counts: { CROD: 1 }, bbox: null, warnings: [], missing: ['mesh.bdf', 'mat.bdf'], has_lbm: true });
  expect(await screen.findByText(/INCLUDE 파일 mesh\.bdf, mat\.bdf 이 없습니다/)).toBeInTheDocument();
});

test.each([
  [{ state: 'include' }, /다른 BDF 가 INCLUDE/],
  [{ state: 'skipped', error: 'no_elements' }, /요소가 없는 BDF/],
  [{ state: 'skipped', error: 'too_large' }, /1GB/],
  [{ state: 'queued' }, /3D 변환 대기 중/],
])('상태 %o', async (summary, text) => {
  renderPreview(summary);
  expect(await screen.findByText(text)).toBeInTheDocument();
});

test('실패는 예외 원문 대신 안내를 보이고 원문은 툴팁으로만 둔다', async () => {
  renderPreview({ state: 'failed', error: 'ValueError: 깨짐', has_lbm: false });
  const msg = await screen.findByText('3D 로 바꾸지 못했습니다. 관리자에게 알려 주세요.');
  expect(msg).toHaveAttribute('title', 'ValueError: 깨짐');
  expect(screen.queryByText(/ValueError/)).toBeNull();
});

test('다시 변환 대기 중이어도 이전 결과가 있으면 썸네일과 안내 한 줄을 보인다', async () => {
  renderPreview({ state: 'queued', has_lbm: true, key: 'old', counts: { CROD: 1 }, bbox: null, warnings: [], missing: [] });
  expect(await screen.findByText('다시 변환 대기 중 · 이전 결과를 보여 줍니다')).toBeInTheDocument();
  expect(await screen.findByRole('img', { name: /m\.bdf/ })).toHaveAttribute('src', 'blob:thumb');
  expect(screen.getByRole('link', { name: '3D 로 보기' })).toHaveAttribute('href', '/v/7');
});

test('대기가 길어지면 멈추고 다시 확인 단추를 보인다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const fetch = renderPreview({ state: 'queued', has_lbm: false });
  expect(await screen.findByText('3D 변환 대기 중')).toBeInTheDocument();
  await tick(20);
  expect(modelCalls(fetch)).toBe(21);
  expect(screen.getByText('변환이 오래 걸리고 있습니다.')).toBeInTheDocument();
  expect(screen.queryByText('3D 변환 대기 중')).toBeNull();
  await tick(2);
  expect(modelCalls(fetch)).toBe(21);
  await userEvent.click(screen.getByRole('button', { name: '다시 확인' }));
  await tick(1);
  expect(modelCalls(fetch)).toBeGreaterThanOrEqual(22);
  expect(screen.getByText('3D 변환 대기 중')).toBeInTheDocument();
});

test('대기 중 일시 오류 한 번은 넘기고 계속 확인한다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const answers = [{ state: 'queued', has_lbm: false }, { __status: 503, detail: 'storage_unreachable' },
    { state: 'done', has_lbm: true, key: 'k', counts: { CQUAD4: 5 }, bbox: null, warnings: [], missing: [] }];
  renderPreview(() => answers.shift());
  expect(await screen.findByText('3D 변환 대기 중')).toBeInTheDocument();
  await tick(1);
  expect(screen.queryByRole('alert')).toBeNull();
  await tick(1);
  expect(await screen.findByText(/CQUAD4 5/)).toBeInTheDocument();
});

test('오류가 세 번 이어지면 멈추고 알린다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const answers = [{ state: 'queued', has_lbm: false }];
  const fetch = renderPreview(() => answers.shift() || { __status: 503, detail: 'storage_unreachable' });
  expect(await screen.findByText('3D 변환 대기 중')).toBeInTheDocument();
  await tick(2);
  expect(screen.queryByRole('alert')).toBeNull();
  await tick(1);
  expect(await screen.findByRole('alert')).toHaveTextContent('999_LogBook');
  await tick(3);
  expect(modelCalls(fetch)).toBe(4);
});
