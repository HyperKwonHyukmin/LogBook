import { afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsersPage from './UsersPage.jsx';
import { AuthContext } from '../../auth/AuthContext.jsx';

const ME = { employee_id: 'A900001', name: '나관리', level: 3, wb_admin: false };
const ROWS = [
  { employee_id: 'A900001', name: '나관리', department: '구조', level: 3, stored_level: 3, wb_active: true, wb_admin: false, known: true, last_login: '2026-10-08T09:00:00' },
  { employee_id: 'A100001', name: '김일반', department: '구조팀', position: '책임', level: 2, stored_level: 2, wb_active: true, wb_admin: false, known: true, last_login: '2026-10-07T10:00:00' },
  { employee_id: 'A100002', name: '이처음', department: null, level: 1, stored_level: 1, wb_active: true, wb_admin: false, known: false, last_login: null },
  { employee_id: 'W100001', name: '박WB', department: '전산', level: 3, stored_level: 1, wb_active: true, wb_admin: true, known: true, last_login: null },
  { employee_id: 'D100001', name: '최떠남', department: null, level: 2, stored_level: 2, wb_active: false, wb_admin: false, known: true, last_login: null },
];

function routeFetch(handlers) {
  vi.stubGlobal('fetch', vi.fn((url, init = {}) => {
    const key = `${init.method || 'GET'} ${url}`;
    const body = handlers[key];
    if (body === undefined) throw new Error(`unexpected ${key}`);
    if (body.__status) {
      return Promise.resolve({ ok: false, status: body.__status, json: () => Promise.resolve({ detail: body.detail }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  }));
}

function renderPage() {
  return render(<AuthContext.Provider value={{ user: ME }}><UsersPage /></AuthContext.Provider>);
}

afterEach(() => { vi.restoreAllMocks(); });

async function answer(ok) {
  const dialog = await screen.findByRole('alertdialog');
  const buttons = within(dialog).getAllByRole('button');
  await userEvent.click(ok ? buttons[buttons.length - 1] : within(dialog).getByRole('button', { name: '취소' }));
}

const rowOf = async (name) => (await screen.findByText(name)).closest('tr');

test('WorkBench 사용자 목록 — 등급 고르기·잠금 표시(나·WorkBench 관리자·비활성)', async () => {
  routeFetch({ 'GET /api/admin/users': ROWS });
  renderPage();
  const general = await rowOf('김일반');
  expect(within(general).getByRole('combobox', { name: '김일반 등급' })).toHaveValue('2');
  expect(within(await rowOf('이처음')).getByText('들어온 적 없음')).toBeInTheDocument();
  const wb = await rowOf('박WB');
  expect(within(wb).queryByRole('combobox')).toBeNull();
  expect(within(wb).getByText('LV3 관리자')).toBeInTheDocument();
  expect(within(wb).getByText('WorkBench 관리자 · 자동')).toBeInTheDocument();
  const mine = await rowOf('나관리');
  expect(within(mine).queryByRole('combobox')).toBeNull();
  expect(within(mine).getByText('나')).toBeInTheDocument();
  expect(within(await rowOf('최떠남')).getByText('WorkBench 비활성')).toBeInTheDocument();
  // 등급별 거르기 — 개수
  const tabs = screen.getByRole('tablist', { name: '등급으로 거르기' });
  expect(within(tabs).getByRole('tab', { name: /LV3/ })).toHaveTextContent('2');
  await userEvent.click(within(tabs).getByRole('tab', { name: /LV1/ }));
  expect(screen.queryByText('김일반')).toBeNull();
  expect(screen.getByText('이처음')).toBeInTheDocument();
});

test('등급을 바꾸면 PUT /level 후 다시 불러온다(LV1↔LV2 는 바로)', async () => {
  routeFetch({ 'GET /api/admin/users': ROWS, 'PUT /api/admin/users/A100001/level': { ...ROWS[1], level: 1 } });
  renderPage();
  const row = await rowOf('김일반');
  await userEvent.selectOptions(within(row).getByRole('combobox'), '1');
  await waitFor(() => expect(fetch.mock.calls.some(([u, i]) => u === '/api/admin/users/A100001/level' && i?.method === 'PUT')).toBe(true));
  const [, init] = fetch.mock.calls.find(([u, i]) => u === '/api/admin/users/A100001/level' && i?.method === 'PUT');
  expect(JSON.parse(init.body)).toEqual({ level: 1 });
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

test('LV3 지정은 확인을 묻는다(취소하면 보내지 않는다)', async () => {
  routeFetch({ 'GET /api/admin/users': ROWS, 'PUT /api/admin/users/A100002/level': { ...ROWS[2], level: 3 } });
  renderPage();
  const row = await rowOf('이처음');
  await userEvent.selectOptions(within(row).getByRole('combobox'), '3');
  await answer(false);
  expect(fetch.mock.calls.some(([u, i]) => i?.method === 'PUT')).toBe(false);
  await userEvent.selectOptions(within(row).getByRole('combobox'), '3');
  await answer(true);
  await waitFor(() => expect(fetch.mock.calls.some(([u, i]) => u === '/api/admin/users/A100002/level' && i?.method === 'PUT')).toBe(true));
});

test('찾기 — 이름·사번으로 서버에 묻는다', async () => {
  routeFetch({ 'GET /api/admin/users': ROWS, 'GET /api/admin/users?q=%EC%9D%B4': [ROWS[2]] });
  renderPage();
  await screen.findByText('김일반');
  await userEvent.type(screen.getByRole('textbox', { name: '사용자 찾기' }), '이');
  await waitFor(() => expect(screen.queryByText('김일반')).toBeNull());
  expect(screen.getByText('이처음')).toBeInTheDocument();
});

test('WorkBench 표를 읽을 수 없으면 원인을 알린다', async () => {
  routeFetch({ 'GET /api/admin/users': { __status: 503, detail: 'wb_unavailable' } });
  renderPage();
  expect(await screen.findByText(/WorkBench 사용자 표를 읽을 수 없습니다/)).toBeInTheDocument();
});

test('서버 거부 문구(WorkBench 관리자 잠금)', async () => {
  routeFetch({ 'GET /api/admin/users': ROWS,
    'PUT /api/admin/users/A100001/level': { __status: 409, detail: 'wb_admin_locked' } });
  renderPage();
  await userEvent.selectOptions(within(await rowOf('김일반')).getByRole('combobox'), '1');
  expect(await screen.findByText(/WorkBench 관리자는 LogBook 에서 자동으로 LV3/)).toBeInTheDocument();
});
