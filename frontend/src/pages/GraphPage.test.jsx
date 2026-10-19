import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { mockApi } from '../test/mockApi.js';
import GraphPage from './GraphPage.jsx';

// 캔버스 엔진은 jsdom 에서 그릴 수 없다 — 페이지가 넘기는 값과 엔진 콜백만 확인한다
const engine = vi.hoisted(() => ({ last: null }));
vi.mock('../components/graph/graphView.js', () => ({
  GRAPH_COLORS: { accent: '#002554', warn: '#C2620E', doc: '#1F7A68' },
  createGraphView: (opts) => {
    const v = { opts, setModel: vi.fn(), setPivot: vi.fn(), setColor: vi.fn(), setOptions: vi.fn(), setSelection: vi.fn(),
      setHighlight: vi.fn(), fit: vi.fn(), destroy: vi.fn(),
      goTo: vi.fn((id) => opts.on.onSelect(id)) };
    engine.last = v;
    return v;
  },
}));
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ isAdmin: false }) }));

const DATA = {
  hulls: { 3370: '컨테이너선', 3508: '컨테이너선' },
  entries: [
    { id: 'E000001', title: '권상 A', analysis_type: '권상', confirmed_at: '2026-09', hulls: ['3370', '3508'], zones: [], free: [], files: 3,
      revisions: [{ name: 'a_r1.bdf', count: 2 }] },
    { id: 'E000002', title: '권상 B', analysis_type: '권상', confirmed_at: '2026-08', hulls: ['3508'], zones: [], free: [], files: 1, revisions: [] },
  ],
  pairs: [{ a: 'E000001', b: 'E000002', type: 'geom', differs: ['load'], files: ['a.bdf', 'b.bdf'], count: 1 }],
  unsigned_models: 3, truncated: false,
};

function renderPage(data = DATA) {
  mockApi({ 'GET /api/graph': data });
  render(<MemoryRouter><GraphPage /></MemoryRouter>);
}

test('지도와 호선 목록을 그리고 모델을 엔진에 넘긴다', async () => {
  renderPage();
  expect(await screen.findByRole('button', { name: /3370/ })).toBeInTheDocument();
  expect(engine.last.setModel).toHaveBeenCalledTimes(1);
  expect(engine.last.setModel.mock.calls[0][0].entries).toHaveLength(2);
  expect(screen.getByText('내용 서명이 없는 BDF 3개는 모델 관계에서 빠졌습니다')).toBeInTheDocument();
});

test('자료를 고르면 형상이 같은 자료·판·자료 열기가 나온다', async () => {
  renderPage();
  await screen.findByRole('button', { name: /3370/ });
  await userEvent.type(screen.getByRole('searchbox', { name: '지도에서 찾기' }), 'E000001{Enter}');
  const detail = await screen.findByRole('complementary', { name: '상세' });
  expect(within(detail).getByText('형상이 같은 자료')).toBeInTheDocument();
  expect(within(detail).getByText(/3508 · 하중만 다름/)).toBeInTheDocument();
  expect(within(detail).getByText('최신판 a_r1.bdf')).toBeInTheDocument();
  expect(within(detail).getByRole('link', { name: '자료 열기' })).toHaveAttribute('href', '/e/E000001');
});

test('기준을 바꾸면 엔진에 알린다', async () => {
  renderPage();
  await screen.findByRole('button', { name: /3370/ });
  await userEvent.click(screen.getByRole('radio', { name: '구역' }));
  expect(engine.last.setPivot).toHaveBeenLastCalledWith('zone');
  expect(await screen.findByText('구역별 자료')).toBeInTheDocument();
});

test('자료가 없으면 빈 화면', async () => {
  renderPage({ entries: [], hulls: {}, pairs: [], unsigned_models: 0, truncated: false });
  expect(await screen.findByText('볼 수 있는 확정 자료가 없습니다')).toBeInTheDocument();
});

const DOC_DATA = {
  hulls: {},
  entries: [
    { id: 'E000011', title: '크레인 모델', hulls: ['3370'], zones: [], free: [], files: 1, revisions: [], models: 1, reports: 0,
      report_revisions: [] },
    { id: 'E000012', title: '코밍 보고서', hulls: ['3508'], zones: [], free: [], files: 2, revisions: [], models: 0, reports: 2,
      report_revisions: [{ count: 2, name: 'coaming_rev.B.pdf', items: [
        { file_id: 5, name: 'coaming_rev.A.pdf', display: 'Rev.A', is_latest: false },
        { file_id: 6, name: 'coaming_rev.B.pdf', display: 'Rev.B', is_latest: true }],
      steps: [{ pages_a: 10, pages_b: 11, changed: 2, added: 1, removed: 0, overlap: 0.8 }] }] },
    { id: 'E000013', title: '코밍 보고서 개정', hulls: ['3508'], zones: [], free: [], files: 1, revisions: [], models: 0, reports: 1 },
  ],
  pairs: [],
  doc_pairs: [
    { a: 'E000011', b: 'E000012', type: 'uses', from: 'E000012', files: ['coaming_rev.B.pdf', 'crane.bdf'], score: null, count: 1 },
    { a: 'E000012', b: 'E000013', type: 'rrev', files: ['coaming_rev.B.pdf', 'coaming_rev.C.pdf'], score: 0.71, count: 1 },
  ],
  doc_index: { reports: 4, indexed: 3, vectors: 3, available: true },
  unsigned_models: 0, truncated: false,
};

test('32 — 보고서만 있는 자료의 문서 관계·보고서 판, 층 바꾸기', async () => {
  renderPage(DOC_DATA);
  await screen.findByRole('button', { name: /3370/ });
  expect(screen.getByText('본문 색인 전 보고서 1개는 본문 관계에서 빠졌습니다')).toBeInTheDocument();
  await userEvent.type(screen.getByRole('searchbox', { name: '지도에서 찾기' }), 'E000012{Enter}');
  const detail = await screen.findByRole('complementary', { name: '상세' });
  expect(within(detail).getByText('이 자료 보고서가 사용한 모델')).toBeInTheDocument();
  expect(within(detail).getByText(/3370 · crane\.bdf/)).toBeInTheDocument();
  expect(within(detail).getByText('같은 보고서의 다른 판이 있는 자료')).toBeInTheDocument();
  expect(within(detail).getByText(/본문 71% 겹침/)).toBeInTheDocument();
  expect(within(detail).getByText('Rev.B')).toBeInTheDocument();
  expect(within(detail).getByText('↳ 앞 판보다 쪽 2곳 바뀜 · 쪽 +1 · 본문 80% 같음')).toBeInTheDocument();
  expect(within(detail).getByText(/모델 0 · 보고서 2/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('radio', { name: '모델' }));
  expect(engine.last.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ layer: 'model' }));
  expect(within(detail).queryByText('같은 보고서의 다른 판이 있는 자료')).not.toBeInTheDocument();
  expect(screen.queryByText(/본문 색인 전 보고서/)).not.toBeInTheDocument();
});
