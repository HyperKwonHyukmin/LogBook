import { vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import { tokenStore } from '../api/client.js';

function Probe() {
  const { user, loading, login, logout } = useAuth();
  if (loading) return <p>로딩</p>;
  return (
    <div>
      <p>{user ? `사용자:${user.name}` : '비로그인'}</p>
      <button onClick={() => login('A100001')}>로그인</button>
      <button onClick={() => logout()}>로그아웃</button>
    </div>
  );
}

const USER = { employee_id: 'A100001', name: '김철수', is_admin: false };

test('토큰이 없으면 비로그인 상태로 시작', async () => {
  vi.stubGlobal('fetch', vi.fn());
  render(<AuthProvider><Probe /></AuthProvider>);
  expect(await screen.findByText('비로그인')).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

test('저장된 토큰으로 /auth/me 를 불러 세션을 복원', async () => {
  tokenStore.set('tok');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(USER) }));
  render(<AuthProvider><Probe /></AuthProvider>);
  expect(await screen.findByText('사용자:김철수')).toBeInTheDocument();
});

test('로그인하면 토큰을 저장하고 사번을 기억한다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, status: 200, json: () => Promise.resolve({ token: 'new-tok', user: USER }),
  }));
  render(<AuthProvider><Probe /></AuthProvider>);
  await act(async () => { screen.getByText('로그인').click(); });
  expect(await screen.findByText('사용자:김철수')).toBeInTheDocument();
  expect(tokenStore.get()).toBe('new-tok');
  expect(localStorage.getItem('logbook_saved_employee_id')).toBe('A100001');
});

test('unauthorized 이벤트가 오면 로그아웃 상태가 된다', async () => {
  tokenStore.set('tok');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(USER) }));
  render(<AuthProvider><Probe /></AuthProvider>);
  await screen.findByText('사용자:김철수');
  act(() => { window.dispatchEvent(new Event('logbook:unauthorized')); });
  await waitFor(() => expect(screen.getByText('비로그인')).toBeInTheDocument());
});

test('세션 복원이 네트워크 오류로 실패해도 토큰을 지우지 않는다', async () => {
  tokenStore.set('tok-network');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  render(<AuthProvider><Probe /></AuthProvider>);
  await screen.findByText('비로그인');
  expect(tokenStore.get()).toBe('tok-network');
});

test('다른 탭에서 로그아웃(토큰 삭제)하면 이 탭도 로그아웃 상태가 된다', async () => {
  tokenStore.set('tok');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(USER) }));
  render(<AuthProvider><Probe /></AuthProvider>);
  await screen.findByText('사용자:김철수');
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'logbook_token', newValue: null }));
  });
  await waitFor(() => expect(screen.getByText('비로그인')).toBeInTheDocument());
});
