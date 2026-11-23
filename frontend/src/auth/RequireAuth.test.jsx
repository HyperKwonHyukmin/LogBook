import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import RequireAuth from './RequireAuth.jsx';

vi.mock('./AuthContext.jsx', () => ({ useAuth: () => ({ user: null, loading: false, isAdmin: false }) }));

function Login() {
  const l = useLocation();
  return <span data-testid="from">{l.state?.from}</span>;
}

test('70 — 로그인 전에 받은 업데이트 안내 공유 주소는 로그인 화면에 돌아올 곳으로 넘긴다', () => {
  render(
    <MemoryRouter initialEntries={['/update-notes/2026-11-24-solid-fem-preview']}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth />}><Route path="/update-notes/:noteId" element={<span>안내</span>} /></Route>
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByTestId('from')).toHaveTextContent('/update-notes/2026-11-24-solid-fem-preview');
});
