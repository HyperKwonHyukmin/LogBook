import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { mockApi } from '../../test/mockApi.js';
import TeamsPage from './TeamsPage.jsx';

const PIPE = { id: 3, name: '배관해석', description: 'CAESAR II', entries: 2, created_by: 'A1', created_at: '2026-11-25T10:00:00',
  members: [{ employee_id: 'T1', name: '배관 하나', department: '선장설계부', wb_active: true, added_at: '2026-11-25T10:00:00' }] };
const EMPTY = { id: 4, name: '다른팀', description: null, entries: 0, members: [] };

function renderPage(map = {}) {
  const fetch = mockApi({ 'GET /api/admin/teams': [PIPE, EMPTY], ...map });
  render(<MemoryRouter><TeamsPage /></MemoryRouter>);
  return fetch;
}

test('팀마다 카드 — 팀원과 자료 수, 팀 자료가 있으면 지우기 잠김', async () => {
  renderPage();
  const pipe = await screen.findByRole('region', { name: '배관해석 팀' });
  expect(within(pipe).getByText('배관 하나')).toBeInTheDocument();
  expect(within(pipe).getByText('T1')).toBeInTheDocument();
  expect(within(pipe).getByRole('button', { name: '배관해석 팀 지우기' })).toBeDisabled();
  const other = screen.getByRole('region', { name: '다른팀 팀' });
  expect(within(other).getByText('아직 팀원이 없습니다.')).toBeInTheDocument();
  expect(within(other).getByRole('button', { name: '다른팀 팀 지우기' })).toBeEnabled();
});

test('팀원 넣기 — 쉼표와 띄어쓰기로 여러 명, 서버 오류 문구', async () => {
  const fetch = renderPage({
    'POST /api/admin/teams/4/members': (init) => {
      const ids = JSON.parse(init.body).employee_ids;
      if (ids.includes('T1')) return { __status: 409, detail: 'member_in_other_team' };
      return { ...EMPTY, members: ids.map((e) => ({ employee_id: e, name: e, wb_active: true })) };
    },
  });
  const other = await screen.findByRole('region', { name: '다른팀 팀' });
  const box = within(other).getByRole('textbox', { name: '다른팀 팀원 사번' });
  await userEvent.type(box, 'T1');
  await userEvent.click(within(other).getByRole('button', { name: '팀원 넣기' }));
  expect(await within(other).findByText(/이미 다른 팀에 속한 사람입니다/)).toBeInTheDocument();
  await userEvent.clear(box);
  await userEvent.type(box, 'X1, X2 X3');
  await userEvent.click(within(other).getByRole('button', { name: '팀원 넣기' }));
  expect(await within(other).findAllByText('X3', { selector: 'td' })).toHaveLength(2);   // 이름 칸과 사번 칸
  const body = JSON.parse(fetch.mock.calls.filter(([u, i]) => u === '/api/admin/teams/4/members' && i?.method === 'POST').at(-1)[1].body);
  expect(body).toEqual({ employee_ids: ['X1', 'X2', 'X3'] });
});

test('새 팀 만들기', async () => {
  renderPage({ 'POST /api/admin/teams': { id: 5, name: '새팀', description: null, entries: 0, members: [] } });
  await screen.findByRole('region', { name: '배관해석 팀' });
  await userEvent.type(screen.getByRole('textbox', { name: '새 팀 이름' }), '새팀');
  await userEvent.click(screen.getByRole('button', { name: '만들기' }));
  expect(await screen.findByRole('region', { name: '새팀 팀' })).toBeInTheDocument();
  expect(screen.getByText(/'새팀' 팀을 만들었습니다/)).toBeInTheDocument();
});
