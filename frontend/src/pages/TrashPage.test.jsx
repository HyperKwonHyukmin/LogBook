import { vi } from 'vitest';
import { render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { AuthContext } from '../auth/AuthContext.jsx';
import TrashPage from './TrashPage.jsx';

const ROWS = [
  { entry_id: 'E000001', title: '9999 연결시험', trash_rel: 'E000001_20260929-123305', restorable: true, updated_at: '2026-09-29T12:33:05', can_purge: true },
  { entry_id: 'E000002', title: '초안 자료', trash_rel: 'draft_E000002_20260929-130000', kind: 'draft', restorable: true, updated_at: '2026-09-29T13:00:00', can_purge: true },
];
// 영구 삭제 권한이 없는 행(남이 올린 자료를 내가 버린 경우 등)
const NO_PURGE = ROWS.map((r) => ({ ...r, can_purge: false }));

// 제목과 복원 안내가 자료 링크라 라우터 안에서 그린다.
const render = (ui) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

function mock(map) {
  vi.stubGlobal('fetch', vi.fn((url, init = {}) => {
    const r = map[`${init.method || 'GET'} ${url}`];
    if (r === undefined) throw new Error(url);
    return Promise.resolve(r.__status ? { ok: false, status: r.__status, json: () => Promise.resolve({ detail: r.detail }) }
                                     : { ok: true, status: 200, json: () => Promise.resolve(r) });
  }));
}

test('확정 자료는 복원하고 자료 화면으로 안내한다', async () => {
  mock({ 'GET /api/trash': ROWS, 'POST /api/entries/E000001/restore': { entry_id: 'E000001', status: 'confirmed' } });
  render(<TrashPage />);
  const row1 = (await screen.findByText('9999 연결시험')).closest('li');
  await userEvent.click(within(row1).getByRole('button', { name: '복원' }));
  expect(fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`)).toContain('POST /api/entries/E000001/restore');
  expect(await screen.findByRole('status')).toHaveTextContent('E000001 을 복원했습니다');
});

test('2026-11-20 — 버린 초안도 복원하고, 올리기와 확정으로 안내한다', async () => {
  mock({ 'GET /api/trash': ROWS, 'POST /api/entries/E000002/restore': { entry_id: 'E000002', status: 'draft' } });
  render(<TrashPage />);
  const row2 = (await screen.findByText('초안 자료')).closest('li');
  expect(within(row2).getByText('버린 초안')).toBeInTheDocument();
  await userEvent.click(within(row2).getByRole('button', { name: '복원' }));
  const note = await screen.findByRole('status');
  expect(note).toHaveTextContent('E000002 초안을 되돌렸습니다');
  expect(within(note).getByRole('link', { name: '올리기와 확정에서 보기' })).toHaveAttribute('href', '/inbox');
});

test('복원 실패 사유를 보여 준다', async () => {
  mock({ 'GET /api/trash': [ROWS[0]], 'POST /api/entries/E000001/restore': { __status: 503, detail: 'storage_unreachable' } });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<TrashPage />);
  await userEvent.click(await screen.findByRole('button', { name: '복원' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('공유 폴더에 연결할 수 없습니다');
});

test('삭제 시각이 없어도 행을 그린다', async () => {
  mock({ 'GET /api/trash': [{ ...ROWS[0], updated_at: null }] });
  render(<TrashPage />);
  const row = (await screen.findByText('9999 연결시험')).closest('li');
  expect(within(row).getByText('—')).toBeInTheDocument();
});

const asUser = (isAdmin) => (ui) => rtlRender(
  <AuthContext.Provider value={{ user: { employee_id: 'A100001', name: '관리자' }, isAdmin }}>
    <MemoryRouter>{ui}</MemoryRouter>
  </AuthContext.Provider>,
);

test('내가 버린 내 자료는 영구 삭제할 수 있다(관리자도 같은 단추)', async () => {
  mock({ 'GET /api/trash': [ROWS[0]], 'DELETE /api/trash/E000001': {} });
  asUser(true)(<TrashPage />);
  const row = (await screen.findByText('9999 연결시험')).closest('li');
  await userEvent.click(within(row).getByRole('button', { name: '영구 삭제' }));
  const dialog = screen.getByRole('alertdialog');
  expect(dialog).toHaveTextContent('되돌릴 수 없습니다. 95_Trash 폴더에서도 지워집니다.');
  await userEvent.click(within(dialog).getByRole('button', { name: '영구 삭제' }));
  expect(fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`)).toContain('DELETE /api/trash/E000001');
  await waitFor(() => expect(screen.queryByText('9999 연결시험')).toBeNull());
  expect(screen.getByRole('status')).toHaveTextContent('E000001 을 영구 삭제했습니다');
});

test('영구 삭제를 취소하면 요청하지 않는다', async () => {
  mock({ 'GET /api/trash': [ROWS[0]] });
  asUser(true)(<TrashPage />);
  await userEvent.click(await screen.findByRole('button', { name: '영구 삭제' }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '취소' }));
  expect(fetch.mock.calls.map(([u, i = {}]) => i.method || 'GET')).not.toContain('DELETE');
  expect(screen.getByText('9999 연결시험')).toBeInTheDocument();
});

test('2026-11-25 — 일반 사용자도 can_purge 인 행은 영구 삭제, 아닌 행에는 단추가 없다', async () => {
  mock({ 'GET /api/trash': [ROWS[0], NO_PURGE[1]], 'DELETE /api/trash/E000001': {} });
  asUser(false)(<TrashPage />);
  const row1 = (await screen.findByText('9999 연결시험')).closest('li');
  const row2 = screen.getByText('초안 자료').closest('li');
  expect(within(row2).queryByRole('button', { name: '영구 삭제' })).toBeNull();
  expect(screen.getByText(/내가 버린 자료만 보입니다/)).toBeInTheDocument();
  expect(screen.queryByRole('radiogroup', { name: '보기' })).toBeNull();   // 모두 보기는 관리자만
  await userEvent.click(within(row1).getByRole('button', { name: '영구 삭제' }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '영구 삭제' }));
  expect(fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`)).toContain('DELETE /api/trash/E000001');
});

test('인증 문맥이 없으면 일반 사용자로 동작한다(권한 없는 행은 영구 삭제 없음)', async () => {
  mock({ 'GET /api/trash': NO_PURGE });
  render(<TrashPage />);
  await screen.findByText('9999 연결시험');
  expect(screen.queryByRole('button', { name: '영구 삭제' })).toBeNull();
});

test('관리자는 [모두]로 남이 버린 것까지 보고 버린 사람이 보인다', async () => {
  mock({ 'GET /api/trash': [ROWS[0]],
         'GET /api/trash?scope=all': [ROWS[0], { ...ROWS[1], trashed_by: 'B200002', trashed_by_name: '김버림' }] });
  asUser(true)(<TrashPage />);
  await screen.findByText('9999 연결시험');
  expect(screen.queryByText('초안 자료')).toBeNull();
  await userEvent.click(screen.getByRole('radio', { name: '모두' }));
  const row2 = (await screen.findByText('초안 자료')).closest('li');
  expect(within(row2).getByText('김버림')).toBeInTheDocument();
  expect(screen.getByText(/모든 사람이 버린 자료입니다/)).toBeInTheDocument();
});

test('휴지통을 한 번에 비운다 — 지울 수 있는 행만, 건마다 영구 삭제 API, 실패한 건은 알린다', async () => {
  const rows = [...ROWS, { ...ROWS[0], entry_id: 'E000003', title: '세 번째' }];
  mock({ 'GET /api/trash': rows, 'DELETE /api/trash/E000001': {}, 'DELETE /api/trash/E000002': {},
         'DELETE /api/trash/E000003': { __status: 409, detail: 'not_trashed' } });
  asUser(true)(<TrashPage />);
  await userEvent.click(await screen.findByRole('button', { name: /휴지통 비우기 \(3건\)/ }));
  const dialog = screen.getByRole('alertdialog');
  expect(dialog).toHaveTextContent('휴지통의 자료 3건을 모두 영구 삭제할까요?');
  await userEvent.click(within(dialog).getByRole('button', { name: '3건 영구 삭제' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('자료 2건을 영구 삭제했습니다'));
  const deletes = fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`).filter((c) => c.startsWith('DELETE'));
  expect(deletes).toEqual(['DELETE /api/trash/E000001', 'DELETE /api/trash/E000002', 'DELETE /api/trash/E000003']);
  expect(screen.getByRole('alert')).toHaveTextContent('1건은 지우지 못했습니다: E000003');
});

test('휴지통 비우기를 취소하면 지우지 않고, 지울 수 있는 행이 없으면 단추가 없다', async () => {
  mock({ 'GET /api/trash': ROWS });
  const { unmount } = asUser(true)(<TrashPage />);
  await userEvent.click(await screen.findByRole('button', { name: /휴지통 비우기/ }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '취소' }));
  expect(fetch.mock.calls.map(([, i = {}]) => i.method || 'GET')).not.toContain('DELETE');
  unmount();
  mock({ 'GET /api/trash': NO_PURGE });
  asUser(false)(<TrashPage />);
  await screen.findByText('9999 연결시험');
  expect(screen.queryByRole('button', { name: /휴지통 비우기/ })).toBeNull();
});
