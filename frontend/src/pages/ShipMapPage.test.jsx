import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { mockApi } from '../test/mockApi.js';
import ShipMapPage from './ShipMapPage.jsx';

// jsdom 에는 WebGL 이 없다 — 장면은 가짜로(무엇을 받았는지만 본다)
const calls = vi.hoisted(() => ({ counts: null, selected: undefined }));
vi.mock('../components/shipmap/shipScene.js', () => ({
  createShipScene: () => ({
    setCounts: (c) => { calls.counts = c; }, select: (z) => { calls.selected = z; }, setView: () => {}, resize: () => {}, dispose: () => {},
  }),
}));

const E = (id, o) => ({ id, title: `${id} 제목`, rows: ['h:9001'], zones: [], target: null, confirmed_at: '2026-09', ...o });
const DATA = {
  hull_kinds: { 9001: 'LNG', 9002: 'VLCC' }, zones: [], targets: [], truncated: false,
  entries: [
    E('E000001', { zones: ['상갑판', '기관실'], target: 'Unit' }),
    E('E000002', { zones: ['상갑판'], target: 'Manifold', rows: ['h:9002'] }),
    E('E000003', { zones: ['기타'], target: 'Unit' }),
  ],
};

function renderPage(path = '/ship-map', data = DATA) {
  mockApi({ 'GET /api/coverage': data });
  render(<MemoryRouter initialEntries={[path]}><ShipMapPage /></MemoryRouter>);
}

test('구역별 자료 수 표와 장면 색 재료', async () => {
  renderPage();
  const side = await screen.findByRole('complementary', { name: '구역 자료' });
  expect(within(side).getByRole('button', { name: /상갑판\s*2/ })).toBeInTheDocument();
  expect(within(side).getByRole('button', { name: /위치 없는 자료\s*1/ })).toBeInTheDocument();
  await vi.waitFor(() => expect(calls.counts?.['상갑판']).toBe(2));
});

test('구역을 고르면 그 자료가 나오고 장면에 알린다', async () => {
  renderPage();
  const side = await screen.findByRole('complementary', { name: '구역 자료' });
  await userEvent.click(within(side).getByRole('button', { name: /기관실\s*1/ }));
  expect(within(side).getByRole('link', { name: 'E000001 제목' })).toHaveAttribute('href', '/e/E000001');
  expect(within(side).queryByRole('link', { name: 'E000002 제목' })).toBeNull();
  await vi.waitFor(() => expect(calls.selected).toBe('기관실'));
});

test('주소의 선종, 구역으로 시작한다', async () => {
  renderPage('/ship-map?kind=VLCC&zone=상갑판');
  const side = await screen.findByRole('complementary', { name: '구역 자료' });
  expect(within(side).getByRole('link', { name: 'E000002 제목' })).toBeInTheDocument();
  expect(within(side).queryByRole('link', { name: 'E000001 제목' })).toBeNull();
});

test('자료가 없으면 빈 상태', async () => {
  renderPage('/ship-map', { ...DATA, entries: [] });
  expect(await screen.findByText('확정한 자료가 아직 없습니다')).toBeInTheDocument();
});
