import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { calls, mockApi } from '../../test/mockApi.js';
import VocabPage from './VocabPage.jsx';

const ATYPE = { kind: 'atype', other: '기타', terms: [
  { id: 1, value: '강도 평가', active: true, count: 3, synonyms: [] },
  { id: 2, value: 'FE 해석', active: true, count: 2, synonyms: [{ id: 10, value: 'FEM 해석' }] },
  { id: 3, value: '기타', active: true, count: 0, synonyms: [] },
] };
const OUT = [{ value: '구조강도', count: 2 }];

function renderPage(map) {
  const fetch = mockApi({ 'GET /api/vocab?kind=atype': ATYPE, 'GET /api/vocab/unlisted?kind=atype': OUT, ...map });
  render(<MemoryRouter><VocabPage /></MemoryRouter>);
  return fetch;
}
const bodyOf = (fetch, method, url) => JSON.parse(fetch.mock.calls.find(([u, i = {}]) => u === url && i.method === method)[1].body);

test('용어·동의어·건수와 목록 밖 값을 보인다', async () => {
  renderPage({});
  const terms = await screen.findByRole('region', { name: '해석 종류 용어' });
  expect(await within(terms).findByText('FEM 해석')).toBeInTheDocument();
  const outside = screen.getByRole('region', { name: '목록 밖 값' });
  expect(within(outside).getByText('구조강도')).toBeInTheDocument();
});

test('목록 밖 값을 용어로 합친다 — 결과를 알린다', async () => {
  const fetch = renderPage({ 'POST /api/vocab/terms/1/merge': { term: '강도 평가', value: '구조강도', entries: ['E000001', 'E000002'] } });
  const row = (await screen.findByText('구조강도')).closest('li');
  await userEvent.selectOptions(within(row).getByRole('combobox', { name: '구조강도 합칠 용어' }), '1');
  await userEvent.click(within(row).getByRole('button', { name: /강도 평가 로 합치기/ }));
  expect(bodyOf(fetch, 'POST', '/api/vocab/terms/1/merge')).toEqual({ value: '구조강도' });
  expect(await screen.findByText(/Entry 2건의 값을 바꿨습니다/)).toBeInTheDocument();
  expect(calls(fetch).filter((c) => c === 'GET /api/vocab/unlisted?kind=atype')).toHaveLength(2);
});

test('용어 추가·순서·사용 중지·동의어 추가와 빼기', async () => {
  const fetch = renderPage({
    'POST /api/vocab/terms': { id: 7, kind: 'atype', value: '충돌 해석', active: true },
    'POST /api/vocab/reorder': { ok: true },
    'PATCH /api/vocab/terms/1': { id: 1, kind: 'atype', value: '강도 평가', active: false },
    'POST /api/vocab/terms/1/synonyms': { term: '강도 평가', value: '강도해석', entries: [] },
    'DELETE /api/vocab/synonyms/10': { ok: true },
  });
  await userEvent.type(await screen.findByRole('textbox', { name: '새 해석 종류 용어' }), '충돌 해석');
  await userEvent.click(screen.getByRole('button', { name: '추가' }));
  expect(bodyOf(fetch, 'POST', '/api/vocab/terms')).toEqual({ kind: 'atype', value: '충돌 해석' });

  await userEvent.click(await screen.findByRole('button', { name: 'FE 해석 위로' }));
  await waitFor(() => expect(bodyOf(fetch, 'POST', '/api/vocab/reorder')).toEqual({ kind: 'atype', ids: [2, 1, 3] }));

  await userEvent.click(screen.getByRole('button', { name: '강도 평가 사용 중지' }));
  await waitFor(() => expect(bodyOf(fetch, 'PATCH', '/api/vocab/terms/1')).toEqual({ active: false }));

  await userEvent.click(screen.getByRole('button', { name: '강도 평가 동의어 추가' }));
  await userEvent.type(screen.getByRole('textbox', { name: '강도 평가 의 새 동의어' }), '강도해석{Enter}');
  await waitFor(() => expect(bodyOf(fetch, 'POST', '/api/vocab/terms/1/synonyms')).toEqual({ value: '강도해석' }));

  await userEvent.click(screen.getByRole('button', { name: '동의어 FEM 해석 빼기' }));
  await waitFor(() => expect(calls(fetch)).toContain('DELETE /api/vocab/synonyms/10'));
});

test('오류를 보인다', async () => {
  renderPage({ 'POST /api/vocab/terms': { __status: 409, detail: 'vocab_is_synonym' } });
  await userEvent.type(await screen.findByRole('textbox', { name: '새 해석 종류 용어' }), 'FEM');
  await userEvent.click(screen.getByRole('button', { name: '추가' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('다른 용어의 동의어');
});
