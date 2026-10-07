import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { calls, mockApi } from '../test/mockApi.js';
import TagsPage from './TagsPage.jsx';

// 08 — 구역·해석 종류는 '분류 목록'(관리자)으로 옮겨, 태그 화면은 자유 태그만 다룬다.
const TAGS = [
  { id: 1, kind: 'free', value: '계류', alias_of: null, count: 2 },
  { id: 2, kind: 'free', value: 'Mooring', alias_of: { id: 1, value: '계류' }, count: 1 },
  { id: 3, kind: 'free', value: '피로', alias_of: null, count: 0 },
];

function renderPage(map) {
  const fetch = mockApi(map);
  render(<MemoryRouter><TagsPage /></MemoryRouter>);
  return fetch;
}

test('대표 아래 동의어를 보이고, 풀 수 있다', async () => {
  const fetch = renderPage({ 'GET /api/tags?kind=free': TAGS, 'DELETE /api/tags/2/alias': { ...TAGS[1], alias_of: null } });
  const group = (await screen.findByText('계류')).closest('li');
  expect(within(group).getByText('Mooring')).toBeInTheDocument();
  await userEvent.click(within(group).getByRole('button', { name: 'Mooring 풀기' }));
  expect(calls(fetch).filter((c) => c === 'GET /api/tags?kind=free')).toHaveLength(2);
  expect(calls(fetch)).toContain('DELETE /api/tags/2/alias');
});

test('다른 대표 태그의 동의어로 묶는다', async () => {
  const fetch = renderPage({ 'GET /api/tags?kind=free': TAGS, 'POST /api/tags/3/alias': { ...TAGS[2], alias_of: { id: 1, value: '계류' } } });
  const row = (await screen.findByText('피로')).closest('li');
  await userEvent.click(within(row).getByRole('button', { name: '동의어로 묶기' }));
  await userEvent.selectOptions(within(row).getByRole('combobox', { name: '대표 태그' }), '1');
  await userEvent.click(within(row).getByRole('button', { name: '묶기' }));
  const post = fetch.mock.calls.find(([, i]) => i?.method === 'POST');
  expect(JSON.parse(post[1].body)).toEqual({ target_id: 1 });
});

test('자유 태그만 보이고, 거르기로 좁히고, 값은 검색 링크다(08)', async () => {
  const fetch = renderPage({ 'GET /api/tags?kind=free': TAGS });
  await screen.findByText('계류');
  expect(screen.queryByRole('tab')).toBeNull();
  expect(screen.getByRole('link', { name: 'Mooring' })).toHaveAttribute('href', '/?tag=Mooring');
  await userEvent.type(screen.getByRole('searchbox', { name: '태그 거르기' }), 'moo');
  expect(screen.getByText('계류')).toBeInTheDocument();
  expect(screen.queryByText('피로')).toBeNull();
  expect(calls(fetch)).not.toContain('GET /api/tags?kind=zone');
});

test('묶기 오류를 보인다', async () => {
  renderPage({ 'GET /api/tags?kind=free': TAGS, 'POST /api/tags/3/alias': { __status: 422, detail: 'same_tag' } });
  const row = (await screen.findByText('피로')).closest('li');
  await userEvent.click(within(row).getByRole('button', { name: '동의어로 묶기' }));
  await userEvent.selectOptions(within(row).getByRole('combobox', { name: '대표 태그' }), '1');
  await userEvent.click(within(row).getByRole('button', { name: '묶기' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('자기 자신이나');
});
