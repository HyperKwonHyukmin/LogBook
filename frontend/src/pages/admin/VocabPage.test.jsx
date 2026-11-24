import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { calls, mockApi } from '../../test/mockApi.js';
import VocabPage from './VocabPage.jsx';

// 42 — 분류 목록은 구역·대상 두 가지(해석 종류는 없앴다). 첫 탭은 구역
const ZONE = { kind: 'zone', other: '기타', terms: [
  { id: 1, value: '선수부', active: true, count: 3, synonyms: [] },
  { id: 2, value: '선미부', active: true, count: 2, synonyms: [{ id: 10, value: 'AFT' }] },
  { id: 3, value: '기타', active: true, count: 0, synonyms: [] },
] };
const OUT = [{ value: '선수 구역', count: 2 }];

function renderPage(map) {
  const fetch = mockApi({ 'GET /api/vocab?kind=zone': ZONE, 'GET /api/vocab/unlisted?kind=zone': OUT, ...map });
  render(<MemoryRouter><VocabPage /></MemoryRouter>);
  return fetch;
}
const bodyOf = (fetch, method, url) => JSON.parse(fetch.mock.calls.find(([u, i = {}]) => u === url && i.method === method)[1].body);

test('용어·동의어·건수와 목록 밖 값을 보인다 — 탭은 구역·대상뿐', async () => {
  const fetch = renderPage({});
  const terms = await screen.findByRole('region', { name: '구역 용어' });
  expect(await within(terms).findByText('AFT')).toBeInTheDocument();
  const outside = screen.getByRole('region', { name: '목록 밖 값' });
  expect(within(outside).getByText('선수 구역')).toBeInTheDocument();
  const tabs = screen.getByRole('tablist', { name: '분류 종류' });
  expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['구역', '대상']);
  expect(screen.queryByText('해석 종류')).toBeNull();
  expect(calls(fetch).some((c) => c.includes('kind=atype'))).toBe(false);
});

test('목록 밖 값을 용어로 합친다 — 결과를 알린다', async () => {
  const fetch = renderPage({ 'POST /api/vocab/terms/1/merge': { term: '선수부', value: '선수 구역', entries: ['E000001', 'E000002'] } });
  const row = (await screen.findByText('선수 구역')).closest('li');
  await userEvent.selectOptions(within(row).getByRole('combobox', { name: '선수 구역 합칠 용어' }), '1');
  await userEvent.click(within(row).getByRole('button', { name: /선수부 로 합치기/ }));
  expect(bodyOf(fetch, 'POST', '/api/vocab/terms/1/merge')).toEqual({ value: '선수 구역' });
  expect(await screen.findByText(/Entry 2건의 값을 바꿨습니다/)).toBeInTheDocument();
  expect(calls(fetch).filter((c) => c === 'GET /api/vocab/unlisted?kind=zone')).toHaveLength(2);
});

test('용어 추가·순서·사용 중지·동의어 추가와 빼기', async () => {
  const fetch = renderPage({
    'POST /api/vocab/terms': { id: 7, kind: 'zone', value: '기관실', active: true },
    'POST /api/vocab/reorder': { ok: true },
    'PATCH /api/vocab/terms/1': { id: 1, kind: 'zone', value: '선수부', active: false },
    'POST /api/vocab/terms/1/synonyms': { term: '선수부', value: 'FWD', entries: [] },
    'DELETE /api/vocab/synonyms/10': { ok: true },
  });
  await userEvent.type(await screen.findByRole('textbox', { name: '새 구역 용어' }), '기관실');
  await userEvent.click(screen.getByRole('button', { name: '추가' }));
  expect(bodyOf(fetch, 'POST', '/api/vocab/terms')).toEqual({ kind: 'zone', value: '기관실' });

  await userEvent.click(await screen.findByRole('button', { name: '선미부 위로' }));
  await waitFor(() => expect(bodyOf(fetch, 'POST', '/api/vocab/reorder')).toEqual({ kind: 'zone', ids: [2, 1, 3] }));

  await userEvent.click(screen.getByRole('button', { name: '선수부 사용 중지' }));
  await waitFor(() => expect(bodyOf(fetch, 'PATCH', '/api/vocab/terms/1')).toEqual({ active: false }));

  await userEvent.click(screen.getByRole('button', { name: '선수부 동의어 추가' }));
  await userEvent.type(screen.getByRole('textbox', { name: '선수부 의 새 동의어' }), 'FWD{Enter}');
  await waitFor(() => expect(bodyOf(fetch, 'POST', '/api/vocab/terms/1/synonyms')).toEqual({ value: 'FWD' }));

  await userEvent.click(screen.getByRole('button', { name: '동의어 AFT 빼기' }));
  await waitFor(() => expect(calls(fetch)).toContain('DELETE /api/vocab/synonyms/10'));
});

test('42 — 이름을 바꾸면 쓰는 자료에 함께 반영됐다고 알린다', async () => {
  const fetch = renderPage({ 'PATCH /api/vocab/terms/1': { id: 1, kind: 'zone', value: '선수 구역부', active: true } });
  await screen.findByRole('region', { name: '구역 용어' });
  expect(screen.getByText(/이름을 바꾸면 그 용어를 쓰는 자료 전부에 함께 반영됩니다/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /선수부 이름/ }));
  const box = screen.getByRole('textbox', { name: /선수부 이름/ });
  await userEvent.clear(box);
  await userEvent.type(box, '선수 구역부{Enter}');
  await waitFor(() => expect(bodyOf(fetch, 'PATCH', '/api/vocab/terms/1')).toEqual({ value: '선수 구역부' }));
  expect(await screen.findByText(/쓰는 자료 3건에 함께 반영했습니다/)).toBeInTheDocument();
});

test('42 — 지우기: 확인 창에 쓰는 자료 수를 보이고, 확인하면 DELETE 후 다시 읽는다', async () => {
  const fetch = renderPage({ 'DELETE /api/vocab/terms/2': { value: '선미부', entries: ['E000003', 'E000004'] } });
  await screen.findByRole('region', { name: '구역 용어' });
  // 취소하면 보내지 않는다
  await userEvent.click(screen.getByRole('button', { name: '선미부 지우기' }));
  let dialog = screen.getByRole('alertdialog');
  expect(dialog).toHaveTextContent('이 값을 쓰는 자료 2건에서 함께 빠집니다');
  expect(dialog).not.toHaveTextContent('보완 필요');   // 43 — 구역·대상은 선택 칸
  expect(dialog).toHaveTextContent('동의어 1개도 함께 지웁니다');
  await userEvent.click(within(dialog).getByRole('button', { name: '취소' }));
  expect(calls(fetch)).not.toContain('DELETE /api/vocab/terms/2');
  // 확인하면 DELETE → 목록 다시 읽기 → 결과 안내
  await userEvent.click(screen.getByRole('button', { name: '선미부 지우기' }));
  dialog = screen.getByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('button', { name: '지우기' }));
  await waitFor(() => expect(calls(fetch)).toContain('DELETE /api/vocab/terms/2'));
  expect(await screen.findByText(/‘선미부’ 를 목록에서 지웠습니다. 자료 2건에서 값을 뺐습니다./)).toBeInTheDocument();
  expect(calls(fetch).filter((c) => c === 'GET /api/vocab?kind=zone')).toHaveLength(2);
});

test('오류를 보인다', async () => {
  renderPage({ 'POST /api/vocab/terms': { __status: 409, detail: 'vocab_is_synonym' } });
  await userEvent.type(await screen.findByRole('textbox', { name: '새 구역 용어' }), 'AFT');
  await userEvent.click(screen.getByRole('button', { name: '추가' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('다른 용어의 동의어');
});

test('71 — 대상 탭: 묶음을 고르면 parent 를 보내고, 하위가 있는 용어와 기타는 고르기 칸이 없다', async () => {
  const TARGET = { kind: 'target', other: '기타', terms: [
    { id: 21, value: '배관', active: true, count: 1, synonyms: [], parent: null, children: ['Manifold'] },
    { id: 22, value: 'Manifold', active: true, count: 20, synonyms: [], parent: '배관', children: [] },
    { id: 23, value: 'Pipe', active: true, count: 2, synonyms: [], parent: null, children: [] },
    { id: 24, value: '기타', active: true, count: 11, synonyms: [], parent: null, children: [] },
  ] };
  const fetch = renderPage({ 'GET /api/vocab?kind=target': TARGET, 'GET /api/vocab/unlisted?kind=target': [],
    'PATCH /api/vocab/terms/23': { id: 23, kind: 'target', value: 'Pipe', active: true } });
  await userEvent.click(await screen.findByRole('tab', { name: '대상' }));
  const terms = await screen.findByRole('region', { name: '대상 용어' });
  await within(terms).findByRole('combobox', { name: 'Pipe 묶음' });
  expect(within(terms).getByTitle('Manifold')).toHaveTextContent('묶음, 하위 1');
  expect(within(terms).queryByRole('combobox', { name: '배관 묶음' })).toBeNull();
  expect(within(terms).queryByRole('combobox', { name: '기타 묶음' })).toBeNull();
  const pick = within(terms).getByRole('combobox', { name: 'Pipe 묶음' });
  expect(within(pick).getAllByRole('option').map((o) => o.textContent)).toEqual(['묶음 없음', '배관']);   // 묶음에 든 용어와 기타는 묶음 후보가 아니다
  expect(within(terms).getByRole('combobox', { name: 'Manifold 묶음' })).toHaveValue('배관');
  await userEvent.selectOptions(pick, '배관');
  await waitFor(() => expect(bodyOf(fetch, 'PATCH', '/api/vocab/terms/23')).toEqual({ parent: '배관' }));
  expect(await screen.findByText(/‘배관’ 로 거르면 ‘Pipe’ 자료도 함께 나옵니다/)).toBeInTheDocument();
});
