import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import TopBar, { suggestionSearch, suggestOptions } from './TopBar.jsx';
import { calls, mockApi } from '../../test/mockApi.js';

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

test('입력하면 잠시 뒤 검색 주소로 바뀌고, 필터는 유지한다', async () => {
  render(
    <MemoryRouter initialEntries={['/?hull=9999']}>
      <TopBar user={{ name: '김철수', employee_id: 'A100001' }} onLogout={() => {}} />
      <Routes><Route path="*" element={<LocationProbe />} /></Routes>
    </MemoryRouter>,
  );
  await userEvent.type(screen.getByLabelText('검색어'), '강도 ');
  await new Promise((r) => setTimeout(r, 300));
  expect(screen.getByTestId('loc').textContent).toBe('/?hull=9999&q=%EA%B0%95%EB%8F%84');
  expect(screen.getByLabelText('검색어')).toHaveValue('강도 ');
});

test('주소의 q 를 입력칸에 채운다', () => {
  render(
    <MemoryRouter initialEntries={['/?q=9999']}>
      <TopBar user={{ name: '김철수', employee_id: 'A100001' }} onLogout={() => {}} />
    </MemoryRouter>,
  );
  expect(screen.getByLabelText('검색어')).toHaveValue('9999');
});

test('입력 반영을 기다리는 사이 주소가 밖에서 바뀌면, 걸려 있던 반영을 버린다', async () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <TopBar user={{ name: '김철수', employee_id: 'A100001' }} onLogout={() => {}} />
      <Link to="/?q=9998">공유 링크</Link>
      <Routes><Route path="*" element={<LocationProbe />} /></Routes>
    </MemoryRouter>,
  );
  await userEvent.type(screen.getByLabelText('검색어'), '강도');
  await userEvent.click(screen.getByRole('link', { name: '공유 링크' }));
  await new Promise((r) => setTimeout(r, 300));
  expect(screen.getByTestId('loc').textContent).toBe('/?q=9998');
  expect(screen.getByLabelText('검색어')).toHaveValue('9998');
});

test('계정 메뉴에서 로그아웃한다', async () => {
  const onLogout = vi.fn();
  render(
    <MemoryRouter initialEntries={['/']}>
      <TopBar user={{ name: '김철수', employee_id: 'A100001', department: '구조팀' }} onLogout={onLogout} />
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole('button', { name: /계정 메뉴/ }));
  const menu = screen.getByRole('menu');
  expect(menu).toHaveTextContent('A100001');
  expect(menu).toHaveTextContent('구조팀');
  await userEvent.click(screen.getByRole('menuitem', { name: '로그아웃' }));
  expect(onLogout).toHaveBeenCalled();
});

test('검색어가 있으면 지우기 단추로 비운다', async () => {
  renderTopBar();
  await userEvent.type(screen.getByLabelText('검색어'), '9999');
  await userEvent.click(screen.getByRole('button', { name: '검색어 지우기' }));
  expect(screen.getByLabelText('검색어')).toHaveValue('');
  expect(screen.getByLabelText('검색어')).toHaveFocus();
});

// ---- 19 자동완성 ----

const SUG = { hull: ['3496', '3497'], zone: ['선수부'], tag: [] };

function renderWith(url = '/') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <TopBar user={{ name: '김철수', employee_id: 'A100001' }} onLogout={() => {}} />
      <Routes><Route path="*" element={<LocationProbe />} /></Routes>
    </MemoryRouter>,
  );
}

test('자동완성 — 입력이 멈추면 호선·구역·태그 후보를 보이고, ↓/Enter 로 그 필터 검색으로 간다', async () => {
  const fetch = mockApi({ 'GET /api/suggest/all?q=349&limit=5': SUG });
  renderWith('/?zone=%EC%84%A0%EB%AF%B8%EB%B6%80');
  const input = screen.getByRole('combobox', { name: '검색어' });
  await userEvent.type(input, '349');
  const list = await screen.findByRole('listbox', { name: '검색 후보' });
  expect(input).toHaveAttribute('aria-expanded', 'true');
  const opts = within(list).getAllByRole('option');
  expect(opts.map((o) => o.textContent)).toEqual(['호선3496', '호선3497', '구역선수부']);
  expect(calls(fetch).filter((c) => c.includes('/suggest/all'))).toHaveLength(1);   // 글자마다가 아니라 멈춘 뒤 한 번
  await userEvent.keyboard('{ArrowDown}{ArrowDown}');
  expect(input).toHaveAttribute('aria-activedescendant', opts[1].id);
  expect(opts[1]).toHaveAttribute('aria-selected', 'true');
  await userEvent.keyboard('{ArrowUp}{ArrowUp}');   // 맨 위에서 ↑ 는 맨 아래로
  expect(opts[2]).toHaveAttribute('aria-selected', 'true');
  await userEvent.keyboard('{ArrowDown}{Enter}');
  // 다른 필터는 두고 호선을 더한다. 입력한 글자(q)는 뺀다
  expect(screen.getByTestId('loc').textContent).toBe('/?zone=%EC%84%A0%EB%AF%B8%EB%B6%80&hull=3496');
  expect(input).toHaveValue('');
  expect(screen.queryByRole('listbox')).toBeNull();
});

test('자동완성 — 후보를 고르지 않은 Enter 는 글자 검색, Esc 는 후보만 닫는다', async () => {
  mockApi({ 'GET /api/suggest/all?q=349&limit=5': SUG });
  renderWith();
  const input = screen.getByRole('combobox', { name: '검색어' });
  await userEvent.type(input, '349');
  await screen.findByRole('listbox');
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(input).toHaveValue('349');
  await userEvent.keyboard('{Enter}');
  expect(screen.getByTestId('loc').textContent).toBe('/?q=349');
});

test('자동완성 — 마우스로 고르고, 후보 요청이 실패하면 목록 없이 그냥 검색창이다', async () => {
  mockApi({ 'GET /api/suggest/all?q=%EC%84%A0%EC%88%98&limit=5': SUG, 'GET /api/suggest/all?q=x&limit=5': { __status: 500 } });
  const { unmount } = renderWith();
  await userEvent.type(screen.getByLabelText('검색어'), '선수');
  await userEvent.click(await screen.findByRole('option', { name: /선수부/ }));
  expect(screen.getByTestId('loc').textContent).toBe('/?zone=%EC%84%A0%EC%88%98%EB%B6%80');
  unmount();
  renderWith();
  await userEvent.type(screen.getByLabelText('검색어'), 'x');
  await new Promise((r) => setTimeout(r, 350));
  expect(screen.queryByRole('listbox')).toBeNull();
});

test('자동완성 도우미 — 응답 → 후보 순서, 후보 → 검색 주소', () => {
  expect(suggestOptions({ tag: ['T'], hull: ['1'], zone: [] })).toEqual([{ key: 'hull', value: '1' }, { key: 'tag', value: 'T' }]);
  expect(suggestOptions(null)).toEqual([]);
  expect(suggestionSearch('?q=34&hull=3496', { key: 'hull', value: '3496' })).toBe('hull=3496');
  expect(suggestionSearch('?q=34&hull=3496', { key: 'hull', value: '3497' })).toBe('hull=3496&hull=3497');
});
