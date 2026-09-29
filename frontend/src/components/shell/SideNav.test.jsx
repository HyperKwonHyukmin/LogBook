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
  expect(screen.getByText('999_LogBook 연결 끊김')).toBeInTheDocument();
});
