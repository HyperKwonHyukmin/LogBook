import { vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../auth/AuthContext.jsx';

vi.mock('../lib/upload.js', async (orig) => ({ ...(await orig()), uploadBatch: vi.fn() }));
import { uploadBatch } from '../lib/upload.js';
import InboxPage from './InboxPage.jsx';
import { UploadProvider } from '../components/inbox/UploadProvider.jsx';

// 68 — 줄 목록(GET /api/inbox/drafts) + 묶음 머리(GET /api/batches?lite=1) + 고른 초안 상세(GET /api/entries/{id})
const DRAFT = { entry_id: 'E000010', status: 'draft', title: '9999 연결시험', version: 1, hulls: [], zones: [],
  hull_evidence: [], files: [], suggested_entry: null, merge_into: null, uploaded_by: 'A100001', can_edit: true };
const row = (id, key, o = {}) => ({ entry_id: id, title: `${id} 제목`, state: 'ready', reason: '', hulls: [], no_hull: false,
  target: null, assignees: [], assigned_to_me: false, file_count: 1, merge_into: false, uploaded_by: 'A100001',
  batch: { key, name: key === 'K1' ? '9999_연결시험' : key, state: 'processed', source: 'web', uploader: 'A100001',
    received_at: '2026-09-29T12:32:35' }, can_edit: true, can_confirm: true, ...o });
const ROWS = { rows: [row('E000010', 'K1', { title: '9999 연결시험' })], counts: { ready: 1 }, total: 1 };
const NONE = { rows: [], counts: {}, total: 0 };
const MINE = [
  { key: 'K1', source: 'web', original_name: '9999_연결시험', state: 'processed', uploader: 'A100001',
    received_at: '2026-09-29T12:32:35', excluded: [{ name: 'enc.pdf', size: 0, reason: 'drm' }], error: null, draft_count: 1 },
  { key: 'K2', source: 'inbox', original_name: '방금 올린 폴더', state: 'staged', uploader: 'A100001',
    received_at: '2026-09-29T12:40:00', excluded: [], error: null, draft_count: 0 },
];
const UNCLAIMED = [{ key: 'K3', source: 'inbox', original_name: '주인 없음', state: 'processed', uploader: null,
  owner_account: 'x1234', received_at: '2026-09-29T11:00:00', excluded: [], error: null, draft_count: 0 }];
const VOCAB = { 'GET /api/vocab?kind=target': { kind: 'target', other: '기타', terms: [] },
  'GET /api/vocab?kind=zone': { kind: 'zone', other: '기타', terms: [] } };
const D = (scope) => `GET /api/inbox/drafts?scope=${scope}`;
const B = (scope) => `GET /api/batches?scope=${scope}&lite=1`;

function stub(fetchMap) {
  vi.stubGlobal('fetch', vi.fn((url, init = {}) => {
    const key = `${init.method || 'GET'} ${url}`;
    const r = fetchMap[key];
    if (r === undefined) throw new Error(`unexpected ${key}`);
    if (typeof r === 'function') return r(init);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(r) });
  }));
}

function renderPage(fetchMap) {
  stub(fetchMap);
  return mount();
}

function mount(path = '/inbox') {
  const auth = { user: { employee_id: 'A100001', name: '사용자' }, isAdmin: false };
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/inbox" element={<InboxPage />} /></Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const gets = () => fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`);
const mineMap = (extra = {}) => ({ [D('mine')]: ROWS, [B('mine')]: MINE, 'GET /api/entries/E000010': DRAFT, ...extra });

test('내가 올린 묶음: 묶음별 줄, 첫 줄의 상세 카드, 분석 중 묶음 머리', async () => {
  renderPage(mineMap());
  // 넓은 화면은 첫 줄을 열어 둔다(예전 초안 카드)
  expect(await screen.findByRole('article', { name: /E000010/ })).toBeInTheDocument();
  const list = screen.getByRole('list', { name: '묶음 9999_연결시험의 초안' });
  expect(within(list).getByRole('button', { name: /9999 연결시험/ })).toHaveAttribute('aria-current', 'true');
  expect(within(list).getByText('확정 가능')).toBeInTheDocument();
  // 분석 중 묶음은 줄 없이 머리만(지금 하는 일 한 줄)
  expect(screen.getByRole('button', { name: '방금 올린 폴더' })).toBeInTheDocument();
  expect(screen.getByText(/곧 시작합니다/)).toBeInTheDocument();
  // 묶음 머리를 누르면 상세 칸에 묶음(제외 파일 목록)
  await userEvent.click(screen.getByRole('button', { name: '9999_연결시험' }));
  const region = await screen.findByRole('region', { name: /묶음 9999_연결시험/ });
  expect(within(region).getByText(/enc\.pdf/)).toBeInTheDocument();
  expect(within(region).getByText(/DRM 암호화/)).toBeInTheDocument();
});

test('폴더에 직접 넣은 묶음을 가져온다', async () => {
  renderPage({ [D('mine')]: NONE, [B('mine')]: [], [D('unclaimed')]: NONE, [B('unclaimed')]: UNCLAIMED,
               'POST /api/batches/K3/claim': { ...UNCLAIMED[0], uploader: 'A100001' } });
  await userEvent.click(await screen.findByRole('tab', { name: /폴더에 직접 넣은 묶음/ }));
  await userEvent.click(within(await screen.findByRole('list', { name: '초안 목록' })).getByRole('button', { name: '내가 올렸어요' }));
  expect(gets()).toContain('POST /api/batches/K3/claim');
});

test('비어 있으면 안내한다', async () => {
  renderPage({ [D('mine')]: NONE, [B('mine')]: [] });
  expect(await screen.findByText('정리할 자료가 없습니다')).toBeInTheDocument();
});

test('탭을 빨리 바꿔도 늦게 온 이전 탭 응답이 목록을 덮지 않는다', async () => {
  const pending = {};
  const deferred = (name) => () => new Promise((resolve) => {
    pending[name] = (body) => resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  });
  renderPage({ [D('mine')]: deferred('mine'), [B('mine')]: MINE, [D('unclaimed')]: deferred('unclaimed'), [B('unclaimed')]: UNCLAIMED });
  await userEvent.click(screen.getByRole('tab', { name: /폴더에 직접 넣은 묶음/ }));
  await vi.waitFor(() => expect(pending.unclaimed).toBeDefined());
  pending.unclaimed(NONE);
  expect(await screen.findByRole('button', { name: '주인 없음' })).toBeInTheDocument();
  pending.mine(ROWS);
  await new Promise((r) => { setTimeout(r, 20); });
  expect(screen.queryByRole('button', { name: '방금 올린 폴더' })).toBeNull();
  expect(screen.getByRole('button', { name: '주인 없음' })).toBeInTheDocument();
});

test('다른 탭에서 올리기가 끝나면 내가 올린 묶음 탭으로 가서 한 번만 새로 부른다', async () => {
  uploadBatch.mockResolvedValue({ key: 'K9', uploaded: 1, rejected: [] });
  renderPage({ [D('mine')]: NONE, [B('mine')]: [], [D('unclaimed')]: NONE, [B('unclaimed')]: UNCLAIMED });
  await userEvent.click(await screen.findByRole('tab', { name: /폴더에 직접 넣은 묶음/ }));
  await screen.findByRole('button', { name: '주인 없음' });
  const before = gets().length;
  await userEvent.upload(screen.getByLabelText('파일 선택'), [new File(['GRID'], 'a.bdf')]);
  await vi.waitFor(() => expect(screen.getByRole('tab', { name: '내가 올린 묶음' })).toHaveAttribute('aria-selected', 'true'));
  await screen.findByText('정리할 자료가 없습니다');
  expect(gets().slice(before).sort()).toEqual([B('mine'), D('mine')]);
});

test('탭은 화살표로 옮겨 가고 탭 패널과 연결된다', async () => {
  renderPage({ [D('mine')]: NONE, [B('mine')]: [], [D('unclaimed')]: NONE, [B('unclaimed')]: [] });
  const mine = screen.getByRole('tab', { name: '내가 올린 묶음' });
  expect(document.getElementById(mine.getAttribute('aria-controls'))).toHaveAttribute('role', 'tabpanel');
  mine.focus();
  await userEvent.keyboard('{ArrowLeft}');   // 처음에서 왼쪽 = 마지막 탭
  const other = screen.getByRole('tab', { name: '폴더에 직접 넣은 묶음' });
  expect(other).toHaveFocus();
  expect(other).toHaveAttribute('aria-selected', 'true');
  await userEvent.keyboard('{ArrowRight}');
  expect(mine).toHaveFocus();
});

test('받은 시각이 없어도 묶음을 그린다', async () => {
  renderPage({ [D('mine')]: NONE, [B('mine')]: [{ ...MINE[1], received_at: null }] });
  const head = (await screen.findByRole('button', { name: '방금 올린 폴더' })).closest('li');
  expect(within(head).getByText('—')).toBeInTheDocument();
});

test('가져가기에 실패하면 새로 부른 뒤에도 사유가 남는다', async () => {
  renderPage({ [D('mine')]: NONE, [B('mine')]: [], [D('unclaimed')]: NONE, [B('unclaimed')]: UNCLAIMED,
    'POST /api/batches/K3/claim': () => Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ detail: 'already_claimed' }) }) });
  await userEvent.click(await screen.findByRole('tab', { name: /폴더에 직접 넣은 묶음/ }));
  await userEvent.click(within(await screen.findByRole('list', { name: '초안 목록' })).getByRole('button', { name: '내가 올렸어요' }));
  await vi.waitFor(() => expect(gets().filter((c) => c === D('unclaimed'))).toHaveLength(2));
  await new Promise((r) => { setTimeout(r, 20); });
  expect(screen.getByRole('alert')).toHaveTextContent('이미 다른 사람이 가져갔습니다');
});

test('상세 카드에 저장하지 않은 변경이 있으면 탭을 바꿀 때 묻는다(11)', async () => {
  renderPage(mineMap({ [D('unclaimed')]: NONE, [B('unclaimed')]: UNCLAIMED, ...VOCAB }));
  const card = await screen.findByRole('article', { name: /E000010/ });
  await userEvent.type(within(card).getByLabelText('설명'), '메모');
  await userEvent.click(screen.getByRole('tab', { name: /폴더에 직접 넣은 묶음/ }));
  const dlg = await screen.findByRole('alertdialog', { name: '저장하지 않은 변경이 있습니다' });
  await userEvent.click(within(dlg).getByRole('button', { name: '계속 고치기' }));
  expect(within(card).getByLabelText('설명')).toHaveValue('메모');
  await userEvent.click(screen.getByRole('tab', { name: /폴더에 직접 넣은 묶음/ }));
  await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '버리고 떠나기' }));
  expect(await screen.findByText('주인 없음')).toBeInTheDocument();
});

test('68 — 다른 줄을 고를 때 저장하지 않은 변경이 있으면 저장하고 이동, 버리고 이동, 머무르기를 묻는다', async () => {
  const two = { rows: [row('E000010', 'K1', { title: '9999 연결시험' }), row('E000011', 'K1')], counts: { ready: 2 }, total: 2 };
  const patched = [];
  renderPage(mineMap({ [D('mine')]: two, ...VOCAB,
    'GET /api/entries/E000011': { ...DRAFT, entry_id: 'E000011', title: 'E000011 제목' },
    'PATCH /api/entries/E000010': (init) => {
      patched.push(JSON.parse(init.body));
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ...DRAFT, version: 2, description: '메모' }) });
    } }));
  const card = await screen.findByRole('article', { name: /E000010/ });
  await userEvent.type(within(card).getByLabelText('설명'), '메모');
  const other = screen.getByRole('button', { name: /E000011 제목/ });
  await userEvent.click(other);
  let dlg = await screen.findByRole('alertdialog', { name: '저장하지 않은 변경이 있습니다' });
  await userEvent.click(within(dlg).getByRole('button', { name: '머무르기' }));
  expect(within(screen.getByRole('article', { name: /E000010/ })).getByLabelText('설명')).toHaveValue('메모');
  await userEvent.click(other);
  dlg = await screen.findByRole('alertdialog');
  await userEvent.click(within(dlg).getByRole('button', { name: '저장하고 이동' }));
  expect(await screen.findByRole('article', { name: /E000011/ })).toBeInTheDocument();
  expect(patched).toEqual([{ version: 1, description: '메모' }]);
});

test('68 — 상태 칩으로 거르고, 고른 초안을 한꺼번에 확정한다(확정 가능만 고를 수 있다)', async () => {
  const rows = { rows: [row('E000010', 'K1', { title: '9999 연결시험' }), row('E000011', 'K1'),
    row('E000012', 'K1', { state: 'needs_check', reason: '제목 없음', title: '' })], counts: { ready: 2, needs_check: 1 }, total: 3 };
  const confirmed = [];
  const ok = (id) => () => { confirmed.push(id); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ entry_id: id }) }); };
  renderPage(mineMap({ [D('mine')]: rows, 'POST /api/entries/E000010/confirm': ok('E000010'), 'POST /api/entries/E000011/confirm': ok('E000011') }));
  await screen.findByRole('article', { name: /E000010/ });
  const chips = screen.getByRole('group', { name: '상태로 거르기' });
  expect(within(chips).getByRole('button', { name: /전체 3/ })).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(within(chips).getByRole('button', { name: /확인 필요 1/ }));
  expect(screen.queryByRole('button', { name: /E000011 제목/ })).toBeNull();
  expect(screen.getByText('제목 없음')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'E000012 고르기' })).toBeDisabled();
  await userEvent.click(within(chips).getByRole('button', { name: /전체 3/ }));
  await userEvent.click(screen.getByRole('button', { name: '모두 고르기' }));
  expect(screen.getByRole('checkbox', { name: 'E000010 고르기' })).toBeChecked();
  await userEvent.click(screen.getByRole('button', { name: /고른 것 확정/ }));
  await userEvent.click(within(await screen.findByRole('alertdialog', { name: '초안 2건을 확정할까요?' })).getByRole('button', { name: '2건 확정' }));
  expect(await screen.findByText(/2건을 확정했습니다/)).toBeInTheDocument();
  expect(confirmed).toEqual(['E000010', 'E000011']);
});

test('68 — 담당 거르기는 내가 올린 묶음 탭에서 서버에 who 로 보낸다', async () => {
  renderPage(mineMap({ 'GET /api/inbox/drafts?scope=mine&who=assigned': NONE }));
  await screen.findByRole('article', { name: /E000010/ });
  await userEvent.selectOptions(screen.getByRole('combobox', { name: '누구의 초안' }), 'assigned');
  await vi.waitFor(() => expect(gets()).toContain('GET /api/inbox/drafts?scope=mine&who=assigned'));
});

test('68 — 첨부 중인 줄에 파일을 놓으면 올리지 않고 안내한다', async () => {
  renderPage(mineMap({ [D('mine')]: { rows: [row('E000010', 'K1', { state: 'attaching' })], counts: { attaching: 1 }, total: 1 } }));
  const btn = await screen.findByRole('button', { name: /E000010 제목/ });
  const li = btn.closest('li');
  const dt = { types: ['Files'], items: [], files: [] };
  fireEvent.dragOver(li, { dataTransfer: dt });
  fireEvent.drop(li, { dataTransfer: dt });
  expect(await screen.findByText(/첨부나 정리가 끝난 뒤 다시 놓아 주세요/)).toBeInTheDocument();
  expect(uploadBatch).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ targetEntryId: 'E000010' }));
});

test('68 — 좁은 화면은 목록만 보이고, 줄을 누르면 상세가 화면 전체로 열린다', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  renderPage(mineMap());
  const btn = await screen.findByRole('button', { name: /9999 연결시험/ });
  expect(screen.queryByRole('article')).toBeNull();
  await userEvent.click(btn);
  expect(await screen.findByRole('article', { name: /E000010/ })).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: /초안$/ })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
  expect(await screen.findByRole('button', { name: /9999 연결시험/ })).toBeInTheDocument();
  vi.unstubAllGlobals();
});

test('68 — 고친 채 저장하지 않은 상세는 창을 좁혀도 내려가지 않는다(Codex 검토)', async () => {
  const mq = { matches: true, listeners: new Set(), addEventListener(_t, f) { this.listeners.add(f); }, removeEventListener(_t, f) { this.listeners.delete(f); } };
  vi.stubGlobal('matchMedia', vi.fn(() => mq));
  renderPage(mineMap(VOCAB));
  const card = await screen.findByRole('article', { name: /E000010/ });
  await userEvent.type(within(card).getByLabelText('설명'), '메모');
  mq.matches = false;
  await act(async () => { mq.listeners.forEach((f) => f()); });
  expect(within(screen.getByRole('article', { name: /E000010/ })).getByLabelText('설명')).toHaveValue('메모');
  expect(screen.getByRole('button', { name: '목록으로' })).toBeInTheDocument();
  vi.unstubAllGlobals();
});

test('LV1(게스트)도 올린다 — 올리기 단추·끌어 놓기 안내가 보인다(15)', async () => {
  stub({ [D('mine')]: NONE, [B('mine')]: [] });
  render(
    <AuthContext.Provider value={{ user: { employee_id: 'G100001', name: '손님', level: 1 }, isAdmin: false, canWrite: true }}>
      <MemoryRouter initialEntries={['/inbox']}>
        <Routes><Route path="/inbox" element={<InboxPage />} /></Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  expect(await screen.findByText('정리할 자료가 없습니다')).toBeInTheDocument();
  expect(screen.getByText(/끌어 놓거나/)).toBeInTheDocument();
  expect(screen.queryByText(/등급은 자료를 올릴 수 없습니다/)).toBeNull();
});

test('48 — 보완할 자료 탭(/inbox?tab=fix)은 배치 대신 확정 자료 목록을 종류별로 보인다', async () => {
  const E = (id, o) => ({ id, title: `${id} 제목`, rows: ['h:9001'], zones: ['정반'], models: 1, reports: 1, doc_linked: false,
    model_linked: false, solve: 'pass', needs_fix: false, unsigned: false, uploaded_by: 'M1', uploader_name: '김해석', confirmed_at: '2026-09', ...o });
  const coverage = { hulls: { 9001: 'LNGC' }, zones: ['정반'], truncated: false,
    entries: [E('E000001'), E('E000002', { reports: 0 }), E('E000003', { reports: 0 })] };
  vi.stubGlobal('fetch', vi.fn((url) => {
    if (url !== '/api/coverage') throw new Error(`unexpected ${url}`);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(coverage) });
  }));
  mount('/inbox?tab=fix');
  expect(screen.getByRole('tab', { name: '보완할 자료' })).toHaveAttribute('aria-selected', 'true');
  const kind = await screen.findByRole('tab', { name: /문서 없는 모델/ });
  expect(kind).toHaveTextContent('문서 없는 모델 2');
  expect(screen.getByRole('link', { name: 'E000002 제목' })).toHaveAttribute('href', '/e/E000002');
});

// 52 — 폴더 목록 창은 셸의 올리기 저장소(UploadProvider)에 있다
function renderInShell(fetchMap) {
  stub(fetchMap);
  const auth = { user: { employee_id: 'A100001', name: '사용자' }, isAdmin: false };
  return render(
    <AuthContext.Provider value={auth}>
      <UploadProvider>
        <MemoryRouter initialEntries={['/inbox']}>
          <Routes><Route path="/inbox" element={<InboxPage />} /></Routes>
        </MemoryRouter>
      </UploadProvider>
    </AuthContext.Provider>,
  );
}

const inFolder = (relPath, body = 'GRID') => {
  const f = new File([body], relPath.split('/').pop());
  Object.defineProperty(f, 'webkitRelativePath', { value: relPath });
  return f;
};

test('52 — 폴더째 올리기는 목록을 먼저 띄우고, 체크한 파일만 묶는 단위·공통 분류와 함께 보낸다', async () => {
  uploadBatch.mockClear();
  uploadBatch.mockResolvedValue({ key: 'K9', uploaded: 3, rejected: [] });
  const vocab = { kind: 'zone', other: '기타', terms: [] };
  renderInShell({ [D('mine')]: NONE, [B('mine')]: [], 'GET /api/vocab?kind=zone': vocab,
    'GET /api/vocab?kind=target': { ...vocab, kind: 'target' },
    'GET /api/uploads/rules': { excluded_patterns: ['~$*'], skip_by_default: ['.op2', '.mvw'] },
    'POST /api/uploads/similar-preset': { zones: [], target: null, from_entry: null, from_title: null } });
  await screen.findByText('정리할 자료가 없습니다');
  // 폴더 입력(webkitdirectory)은 multiple 없이도 여러 파일을 준다 — userEvent.upload 는 첫 파일만 넣어 change 로 보낸다
  fireEvent.change(screen.getByLabelText('폴더 선택'), { target: { files: [
    inFolder('2025/closed_chock/보고서.pdf'), inFolder('2025/closed_chock/R1/m1.bdf'), inFolder('2025/closed_chock/R1/m1.op2'),
    inFolder('2025/manifold/doc/report.pdf'), inFolder('2025/manifold/fe/~$tmp.xlsx'),
  ] } });
  const dlg = await screen.findByRole('dialog', { name: /폴더 올리기/ });
  expect(uploadBatch).not.toHaveBeenCalled();
  // 소속 폴더별로 묶이고, op2 는 체크가 풀려 있다
  expect(within(dlg).getByRole('group', { name: 'closed_chock/R1 폴더' })).toBeInTheDocument();
  expect(within(dlg).getByRole('checkbox', { name: '2025/closed_chock/R1/m1.op2 올리기' })).not.toBeChecked();
  expect(within(dlg).getByRole('checkbox', { name: '2025/closed_chock/R1/m1.bdf 올리기' })).toBeChecked();
  expect(within(dlg).getByText(/임시 파일 1개/)).toBeInTheDocument();
  // 기본은 폴더 전체를 자료 1건(사용자 결정) — 하위 폴더마다 나누기를 고른다
  expect(within(dlg).getByRole('radio', { name: '폴더 전체를 자료 1건' })).toBeChecked();
  expect(within(dlg).getByRole('button', { name: '올리기 (3개)' })).toBeInTheDocument();
  await userEvent.click(within(dlg).getByRole('radio', { name: '하위 폴더마다 자료 1건' }));
  await userEvent.click(within(dlg).getByRole('button', { name: /초안 2건으로 올리기 \(3개\)/ }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await vi.waitFor(() => expect(uploadBatch).toHaveBeenCalledTimes(1));
  const [items, opts] = uploadBatch.mock.calls[0];
  expect(items.map((i) => i.relPath).sort()).toEqual([
    '2025/closed_chock/R1/m1.bdf', '2025/closed_chock/보고서.pdf', '2025/manifold/doc/report.pdf']);
  // 56 — '하위 폴더마다' 를 비워 두면 공통 분류를 보내지 않는다(서버가 초안마다 자기 폴더 이름으로 찾는다)
  expect(opts).toMatchObject({ splitTop: true, preset: null });
});

test('52 — 폴더 목록에서 취소하면 올리지 않는다', async () => {
  uploadBatch.mockClear();
  renderInShell({ [D('mine')]: NONE, [B('mine')]: [], 'GET /api/vocab?kind=zone': { kind: 'zone', terms: [] },
    'GET /api/vocab?kind=target': { kind: 'target', terms: [] },
    'GET /api/uploads/rules': { excluded_patterns: [], skip_by_default: ['.op2'] } });
  await screen.findByText('정리할 자료가 없습니다');
  fireEvent.change(screen.getByLabelText('폴더 선택'), { target: { files: [inFolder('p/a.bdf')] } });
  const dlg = await screen.findByRole('dialog', { name: /폴더 올리기/ });
  expect(within(dlg).queryByRole('radiogroup')).toBeNull();   // 하위 폴더가 없으면 묶는 단위를 묻지 않는다
  await userEvent.click(within(dlg).getByRole('button', { name: '취소' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(uploadBatch).not.toHaveBeenCalled();
});

const SETTLED = { key: 'K9', source: 'web', original_name: 'WB #6784 · GroupModuleUnit', state: 'done', uploader: 'A100001',
  received_at: '2026-11-04T14:31:00', error: null, draft_count: 0,
  excluded: [{ name: 'a.bdf', size: 0, reason: 'duplicate_model', targets: [] }] };

test('같은 BDF 뿐이라 초안 없이 끝난 묶음은 맨 아래 접힌 한 줄로 모으고, 누르면 상세에 묶음을 연다', async () => {
  renderPage(mineMap({ [B('mine')]: [MINE[0], SETTLED] }));
  await screen.findByRole('article', { name: /E000010/ });
  const fold = screen.getByText(/같은 BDF 뿐이라 초안 없이 끝난 묶음/).closest('details');
  expect(fold).not.toHaveAttribute('open');
  expect(fold).toHaveTextContent('1개');
  // 접힌 줄 밖(위쪽 할 일 목록)에는 없다
  expect(screen.getAllByRole('button', { name: /WB #6784/ }).every((b) => fold.contains(b))).toBe(true);
  fold.open = true;
  await userEvent.click(within(fold).getByRole('button', { name: /WB #6784/ }));
  expect(await screen.findByRole('region', { name: /묶음 WB #6784/ })).toBeInTheDocument();
});

test('할 일이 없고 끝난 묶음만 있으면 빈 화면 안내와 접힌 줄이 함께 보인다', async () => {
  renderPage({ [D('mine')]: NONE, [B('mine')]: [{ ...SETTLED, original_name: '같은 것만' }] });
  expect(await screen.findByText('정리할 자료가 없습니다')).toBeInTheDocument();
  expect(screen.getByText(/같은 BDF 뿐이라 초안 없이 끝난 묶음/)).toBeInTheDocument();
});

test('62 — 이 창 밖에서 올리는 중인 묶음이 있으면 한 줄로 알린다', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })));
  const { InboxSummaryContextForTest: Ctx } = await import('../components/shell/InboxSummary.jsx');
  const auth = { user: { employee_id: 'A100001', name: '사용자' }, isAdmin: false };
  render(
    <AuthContext.Provider value={auth}>
      <Ctx.Provider value={{ summary: { drafts: 0, staged: 0, uploading: 2, names: [] }, refresh: () => {} }}>
        <MemoryRouter initialEntries={['/inbox']}>
          <Routes><Route path="/inbox" element={<UploadProvider><InboxPage /></UploadProvider>} /></Routes>
        </MemoryRouter>
      </Ctx.Provider>
    </AuthContext.Provider>,
  );
  expect(await screen.findByText(/다른 창\(또는 다른 PC\)에서 올리는 중인 묶음이/)).toHaveTextContent('2개');
});
