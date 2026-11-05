import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes, useOutletContext } from 'react-router-dom';
import SectionTabs from './SectionTabs.jsx';

function Probe({ name }) {
  const ctx = useOutletContext();
  return <p>{name}:{ctx?.storage}</p>;
}

test('탭은 주소 링크이고 현재 화면 탭이 선택되며, 바깥 Outlet 맥락을 그대로 넘긴다', () => {
  const items = [{ to: '/coverage', label: '갖춤 현황' }, { to: '/graph', label: '관계 지도' }];
  render(
    <MemoryRouter initialEntries={['/graph']}>
      <Routes>
        <Route element={<OuterOutlet />}>
          <Route element={<SectionTabs label="살펴보기" items={items} />}>
            <Route path="coverage" element={<Probe name="갖춤" />} />
            <Route path="graph" element={<Probe name="지도" />} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  const nav = screen.getByRole('navigation', { name: '살펴보기' });
  expect(nav).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '관계 지도' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: '갖춤 현황' })).toHaveAttribute('href', '/coverage');
  expect(screen.getByText('지도:ok')).toBeInTheDocument();
});

function OuterOutlet() {
  return <Outlet context={{ storage: 'ok' }} />;
}
