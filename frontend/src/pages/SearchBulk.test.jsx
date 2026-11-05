import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../auth/AuthContext.jsx';
import { calls, mockApi } from '../test/mockApi.js';
import { invalidateVocab } from '../lib/vocab.js';
import { bulkBody } from '../components/search/BulkClassifyDialog.jsx';
import SearchPage from './SearchPage.jsx';

const row = (id, title) => ({ entry_id: id, title, status: 'confirmed', hulls: [], ship_types: [], zones: [], tags: [],
  uploaded_by: 'A100001', file_count: 1, kinds: ['model'], score: 1, matched: [], snippets: [] });
const RES = { unit: 'entry', total: 2, items: [row('E000001', '가 검토'), row('E000002', '나 검토')], facets: {}, terms: [] };
const SEARCH = 'GET /api/search?limit=50&offset=0';
const ZONE = { kind: 'zone', other: '기타', terms: [{ id: 5, value: '선수부', active: true, count: 0, synonyms: [] }] };

function renderPage(auth = { user: { employee_id: 'A100001' }, canWrite: true }) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/']}>
        <Routes><Route path="/" element={<SearchPage />} /></Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

beforeEach(() => invalidateVocab());

test('54 — 고른 칸만 서버 본문에 싣는다', () => {
  const f = { zonesAdd: ['선수부'], zonesRemove: [], targetMode: 'clear', target: null,
    assigneesAdd: [{ employee_id: 'A1' }], assigneesRemove: [{ employee_id: 'A2' }, { id: 7 }], noHull: '' };
  expect(bulkBody(['E1'], f)).toEqual({ entry_ids: ['E1'], zones_add: ['선수부'], set_target: true, target: null,
    assignees_add: [{ employee_id: 'A1' }], assignees_remove: [7] });
  expect(bulkBody(['E1'], { ...f, zonesAdd: [], targetMode: '', assigneesAdd: [], assigneesRemove: [] })).toBeNull();
});

test('54 — 여러 자료를 골라 미리보기 뒤 분류를 한꺼번에 바꾸고 검색을 다시 부른다', async () => {
  const fetch = mockApi({
    [SEARCH]: RES,
    'GET /api/vocab?kind=zone': ZONE,
    'POST /api/entries/bulk-classify': (init) => {
      const body = JSON.parse(init.body);
      return body.dry_run ? { changed: ['E000001', 'E000002'], same: [], failed: [] }
        : { changed: ['E000001'], same: [], failed: [{ entry_id: 'E000002', title: '나 검토', reason: '고칠 권한 없음' }] };
    },
  });
  renderPage();
  await screen.findByText('가 검토');
  expect(screen.queryByRole('checkbox', { name: '가 검토 고르기' })).toBeNull();   // 고르기 전에는 칸이 없다
  await userEvent.click(screen.getByRole('button', { name: '여러 자료 고르기' }));
  await userEvent.click(screen.getByRole('button', { name: '보이는 자료 모두 고르기' }));
  const bar = screen.getByRole('region', { name: '여러 자료 고르기' });
  expect(bar).toHaveTextContent('고른 자료 2건');
  expect(screen.getByRole('checkbox', { name: '가 검토 고르기' })).toBeChecked();
  await userEvent.click(within(bar).getByRole('button', { name: '분류 바꾸기' }));
  const dlg = await screen.findByRole('dialog', { name: /2건 분류 바꾸기/ });
  expect(within(dlg).getByRole('button', { name: '미리보기' })).toBeDisabled();   // 고른 칸이 없으면
  const box = within(dlg).getByRole('combobox', { name: '구역 더하기' });
  await userEvent.click(box);
  await userEvent.type(box, '선수');
  await userEvent.click(await within(dlg).findByRole('option', { name: /선수부/ }));
  await userEvent.click(within(dlg).getByRole('button', { name: '미리보기' }));
  expect(await within(dlg).findByText(/바뀜/)).toHaveTextContent('바뀜 2건 · 이미 그 값 0건');
  const before = calls(fetch).filter((c) => c === SEARCH).length;
  await userEvent.click(within(dlg).getByRole('button', { name: '2건 바꾸기' }));
  expect(await screen.findByText(/1건의 분류를 바꿨습니다/)).toHaveTextContent('건너뜀 1건: 나 검토(고칠 권한 없음)');
  expect(screen.queryByRole('dialog')).toBeNull();
  const posts = fetch.mock.calls.filter(([u, i]) => u === '/api/entries/bulk-classify' && i.method === 'POST')
    .map(([, i]) => JSON.parse(i.body));
  expect(posts[1]).toEqual({ entry_ids: ['E000001', 'E000002'], zones_add: ['선수부'], dry_run: false });
  await waitFor(() => expect(calls(fetch).filter((c) => c === SEARCH).length).toBe(before + 1));
});

test('54 — 로그인 정보가 없으면(읽기 전용) 고르기 단추가 없다', async () => {
  mockApi({ [SEARCH]: RES });
  renderPage(null);
  await screen.findByText('가 검토');
  expect(screen.queryByRole('button', { name: '여러 자료 고르기' })).toBeNull();
});
