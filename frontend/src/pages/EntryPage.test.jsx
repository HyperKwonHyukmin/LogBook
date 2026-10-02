import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthContext } from '../auth/AuthContext.jsx';
import { calls, mockApi } from '../test/mockApi.js';

vi.mock('../lib/upload.js', async (orig) => ({ ...(await orig()), uploadBatch: vi.fn(() => Promise.resolve({ key: 'K' })) }));
import EntryPage from './EntryPage.jsx';
import { ToastProvider } from '../components/ui/Toast.jsx';

const FILES = [
  { id: 1, name: 'm.bdf', rel_path: 'model/m.bdf', kind: 'model', size: 100, extract: null },
  { id: 2, name: 'r.pdf', rel_path: 'r.pdf', kind: 'report', size: 200, extract: { state: 'done', error: null, summary: null } },
];
const ENTRY = { entry_id: 'E000001', status: 'confirmed', title: '계류 구조 검토', analysis_type: 'Mooring',
  analysis_period: '2026-08', description: null, version: 3, hulls: [{ hull_no: '9999', ship_type: 'LNGC', is_primary: true }],
  zones: ['선수부'], tags: [], uploaded_by: 'A100001', confirmed_by: 'A100001', confirmed_at: '2026-09-02T09:00:00',
  files: FILES, vault_unc: '\\\\srv\\E000001' };
const HISTORY = [{ at: '2026-09-03T10:00:00', employee_id: 'A100002', name: '김해석', action: 'ENTRY_UPDATE',
  before: { title: '옛 제목', zones: [] }, after: { title: '계류 구조 검토', zones: ['선수부'] } }];

function Probe() { const l = useLocation(); return <span data-testid="loc">{l.pathname}</span>; }

function renderPage(map, { url = '/e/E000001', storage } = {}) {
  const fetch = mockApi({
    'GET /api/entries/E000001/history': HISTORY,
    'POST /api/files/2/link?inline=true': { url: '/api/files/2/content?t=a&inline=1' },
    // BDF 는 3D 미리보기(04b) — 변환 상태 'include' 면 안내 한 줄만 보인다.
    'GET /api/files/1/model': { state: 'include' },
    ...map,
  });
  render(
    <AuthContext.Provider value={{ user: { employee_id: 'A100009', name: '다른 사람' }, isAdmin: false }}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route element={storage ? <Outlet context={{ storage }} /> : <Outlet />}>
            <Route path="/e/:entryId" element={<EntryPage />} />
          </Route>
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return fetch;
}

test('머리말·파일 트리·첫 보고서 미리보기·변경 이력', async () => {
  renderPage({ 'GET /api/entries/E000001': ENTRY });
  expect(await screen.findByText('계류 구조 검토')).toBeInTheDocument();
  expect(screen.getByText('확정')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '9999' })).toHaveAttribute('href', '/h/9999');
  expect(await screen.findByTitle('PDF 미리보기')).toBeInTheDocument();
  const tree = screen.getByRole('tree', { name: '파일' });
  expect(within(tree).getByText('model')).toBeInTheDocument();
  const hist = screen.getByRole('list', { name: '변경 이력' });
  expect(await within(hist).findByText('김해석')).toBeInTheDocument();
  expect(within(hist).getByText('제목: 옛 제목 → 계류 구조 검토')).toBeInTheDocument();
  expect(within(hist).getByText('구역: (없음) → 선수부')).toBeInTheDocument();
});

test('확정 자료는 다른 사람도 제목을 고친다 — version 을 싣는다', async () => {
  const fetch = renderPage({
    'GET /api/entries/E000001': ENTRY,
    'PATCH /api/entries/E000001': (init) => ({ ...ENTRY, ...JSON.parse(init.body), version: 4 }),
  });
  await userEvent.click(await screen.findByRole('button', { name: '제목 고치기' }));
  const input = screen.getByRole('textbox', { name: '제목' });
  await userEvent.clear(input);
  await userEvent.type(input, '새 제목{Enter}');
  expect(await screen.findByText('새 제목')).toBeInTheDocument();
  const patch = fetch.mock.calls.find(([u, i]) => i?.method === 'PATCH');
  expect(JSON.parse(patch[1].body)).toEqual({ title: '새 제목', version: 3 });
});

test('버전 충돌이면 다시 불러오고 안내한다', async () => {
  let n = 0;
  renderPage({
    'GET /api/entries/E000001': () => (++n === 1 ? ENTRY : { ...ENTRY, title: '남이 고친 제목', version: 5 }),
    'PATCH /api/entries/E000001': { __status: 409, detail: 'version_conflict' },
  });
  await userEvent.click(await screen.findByRole('button', { name: '제목 고치기' }));
  await userEvent.type(screen.getByRole('textbox', { name: '제목' }), 'x{Enter}');
  expect(await screen.findByRole('alert')).toHaveTextContent('다른 사람이 먼저 고쳤습니다');
  expect(await screen.findByText('남이 고친 제목')).toBeInTheDocument();
});

test('미확정 자료는 읽기 전용이고 정리 대기로 안내한다', async () => {
  renderPage({ 'GET /api/entries/E000001': { ...ENTRY, status: 'draft', vault_unc: null } });
  expect(await screen.findByText('미확정')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '제목 고치기' })).toBeNull();
  expect(screen.getByRole('link', { name: /정리 대기/ })).toHaveAttribute('href', '/inbox');
  expect(screen.queryByRole('button', { name: '파일 추가' })).toBeNull();
});

test('파일을 고르면 미리보기가 바뀐다', async () => {
  renderPage({ 'GET /api/entries/E000001': ENTRY });
  await userEvent.click(await screen.findByRole('treeitem', { name: /m\.bdf/ }));
  expect(await screen.findByText(/다른 BDF 가 INCLUDE/)).toBeInTheDocument();
});

test('휴지통으로 보내면 휴지통 화면으로 간다', async () => {
  const fetch = renderPage({ 'GET /api/entries/E000001': ENTRY, 'DELETE /api/entries/E000001': { ...ENTRY, status: 'trashed' } });
  // 휴지통으로 보내기는 동작 메뉴 안에 있다(복원할 수 있어 확인 대화상자 없이 보낸다).
  await userEvent.click(await screen.findByRole('button', { name: '자료 동작' }));
  await userEvent.click(screen.getByRole('menuitem', { name: '휴지통으로 보내기' }));
  expect(await screen.findByTestId('loc')).toHaveTextContent('/trash');
  expect(calls(fetch)).toContain('DELETE /api/entries/E000001');
});

test('파일 추가 영역을 연다', async () => {
  renderPage({ 'GET /api/entries/E000001': ENTRY });
  await userEvent.click(await screen.findByRole('button', { name: '파일 추가' }));
  expect(screen.getByText(/정리 대기에서 확정하면 이 자료에 추가됩니다/)).toBeInTheDocument();
});

test('없는 자료', async () => {
  renderPage({ 'GET /api/entries/E000001': { __status: 404, detail: 'entry_not_found' } });
  expect(await screen.findByText('자료를 찾을 수 없습니다')).toBeInTheDocument();
});

const asHulls = (nos) => nos.map((h) => ({ hull_no: h, ship_type: null, is_primary: false }));

test('호선을 빠르게 두 번 더해도 둘 다 저장된다(응답 전 낙관적 반영)', async () => {
  const bodies = [];
  let release;
  renderPage({
    'GET /api/entries/E000001': ENTRY,
    'PATCH /api/entries/E000001': (init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      const res = { ...ENTRY, hulls: asHulls(body.hulls), version: body.version + 1 };
      if (bodies.length === 1) return new Promise((r) => { release = () => r(res); });
      return res;
    },
  });
  // 칩 칸은 평소 칩만 보이고, 고치기 단추로 입력칸을 연다.
  await userEvent.click(await screen.findByRole('button', { name: '호선 고치기' }));
  const box = screen.getByRole('combobox', { name: '호선' });
  await userEvent.type(box, '9998,9997,');
  // 응답을 기다리지 않고 칩이 바로 보인다.
  expect(screen.getByRole('button', { name: '9998 빼기' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '9997 빼기' })).toBeInTheDocument();
  await waitFor(() => expect(release).toBeTypeOf('function'));
  release();
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[0]).toEqual({ hulls: ['9999', '9998'], version: 3 });
  expect(bodies[1]).toEqual({ hulls: ['9999', '9998', '9997'], version: 4 });
  expect(await screen.findByRole('link', { name: '9997' })).toBeInTheDocument();
});

test('칩 저장이 실패하면 서버 값으로 되돌린다', async () => {
  renderPage({
    'GET /api/entries/E000001': ENTRY,
    'PATCH /api/entries/E000001': { __status: 500, detail: 'x' },
  });
  await userEvent.click(await screen.findByRole('button', { name: '구역 고치기' }));
  const box = screen.getByRole('combobox', { name: '구역' });
  await userEvent.type(box, '선미부,');
  expect(await screen.findByRole('alert')).toHaveTextContent('저장하지 못했습니다');
  await waitFor(() => expect(screen.queryByRole('button', { name: '선미부 빼기' })).toBeNull());
  expect(screen.getByRole('button', { name: '선수부 빼기' })).toBeInTheDocument();
});

test('제목 저장이 실패하면 입력칸과 입력한 글자를 되살린다', async () => {
  renderPage({
    'GET /api/entries/E000001': ENTRY,
    'PATCH /api/entries/E000001': { __status: 500, detail: 'x' },
  });
  await userEvent.click(await screen.findByRole('button', { name: '제목 고치기' }));
  const input = screen.getByRole('textbox', { name: '제목' });
  await userEvent.clear(input);
  await userEvent.type(input, '고친 제목{Enter}');
  expect(await screen.findByRole('textbox', { name: '제목' })).toHaveValue('고친 제목');
});

test('파일 트리는 키보드로 옮겨 다니고 Enter 로 고른다', async () => {
  renderPage({ 'GET /api/entries/E000001': ENTRY });
  const tree = await screen.findByRole('tree', { name: '파일' });
  const pdf = within(tree).getByRole('treeitem', { name: 'r.pdf' });
  const bdf = within(tree).getByRole('treeitem', { name: 'm.bdf' });
  expect(pdf).toHaveAttribute('tabindex', '0');
  expect(bdf).toHaveAttribute('tabindex', '-1');
  pdf.focus();
  await userEvent.keyboard('{ArrowUp}');
  expect(bdf).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  expect(await screen.findByText(/다른 BDF 가 INCLUDE/)).toBeInTheDocument();
  expect(bdf).toHaveAttribute('tabindex', '0');
});

test('주소의 ?file= 로 처음 고를 파일을 정한다', async () => {
  renderPage({ 'GET /api/entries/E000001': ENTRY }, { url: '/e/E000001?file=1' });
  expect(await screen.findByText(/다른 BDF 가 INCLUDE/)).toBeInTheDocument();
  expect(screen.queryByTitle('PDF 미리보기')).toBeNull();
});

test('휴지통의 자료는 파일을 미리 보지 않고 복원을 안내한다', async () => {
  const fetch = renderPage({ 'GET /api/entries/E000001': { ...ENTRY, status: 'trashed', vault_unc: null } });
  expect(await screen.findByText('휴지통')).toBeInTheDocument();
  expect(screen.getByText('휴지통에 있는 자료입니다. 복원 후 볼 수 있습니다.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '내려받기' })).toBeNull();
  expect(calls(fetch)).not.toContain('POST /api/files/2/link?inline=true');
});

test('공유 폴더가 끊기면 파일 추가를 막는다', async () => {
  renderPage({ 'GET /api/entries/E000001': ENTRY }, { storage: { reachable: false } });
  await userEvent.click(await screen.findByRole('button', { name: '파일 추가' }));
  expect(screen.getByText(/연결되면 올릴 수 있습니다/)).toBeInTheDocument();
  expect(screen.getByLabelText('파일 선택')).toBeDisabled();
});

test('파일 추가·확정 이력은 파일 이름·개수를 보인다', async () => {
  const names = ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf', 'e.pdf', 'f.pdf'];
  renderPage({
    'GET /api/entries/E000001': ENTRY,
    'GET /api/entries/E000001/history': [
      { at: '2026-09-04T10:00:00', employee_id: 'A100002', name: '김해석', action: 'ENTRY_FILES_ADDED', before: null, after: { files: names } },
      { at: '2026-09-02T09:00:00', employee_id: 'A100001', name: '홍길동', action: 'ENTRY_CONFIRM', before: null, after: { title: 'x', files: 4 } },
    ],
  });
  const hist = await screen.findByRole('list', { name: '변경 이력' });
  expect(await within(hist).findByText('a.pdf, b.pdf, c.pdf, d.pdf, e.pdf 외 1개')).toBeInTheDocument();
  expect(within(hist).getByText('파일 4개')).toBeInTheDocument();
});

test('이력을 못 불러오면 그렇게 알린다', async () => {
  renderPage({ 'GET /api/entries/E000001': ENTRY, 'GET /api/entries/E000001/history': { __status: 500, detail: 'x' } });
  const hist = await screen.findByRole('list', { name: '변경 이력' });
  expect(await within(hist).findByText('이력을 불러오지 못했습니다.')).toBeInTheDocument();
  expect(within(hist).queryByText('기록이 없습니다.')).toBeNull();
});

test('휴지통으로 보낸 뒤 토스트의 되돌리기로 복원하고 자료로 돌아온다', async () => {
  const fetch = mockApi({
    'GET /api/entries/E000001': ENTRY,
    'GET /api/entries/E000001/history': HISTORY,
    'POST /api/files/2/link?inline=true': { url: '/api/files/2/content?t=a&inline=1' },
    'DELETE /api/entries/E000001': { ...ENTRY, status: 'trashed' },
    'POST /api/entries/E000001/restore': ENTRY,
  });
  render(
    <AuthContext.Provider value={{ user: { employee_id: 'A100009', name: '다른 사람' }, isAdmin: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/e/E000001']}>
          <Routes>
            <Route path="/e/:entryId" element={<EntryPage />} />
            <Route path="*" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </AuthContext.Provider>,
  );
  await userEvent.click(await screen.findByRole('button', { name: '자료 동작' }));
  await userEvent.click(screen.getByRole('menuitem', { name: '휴지통으로 보내기' }));
  expect(await screen.findByTestId('loc')).toHaveTextContent('/trash');
  expect(await screen.findByText('E000001 을 휴지통으로 보냈습니다.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '되돌리기' }));
  await waitFor(() => expect(calls(fetch)).toContain('POST /api/entries/E000001/restore'));
  expect(await screen.findByText('계류 구조 검토')).toBeInTheDocument();
  expect(await screen.findByText('E000001 을 복원했습니다.')).toBeInTheDocument();
});

test('칩 칸은 고치기 단추로 열고 Esc 로 닫으면 칩만 남는다', async () => {
  renderPage({ 'GET /api/entries/E000001': ENTRY });
  await userEvent.click(await screen.findByRole('button', { name: '구역 고치기' }));
  expect(screen.getByRole('combobox', { name: '구역' })).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('combobox', { name: '구역' })).toBeNull();
  expect(screen.getByText('선수부')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '구역 고치기' })).toHaveFocus();
});

test('올린 사람은 이력에 이름이 있으면 사번 대신 이름으로 보인다', async () => {
  renderPage({
    'GET /api/entries/E000001': { ...ENTRY, uploaded_by: 'A100002' },
  });
  const rail = await screen.findByRole('complementary', { name: '속성' });
  await within(rail).findAllByText('김해석');
  const uploader = within(rail).getByText('올린 사람').nextElementSibling;
  expect(uploader).toHaveTextContent('김해석');
  expect(uploader).not.toHaveTextContent('A100002');
});
