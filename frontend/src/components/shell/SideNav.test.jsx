import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SideNav from './SideNav.jsx';

const renderNav = (isAdmin, path = '/') => render(
  <MemoryRouter initialEntries={[path]}><SideNav isAdmin={isAdmin} storage={{ reachable: true }} /></MemoryRouter>,
);

test('일반 사용자에게는 관리 메뉴가 없다', () => {
  renderNav(false);
  expect(screen.getByRole('link', { name: /검색/ })).toBeInTheDocument();
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
  expect(screen.getByRole('link', { name: '호선' })).toHaveClass('bg-brand-subtle');
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

test('일반 사용자에게는 운영 메뉴가 없다', () => {
  renderNav(false);
  expect(screen.queryByRole('link', { name: '운영' })).toBeNull();
});
