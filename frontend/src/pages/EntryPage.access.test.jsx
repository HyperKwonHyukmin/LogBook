/** 13·15 — 등급별 Entry 상세 버튼 노출(변경하기·파일 추가·휴지통·공개 범위). */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../auth/AuthContext.jsx';
import { mockApi } from '../test/mockApi.js';
import { invalidateVocab } from '../lib/vocab.js';
import EntryPage from './EntryPage.jsx';

beforeEach(() => invalidateVocab());

const ENTRY = { entry_id: 'E000001', status: 'confirmed', title: '계류 구조 검토',
  description: null, version: 3, hulls: [{ hull_no: '9999', ship_type: null, is_primary: true }],
  zones: [], tags: [], uploaded_by: 'U1', confirmed_by: 'U1', confirmed_at: '2026-09-02T09:00:00',
  files: [], vault_unc: null, access: 'blocked', label: '블록' };

function renderAs(user, entry) {
  mockApi({
    'GET /api/entries/E000001': entry,
    'GET /api/entries/E000001/history': [],
    'GET /api/vocab?kind=zone': { kind: 'zone', other: '기타', terms: [] },
    'GET /api/vocab?kind=target': { kind: 'target', other: '기타', terms: [] },
  });
  render(
    <AuthContext.Provider value={{ user }}>
      <MemoryRouter initialEntries={['/e/E000001']}>
        <Routes><Route path="/e/:entryId" element={<EntryPage />} /></Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

test('해석 시기는 보이지 않는다(15)', async () => {
  renderAs({ employee_id: 'U1', name: '올린이', level: 2 },
    { ...ENTRY, access: 'normal', label: null, analysis_period: '2025-11', can_edit: true, can_manage_access: true, grants: [] });
  expect(await screen.findByText('계류 구조 검토')).toBeInTheDocument();
  expect(screen.queryByText('해석 시기')).toBeNull();
  expect(screen.queryByText('2025-11')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: /변경하기/ }));
  expect(screen.queryByRole('textbox', { name: '해석 시기' })).toBeNull();
});

test('남의 자료를 보는 LV2 — 고치지 못하고 이유(작성자만 수정), 블록 배지가 보인다', async () => {
  renderAs({ employee_id: 'M1', name: '열람자', level: 2 }, { ...ENTRY, can_edit: false, can_manage_access: false });
  expect(await screen.findByText('계류 구조 검토')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /변경하기/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /파일 추가/ })).toBeNull();
  expect(screen.getByTestId('read-only-note')).toHaveTextContent('작성자만 수정');
  expect(screen.getAllByTestId('access-badge')[0]).toHaveTextContent('블록');
  expect(screen.queryByRole('combobox', { name: '공개 범위' })).toBeNull();
});

test('올린 사람(LV1) — 변경하기·파일 추가와 공개 범위 고르기(블록 선택지 없음)가 보인다', async () => {
  renderAs({ employee_id: 'U1', name: '올린이', level: 1 },
    { ...ENTRY, access: 'normal', label: null, can_edit: true, can_manage_access: true, can_block: false, grants: [] });
  expect(await screen.findByRole('button', { name: /변경하기/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /파일 추가/ })).toBeInTheDocument();
  const select = screen.getByRole('combobox', { name: '공개 범위' });
  expect(select).toHaveValue('normal');
  expect([...select.options].map((o) => o.value)).toEqual(['shared', 'normal']);
  expect(screen.getByRole('textbox', { name: '열람 허락할 사람 찾기' })).toBeInTheDocument();
  expect(screen.queryByTestId('read-only-note')).toBeNull();
});

test('블록된 자기 자료 — 내용은 고치지만 공개 범위는 관리자만', async () => {
  renderAs({ employee_id: 'U1', name: '올린이', level: 1 },
    { ...ENTRY, can_edit: true, can_manage_access: false, can_block: false });
  expect(await screen.findByRole('button', { name: /변경하기/ })).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: '공개 범위' })).toBeNull();
  expect(screen.getByText(/관리자가 블록한 자료입니다/)).toBeInTheDocument();
});

test('LV3 — 블록 선택지가 있다', async () => {
  renderAs({ employee_id: 'A1', name: '관리', level: 3 },
    { ...ENTRY, access: 'normal', label: null, can_edit: true, can_manage_access: true, can_block: true, grants: [] });
  const select = await screen.findByRole('combobox', { name: '공개 범위' });
  expect([...select.options].map((o) => o.value)).toEqual(['shared', 'normal', 'blocked']);
});

test('열람 허락을 주면 허락 목록에 보이고, 변경 이력에는 남지 않는다(2026-10-20)', async () => {
  let grants = [];
  const fn = mockApi({
    'GET /api/entries/E000001': () => ({ ...ENTRY, access: 'normal', label: null, can_edit: true, can_manage_access: true, grants }),
    'GET /api/entries/E000001/history': [],
    'GET /api/users/lookup?q=%EB%B0%95': [{ employee_id: 'M2', name: '박승인', department: '구조', level: 1 }],
    'POST /api/entries/E000001/grants': () => {
      grants = [{ employee_id: 'M2', name: '박승인', level: 1, effective: true }];
      return { grants };
    },
    'GET /api/vocab?kind=zone': { kind: 'zone', other: '기타', terms: [] },
    'GET /api/vocab?kind=target': { kind: 'target', other: '기타', terms: [] },
  });
  render(
    <AuthContext.Provider value={{ user: { employee_id: 'U1', name: '올린이', level: 2 } }}>
      <MemoryRouter initialEntries={['/e/E000001']}>
        <Routes><Route path="/e/:entryId" element={<EntryPage />} /></Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  const box = await screen.findByRole('textbox', { name: '열람 허락할 사람 찾기' });
  await userEvent.type(box, '박');
  await userEvent.click(await screen.findByRole('checkbox', { name: '박승인 고르기' }));
  await userEvent.click(screen.getByRole('button', { name: '1명 허락' }));
  const list = await screen.findByRole('list', { name: '열람 허락 목록' });
  expect(list).toHaveTextContent('박승인');
  expect(fn.mock.calls.some(([u, i]) => i?.method === 'POST' && u === '/api/entries/E000001/grants')).toBe(true);
});
