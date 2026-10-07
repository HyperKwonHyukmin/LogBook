import { vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { calls, mockApi } from '../../test/mockApi.js';
import OpsPage from './OpsPage.jsx';

const STATUS = {
  worker: { alive: true, at: '2026-10-02T12:00:00', stats: { processed: 2 } },
  storage: { reachable: true },
  jobs: [{ type: 'convert_model', state: 'failed', count: 1 }, { type: 'extract_file', state: 'queued', count: 4 }],
  failed: [{ id: 9, type: 'convert_model', target_id: 3, label: 'main.bdf', attempts: 3, last_error: 'ValueError: 깨짐', updated_at: '2026-10-02T11:00:00' }],
  backup: { ok: true, file: 'logbook-20261002-020000.sql.gz', size: 2048000, at: '2026-10-02T02:00:00', error: null },
  daily: { date: '2026-10-02', at: '2026-10-02T02:00:00' },
  trash: { count: 3, expiring: 1, days: 90 },
};

function renderPage(map) {
  const fetch = mockApi({ 'GET /api/admin/ops/status': STATUS, ...map });
  render(<MemoryRouter><OpsPage /></MemoryRouter>);
  return fetch;
}

afterEach(() => { vi.useRealTimers(); });

test('상태·큐·실패 작업·백업·휴지통', async () => {
  renderPage({});
  expect(await screen.findByText('동작 중')).toBeInTheDocument();
  expect(screen.getByText(/logbook-20261002-020000\.sql\.gz/)).toBeInTheDocument();
  const failed = screen.getByRole('table', { name: '실패한 작업' });
  expect(within(failed).getByText('main.bdf')).toBeInTheDocument();
  expect(screen.getByText(/휴지통 3건/)).toBeInTheDocument();
  expect(screen.getByText(/7일 안에 비워질 것 1건/)).toBeInTheDocument();
});

test('작업 큐 표는 종류 라벨로 개수를 보이고 완료는 접어 둔다', async () => {
  renderPage({ 'GET /api/admin/ops/status': { ...STATUS, jobs: [...STATUS.jobs, { type: 'extract_file', state: 'done', count: 12 }] } });
  const queue = await screen.findByRole('table', { name: '작업 큐' });
  const row = within(queue).getByText('보고서 본문 추출').closest('tr');
  expect(within(row).getByText('4')).toBeInTheDocument();
  expect(within(queue).queryByText('12')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: /완료 보기/ }));
  expect(within(queue).getByText('12')).toBeInTheDocument();
});

test('마지막 오류는 한 줄로 보이고 펼치면 전체를 보인다', async () => {
  const long = 'Traceback 첫 줄\n  File "x.py", line 3\nValueError: 깨짐';
  renderPage({ 'GET /api/admin/ops/status': { ...STATUS, failed: [{ ...STATUS.failed[0], last_error: long }] } });
  const btn = await screen.findByRole('button', { name: 'Traceback 첫 줄' });
  expect(btn).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(btn);
  expect(btn).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(/ValueError: 깨짐/)).toBeInTheDocument();
});

test('다시 시도', async () => {
  const fetch = renderPage({ 'POST /api/admin/ops/jobs/9/retry': { ok: true } });
  await userEvent.click(await screen.findByRole('button', { name: 'main.bdf 다시 시도' }));
  expect(calls(fetch)).toContain('POST /api/admin/ops/jobs/9/retry');
});

test('BDF 다시 변환은 확인 후 실행', async () => {
  const fetch = renderPage({ 'POST /api/admin/ops/reconvert': { queued: 5 } });
  await userEvent.click(await screen.findByRole('button', { name: 'BDF 다시 변환' }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '실행' }));
  expect(await screen.findByText('5건을 넣었습니다.')).toBeInTheDocument();
  const post = fetch.mock.calls.find(([u]) => u === '/api/admin/ops/reconvert');
  expect(JSON.parse(post[1].body)).toEqual({ force: false });
});

test('본문 다시 추출은 "이미 끝난 것도 모두" 를 force 로 보내고, 취소하면 보내지 않는다', async () => {
  const fetch = renderPage({ 'POST /api/admin/ops/reextract': { queued: 7 } });
  const box = await screen.findByRole('checkbox', { name: /본문 다시 추출.*이미 끝난 것도 모두/ });
  await userEvent.click(screen.getByRole('button', { name: '본문 다시 추출' }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '취소' }));
  expect(calls(fetch)).not.toContain('POST /api/admin/ops/reextract');
  await userEvent.click(box);
  await userEvent.click(screen.getByRole('button', { name: '본문 다시 추출' }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '실행' }));
  expect(await screen.findByText('7건을 넣었습니다.')).toBeInTheDocument();
  const post = fetch.mock.calls.find(([u]) => u === '/api/admin/ops/reextract');
  expect(JSON.parse(post[1].body)).toEqual({ force: true });
});

test('지금 백업 성공 결과를 보인다', async () => {
  const fetch = renderPage({ 'POST /api/admin/ops/backup': { ok: true, file: 'logbook-20261002-153000.sql.gz', size: 4096, at: '2026-10-02T15:30:00', error: null } });
  await userEvent.click(await screen.findByRole('button', { name: '지금 백업' }));
  expect(await screen.findByText(/logbook-20261002-153000\.sql\.gz/)).toBeInTheDocument();
  expect(calls(fetch)).toContain('POST /api/admin/ops/backup');
});

test('백업 실패 사유', async () => {
  renderPage({ 'POST /api/admin/ops/backup': { __status: 502, detail: { code: 'backup_failed', message: 'mysqldump_not_found' } } });
  await userEvent.click(await screen.findByRole('button', { name: '지금 백업' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('백업');
});

test('워커 멈춤 표시', async () => {
  renderPage({ 'GET /api/admin/ops/status': { ...STATUS, worker: { alive: false, at: null, stats: null } } });
  expect(await screen.findByText('멈춤')).toBeInTheDocument();
});

test('30초마다 다시 불러오고, 떠나면 멈춘다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const fetch = mockApi({ 'GET /api/admin/ops/status': STATUS });
  const { unmount } = render(<MemoryRouter><OpsPage /></MemoryRouter>);
  await screen.findByText('동작 중');
  const count = () => calls(fetch).filter((c) => c === 'GET /api/admin/ops/status').length;
  expect(count()).toBe(1);
  await act(async () => { vi.advanceTimersByTime(30_000); });
  expect(count()).toBe(2);
  unmount();
  await act(async () => { vi.advanceTimersByTime(60_000); });
  expect(count()).toBe(2);
});

test('백업 중에는 다른 동작이 끝나도 백업 단추가 잠겨 있다', async () => {
  let finishBackup;
  const fetch = renderPage({
    'POST /api/admin/ops/backup': () => new Promise((resolve) => { finishBackup = resolve; }),
    'POST /api/admin/ops/jobs/9/retry': { ok: true },
  });
  const backup = await screen.findByRole('button', { name: '지금 백업' });
  await userEvent.click(backup);
  expect(backup).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'main.bdf 다시 시도' }));
  expect(await screen.findByText(/다시 대기열에 넣었습니다/)).toBeInTheDocument();
  expect(backup).toBeDisabled();
  await userEvent.click(backup);
  expect(calls(fetch).filter((c) => c === 'POST /api/admin/ops/backup')).toHaveLength(1);
  await act(async () => { finishBackup({ ok: true, file: 'logbook-x.sql.gz', size: 10, at: null, error: null }); });
  expect(backup).not.toBeDisabled();
});

test('재시도 대상 파일이 영구 삭제됐으면 알아듣는 문구를 보인다', async () => {
  renderPage({ 'POST /api/admin/ops/jobs/9/retry': { __status: 409, detail: 'target_gone' } });
  await userEvent.click(await screen.findByRole('button', { name: 'main.bdf 다시 시도' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('영구 삭제되어 다시 시도할 수 없습니다');
});

test('멈춤 기준이 오면 그 값으로 안내하고, 시각이 없으면 기호 대신 말로 쓴다', async () => {
  renderPage({ 'GET /api/admin/ops/status': { ...STATUS, worker: { alive: false, at: null, stats: null, alive_seconds: 600 } } });
  expect(await screen.findByText('10분 넘게 응답이 없으면 멈춤으로 봅니다.')).toBeInTheDocument();
  expect(screen.getByText('기록 없음')).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('—');
});

test('실패 작업이 없으면 빈 줄 안내를 보인다', async () => {
  renderPage({ 'GET /api/admin/ops/status': { ...STATUS, failed: [] } });
  const failed = await screen.findByRole('table', { name: '실패한 작업' });
  expect(within(failed).getByText('실패한 작업이 없습니다.')).toBeInTheDocument();
});

test('해석 검증 일괄 — "이미 검증한 모델도 모두" 를 force 로 보낸다', async () => {
  const fetch = renderPage({ 'POST /api/admin/ops/solve-check': { queued: 12 } });
  await userEvent.click(await screen.findByRole('checkbox', { name: '해석 검증 일괄: 이미 검증한 모델도 모두' }));
  await userEvent.click(screen.getByRole('button', { name: '해석 검증 일괄' }));
  const dialog = screen.getByRole('alertdialog');
  expect(dialog).toHaveTextContent('변환이 끝난 모든 모델을 다시 검증합니다');
  await userEvent.click(within(dialog).getByRole('button', { name: '실행' }));
  expect(await screen.findByText('12건을 넣었습니다.')).toBeInTheDocument();
  const post = fetch.mock.calls.find(([u]) => u === '/api/admin/ops/solve-check');
  expect(JSON.parse(post[1].body)).toEqual({ force: true });
});

test('작업 큐·실패 작업에 해석 검증 라벨', async () => {
  renderPage({ 'GET /api/admin/ops/status': { ...STATUS,
    jobs: [...STATUS.jobs, { type: 'solve_check', state: 'queued', count: 3 }],
    failed: [{ ...STATUS.failed[0], id: 10, type: 'solve_check', label: 'deck.bdf' }] } });
  const queue = await screen.findByRole('table', { name: '작업 큐' });
  expect(within(within(queue).getByText('해석 검증').closest('tr')).getByText('3')).toBeInTheDocument();
  const failed = screen.getByRole('table', { name: '실패한 작업' });
  expect(within(within(failed).getByText('deck.bdf').closest('tr')).getByText('해석 검증')).toBeInTheDocument();
});
