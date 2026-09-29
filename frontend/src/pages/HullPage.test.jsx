import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { mockApi } from '../test/mockApi.js';
import HullPage from './HullPage.jsx';
import HullsPage from './HullsPage.jsx';

const HULL = { hull_no: '9999', ship_type: null, memo: null, drafts: 1,
  stats: { entries: 2, files: 3, kinds: { report: 2, model: 1 },
           analysis_types: [{ value: 'Mooring', count: 1 }, { value: 'Strength', count: 1 }],
           zones: [{ value: '선수부', count: 1 }], people: [{ employee_id: 'A100002', name: '김해석', count: 1 }] },
  timeline: [
    { month: '2026-09', entries: [{ entry_id: 'E000002', title: '갑판 강도', analysis_type: 'Strength', zones: [], uploaded_by: 'A100002', confirmed_at: '2026-09-05T00:00:00', kinds: ['report'] }] },
    { month: '2026-08', entries: [{ entry_id: 'E000001', title: '계류 검토', analysis_type: 'Mooring', zones: ['선수부'], uploaded_by: 'A100001', confirmed_at: '2026-09-02T00:00:00', kinds: ['model', 'report'] }] },
  ] };

function renderAt(url, map) {
  mockApi(map);
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/h/:hullNo" element={<HullPage />} /><Route path="/hulls" element={<HullsPage />} /></Routes>
    </MemoryRouter>,
  );
}

test('호선 화면 — 통계·타임라인·분포', async () => {
  renderAt('/h/9999', { 'GET /api/hulls/9999': HULL });
  expect(await screen.findByRole('heading', { name: /9999/ })).toBeInTheDocument();
  expect(screen.getByText('미확정 1건')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '이 호선 자료 검색' })).toHaveAttribute('href', '/?hull=9999');
  const tl = screen.getByRole('list', { name: '월별 타임라인' });
  const months = within(tl).getAllByRole('heading').map((h) => h.textContent);
  expect(months).toEqual(['2026-09', '2026-08']);
  expect(within(tl).getByRole('link', { name: '계류 검토' })).toHaveAttribute('href', '/e/E000001');
  expect(screen.getByRole('region', { name: '구역 분포' })).toHaveTextContent('선수부');
  expect(screen.getByRole('region', { name: '참여자' })).toHaveTextContent('김해석');
});

test('선종을 고친다', async () => {
  renderAt('/h/9999', { 'GET /api/hulls/9999': HULL,
    'PATCH /api/hulls/9999': (init) => ({ hull_no: '9999', memo: null, ...JSON.parse(init.body) }) });
  await userEvent.click(await screen.findByRole('button', { name: '선종 고치기' }));
  await userEvent.type(screen.getByRole('textbox', { name: '선종' }), 'LNGC{Enter}');
  expect(await screen.findByText('LNGC')).toBeInTheDocument();
});

test('없는 호선', async () => {
  renderAt('/h/1234', { 'GET /api/hulls/1234': { __status: 404, detail: 'hull_not_found' } });
  expect(await screen.findByText('등록된 호선이 아닙니다')).toBeInTheDocument();
});

test('호선 목록', async () => {
  renderAt('/hulls', { 'GET /api/hulls?q=': [{ hull_no: '9999', ship_type: 'LNGC', entries: 2, last_at: '2026-09-05T00:00:00' }] });
  const link = await screen.findByRole('link', { name: '9999' });
  expect(link).toHaveAttribute('href', '/h/9999');
  expect(screen.getByText('LNGC')).toBeInTheDocument();
});

test('호선 목록은 처음 불러오는 동안 자리 표시를 보인다', async () => {
  renderAt('/hulls', { 'GET /api/hulls?q=': () => new Promise(() => {}) });
  expect(screen.getByRole('status', { name: '호선 목록을 불러오는 중' })).toBeInTheDocument();
});

test('호선 번호는 주소에 넣을 때 인코딩한다', async () => {
  renderAt('/h/99%2099', { 'GET /api/hulls/99%2099': { __status: 404, detail: 'hull_not_found' } });
  expect(await screen.findByText('등록된 호선이 아닙니다')).toBeInTheDocument();
});
