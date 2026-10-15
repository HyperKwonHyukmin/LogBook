import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthContext } from '../auth/AuthContext.jsx';
import { calls, mockApi } from '../test/mockApi.js';
import { invalidateVocab } from '../lib/vocab.js';

beforeEach(() => invalidateVocab());

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
    // 분류 목록(08) — 구역·해석 종류 입력
    'GET /api/vocab?kind=zone': { kind: 'zone', other: '기타', terms: [
      { id: 1, value: '선수부', active: true, count: 1, synonyms: [] },
      { id: 2, value: '선미부', active: true, count: 0, synonyms: [] }] },
    'GET /api/vocab?kind=atype': { kind: 'atype', other: '기타', terms: [
      { id: 3, value: '계류 해석', active: true, count: 0, synonyms: [{ id: 4, value: 'Mooring' }] }] },
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

test('미확정 자료는 읽기 전용이고 정리 대기로 안내한다', async () => {
  renderPage({ 'GET /api/entries/E000001': { ...ENTRY, status: 'draft', vault_unc: null } });
  expect(await screen.findByText('미확정')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '변경하기' })).toBeNull();
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
  expect(screen.getByText(/정리 대기를 거치지 않고 이 자료에 바로 추가됩니다/)).toBeInTheDocument();
});

test('파일 추가 — 워커가 합치면 목록을 새로 부르고 알린다', async () => {
  let entryCalls = 0;
  const fetch = renderPage({
    'GET /api/entries/E000001': () => { entryCalls += 1; return ENTRY; },
    'GET /api/batches/K': { key: 'K', state: 'done', excluded: [] },
  });
  await userEvent.click(await screen.findByRole('button', { name: '파일 추가' }));
  await userEvent.upload(screen.getByLabelText('파일 선택'), new File(['%PDF'], '보고서.pdf', { type: 'application/pdf' }));
  expect(await screen.findByText('파일을 이 자료에 추가했습니다.', {}, { timeout: 4000 })).toBeInTheDocument();
  expect(calls(fetch)).toContain('GET /api/batches/K');
  await waitFor(() => expect(entryCalls).toBeGreaterThanOrEqual(2));
});

test('파일 추가 — 바로 붙이지 못하면 정리 대기로 안내한다', async () => {
  renderPage({
    'GET /api/entries/E000001': ENTRY,
    'GET /api/batches/K': { key: 'K', state: 'processed', excluded: [] },
  });
  await userEvent.click(await screen.findByRole('button', { name: '파일 추가' }));
  await userEvent.upload(screen.getByLabelText('파일 선택'), new File(['%PDF'], '보고서.pdf', { type: 'application/pdf' }));
  expect(await screen.findByText(/바로 붙이지 못해 정리 대기에 두었습니다/, {}, { timeout: 4000 })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '정리 대기로' })).toHaveAttribute('href', '/inbox');
});

test('없는 자료', async () => {
  renderPage({ 'GET /api/entries/E000001': { __status: 404, detail: 'entry_not_found' } });
  expect(await screen.findByText('자료를 찾을 수 없습니다')).toBeInTheDocument();
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

test('23 — 문서 분류 이력: 자동(확장자 추정)에서 바꾼 것과 정비 명령이 저장한 것', async () => {
  renderPage({
    'GET /api/entries/E000001': ENTRY,
    'GET /api/entries/E000001/history': [
      { at: '2026-10-12T10:00:00', employee_id: 'system', name: null, action: 'REPORT_META',
        before: { report: '발표.pptx', document_type: null, document_type_auto: '발표자료' },
        after: { report: '발표.pptx', document_type: '발표자료', source: 'document-type-fill' } },
      { at: '2026-10-12T09:00:00', employee_id: 'A100001', name: '홍길동', action: 'REPORT_META',
        before: { report: '검토.pdf', document_type: null }, after: { report: '검토.pdf', document_type: '계산서' } },
    ],
  });
  const hist = await screen.findByRole('list', { name: '변경 이력' });
  expect(await within(hist).findByText('발표.pptx: 문서 분류 자동 발표자료 → 발표자료')).toBeInTheDocument();
  expect(within(hist).getByText('검토.pdf: 문서 분류 미분류 → 계산서')).toBeInTheDocument();
  expect(within(hist).getAllByText('문서 분류 변경').length).toBe(2);
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

test('머리말의 별로 즐겨찾기에서 뺀다(10)', async () => {
  const { FavoritesProvider } = await import('../components/favorites/Favorites.jsx');
  const fetch = mockApi({
    'GET /api/entries/E000001': { ...ENTRY, favorite: true },
    'GET /api/entries/E000001/history': HISTORY,
    'POST /api/files/2/link?inline=true': { url: '/api/files/2/content?t=a&inline=1' },
    'DELETE /api/favorites/E000001': { entry_id: 'E000001', favorite: false },
  });
  render(
    <AuthContext.Provider value={{ user: { employee_id: 'A100009', name: '다른 사람' }, isAdmin: false }}>
      <ToastProvider><FavoritesProvider>
        <MemoryRouter initialEntries={['/e/E000001']}>
          <Routes><Route path="/e/:entryId" element={<EntryPage />} /></Routes>
        </MemoryRouter>
      </FavoritesProvider></ToastProvider>
    </AuthContext.Provider>,
  );
  const star = await screen.findByRole('button', { name: '즐겨찾기 해제' });
  expect(star).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(star);
  expect(screen.getByRole('button', { name: '즐겨찾기 추가' })).toHaveAttribute('aria-pressed', 'false');
  await waitFor(() => expect(calls(fetch)).toContain('DELETE /api/favorites/E000001'));
});

test('휴지통 자료의 별은 비활성이다(10)', async () => {
  renderPage({ 'GET /api/entries/E000001': { ...ENTRY, status: 'trashed', favorite: false, vault_unc: null } });
  expect(await screen.findByRole('button', { name: '즐겨찾기 추가' })).toBeDisabled();
});

/* ── 11 — 고치기: [변경하기] → 고치고 → [변경 완료] 한 번의 PATCH ── */

const patchBodies = (fetch) => fetch.mock.calls
  .filter(([u, i = {}]) => u === '/api/entries/E000001' && i.method === 'PATCH').map(([, i]) => JSON.parse(i.body));

test('기본은 읽기 화면 — 값은 찾기 링크이고 고치기 칸이 없다', async () => {
  renderPage({ 'GET /api/entries/E000001': { ...ENTRY, tags: ['계류'] } });
  expect(await screen.findByRole('heading', { name: '계류 구조 검토' })).toBeInTheDocument();
  const rail = screen.getByRole('complementary', { name: '속성' });
  expect(within(rail).getByRole('link', { name: 'Mooring' })).toHaveAttribute('href', '/?analysis_type=Mooring');
  expect(within(rail).getByRole('link', { name: '계류' })).toHaveAttribute('href', '/?tag=%EA%B3%84%EB%A5%98');
  expect(within(rail).getByRole('link', { name: /A100001/ })).toHaveAttribute('href', '/?uploaded_by=A100001');
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button', { name: /고치기$/ })).toBeNull();
  await userEvent.click(within(rail).getByRole('link', { name: '선수부' }));
  expect(screen.getByTestId('loc').textContent).toBe('/');
});

test('변경하기 → 여러 칸을 고치고 바뀐 칸 표시 → 변경 완료가 한 번의 PATCH 로 저장하고 읽기로 돌아간다', async () => {
  const fetch = renderPage({
    'GET /api/entries/E000001': ENTRY,
    'PATCH /api/entries/E000001': (init) => {
      const b = JSON.parse(init.body);
      return { ...ENTRY, ...b, hulls: (b.hulls || ['9999']).map((h) => ({ hull_no: h })), version: 4 };
    },
  });
  await userEvent.click(await screen.findByRole('button', { name: '변경하기' }));
  const bar = screen.getByRole('region', { name: '고치기' });
  const done = within(bar).getByRole('button', { name: '변경 완료' });
  expect(done).toBeDisabled();
  expect(within(bar).getByText('바뀐 칸이 없습니다')).toBeInTheDocument();
  const title = screen.getByRole('textbox', { name: '제목' });
  expect(title).toHaveFocus();
  await userEvent.clear(title);
  await userEvent.type(title, '새 제목');
  await userEvent.type(screen.getByRole('combobox', { name: '호선' }), '9998{Enter}');
  await userEvent.type(screen.getByRole('combobox', { name: '구역' }), '선미부{Enter}');
  await userEvent.type(screen.getByRole('combobox', { name: '태그' }), '계류{Enter}');
  // 칸마다 바로 저장하지 않는다
  expect(patchBodies(fetch)).toHaveLength(0);
  expect(within(bar).getByRole('status')).toHaveTextContent('바뀐 칸 4 · 제목, 호선, 구역, 태그');
  expect(screen.getAllByText('(변경됨)')).toHaveLength(4);
  expect(screen.queryByRole('textbox', { name: '해석 시기' })).toBeNull();   // 15 — 해석 시기 칸은 없다
  await userEvent.click(done);
  await waitFor(() => expect(patchBodies(fetch)).toHaveLength(1));
  expect(patchBodies(fetch)[0]).toEqual({ version: 3, title: '새 제목', hulls: ['9999', '9998'], zones: ['선수부', '선미부'],
    tags: ['계류'] });
  expect(await screen.findByRole('heading', { name: '새 제목' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '고치기' })).toBeNull();
  expect(screen.getByRole('button', { name: '변경하기' })).toBeInTheDocument();
});

test('잘못된 값이면 완료를 막는다 — 제목 비움', async () => {
  renderPage({ 'GET /api/entries/E000001': ENTRY });
  await userEvent.click(await screen.findByRole('button', { name: '변경하기' }));
  const done = screen.getByRole('button', { name: '변경 완료' });
  await userEvent.clear(screen.getByRole('textbox', { name: '제목' }));
  expect(screen.getByText('제목을 입력해 주세요.')).toBeInTheDocument();
  expect(done).toBeDisabled();
  await userEvent.type(screen.getByRole('textbox', { name: '제목' }), '제목');
  expect(done).toBeEnabled();
});

test('취소 — 바뀐 것이 있으면 묻고, 버리면 원래 값으로 돌아간다(PATCH 없음)', async () => {
  const fetch = renderPage({ 'GET /api/entries/E000001': ENTRY });
  await userEvent.click(await screen.findByRole('button', { name: '변경하기' }));
  await userEvent.type(screen.getByRole('textbox', { name: '제목' }), ' 고침');
  await userEvent.click(screen.getByRole('button', { name: '취소' }));
  const dlg = screen.getByRole('alertdialog', { name: '고친 내용을 버릴까요?' });
  await userEvent.click(within(dlg).getByRole('button', { name: '계속 고치기' }));
  expect(screen.getByRole('textbox', { name: '제목' })).toHaveValue('계류 구조 검토 고침');
  await userEvent.click(screen.getByRole('button', { name: '취소' }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '버리기' }));
  expect(screen.getByRole('heading', { name: '계류 구조 검토' })).toBeInTheDocument();
  expect(patchBodies(fetch)).toHaveLength(0);
});

test('단축키 — Esc 는 바뀐 것이 없으면 바로 닫고, Ctrl+Enter 는 완료한다', async () => {
  const fetch = renderPage({
    'GET /api/entries/E000001': ENTRY,
    'PATCH /api/entries/E000001': (init) => ({ ...ENTRY, ...JSON.parse(init.body), version: 4 }),
  });
  await userEvent.click(await screen.findByRole('button', { name: '변경하기' }));
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('region', { name: '고치기' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '변경하기' }));
  await userEvent.type(screen.getByRole('textbox', { name: '설명' }), '설명 한 줄');
  await userEvent.keyboard('{Control>}{Enter}{/Control}');
  await waitFor(() => expect(patchBodies(fetch)).toEqual([{ version: 3, description: '설명 한 줄' }]));
  expect(await screen.findByText('설명 한 줄')).toBeInTheDocument();
});

test('충돌(409) — 내 변경을 지키고 알린다. 최신 내용을 불러와 그 위에 다시 얹어 저장한다', async () => {
  let n = 0;
  const fetch = renderPage({
    'GET /api/entries/E000001': () => (++n === 1 ? ENTRY : { ...ENTRY, description: '남이 쓴 설명', version: 5 }),
    'PATCH /api/entries/E000001': (init) => (JSON.parse(init.body).version === 3
      ? { __status: 409, detail: 'version_conflict' }
      : { ...ENTRY, ...JSON.parse(init.body), description: '남이 쓴 설명', version: 6 }),
  });
  await userEvent.click(await screen.findByRole('button', { name: '변경하기' }));
  const title = screen.getByRole('textbox', { name: '제목' });
  await userEvent.clear(title);
  await userEvent.type(title, '내 제목');
  await userEvent.click(screen.getByRole('button', { name: '변경 완료' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('다른 사람이 그 사이 이 자료를 고쳐');
  expect(screen.getByRole('textbox', { name: '제목' })).toHaveValue('내 제목');
  expect(screen.getByRole('button', { name: '변경 완료' })).toBeDisabled();
  await userEvent.click(within(alert).getByRole('button', { name: '최신 내용 불러오기' }));
  // 남의 설명은 들어오고 내 제목은 남는다
  expect(await screen.findByRole('textbox', { name: '설명' })).toHaveValue('남이 쓴 설명');
  expect(screen.getByRole('textbox', { name: '제목' })).toHaveValue('내 제목');
  await userEvent.click(screen.getByRole('button', { name: '변경 완료' }));
  await waitFor(() => expect(patchBodies(fetch)).toHaveLength(2));
  expect(patchBodies(fetch)[1]).toEqual({ version: 5, title: '내 제목' });
  expect(await screen.findByRole('heading', { name: '내 제목' })).toBeInTheDocument();
});

test('저장하지 않은 변경이 있으면 다른 화면으로 가는 링크를 누를 때 묻는다', async () => {
  renderPage({ 'GET /api/entries/E000001': ENTRY });
  await userEvent.click(await screen.findByRole('button', { name: '변경하기' }));
  await userEvent.type(screen.getByRole('textbox', { name: '제목' }), '!');
  await userEvent.click(screen.getByRole('link', { name: /A100001/ }));
  const dlg = await screen.findByRole('alertdialog', { name: '저장하지 않은 변경이 있습니다' });
  await userEvent.click(within(dlg).getByRole('button', { name: '계속 고치기' }));
  expect(screen.getByRole('textbox', { name: '제목' })).toHaveValue('계류 구조 검토!');
  const ev = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(true);
});

test('미확정·휴지통 자료에는 변경하기가 없다', async () => {
  renderPage({ 'GET /api/entries/E000001': { ...ENTRY, status: 'draft', vault_unc: null } });
  expect(await screen.findByText('미확정')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '변경하기' })).toBeNull();
});

test('데이터 라우터에서는 모든 앱 안 이동을 막고 묻는다 — 버리고 떠나면 이동한다', async () => {
  const { RouterProvider, createMemoryRouter } = await import('react-router-dom');
  mockApi({
    'GET /api/entries/E000001': ENTRY, 'GET /api/entries/E000001/history': HISTORY,
    'POST /api/files/2/link?inline=true': { url: '/api/files/2/content?t=a&inline=1' },
    'GET /api/vocab?kind=zone': { kind: 'zone', other: '기타', terms: [] },
    'GET /api/vocab?kind=atype': { kind: 'atype', other: '기타', terms: [] },
  });
  const router = createMemoryRouter([
    { path: '/e/:entryId', element: <EntryPage /> },
    { path: '*', element: <Probe /> },
  ], { initialEntries: ['/e/E000001'] });
  render(
    <AuthContext.Provider value={{ user: { employee_id: 'A100009', name: '다른 사람' }, isAdmin: false }}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  await userEvent.click(await screen.findByRole('button', { name: '변경하기' }));
  await userEvent.type(screen.getByRole('textbox', { name: '제목' }), '!');
  router.navigate('/browse');   // 상단 검색·뒤로 가기처럼 링크가 아닌 이동
  const dlg = await screen.findByRole('alertdialog', { name: '저장하지 않은 변경이 있습니다' });
  await userEvent.click(within(dlg).getByRole('button', { name: '계속 고치기' }));
  expect(router.state.location.pathname).toBe('/e/E000001');
  await userEvent.click(screen.getByRole('link', { name: /A100001/ }));
  await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '버리고 떠나기' }));
  expect(await screen.findByTestId('loc')).toHaveTextContent('/');
}, 15000); // 이동 막기·대화상자 왕복이 길어 전체 스위트 부하에서 기본 5초를 넘기곤 한다

test('같은 BDF(12) — 모델 영역에 동일 BDF·같은 형상을 보이고 트리 줄에 표시한다', async () => {
  const model = { state: 'done', error: null, counts: {}, bbox: null, missing: [], warnings: [], format_version: 2,
    same_model: [{ file_id: 7, name: '9001_사본.bdf', rel_path: 'model/9001_사본.bdf', entry_id: 'E000077',
      entry_title: '9001 검토', entry_status: 'confirmed' }],
    same_model_total: 1,
    same_geometry: [{ file_id: 8, name: '9002_두께.bdf', rel_path: '9002_두께.bdf', entry_id: 'E000078',
      entry_title: '9002 검토', entry_status: 'draft', differs: ['property', 'load'] }],
    same_geometry_total: 3 };
  const files = [{ ...FILES[0], model }, FILES[1]];
  renderPage({ 'GET /api/entries/E000001': { ...ENTRY, files } }, { url: '/e/E000001?file=1' });
  const same = await screen.findByRole('region', { name: '동일 BDF' });
  expect(within(same).getByText('동일 BDF 가 이미 있습니다')).toBeInTheDocument();
  expect(within(same).getByRole('link', { name: 'E000077' })).toHaveAttribute('href', '/e/E000077');
  expect(within(same).getByText('model/9001_사본.bdf')).toBeInTheDocument();
  const shape = screen.getByRole('region', { name: '같은 형상' });
  expect(within(shape).getByText('속성·하중 다름')).toBeInTheDocument();
  expect(within(shape).getByText('미확정')).toBeInTheDocument();
  expect(within(shape).getByText('외 2개')).toBeInTheDocument();
  const tree = screen.getByRole('tree', { name: '파일' });
  expect(within(tree).getByTitle('동일 BDF 가 이미 있음')).toBeInTheDocument();
});

test('같은 BDF 가 없거나 변환 전이면 아무것도 보이지 않는다', async () => {
  const files = [{ ...FILES[0], model: { state: 'queued', same_model: [], same_model_total: 0,
    same_geometry: [], same_geometry_total: 0 } }, FILES[1]];
  renderPage({ 'GET /api/entries/E000001': { ...ENTRY, files } }, { url: '/e/E000001?file=1' });
  expect(await screen.findByText('계류 구조 검토')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '동일 BDF' })).toBeNull();
  expect(screen.queryByRole('region', { name: '같은 형상' })).toBeNull();
});


test('모델이 둘 이상이면 판 흐름이 보이고, 판 정리 중에는 [변경하기]가 잠긴다(14)', async () => {
  const files = [
    { id: 1, name: 'deck.bdf', rel_path: 'deck.bdf', kind: 'model', size: 100, extract: null, model: null },
    { id: 3, name: 'deck_r1.bdf', rel_path: 'deck_r1.bdf', kind: 'model', size: 100, extract: null, model: null },
  ];
  const item = (id, name, display, latest) => ({ file_id: id, name, rel_path: name, order: 0, label: null, auto_label: display,
    display, mark: null, is_latest: latest, manual: false, model_state: 'done' });
  renderPage({
    'GET /api/entries/E000001': { ...ENTRY, uploaded_by: 'A100009', can_edit: true, files },
    'GET /api/files/1/model': { state: 'include' },
    'GET /api/entries/E000001/revisions': { entry_id: 'E000001', token: 't', manual: false, can_edit: true, others: [],
      series: [{ key: 'n:deck', manual: false, items: [item(1, 'deck.bdf', 'R0', false), item(3, 'deck_r1.bdf', 'R1', true)],
        diffs: [{ a: 1, b: 3, id: 5, state: 'queued', summary: null, error: null, stale: false }] }] },
  });
  const flow = await screen.findByRole('list', { name: '판 흐름' });
  expect(within(flow).getByRole('button', { name: /R0 → R1 변경 요약: 비교 중/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '판 정리' }));
  expect(screen.getByRole('button', { name: '변경하기' })).toBeDisabled();
});
