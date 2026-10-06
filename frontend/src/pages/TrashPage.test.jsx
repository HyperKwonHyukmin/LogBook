import { vi } from 'vitest';
import { render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { AuthContext } from '../auth/AuthContext.jsx';
import TrashPage from './TrashPage.jsx';

const ROWS = [
  { entry_id: 'E000001', title: '9999 연결시험', trash_rel: 'E000001_20260929-123305', restorable: true, updated_at: '2026-09-29T12:33:05' },
  { entry_id: 'E000002', title: '버린 초안', trash_rel: 'draft_E000002_20260929-130000', restorable: false, updated_at: '2026-09-29T13:00:00' },
];

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

test('확정 자료는 복원하고, 버린 초안은 복원 불가로 표시한다', async () => {
  mock({ 'GET /api/trash': ROWS, 'POST /api/entries/E000001/restore': { entry_id: 'E000001', status: 'confirmed' } });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<TrashPage />);
  const row1 = (await screen.findByText('9999 연결시험')).closest('li');
  await userEvent.click(within(row1).getByRole('button', { name: '복원' }));
  expect(fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`)).toContain('POST /api/entries/E000001/restore');
  const row2 = screen.getByText('버린 초안').closest('li');
  expect(within(row2).queryByRole('button', { name: '복원' })).toBeNull();
  expect(within(row2).getByText('초안이라 복원할 수 없음')).toBeInTheDocument();
  expect(await screen.findByRole('status')).toHaveTextContent('E000001 을 복원했습니다');
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

test('관리자는 영구 삭제할 수 있다', async () => {
  mock({ 'GET /api/trash': [ROWS[0]], 'DELETE /api/admin/trash/E000001': {} });
  asUser(true)(<TrashPage />);
  const row = (await screen.findByText('9999 연결시험')).closest('li');
  await userEvent.click(within(row).getByRole('button', { name: '영구 삭제' }));
  const dialog = screen.getByRole('alertdialog');
  expect(dialog).toHaveTextContent('되돌릴 수 없습니다. 95_Trash 폴더에서도 지워집니다.');
  await userEvent.click(within(dialog).getByRole('button', { name: '영구 삭제' }));
  expect(fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`)).toContain('DELETE /api/admin/trash/E000001');
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

test('일반 사용자에게는 영구 삭제가 없다', async () => {
  mock({ 'GET /api/trash': ROWS });
  asUser(false)(<TrashPage />);
  await screen.findByText('9999 연결시험');
  expect(screen.queryByRole('button', { name: '영구 삭제' })).toBeNull();
});

test('인증 문맥이 없으면 일반 사용자로 동작한다', async () => {
  mock({ 'GET /api/trash': ROWS });
  render(<TrashPage />);
  await screen.findByText('9999 연결시험');
  expect(screen.queryByRole('button', { name: '영구 삭제' })).toBeNull();
});
