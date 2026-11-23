import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { mockApi } from '../../test/mockApi.js';
import UpdateNotesAdminPage from './UpdateNotesAdminPage.jsx';

test('안내마다 공유 주소와 복사 단추, 사용자 화면 링크', async () => {
  mockApi({ 'GET /api/update-notes': { items: [
    { id: '2026-11-24-solid', date: '2026-11-24', kind: '새 기능', title: '솔리드 미리보기', summary: '요약' },
  ] } });
  render(<MemoryRouter><UpdateNotesAdminPage /></MemoryRouter>);
  const row = (await screen.findByText('솔리드 미리보기')).closest('tr');
  expect(within(row).getByText(`${window.location.origin}/update-notes/2026-11-24-solid`)).toBeInTheDocument();
  expect(within(row).getByRole('button', { name: /복사/ })).toBeInTheDocument();
  expect(within(row).getByRole('link', { name: '솔리드 미리보기' })).toHaveAttribute('href', '/update-notes/2026-11-24-solid');
  expect(screen.getByRole('link', { name: '사용자 화면으로 보기' })).toHaveAttribute('href', '/update-notes');
});
