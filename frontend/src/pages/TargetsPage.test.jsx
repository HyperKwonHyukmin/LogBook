import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TargetsPage from './TargetsPage.jsx';
import TargetPage from './TargetPage.jsx';

function stub(map) {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const body = map[url];
    if (body === undefined) throw new Error(`unexpected ${url}`);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  }));
}
const at = (path, el) => render(<MemoryRouter initialEntries={[path]}><Routes>
  <Route path="/targets" element={<TargetsPage />} /><Route path="/t/:value" element={<TargetPage />} /></Routes></MemoryRouter>);

test('69 — 업무 카드 목록: 건수와 호선 수, 기타는 검색으로 보낸다', async () => {
  stub({ '/api/targets': { targets: [
    { value: 'Unit', entries: 44, hulls: 15, latest: '2026-11-20T10:00:00', thumb: null, other: false },
    { value: '기타', entries: 11, hulls: 6, latest: null, thumb: null, other: true }] } });
  at('/targets');
  const unit = await screen.findByRole('link', { name: /Unit/ });
  expect(unit).toHaveAttribute('href', '/t/Unit');
  expect(unit).toHaveTextContent('자료 44건, 호선 15척');
  expect(screen.getByRole('link', { name: /기타/ }).getAttribute('href')).toMatch(/target=/);
  vi.unstubAllGlobals();
});

const row = (id, o = {}) => ({ entry_id: id, title: `${id} 제목`, posted_at: '2026-11-01T00:00:00', hulls: ['3496'], ship_types: ['LNGC'],
  assignees: [{ name: '구조가', employed: true }], conclusion: null, reviewed: false, kind_counts: { model: 1, report: 1 },
  thumb: null, cover: null, no_hull: false, elements: 100, solve: 'pass', ...o });

test('69 — 대상 화면: 처음이면 여기부터, 기초 자료, 실적, 담당자, 빈 곳(결론 모음은 결론이 있을 때만)', async () => {
  stub({ '/api/targets/page?value=Unit': {
    value: 'Unit', synonyms: ['GMU'], other: false, counts: { entries: 3, hulls: 2, assignees: 1, latest: '2026-11-01T00:00:00' },
    start: [row('E000001')], base_docs: [row('E000003', { no_hull: true, hulls: [], title: '권상 지침' })], conclusions: [],
    records: [row('E000001'), row('E000002')], models: [],
    people: [{ id: 7, name: '구조가', employed: true, count: 2 }],
    gaps: { no_conclusion: { count: 3, items: [{ entry_id: 'E000001', title: 't' }] }, no_report: { count: 0, items: [] }, no_model: { count: 0, items: [] } } } });
  at('/t/Unit');
  expect(await screen.findByRole('heading', { name: 'Unit' })).toBeInTheDocument();
  expect(screen.getByText(/같은 말: GMU/)).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: '처음이면 여기부터' })).getByRole('link', { name: 'E000001 제목' })).toHaveAttribute('href', '/e/E000001');
  expect(within(screen.getByRole('region', { name: '기초 자료와 참고 문서' })).getByText('권상 지침')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '결론과 주의점' })).toBeNull();
  expect(within(screen.getByRole('region', { name: '실적' })).getAllByText('검증 통과')).toHaveLength(2);
  expect(within(screen.getByRole('region', { name: '누구에게 물을까' })).getByRole('link', { name: /구조가/ })).toHaveAttribute('href', '/p/7');
  expect(within(screen.getByRole('region', { name: '빈 곳' })).getByText(/결론 없음/)).toHaveTextContent('결론 없음 3건');
  expect(document.title).toMatch(/^Unit 업무/);
  vi.unstubAllGlobals();
});
