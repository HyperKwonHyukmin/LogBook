import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../auth/AuthContext.jsx';

vi.mock('../lib/upload.js', async (orig) => ({ ...(await orig()), uploadBatch: vi.fn() }));
import { uploadBatch } from '../lib/upload.js';
import InboxPage from './InboxPage.jsx';

const DRAFT = { entry_id: 'E000010', status: 'draft', title: '9999 연결시험', version: 1, hulls: [], zones: [],
  hull_evidence: [], files: [], suggested_entry: null, merge_into: null, uploaded_by: 'A100001' };
const MINE = [
  { key: 'K1', source: 'web', original_name: '9999_연결시험', state: 'processed', uploader: 'A100001',
    received_at: '2026-09-29T12:32:35', excluded: [{ name: 'enc.pdf', size: 0, reason: 'drm' }], error: null, entries: [DRAFT] },
  { key: 'K2', source: 'inbox', original_name: '방금 올린 폴더', state: 'staged', uploader: 'A100001',
    received_at: '2026-09-29T12:40:00', excluded: [], error: null, entries: [] },
];
const UNCLAIMED = [{ key: 'K3', source: 'inbox', original_name: '주인 없음', state: 'processed', uploader: null,
  owner_account: 'x1234', received_at: '2026-09-29T11:00:00', excluded: [], error: null, entries: [] }];

function renderPage(fetchMap) {
  vi.stubGlobal('fetch', vi.fn((url, init = {}) => {
    const key = `${init.method || 'GET'} ${url}`;
    const r = fetchMap[key];
    if (r === undefined) throw new Error(`unexpected ${key}`);
    if (typeof r === 'function') return r();
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(r) });
  }));
  return mount();
}

function mount() {
  const auth = { user: { employee_id: 'A100001', name: '사용자' }, isAdmin: false };
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/inbox']}>
        <Routes><Route path="/inbox" element={<InboxPage />} /></Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

test('내 배치: 초안 카드, 처리 중 배치, DRM 제외 목록', async () => {
  renderPage({ 'GET /api/batches?scope=mine': MINE });
  expect(await screen.findByRole('article', { name: /E000010/ })).toBeInTheDocument();
  const k2 = screen.getByRole('region', { name: /방금 올린 폴더/ });
  expect(within(k2).getByText('분석 중')).toBeInTheDocument();
  expect(screen.getByText(/enc\.pdf/)).toBeInTheDocument();
  expect(screen.getByText(/DRM 암호화/)).toBeInTheDocument();
});

test('주인 없는 배치를 가져온다', async () => {
  renderPage({ 'GET /api/batches?scope=mine': [], 'GET /api/batches?scope=unclaimed': UNCLAIMED,
               'POST /api/batches/K3/claim': { ...UNCLAIMED[0], uploader: 'A100001' } });
  await userEvent.click(await screen.findByRole('tab', { name: /주인 없는 배치/ }));
  await userEvent.click(await screen.findByRole('button', { name: '내가 올렸어요' }));
  const calls = fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`);
  expect(calls).toContain('POST /api/batches/K3/claim');
});

test('비어 있으면 안내한다', async () => {
  renderPage({ 'GET /api/batches?scope=mine': [] });
  expect(await screen.findByText('정리할 자료가 없습니다')).toBeInTheDocument();
});

const gets = () => fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`);

test('탭을 빨리 바꿔도 늦게 온 이전 탭 응답이 목록을 덮지 않는다', async () => {
  const pending = {};
  const deferred = (name) => () => new Promise((resolve) => {
    pending[name] = (rows) => resolve({ ok: true, status: 200, json: () => Promise.resolve(rows) });
  });
  renderPage({ 'GET /api/batches?scope=mine': deferred('mine'), 'GET /api/batches?scope=unclaimed': deferred('unclaimed') });
  await userEvent.click(screen.getByRole('tab', { name: /주인 없는 배치/ }));
  await vi.waitFor(() => expect(pending.unclaimed).toBeDefined());
  pending.unclaimed(UNCLAIMED);
  expect(await screen.findByRole('region', { name: /주인 없음/ })).toBeInTheDocument();
  pending.mine(MINE);
  await new Promise((r) => { setTimeout(r, 20); });
  expect(screen.queryByRole('region', { name: /방금 올린 폴더/ })).toBeNull();
  expect(screen.getByRole('region', { name: /주인 없음/ })).toBeInTheDocument();
});

test('다른 탭에서 올리기가 끝나면 내 배치 탭으로 가서 한 번만 새로 부른다', async () => {
  uploadBatch.mockResolvedValue({ key: 'K9', uploaded: 1, rejected: [] });
  renderPage({ 'GET /api/batches?scope=mine': [], 'GET /api/batches?scope=unclaimed': UNCLAIMED });
  await userEvent.click(await screen.findByRole('tab', { name: /주인 없는 배치/ }));
  await screen.findByRole('region', { name: /주인 없음/ });
  const before = gets().length;
  await userEvent.upload(screen.getByLabelText('파일 선택'), [new File(['GRID'], 'a.bdf')]);
  await vi.waitFor(() => expect(screen.getByRole('tab', { name: '내 배치' })).toHaveAttribute('aria-selected', 'true'));
  await screen.findByText('정리할 자료가 없습니다');
  expect(gets().slice(before)).toEqual(['GET /api/batches?scope=mine']);
});

test('탭은 화살표로 옮겨 가고 탭 패널과 연결된다', async () => {
  renderPage({ 'GET /api/batches?scope=mine': [], 'GET /api/batches?scope=unclaimed': [] });
  const mine = screen.getByRole('tab', { name: '내 배치' });
  expect(document.getElementById(mine.getAttribute('aria-controls'))).toHaveAttribute('role', 'tabpanel');
  mine.focus();
  await userEvent.keyboard('{ArrowRight}');
  const other = screen.getByRole('tab', { name: '주인 없는 배치' });
  expect(other).toHaveFocus();
  expect(other).toHaveAttribute('aria-selected', 'true');
  await userEvent.keyboard('{ArrowLeft}');
  expect(mine).toHaveFocus();
});

test('받은 시각이 없어도 배치를 그린다', async () => {
  renderPage({ 'GET /api/batches?scope=mine': [{ ...MINE[1], received_at: null }] });
  const region = await screen.findByRole('region', { name: /방금 올린 폴더/ });
  expect(within(region).getByText('—')).toBeInTheDocument();
});

test('가져가기에 실패하면 새로 부른 뒤에도 사유가 남는다', async () => {
  renderPage({ 'GET /api/batches?scope=mine': [], 'GET /api/batches?scope=unclaimed': UNCLAIMED,
    'POST /api/batches/K3/claim': () => Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ detail: 'already_claimed' }) }) });
  await userEvent.click(await screen.findByRole('tab', { name: /주인 없는 배치/ }));
  await userEvent.click(await screen.findByRole('button', { name: '내가 올렸어요' }));
  await vi.waitFor(() => expect(gets().filter((c) => c === 'GET /api/batches?scope=unclaimed')).toHaveLength(2));
  await new Promise((r) => { setTimeout(r, 20); });
  expect(screen.getByRole('alert')).toHaveTextContent('이미 다른 사람이 가져갔습니다');
});
