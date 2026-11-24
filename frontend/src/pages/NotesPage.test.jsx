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

const WRITTEN = {
  counts: { total: 3, comment: 2, issue: 1, open: 1 },
  items: [
    { id: 9, kind: 'comment', body: '답글 내용', status: null, resolved: null, created_at: '2026-11-25T08:00:00', replies: 0,
      reply_to: { kind: 'issue', name: '김연태', mine: false, body: '경계조건 누락' },
      entry: { entry_id: 'E000288', title: '2865 sw pipesupport', hulls: ['2865'], no_hull: false } },
    { id: 7, kind: 'issue', body: '하중 계수 재확인', status: 'open', resolved: null, created_at: '2026-11-24T10:00:00', replies: 2,
      reply_to: null, entry: { entry_id: 'E000191', title: '축전지', hulls: [], no_hull: true } },
  ],
};

test('2026-11-25 — 의견과 이슈 탭: 내가 쓴 글, 답글이면 어느 글에 단 것인지, 누르면 자료의 의견 칸으로. 거르기는 서버에', async () => {
  const urls = [];
  vi.stubGlobal('fetch', vi.fn((url) => {
    urls.push(url);
    const body = url.includes('/me/comments/written') ? WRITTEN : { items: [], total: 0 };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  }));
  render(<MemoryRouter initialEntries={['/notes']}><NotesPage /></MemoryRouter>);
  await userEvent.click(await screen.findByRole('tab', { name: '의견과 이슈' }));
  const list = await screen.findByRole('list', { name: '내가 쓴 의견과 이슈' });
  const rows = [...list.children];
  expect(rows).toHaveLength(2);
  expect(within(rows[0]).getByRole('link', { name: /E000288/ })).toHaveAttribute('href', '/e/E000288#entry-comments');
  expect(within(rows[0]).getByText('답글')).toBeInTheDocument();
  expect(within(rows[0]).getByText('김연태 님의 이슈에 단 답글')).toBeInTheDocument();
  expect(within(rows[1]).getByText('열린 이슈')).toBeInTheDocument();
  expect(within(rows[1]).getByText('공용')).toBeInTheDocument();
  expect(rows[1]).toHaveTextContent('답글 2');
  await userEvent.click(screen.getByRole('radio', { name: /열린 이슈 1/ }));
  await waitFor(() => expect(urls.some((u) => u.includes('status=open'))).toBe(true));
  vi.unstubAllGlobals();
});

test('의견과 이슈가 없으면 쓰는 곳을 알려 준다(주소 ?tab=comments 로 바로 연다)', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200,
    json: () => Promise.resolve({ items: [], counts: { total: 0, comment: 0, issue: 0, open: 0 } }) })));
  render(<MemoryRouter initialEntries={['/notes?tab=comments']}><NotesPage /></MemoryRouter>);
  expect(await screen.findByText('아직 쓴 의견이나 이슈가 없습니다')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '의견과 이슈' })).toHaveAttribute('aria-selected', 'true');
  vi.unstubAllGlobals();
});
