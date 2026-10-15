import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { calls, mockApi } from '../test/mockApi.js';
import RecentComparesPage from './RecentComparesPage.jsx';
import { CompareBar, CompareBasketProvider } from '../components/compare/CompareBasket.jsx';
import { BASKET_KEY } from '../lib/compareBasket.js';
import { whenLabel } from '../lib/recentCompares.js';

const file = (id, name, extra = {}) => ({ id, name, hull: '9001', entry_id: `E00000${id}`, entry_title: `${name} 자료`,
  entry_status: 'confirmed', model_state: 'done', model_key: null, available: true, note: null, ...extra });
const ITEMS = [
  { id: 11, file_ids: [1, 2, 3], open_count: 4, created_at: '2026-10-01T09:00:00', last_opened_at: '2026-10-07T08:00:00', dropped: 1,
    files: [file(1, 'a.bdf'), file(2, 'b.bdf', { available: false, note: 'failed', model_state: 'failed' }),
            file(3, 'c.bdf', { available: false, note: 'trashed', entry_status: 'trashed' })] },
  { id: 12, file_ids: [4, 5], open_count: 1, created_at: '2026-10-02T09:00:00', last_opened_at: '2026-10-02T09:00:00', dropped: 0,
    files: [file(4, 'd.bdf'), file(5, 'e.bdf')] },
];

function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname + l.search}</output>; }

function renderAt(url = '/compares') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CompareBasketProvider>
        <Routes>
          <Route path="/compares" element={<RecentComparesPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
        <CompareBar />
      </CompareBasketProvider>
    </MemoryRouter>,
  );
}

function renderBar() {
  localStorage.setItem(BASKET_KEY, JSON.stringify([{ id: 9, name: 'x.bdf', hull: '' }]));
  return render(
    <MemoryRouter initialEntries={['/']}>
      <CompareBasketProvider>
        <Routes><Route path="*" element={<Where />} /></Routes>
        <CompareBar />
      </CompareBasketProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => localStorage.clear());

test('최근 비교 카드 — 이름·호선·자료·안내·열기(휴지통 모델은 빼고)·횟수', async () => {
  mockApi({ 'GET /api/me/compares': { items: ITEMS } });
  renderAt();
  const cards = await screen.findAllByRole('article');
  expect(cards).toHaveLength(2);
  const first = cards[0];
  expect(within(first).getByText('a.bdf')).toBeInTheDocument();
  expect(within(first).getByRole('link', { name: 'E000001' })).toHaveAttribute('href', '/e/E000001');
  expect(within(first).getByText('b.bdf — 3D 변환 실패')).toBeInTheDocument();
  expect(within(first).getByText('c.bdf — 휴지통에 있어 빠집니다')).toBeInTheDocument();
  expect(within(first).getByText('영구 삭제된 모델 1개는 빠졌습니다')).toBeInTheDocument();
  expect(within(first).getByText(/4번 열어 봄/)).toBeInTheDocument();
  expect(within(first).getByRole('link', { name: '열기' })).toHaveAttribute('href', '/compare?ids=1,2');
  expect(within(cards[1]).getByRole('link', { name: '열기' })).toHaveAttribute('href', '/compare?ids=4,5');
});

test('한 줄 지우기·모두 지우기', async () => {
  const fetch = mockApi({ 'GET /api/me/compares': { items: ITEMS }, 'DELETE /api/me/compares/12': { ok: true },
                          'DELETE /api/me/compares': { deleted: 1 } });
  renderAt();
  const cards = await screen.findAllByRole('article');
  await userEvent.click(within(cards[1]).getByRole('button', { name: '이 비교 기록 삭제' }));
  await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1));
  expect(calls(fetch)).toContain('DELETE /api/me/compares/12');
  await userEvent.click(screen.getByRole('button', { name: '모두 지우기' }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '모두 지우기' }));
  expect(await screen.findByText('아직 연 비교가 없습니다')).toBeInTheDocument();
  expect(calls(fetch)).toContain('DELETE /api/me/compares');
});

test('바구니 띠의 [최근] 메뉴에서 전에 연 비교를 연다', async () => {
  mockApi({ 'GET /api/me/compares?limit=6': { items: ITEMS } });
  renderBar();
  await userEvent.click(within(screen.getByRole('region', { name: '비교 바구니' })).getByRole('button', { name: '최근' }));
  const menu = await screen.findByRole('menu', { name: '최근 비교' });
  const item = await within(menu).findByRole('menuitem', { name: /d\.bdf · e\.bdf/ });
  await userEvent.click(item);
  expect(screen.getByTestId('where').textContent).toBe('/compare?ids=4,5');
});

test('[최근] 메뉴 — 비어 있으면 안내하고, 모두 보기로 간다', async () => {
  mockApi({ 'GET /api/me/compares?limit=6': { items: [] } });
  renderBar();
  await userEvent.click(screen.getByRole('button', { name: '최근' }));
  expect(await screen.findByText('아직 연 비교가 없습니다.')).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '최근' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: '최근 비교 모두 보기' }));
  expect(screen.getByTestId('where').textContent).toBe('/compares');
});

test('언제 표시', () => {
  const now = new Date(2026, 9, 7, 12, 0, 0);
  expect(whenLabel(new Date(2026, 9, 7, 11, 59, 40).toISOString(), now)).toBe('방금');
  expect(whenLabel(new Date(2026, 9, 7, 11, 30).toISOString(), now)).toBe('30분 전');
  expect(whenLabel(new Date(2026, 9, 7, 8, 0).toISOString(), now)).toBe('4시간 전');
  expect(whenLabel(new Date(2026, 9, 6, 20, 0).toISOString(), now)).toBe('어제');
  expect(whenLabel(new Date(2026, 9, 3, 20, 0).toISOString(), now)).toBe('4일 전');
  expect(whenLabel(new Date(2026, 8, 3, 20, 0).toISOString(), now)).toBe('2026-09-03');
});
