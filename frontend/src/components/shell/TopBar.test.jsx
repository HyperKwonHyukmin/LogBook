import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import TopBar from './TopBar.jsx';

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="loc">{location.pathname}{location.search}</span>;
}

function renderTopBar() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <TopBar user={{ name: '김철수', employee_id: 'A100001' }} onLogout={() => {}} />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

test('Ctrl+K 로 검색창에 포커스를 옮긴다', async () => {
  renderTopBar();
  const input = screen.getByLabelText('검색어');
  await userEvent.keyboard('{Control>}k{/Control}');
  expect(input).toHaveFocus();
});

test('빈 검색어는 제출해도 이동하지 않는다', () => {
  renderTopBar();
  const before = screen.getByTestId('loc').textContent;
  fireEvent.submit(screen.getByRole('search'));
  expect(screen.getByTestId('loc').textContent).toBe(before);
});

test('공백만 있는 검색어도 제출해도 이동하지 않는다', async () => {
  renderTopBar();
  const before = screen.getByTestId('loc').textContent;
  await userEvent.type(screen.getByLabelText('검색어'), '   ');
  fireEvent.submit(screen.getByRole('search'));
  expect(screen.getByTestId('loc').textContent).toBe(before);
});

test('검색어를 입력해 제출하면 검색 화면으로 이동한다', async () => {
  renderTopBar();
  await userEvent.type(screen.getByLabelText('검색어'), '3496');
  fireEvent.submit(screen.getByRole('search'));
  expect(screen.getByTestId('loc').textContent).toBe('/?q=3496');
});
