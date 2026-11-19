import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { calls, mockApi } from '../../test/mockApi.js';
import { useState } from 'react';
import EntryComments, { CommentsLink } from './EntryComments.jsx';
import CommentsPage from '../../pages/CommentsPage.jsx';

const author = (employee_id, name) => ({ employee_id, name });
const item = (o = {}) => ({
  id: 1, kind: 'comment', parent_id: null, body: '경계조건이 다릅니다', author: author('B2', '동료'),
  created_at: '2026-11-19T09:00:00', edited_at: null, deleted: false, status: null, resolved: null,
  can_edit: false, can_delete: false, can_resolve: false, replies: [], ...o,
});
const URL = '/api/entries/E000001/comments';

function renderIt(status = 'confirmed') {
  return render(<MemoryRouter><EntryComments entryId="E000001" status={status} /></MemoryRouter>);
}

test('목록 — 열린 이슈, 답글, 삭제 표시를 보이고 권한에 따라 단추를 보인다', async () => {
  mockApi({ [`GET ${URL}`]: { total: 3, open_issues: 1, can_comment: true, items: [
    item({ id: 1, kind: 'issue', status: 'open', can_resolve: true, body: '3쪽 값이 모델과 다름',
           replies: [item({ id: 2, parent_id: 1, body: '확인하겠습니다', author: author('A1', '올린이'), can_edit: true, can_delete: true })] }),
    item({ id: 3, deleted: true, body: '', replies: [item({ id: 4, parent_id: 3, body: '남은 답글' })] }),
  ] } });
  renderIt();
  expect(await screen.findByText('3쪽 값이 모델과 다름')).toBeInTheDocument();
  expect(screen.getByText('열린 이슈 1')).toBeInTheDocument();
  expect(screen.getByText('열린 이슈')).toBeInTheDocument();          // 칩
  expect(screen.getByText('삭제된 글입니다.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '해결됨으로 표시' })).toBeInTheDocument();
  // 고치기와 지우기는 내 답글에만
  expect(screen.getAllByRole('button', { name: '고치기' })).toHaveLength(1);
  // 삭제 표시에는 답글 단추가 없다(첫 글에만)
  expect(screen.getAllByRole('button', { name: '답글' })).toHaveLength(1);
});

test('이슈로 올리면 kind=issue 로 보내고 목록을 다시 읽는다', async () => {
  let n = 0;
  const fetch = mockApi({
    [`GET ${URL}`]: () => (n++ === 0 ? { total: 0, open_issues: 0, can_comment: true, items: [] }
      : { total: 1, open_issues: 1, can_comment: true, items: [item({ kind: 'issue', status: 'open', body: '고칠 점' })] }),
    [`POST ${URL}`]: (init) => ({ ...item(), ...JSON.parse(init.body) }),
  });
  renderIt();
  expect(await screen.findByText('아직 의견이 없습니다.')).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole('radio', { name: '이슈' }));
  const box = screen.getByRole('textbox');
  expect(screen.getByRole('button', { name: '올리기' })).toBeDisabled();
  await user.type(box, '  고칠 점  ');
  await user.click(screen.getByRole('button', { name: '올리기' }));
  await waitFor(() => expect(calls(fetch)).toContain(`POST ${URL}`));
  const sent = fetch.mock.calls.find(([u, i]) => u === URL && i?.method === 'POST')[1];
  expect(JSON.parse(sent.body)).toEqual({ body: '고칠 점', kind: 'issue' });
  expect(await screen.findByText('고칠 점')).toBeInTheDocument();
  expect(box).toHaveValue('');
});

test('해결됨으로 표시 — POST resolve', async () => {
  const fetch = mockApi({
    [`GET ${URL}`]: { total: 1, open_issues: 1, can_comment: true, items: [item({ kind: 'issue', status: 'open', can_resolve: true })] },
    'POST /api/comments/1/resolve': item({ kind: 'issue', status: 'resolved' }),
  });
  renderIt();
  await userEvent.click(await screen.findByRole('button', { name: '해결됨으로 표시' }));
  await waitFor(() => expect(calls(fetch)).toContain('POST /api/comments/1/resolve'));
});

test('2000자를 넘으면 올리기를 막는다', async () => {
  mockApi({ [`GET ${URL}`]: { total: 0, open_issues: 0, can_comment: true, items: [] } });
  renderIt();
  const box = await screen.findByRole('textbox');
  await userEvent.click(box);
  await userEvent.paste('가'.repeat(2001));
  expect(screen.getByText(/2000자를 넘었습니다/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '올리기' })).toBeDisabled();
});

test('쓸 수 없는 자료(휴지통)는 입력칸 없이 안내만, 초안은 구역을 그리지 않는다', async () => {
  mockApi({ [`GET ${URL}`]: { total: 0, open_issues: 0, can_comment: false, items: [] } });
  const { unmount } = renderIt('trashed');
  expect(await screen.findByText('휴지통에 있는 자료라 의견을 쓸 수 없습니다.')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  unmount();
  renderIt('draft');
  expect(screen.queryByRole('region', { name: '의견과 이슈' })).not.toBeInTheDocument();
});

test('새 의견 화면 — 목록을 보이고 읽음 표시를 보낸다', async () => {
  const fetch = mockApi({
    'GET /api/me/comments?limit=100': { unread: 1, seen_at: null, items: [
      { id: 5, kind: 'issue', status: 'open', body: '하중 조건 확인 필요', author: author('B2', '동료'), created_at: '2026-11-19T09:00:00',
        entry: { entry_id: 'E000001', title: '계류 검토' }, reply_to_me: false, is_new: true },
      { id: 6, kind: 'comment', status: null, body: '답글입니다', author: author('C3', '손님'), created_at: '2026-11-18T09:00:00',
        entry: { entry_id: 'E000002', title: '권상 검토' }, reply_to_me: true, is_new: false },
    ] },
    'POST /api/me/comments/seen': { seen_at: '2026-11-19T10:00:00' },
  });
  const seen = vi.fn();
  window.addEventListener('logbook:comments-seen', seen);
  render(<MemoryRouter><CommentsPage /></MemoryRouter>);
  const list = await screen.findByRole('list', { name: '받은 의견' });
  expect(within(list).getByText('하중 조건 확인 필요')).toBeInTheDocument();
  expect(within(list).getByText('내 글에 답글')).toBeInTheDocument();
  expect(within(list).getByRole('link', { name: /계류 검토/ })).toHaveAttribute('href', '/e/E000001');
  expect(screen.getByText(/새로 온 글/)).toBeInTheDocument();
  await waitFor(() => expect(calls(fetch)).toContain('POST /api/me/comments/seen'));
  await waitFor(() => expect(seen).toHaveBeenCalled());
  window.removeEventListener('logbook:comments-seen', seen);
});

test('속성 칸 링크 — 의견 수와 열린 이슈를 받아 보이고, 누르면 의견 구역으로 내려간다', async () => {
  mockApi({ [`GET ${URL}`]: { total: 3, open_issues: 1, can_comment: true, items: [item({ kind: 'issue', status: 'open' })] } });
  function Both() {
    const [counts, setCounts] = useState(null);
    return <MemoryRouter><CommentsLink counts={counts} /><EntryComments entryId="E000001" status="confirmed" onCounts={setCounts} /></MemoryRouter>;
  }
  render(<Both />);
  const link = await screen.findByRole('button', { name: /의견 3/ });
  expect(link).toHaveTextContent('열린 이슈 1');
  const section = screen.getByRole('region', { name: '의견과 이슈' });
  section.scrollIntoView = vi.fn();
  await userEvent.click(link);
  expect(section.scrollIntoView).toHaveBeenCalled();
  expect(section).toHaveFocus();
});

test('의견이 없으면 링크는 "의견 남기기"', () => {
  render(<CommentsLink counts={{ total: 0, open_issues: 0 }} />);
  expect(screen.getByRole('button', { name: '의견 남기기' })).toBeInTheDocument();
});
