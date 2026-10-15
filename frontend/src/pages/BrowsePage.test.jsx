import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthContext } from '../auth/AuthContext.jsx';
import { calls, mockApi } from '../test/mockApi.js';
import BrowsePage, { matchesFilter } from './BrowsePage.jsx';

const FACETS = {
  zone: [{ value: '선미부', count: 3, listed: true, aliases: ['AFT', '선미'] }, { value: '기관실', count: 1, listed: true, aliases: ['ER'] },
    { value: '선수부', count: 0, listed: true, aliases: [] }, { value: '갑판실', count: 1, listed: false, aliases: [] }],
  analysis_type: [{ value: 'FE 해석', count: 2, listed: true, aliases: ['FEM'] }],
  hull: [{ value: '9002', count: 2, label: '벌크선' }, { value: '9001', count: 1, label: null }],
  ship_type: [{ value: '벌크선', count: 2 }],
  tag: [{ value: '계류', count: 2, aliases: ['Mooring'] }],
  kind: [{ value: 'model', count: 4 }],
  uploaded_by: [{ value: 'A100001', count: 4, label: '홍길동' }],
};
const DATA = { total: 4, facets: FACETS };

function Probe() { const l = useLocation(); return <span data-testid="loc">{l.pathname}{l.search}</span>; }

function renderAt(url = '/browse', { admin = false, map = {} } = {}) {
  const fetch = mockApi({ 'GET /api/search/browse': DATA, 'GET /api/search/browse?drafts=true': { ...DATA, total: 5 }, ...map });
  render(
    <AuthContext.Provider value={{ user: { employee_id: 'A1', is_admin: admin } }}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/browse" element={<><BrowsePage /><Probe /></>} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return fetch;
}

test('속성 탭마다 값과 건수를 건수순으로 보이고, 값을 누르면 그 필터로 검색한다', async () => {
  renderAt();
  const list = await screen.findByRole('list', { name: '구역 값' });
  const rows = within(list).getAllByRole('listitem');
  expect(rows[0]).toHaveTextContent('선미부');
  expect(rows[0]).toHaveTextContent('동의어 AFT, 선미');
  expect(rows[0]).toHaveTextContent('3');
  // 아직 안 쓴 용어는 링크가 아니다, 목록 밖 값은 표시된다
  expect(within(list).queryByRole('link', { name: '선수부' })).toBeNull();
  expect(within(list).getByText('목록 밖')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /구역/ })).toHaveAttribute('aria-selected', 'true');
  await userEvent.click(within(list).getByRole('link', { name: '선미부' }));
  expect(screen.getByTestId('loc').textContent).toBe('/?zone=%EC%84%A0%EB%AF%B8%EB%B6%80');
});

test('탭을 바꾸면 주소에 남고, 동의어로도 거른다', async () => {
  renderAt();
  await screen.findByRole('list', { name: '구역 값' });
  await userEvent.type(screen.getByRole('searchbox', { name: '구역 값 거르기' }), 'aft');
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  // 15 — 해석 연도 탭은 없앴다
  expect(screen.queryByRole('tab', { name: /해석 연도/ })).toBeNull();
  await userEvent.click(screen.getByRole('tab', { name: /^호선/ }));
  expect(screen.getByTestId('loc').textContent).toBe('/browse?by=hull');
  expect(screen.getByRole('searchbox', { name: '호선 값 거르기' })).toHaveValue('');
  await userEvent.click(screen.getByRole('radio', { name: '이름순' }));
  const hulls = within(screen.getByRole('list', { name: '호선 값' })).getAllByRole('listitem').map((li) => li.textContent);
  expect(hulls[0]).toMatch(/^9001/);
});

test('호선은 선종, 올린 사람은 이름으로 보이고 각각 필터 주소로 간다', async () => {
  renderAt('/browse?by=hull');
  const list = await screen.findByRole('list', { name: '호선 값' });
  expect(within(list).getByRole('link', { name: '9002' })).toHaveAttribute('href', '/?hull=9002');
  expect(list).toHaveTextContent('벌크선');
  await userEvent.click(screen.getByRole('tab', { name: /올린 사람/ }));
  expect(screen.getByRole('link', { name: '홍길동' })).toHaveAttribute('href', '/?uploaded_by=A100001');
});

test('미확정 포함은 다시 세고, 값 링크도 같은 조건으로 연다', async () => {
  const fetch = renderAt('/browse?by=tag');
  await screen.findByRole('list', { name: '태그 값' });
  expect(screen.getByRole('link', { name: /태그 동의어 묶기/ })).toHaveAttribute('href', '/tags/manage');
  await userEvent.click(screen.getByRole('checkbox', { name: '미확정 포함' }));
  expect(await screen.findByText(/확정·미확정 자료/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '계류' })).toHaveAttribute('href', '/?drafts=1&tag=%EA%B3%84%EB%A5%98');
  expect(calls(fetch)).toContain('GET /api/search/browse?drafts=true');
});

test('관리자에게만 분류 목록 관리 링크를 보인다', async () => {
  renderAt('/browse', { admin: true });
  expect(await screen.findByRole('link', { name: /분류 목록 관리/ })).toHaveAttribute('href', '/admin/vocab');
});

test('일반 사용자에게는 분류 목록 관리 링크가 없다', async () => {
  renderAt('/browse');
  await screen.findByRole('list', { name: '구역 값' });
  expect(screen.queryByRole('link', { name: /분류 목록 관리/ })).toBeNull();
});

test('오류를 보이고 다시 시도한다', async () => {
  let n = 0;
  renderAt('/browse', { map: { 'GET /api/search/browse': () => (++n === 1 ? { __status: 500, detail: 'x' } : DATA) } });
  expect(await screen.findByRole('alert')).toHaveTextContent('분류를 불러오지 못했습니다');
  await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByRole('list', { name: '구역 값' })).toBeInTheDocument();
});

test('거르기는 값·라벨·동의어를 공백·대소문자 없이 본다', () => {
  expect(matchesFilter('zone', FACETS.zone[0], '선 미')).toBe(true);
  expect(matchesFilter('zone', FACETS.zone[0], 'Aft')).toBe(true);
  expect(matchesFilter('hull', FACETS.hull[0], '벌크')).toBe(true);
  expect(matchesFilter('zone', FACETS.zone[1], 'aft')).toBe(false);
  expect(matchesFilter('zone', FACETS.zone[1], '')).toBe(true);
});
