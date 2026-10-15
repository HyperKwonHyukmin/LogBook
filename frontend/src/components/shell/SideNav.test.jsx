import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SideNav from './SideNav.jsx';

const renderNav = (isAdmin, path = '/') => render(
  <MemoryRouter initialEntries={[path]}><SideNav isAdmin={isAdmin} storage={{ reachable: true }} /></MemoryRouter>,
);

test('일반 사용자에게는 관리 메뉴가 없다', () => {
  renderNav(false);
  expect(screen.getByRole('link', { name: '검색', exact: true })).toBeInTheDocument();
  // 22 — 본문 검색은 '문서'(23 전 '보고서') 화면 안의 검색 방식이다(별도 메뉴 없음). 주소는 /reports 그대로
  expect(screen.getByRole('link', { name: '문서' })).toHaveAttribute('href', '/reports');
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

test('관리자에게는 사용자 관리 아래 운영 메뉴가 보인다', () => {
  renderNav(true, '/admin/ops');
  const ops = screen.getByRole('link', { name: '운영' });
  expect(ops).toHaveAttribute('href', '/admin/ops');
  expect(ops).toHaveAttribute('aria-current', 'page');
  const links = screen.getAllByRole('link').map((a) => a.textContent);
  expect(links.indexOf('운영')).toBe(links.indexOf('사용자 관리') + 1);
});

test('관리자에게는 분류 목록 아래 WorkBench 연결 규칙 메뉴가 보인다(18-b)', () => {
  renderNav(true, '/admin/wb-targets');
  const item = screen.getByRole('link', { name: 'WorkBench 연결 규칙' });
  expect(item).toHaveAttribute('href', '/admin/wb-targets');
  expect(item).toHaveAttribute('aria-current', 'page');
  const links = screen.getAllByRole('link').map((a) => a.textContent);
  expect(links.indexOf('WorkBench 연결 규칙')).toBe(links.indexOf('분류 목록') + 1);
});

test('일반 사용자에게는 운영 메뉴가 없다', () => {
  renderNav(false);
  expect(screen.queryByRole('link', { name: '운영' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'WorkBench 연결 규칙' })).toBeNull();
});

test('태그 메뉴는 분류가 되었고, 태그 동의어 화면에서도 활성이다(09)', () => {
  renderNav(false, '/tags/manage');
  const browse = screen.getByRole('link', { name: '분류' });
  expect(browse).toHaveAttribute('href', '/browse');
  expect(browse).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('link', { name: '태그' })).toBeNull();
});

test('즐겨찾기 메뉴는 검색 다음에 있고 fav=1 주소에서만 활성이다(10)', () => {
  renderNav(false, '/?fav=1');
  const links = screen.getAllByRole('link').map((a) => a.textContent);
  expect(links.indexOf('즐겨찾기')).toBe(links.indexOf('검색') + 1);
  const fav = screen.getByRole('link', { name: '즐겨찾기' });
  expect(fav).toHaveAttribute('href', '/?fav=1');
  expect(fav).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: '검색' })).not.toHaveAttribute('aria-current');
});

test('검색 화면에서는 검색 메뉴만 활성이다(10)', () => {
  renderNav(false, '/?q=abc');
  expect(screen.getByRole('link', { name: '검색' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: '즐겨찾기' })).not.toHaveAttribute('aria-current');
});

test('최근 비교 메뉴 — 비교 화면에서도 활성이다(11)', () => {
  renderNav(false, '/compare?ids=1,2');
  expect(screen.getByRole('link', { name: '최근 비교' })).toHaveAttribute('href', '/compares');
  expect(screen.getByRole('link', { name: '최근 비교' })).toHaveAttribute('aria-current', 'page');
});
