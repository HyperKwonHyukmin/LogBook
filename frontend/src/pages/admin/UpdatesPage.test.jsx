import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { mockApi } from '../../test/mockApi.js';
import UpdatesPage from './UpdatesPage.jsx';

const ITEMS = [
  { date: '2026-10-22', no: '46', kind: '기능', title: '과제 담당자', summary: '담당자를 따로', requester: '김도현 선임',
    path: '/inbox', screen: '정리 대기', points: ['명부에서 퇴사 표시'] },
  { date: '2026-10-21', no: '45', kind: '기능', title: '시리즈 호선', summary: '한 묶음으로', status: '운영 확인 전' },
  { date: '2026-10-20', no: '44', kind: '개선', title: '갖춤 현황 기준', summary: '행·열 고르기' },
  { date: '2026-09-29', no: '01', kind: '기능', title: '첫 판', summary: '사번 로그인' },
];

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname}{l.search}</span>;
}

function renderPage({ items = ITEMS, url = '/admin/updates', seen = null } = {}) {
  localStorage.clear();
  if (seen) localStorage.setItem('logbook_updates_seen', seen);
  mockApi({ 'GET /api/admin/updates': { items } });
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/admin/updates" element={<><UpdatesPage /><Where /></>} /><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  );
}
const shown = () => screen.queryAllByRole('listitem').filter((li) => li.id?.startsWith('u-')).length;

test('달 묶음 점 타임라인 · 요청자 · 화면 바로가기는 앱 안 링크', async () => {
  renderPage();
  expect(await screen.findByRole('heading', { name: '업데이트 이력' })).toBeInTheDocument();
  expect(await screen.findByText('과제 담당자')).toBeInTheDocument();
  expect(shown()).toBe(4);
  expect(screen.getByRole('region', { name: '2026년 10월' })).toBeInTheDocument();
  expect(screen.getByText(/요청/)).toHaveTextContent('요청 김도현 선임');
  expect(screen.getByRole('link', { name: /정리 대기 열기/ })).toHaveAttribute('href', '/inbox');
  expect(screen.getByText('운영 확인 전')).toBeInTheDocument();
});

test('기간 두 단 — 해를 고르면 주소에 남고, 달로 좁히고, 필터 초기화로 전체', async () => {
  renderPage();
  await screen.findByText('과제 담당자');
  const periods = screen.getByRole('group', { name: '기간' });
  expect(within(periods).getByRole('button', { name: /2026년/ })).toHaveTextContent('4');
  const months = screen.getByRole('group', { name: '달' });
  await userEvent.click(within(months).getByRole('button', { name: /9월/ }));
  expect(shown()).toBe(1);
  expect(screen.getByTestId('where')).toHaveTextContent('/admin/updates?period=2026-09');
  await userEvent.click(screen.getByRole('button', { name: '필터 초기화' }));
  expect(shown()).toBe(4);
  expect(screen.getByTestId('where')).toHaveTextContent(/^\/admin\/updates$/);
});

test('주소의 기간으로 열고, 분류·찾기·운영 확인 전만 보기', async () => {
  renderPage({ url: '/admin/updates?period=2026-10' });
  await screen.findByText('과제 담당자');
  expect(shown()).toBe(3);
  await userEvent.click(screen.getByRole('radio', { name: /개선/ }));
  expect(shown()).toBe(1);
  await userEvent.click(screen.getByRole('radio', { name: /전체/ }));
  await userEvent.type(screen.getByRole('searchbox', { name: '이력 찾기' }), '김도현');
  expect(shown()).toBe(1);
  await userEvent.clear(screen.getByRole('searchbox', { name: '이력 찾기' }));
  await userEvent.click(screen.getByRole('checkbox', { name: /운영 확인 전만 보기/ }));
  expect(shown()).toBe(1);
});

test('지난번에 본 뒤 새 항목 — 같은 날 배포도 잡고 다음 기준을 저장', async () => {
  renderPage({ seen: '2026-10-21|45|시리즈 호선' });
  await screen.findByText('과제 담당자');
  expect(screen.getByText('지난번에 본 뒤 새 항목 1건')).toBeInTheDocument();
  expect(screen.getAllByText('새 항목')).toHaveLength(1);
  expect(localStorage.getItem('logbook_updates_seen')).toBe('2026-10-22|46|과제 담당자');
});

test('빈 기록과 오류', async () => {
  renderPage({ items: [] });
  expect(await screen.findByText('아직 기록한 업데이트가 없습니다')).toBeInTheDocument();
});

test('맞는 항목이 없으면 안내와 필터 초기화', async () => {
  renderPage();
  await screen.findByText('과제 담당자');
  await userEvent.type(screen.getByRole('searchbox', { name: '이력 찾기' }), '없는글자');
  expect(screen.getByText('맞는 항목이 없습니다')).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: '필터 초기화' })[0]);
  expect(shown()).toBe(4);
});
