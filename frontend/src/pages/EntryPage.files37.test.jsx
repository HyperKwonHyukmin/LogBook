import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../auth/AuthContext.jsx';
import { calls, mockApi } from '../test/mockApi.js';
import { invalidateVocab } from '../lib/vocab.js';
import EntryPage from './EntryPage.jsx';
import { ToastProvider } from '../components/ui/Toast.jsx';

beforeEach(() => invalidateVocab());

// 37 — 자료 번호 배지·복사, 고치기에서 파일 하나씩 삭제·되돌리기
const FILES = [
  { id: 1, name: 'm.bdf', rel_path: 'model/m.bdf', kind: 'model', size: 100, extract: null },
  { id: 2, name: 'r.pdf', rel_path: 'r.pdf', kind: 'report', size: 200, extract: { state: 'done', error: null, summary: null } },
];
const ENTRY = { entry_id: 'E000051', status: 'confirmed', title: '계류 구조 검토', analysis_type: 'Mooring',
  description: null, version: 3, hulls: [{ hull_no: '9999', ship_type: 'LNGC', is_primary: true }],
  zones: ['선수부'], tags: [], uploaded_by: 'A100009', confirmed_by: 'A100009', confirmed_at: '2026-09-02T09:00:00',
  files: FILES, removed_files: [], vault_unc: '\\\\srv\\E000051', can_edit: true };

function renderPage(map) {
  const fetch = mockApi({
    'GET /api/entries/E000051/history': [],
    'POST /api/files/2/link?inline=true': { url: '/api/files/2/content?t=a&inline=1' },
    'GET /api/files/1/model': { state: 'include' },
    ...map,
  });
  render(
    <AuthContext.Provider value={{ user: { employee_id: 'A100009', name: '나', level: 2 }, isAdmin: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/e/E000051']}>
          <Routes><Route path="/e/:entryId" element={<EntryPage />} /></Routes>
        </MemoryRouter>
      </ToastProvider>
    </AuthContext.Provider>,
  );
  return fetch;
}

test('머리의 자료 번호 배지 — [복사]로 번호만 클립보드에 넣는다', async () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  renderPage({ 'GET /api/entries/E000051': ENTRY });
  expect(await screen.findByTestId('entry-id')).toHaveTextContent('E000051');
  await userEvent.click(screen.getByRole('button', { name: '자료 번호 E000051 복사' }));
  expect(writeText).toHaveBeenCalledWith('E000051');
  expect(await screen.findByText('자료 번호 E000051를 복사했습니다.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '자료 번호 E000051 복사' })).toHaveTextContent('복사됨');
});

test('고치기에서 파일에 삭제 표시 → 변경 완료 때 한 번에 빼고, 토스트의 되돌리기로 되살린다', async () => {
  let current = ENTRY;
  const fetch = renderPage({
    'GET /api/entries/E000051': () => current,
    'POST /api/entries/E000051/files/remove': (init) => {
      expect(JSON.parse(init.body)).toEqual({ file_ids: [2], version: 3 });
      current = { ...ENTRY, version: 4, files: [FILES[0]], removed_files: [{ ...FILES[1] }] };
      return current;
    },
    'POST /api/entries/E000051/files/restore': () => { current = { ...ENTRY, version: 5 }; return current; },
  });
  await userEvent.click(await screen.findByRole('button', { name: '변경하기' }));
  const tree = screen.getByRole('tree', { name: '파일' });
  await userEvent.click(within(tree).getByRole('button', { name: 'r.pdf 삭제' }));
  expect(within(tree).getByText('삭제 예정')).toBeInTheDocument();
  // 남은 하나는 뺄 수 없다
  expect(within(tree).getByRole('button', { name: 'm.bdf 삭제' })).toBeDisabled();
  const bar = screen.getByRole('region', { name: '고치기' });
  expect(within(bar).getByRole('status')).toHaveTextContent('바뀐 칸 1 · 파일 삭제 1개');
  expect(calls(fetch)).not.toContain('POST /api/entries/E000051/files/remove');   // 표시만 — 아직 저장 안 함
  await userEvent.click(within(bar).getByRole('button', { name: '변경 완료' }));
  await waitFor(() => expect(calls(fetch)).toContain('POST /api/entries/E000051/files/remove'));
  expect(calls(fetch)).not.toContain('PATCH /api/entries/E000051');   // 칸은 안 바뀌었다
  expect(await screen.findByText('변경을 저장했습니다. 파일 1개를 삭제했습니다.')).toBeInTheDocument();
  await waitFor(() => expect(within(screen.getByRole('tree', { name: '파일' })).queryByText('r.pdf')).toBeNull());
  expect(screen.getByText('뺀 파일')).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: '되돌리기' })[0]);
  await waitFor(() => expect(calls(fetch)).toContain('POST /api/entries/E000051/files/restore'));
  expect(await within(screen.getByRole('tree', { name: '파일' })).findByText('r.pdf')).toBeInTheDocument();
});

test('삭제 표시를 다시 누르면 취소되고, [취소]로 나가면 아무것도 빼지 않는다', async () => {
  const fetch = renderPage({ 'GET /api/entries/E000051': ENTRY });
  await userEvent.click(await screen.findByRole('button', { name: '변경하기' }));
  const tree = screen.getByRole('tree', { name: '파일' });
  await userEvent.click(within(tree).getByRole('button', { name: 'r.pdf 삭제' }));
  await userEvent.click(within(tree).getByRole('button', { name: 'r.pdf 삭제 취소' }));
  expect(within(tree).queryByText('삭제 예정')).toBeNull();
  const bar = screen.getByRole('region', { name: '고치기' });
  expect(within(bar).getByText('바뀐 칸이 없습니다')).toBeInTheDocument();
  await userEvent.click(within(bar).getByRole('button', { name: '취소' }));
  expect(within(screen.getByRole('tree', { name: '파일' })).queryByRole('button', { name: 'r.pdf 삭제' })).toBeNull();
  expect(calls(fetch).some((c) => c.includes('/files/remove'))).toBe(false);
});

test('38 — 고치기에서 대상을 고르면(동의어도 용어로) PATCH 에 실리고 읽기 화면에 대상 링크가 보인다', async () => {
  let current = ENTRY;
  const fetch = renderPage({
    'GET /api/entries/E000051': () => current,
    'GET /api/vocab?kind=zone': { kind: 'zone', other: '기타', terms: [{ id: 1, value: '선수부', active: true, count: 1, synonyms: [] }] },
    'GET /api/vocab?kind=atype': { kind: 'atype', other: '기타', terms: [] },
    'GET /api/vocab?kind=target': { kind: 'target', other: '기타', terms: [
      { id: 6, value: '계류 의장품', active: true, count: 0, synonyms: [{ id: 7, value: 'Mooring Fitting' }] }] },
    'PATCH /api/entries/E000051': (init) => { current = { ...ENTRY, ...JSON.parse(init.body), version: 4 }; return current; },
  });
  await userEvent.click(await screen.findByRole('button', { name: '변경하기' }));
  await userEvent.type(screen.getByRole('combobox', { name: '대상' }), 'Mooring Fitting{Enter}');
  const bar = screen.getByRole('region', { name: '고치기' });
  expect(within(bar).getByRole('status')).toHaveTextContent('바뀐 칸 1 · 대상');
  await userEvent.click(within(bar).getByRole('button', { name: '변경 완료' }));
  await waitFor(() => expect(calls(fetch)).toContain('PATCH /api/entries/E000051'));
  const body = JSON.parse(fetch.mock.calls.find(([u, i]) => i?.method === 'PATCH')[1].body);
  expect(body).toEqual({ version: 3, target: '계류 의장품' });
  expect(await screen.findByRole('link', { name: '계류 의장품' })).toHaveAttribute('href', expect.stringContaining('target='));
});
