import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { mockApi } from '../test/mockApi.js';
import UpdateNotesPage from './UpdateNotesPage.jsx';

const LIST = [
  { id: '2026-11-24-solid', date: '2026-11-24', kind: '새 기능', title: '솔리드 미리보기', summary: '겉면을 그린다' },
  { id: '2026-10-30-old', date: '2026-10-30', kind: '개선', title: '옛 안내', summary: '옛 요약' },
];
const NOTES = {
  '2026-11-24-solid': { ...LIST[0], links: [{ label: '업무별 모음', path: '/targets' }], sections: [
    { heading: '1. 바깥 면', body: ['본문 문단'], points: ['점 하나'], steps: ['첫 단계', { text: '둘째 단계', image: { src: 'step.png', alt: '단계 그림', caption: '① 여기' } }],
      facts: [{ label: '어디서', text: '자료 화면' }], image: { src: 'solid.png', alt: '솔리드 그림', caption: '그림 설명' },
      note: '주의 한 줄' }] },
  '2026-10-30-old': { ...LIST[1], sections: [{ heading: '옛 구획', body: ['옛 본문'] }] },
};

function renderAt(url, extra = {}) {
  localStorage.clear();
  mockApi({
    'GET /api/update-notes': { items: LIST },
    'GET /api/update-notes/2026-11-24-solid': NOTES['2026-11-24-solid'],
    'GET /api/update-notes/2026-10-30-old': NOTES['2026-10-30-old'],
    ...extra,
  });
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/update-notes" element={<UpdateNotesPage />} />
        <Route path="/update-notes/:noteId" element={<UpdateNotesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

test('목록 주소는 최신 안내 — 구획(문단, 사실, 단계, 점, 그림, 주의)과 화면 열기, 본 기록', async () => {
  renderAt('/update-notes');
  expect(await screen.findByRole('heading', { level: 2, name: '솔리드 미리보기' })).toBeInTheDocument();
  expect(screen.getByText('본문 문단')).toBeInTheDocument();
  expect(screen.getByText('자료 화면')).toBeInTheDocument();
  expect(screen.getByText('첫 단계')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: '단계 그림' })).toHaveAttribute('src', '/api/update-notes/img/step.png');
  expect(screen.getByRole('img', { name: '단계 그림' }).closest('a')).toHaveAttribute('href', '/api/update-notes/img/step.png');
  expect(screen.getByRole('img', { name: '솔리드 그림' })).toHaveAttribute('src', '/api/update-notes/img/solid.png');
  expect(screen.getByText('주의 한 줄')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /업무별 모음 열기/ })).toHaveAttribute('href', '/targets');
  const nav = screen.getByRole('navigation', { name: '안내 목록' });
  expect(within(nav).getByRole('link', { name: /솔리드 미리보기/ })).toHaveAttribute('aria-current', 'page');
  expect(within(nav).getByText('2026년 10월')).toBeInTheDocument();
  expect(localStorage.getItem('logbook_update_notes_seen')).toBe('2026-11-24-solid');
});

test('한 건 주소는 그 안내, 목록을 누르면 주소가 바뀐다', async () => {
  renderAt('/update-notes/2026-10-30-old');
  expect(await screen.findByText('옛 본문')).toBeInTheDocument();
  await userEvent.click(within(screen.getByRole('navigation', { name: '안내 목록' })).getByRole('link', { name: /솔리드 미리보기/ }));
  expect(await screen.findByText('본문 문단')).toBeInTheDocument();
});

test('없는 안내 주소는 최신 안내를 보이며 알린다', async () => {
  renderAt('/update-notes/no-such');
  expect(await screen.findByText(/찾는 안내가 없어 최신 안내를 보여 줍니다/)).toHaveAttribute('role', 'status');
  expect(await screen.findByText('본문 문단')).toBeInTheDocument();
});

test('링크 복사는 그 안내의 전체 주소', async () => {
  renderAt('/update-notes/2026-11-24-solid');
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  await userEvent.click(await screen.findByRole('button', { name: /링크 복사/ }));
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/update-notes/2026-11-24-solid`);
  expect(await screen.findByRole('button', { name: /복사됨/ })).toBeInTheDocument();
});

test('한 안내를 못 불러와도 다른 안내를 고르면 오류가 사라진다', async () => {
  renderAt('/update-notes/2026-10-30-old', { 'GET /api/update-notes/2026-10-30-old': { __status: 500, detail: 'boom' } });
  expect(await screen.findByRole('button', { name: '다시 시도' })).toBeInTheDocument();
  await userEvent.click(within(screen.getByRole('navigation', { name: '안내 목록' })).getByRole('link', { name: /솔리드 미리보기/ }));
  expect(await screen.findByText('본문 문단')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument();
});

test('늦게 온 앞 안내의 응답이 지금 안내를 덮지 않는다', async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  renderAt('/update-notes/2026-10-30-old', { 'GET /api/update-notes/2026-10-30-old': () => slow });
  const nav = await screen.findByRole('navigation', { name: '안내 목록' });
  await userEvent.click(within(nav).getByRole('link', { name: /솔리드 미리보기/ }));
  expect(await screen.findByText('본문 문단')).toBeInTheDocument();
  release(NOTES['2026-10-30-old']);
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByText('옛 본문')).not.toBeInTheDocument();
  expect(screen.getByText('본문 문단')).toBeInTheDocument();
});
