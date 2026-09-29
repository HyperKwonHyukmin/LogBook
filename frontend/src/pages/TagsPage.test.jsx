import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { calls, mockApi } from '../test/mockApi.js';
import TagsPage from './TagsPage.jsx';

const ZONES = [
  { id: 1, kind: 'zone', value: '선수부', alias_of: null, count: 2 },
  { id: 2, kind: 'zone', value: 'FWD', alias_of: { id: 1, value: '선수부' }, count: 1 },
  { id: 3, kind: 'zone', value: '선미부', alias_of: null, count: 0 },
];

function renderPage(map) {
  const fetch = mockApi(map);
  render(<MemoryRouter><TagsPage /></MemoryRouter>);
  return fetch;
}

test('대표 아래 동의어를 보이고, 풀 수 있다', async () => {
  const fetch = renderPage({ 'GET /api/tags?kind=zone': ZONES, 'DELETE /api/tags/2/alias': { ...ZONES[1], alias_of: null } });
  const group = (await screen.findByText('선수부')).closest('li');
  expect(within(group).getByText('FWD')).toBeInTheDocument();
  await userEvent.click(within(group).getByRole('button', { name: 'FWD 풀기' }));
  expect(calls(fetch).filter((c) => c === 'GET /api/tags?kind=zone')).toHaveLength(2);
  expect(calls(fetch)).toContain('DELETE /api/tags/2/alias');
});

test('다른 대표 태그의 동의어로 묶는다', async () => {
  const fetch = renderPage({ 'GET /api/tags?kind=zone': ZONES, 'POST /api/tags/3/alias': { ...ZONES[2], alias_of: { id: 1, value: '선수부' } } });
  const row = (await screen.findByText('선미부')).closest('li');
  await userEvent.click(within(row).getByRole('button', { name: '동의어로 묶기' }));
  await userEvent.selectOptions(within(row).getByRole('combobox', { name: '대표 태그' }), '1');
  await userEvent.click(within(row).getByRole('button', { name: '묶기' }));
  const post = fetch.mock.calls.find(([u, i]) => i?.method === 'POST');
  expect(JSON.parse(post[1].body)).toEqual({ target_id: 1 });
});

test('탭으로 자유 태그를 보고, 거르기로 좁힌다', async () => {
  renderPage({ 'GET /api/tags?kind=zone': ZONES, 'GET /api/tags?kind=free': [{ id: 9, kind: 'free', value: '계류', alias_of: null, count: 3 }] });
  await screen.findByText('선수부');
  await userEvent.type(screen.getByRole('searchbox', { name: '태그 거르기' }), 'fw');
  expect(screen.getByText('선수부')).toBeInTheDocument();
  expect(screen.queryByText('선미부')).toBeNull();
  await userEvent.click(screen.getByRole('tab', { name: '자유 태그' }));
  expect(await screen.findByText('계류')).toBeInTheDocument();
});

test('묶기 오류를 보인다', async () => {
  renderPage({ 'GET /api/tags?kind=zone': ZONES, 'POST /api/tags/3/alias': { __status: 422, detail: 'same_tag' } });
  const row = (await screen.findByText('선미부')).closest('li');
  await userEvent.click(within(row).getByRole('button', { name: '동의어로 묶기' }));
  await userEvent.selectOptions(within(row).getByRole('combobox', { name: '대표 태그' }), '1');
  await userEvent.click(within(row).getByRole('button', { name: '묶기' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('자기 자신이나');
});
