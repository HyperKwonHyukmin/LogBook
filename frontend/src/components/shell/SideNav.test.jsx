import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SideNav from './SideNav.jsx';

const renderNav = (isAdmin, path = '/') => render(
  <MemoryRouter initialEntries={[path]}><SideNav isAdmin={isAdmin} storage={{ reachable: true }} /></MemoryRouter>,
);

test('일반 사용자에게는 관리 메뉴가 없다', () => {
  renderNav(false);
  expect(screen.getByRole('link', { name: '검색', exact: true })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /본문 검색/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /관리/ })).not.toBeInTheDocument();
});

test('관리자에게는 관리 메뉴가 보인다', () => {
  renderNav(true);
  expect(screen.getByRole('link', { name: /관리/ })).toHaveAttribute('href', '/admin/users');
});

test('현재 경로의 메뉴가 활성 표시된다', () => {
  renderNav(false, '/hulls');
  expect(screen.getByRole('link', { name: /호선/ })).toHaveAttribute('aria-current', 'page');
});

test('저장소 연결이 끊기면 경고를 보인다', () => {
  render(<MemoryRouter><SideNav isAdmin={false} storage={{ reachable: false }} /></MemoryRouter>);
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('999_LogBook');
  expect(status).toHaveTextContent('끊김');
});

test('호선 화면(/h/9999)에서도 호선 메뉴가 활성이다', () => {
  render(<MemoryRouter initialEntries={['/h/9999']}><SideNav isAdmin={false} storage={{ reachable: true }} /></MemoryRouter>);
  expect(screen.getByRole('link', { name: '호선' })).toHaveClass('bg-navy-700'); // 현재 메뉴 = 한 단계 밝은 네이비 채움
  expect(screen.getByRole('link', { name: '호선' })).toHaveAttribute('aria-current', 'page');
});

test('관리자 메뉴는 관리 하나이고 관리 화면 어디서나 활성이다(2026-11-05)', () => {
  renderNav(true, '/admin/wb-targets');
  const admin = screen.getByRole('link', { name: '관리' });
  expect(admin).toHaveAttribute('href', '/admin/users');
  expect(admin).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('link', { name: '운영' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'WorkBench 연결 규칙' })).toBeNull();
});

test('48 — 분류·태그 동의어 화면은 검색 메뉴 아래다(분류 메뉴 없음)', () => {
  renderNav(false, '/tags/manage');
  expect(screen.queryByRole('link', { name: '분류' })).toBeNull();
  expect(screen.getByRole('link', { name: '검색' })).toHaveAttribute('aria-current', 'page');
});

test('즐겨찾기는 메뉴가 아니라 검색의 fav=1 이다 — 검색 메뉴가 활성(2026-11-05)', () => {
  renderNav(false, '/?fav=1');
  expect(screen.queryByRole('link', { name: '즐겨찾기' })).toBeNull();
  expect(screen.getByRole('link', { name: '검색' })).toHaveAttribute('aria-current', 'page');
});

test('찾아 쓰기·등록·정리 두 묶음, 메뉴 7개(2026-11-05)', () => {
  renderNav(false);
  const nav = screen.getByRole('navigation', { name: '주 메뉴' });
  for (const g of ['찾아 쓰기', '등록·정리']) expect(within(nav).getByText(g)).toBeInTheDocument();
  const links = screen.getAllByRole('link').map((a) => a.textContent);
  expect(links).toEqual(['검색', '호선', '선례 찾기', '살펴보기', '정리 대기', '휴지통', '활동 로그']);
});

test('살펴보기는 갖춤 현황(/coverage)과 관계 지도(/graph) 모두에서 활성이다', () => {
  const { unmount } = renderNav(false, '/graph');
  expect(screen.getByRole('link', { name: '살펴보기' })).toHaveAttribute('aria-current', 'page');
  unmount();
  renderNav(false, '/coverage');
  expect(screen.getByRole('link', { name: '살펴보기' })).toHaveAttribute('aria-current', 'page');
});

test('48 — 문서 본문 검색(/reports)에서도 검색 메뉴가 활성, 비교 화면은 어느 메뉴도 아니다', () => {
  const { unmount } = renderNav(false, '/reports?q=abc');
  expect(screen.getByRole('link', { name: '검색' })).toHaveAttribute('aria-current', 'page');
  unmount();
  renderNav(false, '/compare?ids=1,2');
  expect(screen.queryByRole('link', { name: '최근 비교' })).toBeNull();
  expect(screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page')).toHaveLength(0);
});
