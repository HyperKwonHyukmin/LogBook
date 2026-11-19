import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import NotesPage from './NotesPage.jsx';

const ITEMS = [
  { entry: { entry_id: 'E000222', title: '3503 · 기타 · Unit · M03', status: 'confirmed', hulls: ['3503'], no_hull: false },
    body: '## 경계조건\n- SPC 123456', updated_at: '2026-11-19T17:30:00' },
  { entry: { entry_id: 'E000191', title: '공용 · 기타 · 의장품 · 축전지', status: 'confirmed', hulls: [], no_hull: true },
    body: '트렁크 **보강** 참고', updated_at: '2026-11-18T09:00:00' },
];

test('64 — 메모를 최근 순으로 마크다운으로 보이고, 줄 머리를 누르면 자료로 간다. 찾기는 서버에 q 로', async () => {
  const urls = [];
  vi.stubGlobal('fetch', vi.fn((url) => {
    urls.push(url);
    const q = new URL(url, 'http://x').searchParams.get('q');
    const items = q ? ITEMS.filter((i) => i.body.includes(q)) : ITEMS;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items, total: 2 }) });
  }));
  render(<MemoryRouter><NotesPage /></MemoryRouter>);
  const list = await screen.findByRole('list', { name: '나의 메모 목록' });
  const rows = [...list.children];   // 메모 안의 마크다운 목록(li)은 세지 않는다
  expect(rows).toHaveLength(2);
  expect(within(rows[0]).getByRole('link', { name: /E000222/ })).toHaveAttribute('href', '/e/E000222');
  expect(rows[0].querySelector('.md-body h2')).toHaveTextContent('경계조건');
  expect(within(rows[1]).getByText('공용')).toBeInTheDocument();
  expect(rows[1].querySelector('.md-body strong')).toHaveTextContent('보강');

  await userEvent.type(screen.getByRole('searchbox', { name: '메모 찾기' }), '트렁크');
  await waitFor(() => expect(urls.some((u) => u.includes('q=%ED%8A%B8%EB%A0%81%ED%81%AC'))).toBe(true));
  await waitFor(() => expect(screen.getByRole('list', { name: '나의 메모 목록' }).children).toHaveLength(1));
});

test('메모가 없으면 쓰는 곳을 알려 준다', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [], total: 0 }) })));
  render(<MemoryRouter><NotesPage /></MemoryRouter>);
  expect(await screen.findByText('아직 메모가 없습니다')).toBeInTheDocument();
});
