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
  expect(months).toEqual(['2026년 9월', '2026년 8월']);
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

test('타임라인 행의 별은 서버 값을 보이고, 눌러도 상세로 가지 않는다(10)', async () => {
  const hull = { ...HULL, timeline: HULL.timeline.map((m) => ({ ...m, entries: m.entries.map((e) => ({ ...e, favorite: e.entry_id === 'E000001' })) })) };
  renderAt('/h/9999', { 'GET /api/hulls/9999': hull });
  const tl = await screen.findByRole('list', { name: '월별 타임라인' });
  const on = within(tl).getByRole('button', { name: '즐겨찾기 해제' });
  expect(on).toHaveAttribute('aria-pressed', 'true');
  const off = within(tl).getByRole('button', { name: '즐겨찾기 추가' });
  await userEvent.click(off);   // 공급자 없이 단독 렌더 — 이 단추 안에서만 바뀐다
  expect(within(tl).getAllByRole('button', { name: '즐겨찾기 해제' })).toHaveLength(2);
  expect(screen.getByRole('heading', { name: /9999/ })).toBeInTheDocument();   // 상세로 가지 않았다
});

// ---- 30 — 사내 PLM 선박 정보 ----

const PLM = { status: 'found', ship_type_raw: '174K-LNG', capacity: '174K', ship_kind: 'LNG', variant: null,
  main_engine: 'G70ME-C10.5-GA-EGRBP', ship_class: 'BV', delivery_date: '2025-02-28', delivered: true,
  checked_at: '2026-10-16T15:00:00' };

test('[선박 정보 검색] — PLM 값으로 선종과 선박 정보 줄을 채운다', async () => {
  renderAt('/h/9999', { 'GET /api/hulls/9999': HULL,
    'POST /api/hulls/9999/plm': { hull_no: '9999', ship_type: '174K LNG', memo: null, plm: PLM } });
  await userEvent.click(await screen.findByRole('button', { name: '선박 정보 검색' }));
  expect(await screen.findByText('174K LNG')).toBeInTheDocument();
  const line = screen.getByLabelText('PLM 선박 정보');
  expect(line).toHaveTextContent('G70ME-C10.5-GA-EGRBP');
  expect(line).toHaveTextContent('BV');
  expect(line).toHaveTextContent('2025-02-28');
  expect(line).not.toHaveTextContent('미인도');
});

test('[선박 정보 검색] — PLM 에 없거나 접속하지 못하면 이유를 보인다', async () => {
  renderAt('/h/9999', { 'GET /api/hulls/9999': HULL,
    'POST /api/hulls/9999/plm': { __status: 503, detail: 'plm_not_configured' } });
  await userEvent.click(await screen.findByRole('button', { name: '선박 정보 검색' }));
  expect(await screen.findByText(/PLM 접속 정보가 설정되지 않았습니다/)).toBeInTheDocument();
});

test('호선 목록 [선종 채우기(PLM)] — 한 번에 조회하고 목록을 다시 읽는다', async () => {
  let n = 0;
  const fetch = (() => {
    const rows = () => (n === 0
      ? [{ hull_no: '9999', ship_type: null, plm_status: null, entries: 2, last_at: '2026-09-05T00:00:00' }]
      : [{ hull_no: '9999', ship_type: '174K LNG', plm_status: 'found', entries: 2, last_at: '2026-09-05T00:00:00' }]);
    return { 'GET /api/hulls?q=': rows,
      'POST /api/hulls/plm-fill': () => { n += 1; return { checked: 1, found: 1, not_found: 0, filled: 1 }; } };
  })();
  renderAt('/hulls', fetch);
  const btn = await screen.findByRole('button', { name: /선종 채우기\(PLM\)/ });
  expect(btn).toHaveTextContent('1');   // 선종이 빈 호선 수
  await userEvent.click(btn);
  expect(await screen.findByText('174K LNG')).toBeInTheDocument();
});
