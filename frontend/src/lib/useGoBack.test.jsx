import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import BackButton from '../components/ui/BackButton.jsx';
import { useMouseBack } from './useGoBack.js';

function Where() {
  const loc = useLocation();
  return <span data-testid="where">{loc.pathname}</span>;
}

function Shell() {
  useMouseBack();
  return <><Where /><BackButton /></>;
}

function renderAt(entries, index) {
  render(
    <MemoryRouter initialEntries={entries} initialIndex={index}>
      <Routes><Route path="*" element={<Shell />} /></Routes>
    </MemoryRouter>,
  );
}

test('이전 화면 단추 — 앱 안 이전 화면으로 돌아간다', () => {
  renderAt(['/reports', '/e/E000001'], 1);
  fireEvent.click(screen.getByRole('button', { name: '이전 화면' }));
  expect(screen.getByTestId('where')).toHaveTextContent('/reports');
});

test('이전 화면 단추 — 새 탭으로 열었으면(이전 화면 없음) 검색으로 간다', () => {
  renderAt(['/e/E000001'], 0);
  fireEvent.click(screen.getByRole('button', { name: '이전 화면' }));
  expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
});

test('마우스 뒤로 버튼(3)은 이전 화면, 앞으로 버튼(4)은 다음 화면 — 브라우저 기본 이동은 막는다', () => {
  renderAt(['/reports', '/e/E000001'], 1);
  const back = new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true });
  fireEvent(window, back);
  expect(back.defaultPrevented).toBe(true);
  expect(screen.getByTestId('where')).toHaveTextContent('/reports');
  fireEvent(window, new MouseEvent('mouseup', { button: 4, bubbles: true, cancelable: true }));
  expect(screen.getByTestId('where')).toHaveTextContent('/e/E000001');
});

test('왼쪽·가운데 버튼은 건드리지 않는다', () => {
  renderAt(['/reports', '/e/E000001'], 1);
  const left = new MouseEvent('mouseup', { button: 0, bubbles: true, cancelable: true });
  fireEvent(window, left);
  expect(left.defaultPrevented).toBe(false);
  expect(screen.getByTestId('where')).toHaveTextContent('/e/E000001');
});
