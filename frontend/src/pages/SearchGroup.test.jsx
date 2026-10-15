import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { calls, mockApi } from '../test/mockApi.js';
import SearchPage from './SearchPage.jsx';
import { GROUP_STORE_KEY } from '../lib/searchGroup.js';
import { resetPrefs } from '../lib/prefs.js';

const row = (id, title, extra = {}) => ({ entry_id: id, title, status: 'confirmed', analysis_type: null, posted_at: '2026-10-01T09:00:00',
  hulls: ['9001'], ship_types: [], zones: [], tags: [], uploaded_by: 'A100001', confirmed_at: null, file_count: 1,
  kinds: ['report'], kind_counts: { model: 0, report: 1, drawing: 0, result: 0, other: 0 }, score: 0, matched: [], snippets: [],
  favorite: false, ...extra });
const A = row('E000001', '선미 응력 검토', { zones: ['선미부', '기관실'] });
const B = row('E000002', '선미 진동 검토', { zones: ['선미부'] });
const C = row('E000003', '구역 없는 자료');
const FACETS = { hull: [], ship_type: [], analysis_type: [], zone: [], uploaded_by: [], kind: [], tag: [] };
const GROUPED = {
  unit: 'entry', total: 3, items: [], facets: FACETS, hull_suggestion: null, terms: [], group: 'zone', group_total: 3,
  group_offset: 0, group_sort: 'count', multi_valued: 1,
  groups: [
    { value: '선미부', label: null, count: 3, items: [A, B] },
    { value: '기관실', label: null, count: 1, items: [A] },
    { value: null, label: null, count: 1, items: [C] },
  ],
};
const FLAT = { unit: 'entry', total: 3, items: [A, B, C], facets: FACETS, hull_suggestion: null, terms: [], group: null };
const Q_GROUP = 'GET /api/search?group=zone&group_rows=5&group_limit=30&limit=50&offset=0';

function Probe() { const l = useLocation(); return <span data-testid="loc">{l.pathname}{l.search}</span>; }

function renderAt(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/" element={<><SearchPage /><Probe /></>} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { localStorage.clear(); resetPrefs(); });

test('구역별로 묶어 보인다 — 묶음 머리·건수·없음 묶음은 맨 뒤·여러 값 안내', async () => {
  mockApi({ [Q_GROUP]: GROUPED });
  renderAt('/?group=zone');
  const list = await screen.findByRole('listbox', { name: '검색 결과' });
  const groups = within(list).getAllByRole('group');
  expect(groups.map((g) => g.getAttribute('aria-labelledby'))).toEqual(['group-g0', 'group-g1', 'group-g2']);
  expect(within(groups[0]).getAllByRole('option')).toHaveLength(2);
  expect(groups[0]).toHaveTextContent('선미부3건');
  expect(groups[2]).toHaveTextContent('구역 없음');
  expect(screen.getByText(/묶음 3개/)).toBeInTheDocument();
  expect(screen.getByText(/구역이 둘 이상인 자료/)).toHaveTextContent('1건은 해당하는 묶음마다 모두 보입니다');
  expect(screen.getByRole('combobox', { name: '보기 기준' })).toHaveValue('zone');
  // 같은 Entry 가 두 묶음에 있어도 따로 고른다
  await userEvent.click(within(groups[1]).getByText('선미 응력 검토').closest('[role="option"]'));
  expect(within(groups[1]).getByRole('option')).toHaveAttribute('aria-selected', 'true');
  expect(within(groups[0]).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'false');
});

test('보기 기준을 고르면 주소와 사용자 설정에 남고, 묶지 않음으로 되돌린다', async () => {
  const fetch = mockApi({ 'GET /api/search?limit=50&offset=0': FLAT, [Q_GROUP]: GROUPED });
  renderAt('/');
  await screen.findByText('결과 3건');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: '보기 기준' }), 'zone');
  expect(screen.getByTestId('loc').textContent).toBe('/?group=zone');
  expect(localStorage.getItem(GROUP_STORE_KEY)).toBe('zone');
  expect(localStorage.getItem('logbook.prefsUnsent.v1')).toContain('"search.group":"zone"');
  await screen.findByText('구역 없음');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: '보기 기준' }), '');
  expect(screen.getByTestId('loc').textContent).toBe('/');
  expect(localStorage.getItem(GROUP_STORE_KEY)).toBeNull();
  await waitFor(() => expect(screen.queryByText('구역 없음')).not.toBeInTheDocument());
  expect(calls(fetch).filter((c) => c.startsWith('GET /api/search'))).toHaveLength(3);
});

test('기억한 보기 기준은 주소에 없어도 적용되고 주소에 적힌다(검색은 한 번)', async () => {
  localStorage.setItem(GROUP_STORE_KEY, 'zone');
  const fetch = mockApi({ [Q_GROUP]: GROUPED });
  renderAt('/');
  await screen.findByText('구역 없음');
  await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/?group=zone'));
  expect(calls(fetch)).toEqual([Q_GROUP]);
});

test('묶음 머리를 누르면 그 값으로 거르고, 더 보기는 그 묶음만 더 받는다', async () => {
  mockApi({
    [Q_GROUP]: GROUPED,
    'GET /api/search?group=zone&group_value=%EC%84%A0%EB%AF%B8%EB%B6%80&limit=20&offset=2':
      { ...FLAT, total: 3, items: [row('E000009', '선미 피로 검토')], group: 'zone', group_value: '선미부' },
    'GET /api/search?zone=%EC%84%A0%EB%AF%B8%EB%B6%80&group=zone&group_rows=5&group_limit=30&limit=50&offset=0': GROUPED,
  });
  renderAt('/?group=zone');
  const more = await screen.findByRole('button', { name: /더 보기 남은 1건/ });
  await userEvent.click(more);
  const g0 = screen.getAllByRole('group')[0];
  expect(await within(g0).findByText('선미 피로 검토')).toBeInTheDocument();
  expect(within(g0).getAllByRole('option')).toHaveLength(3);
  expect(within(g0).queryByRole('button', { name: /더 보기/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '선미부' }));
  expect(screen.getByTestId('loc').textContent).toBe('/?zone=%EC%84%A0%EB%AF%B8%EB%B6%80&group=zone');
});

test('키보드는 펼친 묶음의 행을 이어서 옮기고, 접은 묶음은 건너뛴다', async () => {
  mockApi({ [Q_GROUP]: GROUPED, 'GET /api/entries/E000003': { entry_id: 'E000003', title: 'x', status: 'confirmed', hulls: [], zones: [], tags: [], files: [], version: 1 } });
  renderAt('/?group=zone');
  const list = await screen.findByRole('listbox', { name: '검색 결과' });
  await userEvent.click(screen.getByRole('button', { name: '기관실 접기' }));
  expect(within(screen.getAllByRole('group')[1]).queryByRole('option')).not.toBeInTheDocument();
  list.focus();
  await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
  const selected = screen.getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true');
  expect(selected).toHaveTextContent('구역 없는 자료');
  await userEvent.keyboard('{Enter}');
  expect(screen.getByTestId('loc').textContent).toBe('/e/E000003');
});

test('파일 보기에서는 보기 기준을 고를 수 없다', async () => {
  mockApi({ 'GET /api/search?unit=file&limit=50&offset=0': { unit: 'file', total: 0, items: [], facets: FACETS, hull_suggestion: null, terms: [], group: null } });
  renderAt('/?unit=file&group=zone');
  const sel = await screen.findByRole('combobox', { name: '보기 기준' });
  expect(sel).toBeDisabled();
  expect(sel).toHaveValue('');
  expect(await screen.findByText('결과 0건')).toBeInTheDocument();
});
