import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App.jsx';

test('비로그인 사용자는 로그인 화면으로 이동한다', async () => {
  vi.stubGlobal('fetch', vi.fn());
  render(<MemoryRouter initialEntries={['/hulls']}><App /></MemoryRouter>);
  expect(await screen.findByRole('tab', { name: '로그인' })).toBeInTheDocument();
});
