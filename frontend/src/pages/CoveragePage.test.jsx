import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { mockApi } from '../test/mockApi.js';
import CoveragePage from './CoveragePage.jsx';

const E = (id, o) => ({ id, title: `${id} 제목`, rows: ['h:9001'], zones: ['정반'], models: 1, reports: 1,
  doc_linked: false, model_linked: false, solve: 'pass', needs_fix: false, unsigned: false, uploaded_by: 'M1', uploader_name: '김해석',
  confirmed_at: '2026-09', ...o });
const DATA = {
  hulls: { 9001: 'LNGC', 9002: null }, zones: ['정반', '블록'], truncated: false,
  entries: [E('E000001'), E('E000002', { rows: ['h:9002'], reports: 0 }), E('E000003', { zones: ['블록'], reports: 0, solve: 'fail' })],
};

function renderPage(data = DATA) {
  mockApi({ 'GET /api/coverage': data });
  render(<MemoryRouter><CoveragePage /></MemoryRouter>);
}

test('격자·범례·먼저 볼 칸을 그린다', async () => {
  renderPage();
  expect(await screen.findByRole('grid', { name: '호선별 구역 자료 현황' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^갖춤 1/ })).toBeInTheDocument();
  const side = screen.getByRole('complementary', { name: '칸 상세' });
  expect(within(side).getByText('모델 1개가 모두 검증 실패')).toBeInTheDocument();
  // 48 — 손볼 자료 목록은 정리 대기로 옮겼다
  expect(screen.queryByRole('tab', { name: /문서 없는 모델/ })).toBeNull();
  expect(within(side).getByRole('link', { name: /손볼 자료를 자료 단위로 보기/ })).toHaveAttribute('href', '/inbox?tab=fix');
});

test('칸을 누르면 그 칸의 자료가 나온다', async () => {
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: '9002 · 정반: 문서 없음, 자료 1건' }));
  const side = screen.getByRole('complementary', { name: '칸 상세' });
  expect(within(side).getByRole('link', { name: 'E000002 제목' })).toHaveAttribute('href', '/e/E000002');
});

test('42 — 해석 종류 거르기는 없다(옛 응답에 analysis_type 이 있어도)', async () => {
  renderPage({ ...DATA, entries: DATA.entries.map((e) => ({ ...e, analysis_type: '권상' })) });
  await screen.findByRole('grid', { name: '호선별 구역 자료 현황' });
  expect(screen.queryByRole('radiogroup', { name: '해석 종류' })).toBeNull();
  expect(screen.queryByText('해석 종류')).toBeNull();
  expect(screen.queryByRole('radio', { name: '권상' })).toBeNull();
  expect(screen.queryAllByLabelText(/해당 없음/)).toHaveLength(0);
});

test('자료가 없으면 빈 상태', async () => {
  renderPage({ ...DATA, entries: [] });
  expect(await screen.findByText('확정한 자료가 아직 없습니다')).toBeInTheDocument();
});

test('44 — 행 기준 · 열 기준을 고르면 격자가 바뀌고 주소에 남는다', async () => {
  const data = { ...DATA, hull_kinds: { 9001: 'LNG', 9002: 'LNG' }, hull_sizes: { 9001: '174K급 LNG', 9002: null }, targets: ['Unit'],
    entries: DATA.entries.map((e, i) => ({ ...e, target: i === 0 ? 'Unit' : null })) };
  renderPage(data);
  await screen.findByRole('grid', { name: '호선별 구역 자료 현황' });
  await userEvent.click(screen.getByRole('radio', { name: '선종' }));
  await userEvent.click(screen.getByRole('radio', { name: '대상' }));
  const grid = screen.getByRole('grid', { name: '선종별 대상 자료 현황' });
  expect(within(grid).getByRole('button', { name: 'LNG · Unit: 갖춤, 자료 1건' })).toBeInTheDocument();
  expect(within(grid).getByRole('button', { name: /^LNG · 대상 없음: / })).toBeInTheDocument();
  expect(within(grid).getByText('채운 대상')).toBeInTheDocument();
});
