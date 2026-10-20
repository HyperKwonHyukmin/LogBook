import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { invalidateVocab } from '../../lib/vocab.js';
import { mockApi } from '../../test/mockApi.js';
import WbRulesPage from './WbRulesPage.jsx';

const ZONE = { kind: 'zone', other: '기타', terms: [
  { id: 5, value: '선수부', active: true, count: 0, synonyms: [{ id: 9, value: 'FWD' }] },
  { id: 6, value: '선미부', active: true, count: 0, synonyms: [] },
] };
const LIST = [
  { target: 'gmu', label: 'Group & Module Unit 권상 구조 해석', zones: [], tags: [], condition: null, reason: null,
    updated_by: null, updated_at: null },
  { target: 'truss', label: 'Truss Structural Assessment', zones: [], tags: ['Truss'],
    condition: "태그 'Truss' 가 붙은 자료만 보낼 수 있습니다", reason: 'x', updated_by: 'system', updated_at: '2026-10-08T09:00:00' },
];

beforeEach(() => invalidateVocab());

function renderPage(map = {}) {
  const fetch = mockApi({ 'GET /api/admin/wb-targets': LIST, 'GET /api/vocab?kind=zone': ZONE,
                          'GET /api/suggest?kind=tag&q=Frame': [], ...map });
  render(<MemoryRouter><WbRulesPage /></MemoryRouter>);
  return fetch;
}

test('대상마다 카드 — 이름·현재 태그·설명', async () => {
  renderPage();
  const truss = await screen.findByRole('region', { name: 'Truss Structural Assessment' });
  expect(within(truss).getByText('Truss')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Group & Module Unit 권상 구조 해석' })).toBeInTheDocument();
  expect(screen.getAllByText(/하나라도 맞으면 보낼 수 있습니다\. 비워 두면 제한하지 않습니다\./)).toHaveLength(2);
  // 바꾸지 않았으면 저장 단추는 잠겨 있다
  expect(within(truss).getByRole('button', { name: 'Truss Structural Assessment 규칙 저장' })).toBeDisabled();
});

test('구역을 고르고 태그를 바꿔 저장한다 — PUT 본문과 결과 안내', async () => {
  const fetch = renderPage({
    'PUT /api/admin/wb-targets/truss': { target: 'truss', label: 'Truss Structural Assessment', zones: ['선수부'],
      tags: ['Frame'], condition: "구역 '선수부' 또는 태그 'Frame' 가 붙은 자료만 보낼 수 있습니다", reason: 'y' },
  });
  const truss = await screen.findByRole('region', { name: 'Truss Structural Assessment' });
  await userEvent.click(within(truss).getByRole('button', { name: 'Truss 빼기' }));
  await userEvent.type(within(truss).getByRole('combobox', { name: 'Truss Structural Assessment 필요한 태그' }), 'Frame{Enter}');
  const zone = within(truss).getByRole('combobox', { name: 'Truss Structural Assessment 필요한 구역' });
  await userEvent.click(zone);
  await userEvent.type(zone, 'fwd');
  await userEvent.click(await screen.findByRole('option', { name: /선수부/ }));
  await userEvent.click(within(truss).getByRole('button', { name: 'Truss Structural Assessment 규칙 저장' }));
  await waitFor(() => {
    const put = fetch.mock.calls.find(([u, i = {}]) => u === '/api/admin/wb-targets/truss' && i.method === 'PUT');
    expect(JSON.parse(put[1].body)).toEqual({ zones: ['선수부'], targets: [], tags: ['Frame'] });
  });
  expect(await within(truss).findByText(/저장했습니다 — 구역 '선수부' 또는 태그 'Frame'/)).toBeInTheDocument();
});

test('서버가 거절하면 사유를 보인다', async () => {
  renderPage({ 'PUT /api/admin/wb-targets/gmu': { __status: 422, detail: 'zone_not_listed' } });
  const gmu = await screen.findByRole('region', { name: 'Group & Module Unit 권상 구조 해석' });
  await userEvent.type(within(gmu).getByRole('combobox', { name: 'Group & Module Unit 권상 구조 해석 필요한 태그' }), 'Frame{Enter}');
  await userEvent.click(within(gmu).getByRole('button', { name: 'Group & Module Unit 권상 구조 해석 규칙 저장' }));
  expect(await within(gmu).findByRole('alert')).toHaveTextContent('구역 목록에 없는 값입니다');
});
