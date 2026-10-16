import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { mockApi } from '../test/mockApi.js';
import CoveragePage from './CoveragePage.jsx';

const E = (id, o) => ({ id, title: `${id} 제목`, analysis_type: 'Truss', rows: ['h:9001'], zones: ['정반'], models: 1, reports: 1,
  doc_linked: false, model_linked: false, solve: 'pass', needs_fix: false, unsigned: false, uploaded_by: 'M1', uploader_name: '김해석',
  confirmed_at: '2026-09', ...o });
const DATA = {
  hulls: { 9001: 'LNGC', 9002: null }, zones: ['정반', '블록'], truncated: false,
  entries: [E('E000001'), E('E000002', { rows: ['h:9002'], reports: 0 }), E('E000003', { zones: ['블록'], reports: 0, solve: 'fail', analysis_type: '권상' })],
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
  expect(screen.getByRole('tab', { name: /문서 없는 모델/ })).toHaveTextContent('2건');
});

test('칸을 누르면 그 칸의 자료와 칸만 보기가 나온다', async () => {
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: '9002 · 정반: 문서 없음, 자료 1건' }));
  const side = screen.getByRole('complementary', { name: '칸 상세' });
  expect(within(side).getByRole('link', { name: 'E000002 제목' })).toHaveAttribute('href', '/e/E000002');
  await userEvent.click(screen.getByRole('button', { name: '9002 · 정반만 보기' }));
  expect(screen.getByRole('tab', { name: /문서 없는 모델/ })).toHaveTextContent('1건');
});

test('해석 종류로 거르면 그 종류가 없는 구역은 해당 없음', async () => {
  renderPage();
  await screen.findByRole('grid', { name: '호선별 구역 자료 현황' });
  await userEvent.click(screen.getByRole('radio', { name: '권상' }));
  expect(screen.getAllByLabelText(/정반: 해당 없음/).length).toBeGreaterThan(0);
});

test('자료가 없으면 빈 상태', async () => {
  renderPage({ ...DATA, entries: [] });
  expect(await screen.findByText('확정한 자료가 아직 없습니다')).toBeInTheDocument();
});
