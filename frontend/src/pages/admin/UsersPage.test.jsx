import { afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsersPage from './UsersPage.jsx';

const PENDING = [{ employee_id: 'A100002', name: '대기자', department: '구조팀', status: 'pending', is_admin: false, created_at: '2026-09-29T09:00:00' }];
const ACTIVE = [{ employee_id: 'A100004', name: '활성자', department: '구조팀', status: 'active', is_admin: false, created_at: '2026-09-29T09:00:00' }];
const DISABLED = [{ employee_id: 'A100003', name: '비활성자', department: null, status: 'disabled', is_admin: false, created_at: '2026-09-29T09:00:00' }];

function routeFetch(handlers) {
  vi.stubGlobal('fetch', vi.fn((url, init = {}) => {
    const key = `${init.method || 'GET'} ${url}`;
    const body = handlers[key];
    if (body === undefined) throw new Error(`unexpected ${key}`);
    if (body instanceof Error) return Promise.reject(body);
    if (body.__status) {
      return Promise.resolve({ ok: false, status: body.__status, json: () => Promise.resolve({ detail: body.detail }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

test('승인 대기 목록을 보여 주고 승인하면 목록을 다시 불러온다', async () => {
  routeFetch({
    'GET /api/admin/users?status=pending': PENDING,
    'POST /api/admin/users/A100002/approve': { ...PENDING[0], status: 'active' },
  });
  render(<UsersPage />);
  const row = (await screen.findByText('대기자')).closest('tr');
  await userEvent.click(within(row).getByRole('button', { name: '승인' }));
  const calls = fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`);
  expect(calls).toContain('POST /api/admin/users/A100002/approve');
  expect(calls.filter((c) => c === 'GET /api/admin/users?status=pending')).toHaveLength(2);
});

test('탭을 바꾸면 해당 상태로 조회한다', async () => {
  routeFetch({ 'GET /api/admin/users?status=pending': [], 'GET /api/admin/users?status=active': [] });
  render(<UsersPage />);
  await userEvent.click(screen.getByRole('tab', { name: '활성' }));
  const calls = fetch.mock.calls.map(([u]) => u);
  expect(calls).toContain('/api/admin/users?status=active');
});

test('이미 처리된 사용자(409 not_pending)면 안내하고 목록을 새로 고친다', async () => {
  routeFetch({
    'GET /api/admin/users?status=pending': PENDING,
    'POST /api/admin/users/A100002/approve': { __status: 409, detail: 'not_pending' },
  });
  render(<UsersPage />);
  const row = (await screen.findByText('대기자')).closest('tr');
  await userEvent.click(within(row).getByRole('button', { name: '승인' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('이미 처리된 사용자입니다. 목록을 새로 고칩니다.');
  const calls = fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`);
  expect(calls.filter((c) => c === 'GET /api/admin/users?status=pending')).toHaveLength(2);
});

test('이미 처리된 사용자(409 not_disabled)면 안내하고 목록을 새로 고친다', async () => {
  routeFetch({
    'GET /api/admin/users?status=disabled': DISABLED,
    'GET /api/admin/users?status=pending': [],
    'POST /api/admin/users/A100003/enable': { __status: 409, detail: 'not_disabled' },
  });
  render(<UsersPage />);
  await userEvent.click(screen.getByRole('tab', { name: '비활성' }));
  const row = (await screen.findByText('비활성자')).closest('tr');
  await userEvent.click(within(row).getByRole('button', { name: '재활성화' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('이미 처리된 사용자입니다. 목록을 새로 고칩니다.');
  const calls = fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`);
  expect(calls.filter((c) => c === 'GET /api/admin/users?status=disabled')).toHaveLength(2);
});

test('이미 처리된 사용자(409 not_active)면 안내하고 목록을 새로 고친다', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  routeFetch({
    'GET /api/admin/users?status=active': ACTIVE,
    'POST /api/admin/users/A100004/disable': { __status: 409, detail: 'not_active' },
  });
  render(<UsersPage />);
  await userEvent.click(screen.getByRole('tab', { name: '활성' }));
  const row = (await screen.findByText('활성자')).closest('tr');
  await userEvent.click(within(row).getByRole('button', { name: '비활성화' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('이미 처리된 사용자입니다. 목록을 새로 고칩니다.');
  const calls = fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`);
  expect(calls.filter((c) => c === 'GET /api/admin/users?status=active')).toHaveLength(2);
});

test('이미 삭제된 사용자(404 user_not_found)면 안내하고 목록을 새로 고친다', async () => {
  routeFetch({
    'GET /api/admin/users?status=pending': PENDING,
    'POST /api/admin/users/A100002/approve': { __status: 404, detail: 'user_not_found' },
  });
  render(<UsersPage />);
  const row = (await screen.findByText('대기자')).closest('tr');
  await userEvent.click(within(row).getByRole('button', { name: '승인' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('이미 처리된 사용자입니다. 목록을 새로 고칩니다.');
  const calls = fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`);
  expect(calls.filter((c) => c === 'GET /api/admin/users?status=pending')).toHaveLength(2);
});

test('처리 중에는 해당 행의 버튼이 비활성화된다', async () => {
  let resolveApprove;
  vi.stubGlobal('fetch', vi.fn((url, init = {}) => {
    const key = `${init.method || 'GET'} ${url}`;
    if (key === 'GET /api/admin/users?status=pending') {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(PENDING) });
    }
    if (key === 'POST /api/admin/users/A100002/approve') {
      return new Promise((resolve) => { resolveApprove = resolve; });
    }
    throw new Error(`unexpected ${key}`);
  }));
  render(<UsersPage />);
  const row = (await screen.findByText('대기자')).closest('tr');
  const approveBtn = within(row).getByRole('button', { name: '승인' });
  const rejectBtn = within(row).getByRole('button', { name: '거절' });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await userEvent.click(approveBtn);
  expect(approveBtn).toBeDisabled();
  expect(rejectBtn).toBeDisabled();
  resolveApprove({ ok: true, status: 200, json: () => Promise.resolve({ ...PENDING[0], status: 'active' }) });
  await waitFor(() => expect(approveBtn).not.toBeDisabled());
});

test('거절 확인 대화상자에서 취소하면 요청을 보내지 않는다', async () => {
  routeFetch({ 'GET /api/admin/users?status=pending': PENDING });
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<UsersPage />);
  const row = (await screen.findByText('대기자')).closest('tr');
  await userEvent.click(within(row).getByRole('button', { name: '거절' }));
  const calls = fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`);
  expect(calls).not.toContain('POST /api/admin/users/A100002/reject');
});

test('거절 확인 대화상자에서 확인하면 요청을 보낸다', async () => {
  routeFetch({
    'GET /api/admin/users?status=pending': PENDING,
    'POST /api/admin/users/A100002/reject': { ...PENDING[0], status: 'disabled' },
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<UsersPage />);
  const row = (await screen.findByText('대기자')).closest('tr');
  await userEvent.click(within(row).getByRole('button', { name: '거절' }));
  const calls = fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`);
  expect(calls).toContain('POST /api/admin/users/A100002/reject');
});

test('비활성화 확인 대화상자에서 취소하면 요청을 보내지 않는다', async () => {
  routeFetch({ 'GET /api/admin/users?status=active': ACTIVE });
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<UsersPage />);
  await userEvent.click(screen.getByRole('tab', { name: '활성' }));
  const row = (await screen.findByText('활성자')).closest('tr');
  await userEvent.click(within(row).getByRole('button', { name: '비활성화' }));
  const calls = fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`);
  expect(calls).not.toContain('POST /api/admin/users/A100004/disable');
});

test('로딩 중에는 없음 안내가 나타나지 않는다', async () => {
  let resolveGet;
  vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { resolveGet = resolve; })));
  render(<UsersPage />);
  expect(screen.queryByText('해당하는 사용자가 없습니다.')).not.toBeInTheDocument();
  resolveGet({ ok: true, status: 200, json: () => Promise.resolve([]) });
  expect(await screen.findByText('해당하는 사용자가 없습니다.')).toBeInTheDocument();
});

test('목록 조회 실패 시 이전 목록을 지운다', async () => {
  vi.stubGlobal('fetch', vi.fn((url, init = {}) => {
    const key = `${init.method || 'GET'} ${url}`;
    if (key === 'GET /api/admin/users?status=pending') {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(PENDING) });
    }
    if (key === 'GET /api/admin/users?status=active') return Promise.reject(new Error('network'));
    throw new Error(`unexpected ${key}`);
  }));
  render(<UsersPage />);
  await screen.findByText('대기자');
  await userEvent.click(screen.getByRole('tab', { name: '활성' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('대기자')).not.toBeInTheDocument();
});

test('빠르게 탭을 바꾸면 오래된 응답을 무시한다', async () => {
  let resolvePending;
  let resolveActive;
  vi.stubGlobal('fetch', vi.fn((url, init = {}) => {
    const key = `${init.method || 'GET'} ${url}`;
    if (key === 'GET /api/admin/users?status=pending') {
      return new Promise((resolve) => {
        resolvePending = () => resolve({ ok: true, status: 200, json: () => Promise.resolve(PENDING) });
      });
    }
    if (key === 'GET /api/admin/users?status=active') {
      return new Promise((resolve) => {
        resolveActive = () => resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      });
    }
    throw new Error(`unexpected ${key}`);
  }));
  render(<UsersPage />);
  await userEvent.click(screen.getByRole('tab', { name: '활성' }));
  // 활성 탭 요청이 먼저 응답으로 오고, 그보다 먼저 나간 대기 탭 요청이 뒤늦게 도착해도
  // 화면은 마지막으로 선택한 탭(활성)의 빈 목록을 유지해야 한다.
  resolveActive();
  await screen.findByText('해당하는 사용자가 없습니다.');
  resolvePending();
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByText('대기자')).not.toBeInTheDocument();
});

test('승인 대기 탭은 신청일, 그 외 탭은 가입일 헤더를 쓴다', async () => {
  routeFetch({ 'GET /api/admin/users?status=pending': [], 'GET /api/admin/users?status=active': [] });
  render(<UsersPage />);
  expect(await screen.findByText('신청일')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: '활성' }));
  expect(await screen.findByText('가입일')).toBeInTheDocument();
  expect(screen.queryByText('신청일')).not.toBeInTheDocument();
});
