import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { mockApi } from '../test/mockApi.js';
import TeamSpacePage from './TeamSpacePage.jsx';

const ITEM = { entry_id: 'E000001', title: '계류 구조 검토', status: 'confirmed', analysis_type: 'Mooring',
  analysis_period: '2026-08', hulls: ['9999'], ship_types: [], zones: ['선수부'], tags: [], uploaded_by: 'A100001',
  confirmed_at: '2026-09-02T09:00:00', file_count: 2, kinds: ['model', 'report'], score: 110,
  matched: ['body', 'hull'], snippets: [{ file_id: 11, name: 'r.pptx', locator: 'slide:3', text: '선체 구조 강도 평가', highlights: [[6, 8]] }] };
const TEAM = { id: 3, name: '배관해석', description: 'CAESAR II 배관 응력해석', entries: 1, drafts: 2, is_member: true,
  members: [{ employee_id: 'T1', name: '배관 하나', department: '선장설계부', wb_active: true }] };
const TEAM_ITEM = { ...ITEM, title: '배관 응력 해석', access: 'team', label: '팀 전용', team: { id: 3, name: '배관해석' } };

function renderAt(map) {
  const fetch = mockApi(map);
  render(<MemoryRouter initialEntries={['/team/3']}><Routes><Route path="/team/:teamId" element={<TeamSpacePage />} /></Routes></MemoryRouter>);
  return fetch;
}

test('팀 공간 — 팀 자료 목록, 팀원 명단, 확정 전 초안 링크', async () => {
  renderAt({ 'GET /api/teams/3': TEAM, 'GET /api/search?team=3&limit=50': { items: [TEAM_ITEM], total: 1, terms: [] } });
  expect(await screen.findByRole('heading', { name: '배관해석 팀 공간' })).toBeInTheDocument();
  expect(await screen.findByText('배관 응력 해석')).toBeInTheDocument();
  expect(screen.getByRole('list', { name: '팀원 명단' })).toHaveTextContent('배관 하나');
  expect(screen.getByRole('link', { name: '올리기와 확정에서 보기' })).toHaveAttribute('href', '/inbox');
  expect(screen.getByText('팀 전용: 배관해석')).toBeInTheDocument();   // 자료 행의 공개 범위 배지
});

test('공간 안 찾기 — 검색어가 team= 과 함께 간다', async () => {
  const fetch = renderAt({ 'GET /api/teams/3': TEAM, 'GET /api/search?team=3&limit=50': { items: [TEAM_ITEM], total: 1, terms: [] },
    'GET /api/search?team=3&limit=50&q=%EC%97%86%EC%9D%8C': { items: [], total: 0, terms: ['없음'] } });
  await screen.findByText('배관 응력 해석');
  await userEvent.type(screen.getByRole('searchbox', { name: '팀 자료에서 찾기' }), '없음');
  expect(await screen.findByText('맞는 팀 자료가 없습니다')).toBeInTheDocument();
  expect(fetch.mock.calls.some(([u]) => u === '/api/search?team=3&limit=50&q=%EC%97%86%EC%9D%8C')).toBe(true);
});

test('팀원이 아니면 없는 팀처럼', async () => {
  renderAt({ 'GET /api/teams/3': { __status: 404, detail: 'team_not_found' } });
  expect(await screen.findByText('없는 팀이거나 이 팀의 팀원이 아닙니다.')).toBeInTheDocument();
});
