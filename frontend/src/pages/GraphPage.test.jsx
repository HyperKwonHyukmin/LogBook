import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { mockApi } from '../test/mockApi.js';
import GraphPage from './GraphPage.jsx';

// 캔버스 엔진은 jsdom 에서 그릴 수 없다 — 페이지가 넘기는 값과 엔진 콜백만 확인한다
const engine = vi.hoisted(() => ({ last: null }));
vi.mock('../components/graph/graphView.js', () => ({
  GRAPH_COLORS: { accent: '#002554', warn: '#C2620E' },
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
