import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TargetsPage, { nestRows } from './TargetsPage.jsx';
import TargetPage from './TargetPage.jsx';
import { introSentence, pickReasons, reportText, steps } from '../lib/targetPage.js';

function stub(map) {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const body = map[url];
    if (body === undefined) throw new Error(`unexpected ${url}`);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  }));
}
const at = (path) => render(<MemoryRouter initialEntries={[path]}><Routes>
  <Route path="/targets" element={<TargetsPage />} /><Route path="/t/:value" element={<TargetPage />} /></Routes></MemoryRouter>);

test('69 — 업무 목록: 행마다 요약 문장, 거르기, 기타는 아래 글 링크로', async () => {
  stub({ '/api/targets': { targets: [
    { value: 'Unit', entries: 44, hulls: 15, base_docs: 14, conclusions: 1, lead: { name: '권혁민', count: 38 }, latest: '2026-11-20T10:00:00', thumb: null, other: false },
    { value: 'Manifold', entries: 20, hulls: 9, base_docs: 6, conclusions: 0, lead: null, latest: null, thumb: null, other: false },
    { value: '기타', entries: 11, hulls: 6, base_docs: 0, conclusions: 0, lead: null, latest: null, thumb: null, other: true }] } });
  at('/targets');
  const unit = await screen.findByRole('link', { name: /Unit/ });
  expect(unit).toHaveAttribute('href', '/t/Unit');
  expect(unit).toHaveTextContent('자료 44건, 호선 15척, 기초 자료 14건, 주 담당 권혁민');
  const list = screen.getByRole('list', { name: '업무 목록' });
  expect(within(list).queryByText('기타')).toBeNull();
  expect(screen.getByRole('link', { name: '검색에서 봅니다' }).getAttribute('href')).toMatch(/target=/);
  await userEvent.type(screen.getByRole('searchbox', { name: '업무 찾기' }), 'mani');
  expect(within(list).queryByRole('link', { name: /Unit/ })).toBeNull();
  expect(within(list).getByRole('link', { name: /Manifold/ })).toBeInTheDocument();
  vi.unstubAllGlobals();
});

const row = (id, o = {}) => ({ entry_id: id, title: `${id} 제목`, posted_at: '2026-11-01T00:00:00', hulls: ['3496'], ship_types: ['LNGC'],
  assignees: [{ name: '구조가', employed: true }], conclusion: null, reviewed: false, kind_counts: { model: 1, report: 1 },
  thumb: null, cover: null, no_hull: false, elements: 100, solve: 'pass', report: { title: '권상 보고서', count: 32, unit: 'page' }, ...o });
const PAGE = {
  value: 'Unit', synonyms: ['GMU'], other: false, can_fix: true, counts: { entries: 14, hulls: 12, assignees: 1, latest: '2026-11-01T00:00:00' },
  start: [row('E000001', { conclusion: '러그 응력 여유 확인' }), row('E000002')],
  base_docs: [row('E000003', { no_hull: true, hulls: [], title: '권상 지침' })], conclusions: [row('E000001', { conclusion: '러그 응력 여유 확인' })],
  records: Array.from({ length: 12 }, (_, i) => row(`E0001${String(i).padStart(2, '0')}`, { hulls: [`35${String(i).padStart(2, '0')}`], ship_types: [i < 9 ? 'LNGC' : 'VLCC'] })),
  models: [], people: [{ id: 7, name: '구조가', department: '구조해석부', employed: true, count: 12 }],
  gaps: { no_conclusion: { count: 13, items: [{ entry_id: 'E000002', title: 't' }] }, no_report: { count: 0, items: [] }, no_model: { count: 0, items: [] } } };

test('69 — 대상 화면: 소개 문장, 시작 순서, 먼저 볼 예제, 기준 문서, 실적(거르기, 10건 뒤 펼치기), 레일', async () => {
  stub({ '/api/targets/page?value=Unit': PAGE });
  at('/t/Unit');
  expect(await screen.findByRole('heading', { level: 1, name: 'Unit' })).toBeInTheDocument();
  expect(screen.getByText(/같은 말 GMU/)).toBeInTheDocument();
  expect(screen.getByText(/주 담당은 구조가 님\(12건\)입니다/)).toBeInTheDocument();
  const nav = screen.getByRole('navigation', { name: '처음이면 이 순서로' });
  expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['#base', '#example', '#conclusions', '#records', '#people']);
  const ex = screen.getByRole('region', { name: '먼저 볼 예제' });
  expect(within(ex).getByRole('link', { name: 'E000001 제목' })).toHaveAttribute('href', '/e/E000001');
  expect(within(ex).getByText('권상 보고서, 32쪽')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: '기준부터 읽기' })).getByText('권상 지침')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '결론과 주의점' })).toBeNull();   // 3건 미만이면 따로 두지 않는다
  const rec = screen.getByRole('region', { name: '실적' });
  expect(within(rec).getAllByRole('row')).toHaveLength(11);   // 머리 + 10행
  await userEvent.click(within(rec).getByRole('button', { name: /VLCC 3/ }));
  expect(within(rec).getAllByRole('row')).toHaveLength(4);
  await userEvent.click(within(rec).getByRole('radio', { name: '그림' }));
  expect(within(rec).getByRole('list', { name: '실적 그림' })).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: '누구에게 물을까' })).getByRole('link', { name: /구조가/ })).toHaveAttribute('href', '/p/7');
  expect(screen.getByRole('region', { name: '자료 갖춤' })).toHaveTextContent('결론 1/14');
  expect(document.title).toMatch(/^Unit 업무/);
  vi.unstubAllGlobals();
});

test('69 — 순수 함수: 고른 이유, 보고서 글자, 내용 있는 단계만', () => {
  expect(pickReasons(row('E1', { conclusion: 'x' }))).toEqual(['결론 있음', '모델과 보고서 모두 있음', '해석 검증 통과']);
  expect(reportText({ name: 'a.pptx', count: 12, unit: 'slide' })).toBe('a.pptx, 12장');
  expect(steps({ base_docs: [], start: [1], conclusions: [], records: [1], people: [] }).map((s) => s.id)).toEqual(['example', 'records']);
  expect(introSentence({ ...PAGE, people: [] })).toMatch(/^LNGC 9척, VLCC 3척, 호선 12척에서 한 해석 12건/);
});

test('71 — 묶음: 하위 업무를 묶음 아래로 들여 쓰고, 찾는 중이면 묶음 이름을 붙인다', async () => {
  const card = (value, o = {}) => ({ value, entries: 1, hulls: 1, base_docs: 0, conclusions: 0, lead: null, latest: null, thumb: null, other: false, group: null, children: [], ...o });
  const cards = [card('배관', { entries: 23, children: ['Manifold', 'Pipe'] }), card('Unit', { entries: 21 }),
    card('Manifold', { entries: 20, group: '배관' }), card('Pipe', { entries: 2, group: '배관' })];
  expect(nestRows(cards).map((r) => `${r.child ? '  ' : ''}${r.card.value}`)).toEqual(['배관', '  Manifold', '  Pipe', 'Unit']);
  stub({ '/api/targets': { targets: cards } });
  at('/targets');
  const group = await screen.findByRole('link', { name: /^배관/ });
  expect(group).toHaveTextContent('하위 업무 2개 포함');
  const list = screen.getByRole('list', { name: '업무 목록' });
  expect(within(list).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/t/%EB%B0%B0%EA%B4%80', '/t/Manifold', '/t/Pipe', '/t/Unit']);
  await userEvent.type(screen.getByRole('searchbox', { name: '업무 찾기' }), 'pipe');
  expect(within(list).getByRole('link', { name: /Pipe/ })).toHaveTextContent('묶음 배관');
  vi.unstubAllGlobals();
});

test('71 — 대상 화면: 묶음 링크와 하위 업무 줄', async () => {
  stub({ '/api/targets/page?value=Pipe': { ...PAGE, value: 'Pipe', synonyms: [], group: '배관', children: [] },
         '/api/targets/page?value=%EB%B0%B0%EA%B4%80': { ...PAGE, value: '배관', synonyms: [], group: null,
           children: [{ value: 'Manifold', entries: 20 }, { value: 'Pipe', entries: 2 }] } });
  at('/t/Pipe');
  expect(await screen.findByRole('heading', { level: 1, name: 'Pipe' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '배관' })).toHaveAttribute('href', '/t/%EB%B0%B0%EA%B4%80');
  expect(screen.queryByRole('navigation', { name: '하위 업무' })).toBeNull();
  vi.unstubAllGlobals();
});

test('71 — 묶음 화면: 하위 업무로 가는 링크', async () => {
  stub({ '/api/targets/page?value=%EB%B0%B0%EA%B4%80': { ...PAGE, value: '배관', synonyms: [], group: null,
    children: [{ value: 'Manifold', entries: 20 }, { value: 'Pipe', entries: 2 }] } });
  at('/t/%EB%B0%B0%EA%B4%80');
  const nav = await screen.findByRole('navigation', { name: '하위 업무' });
  expect(within(nav).getByRole('link', { name: /Manifold/ })).toHaveAttribute('href', '/t/Manifold');
  expect(within(nav).getByRole('link', { name: /Pipe/ })).toHaveTextContent('2');
  vi.unstubAllGlobals();
});


test('74 — 팀원과 관리자에게만 맨 위 팀 공간 줄', async () => {
  stub({ '/api/targets': { targets: [] },
    '/api/teams': [{ id: 3, name: '배관해석', description: 'CAESAR II', entries: 12, drafts: 2, members: 4 }] });
  at('/targets');
  const team = await screen.findByRole('link', { name: /배관해석/ });
  expect(team).toHaveAttribute('href', '/team/3');
  expect(team).toHaveTextContent('팀 전용');
  expect(team).toHaveTextContent('팀 자료 12건, 팀원 4명, 확정 전 초안 2건, CAESAR II');
  vi.unstubAllGlobals();
});

test('74 — 팀이 없으면 팀 줄도 없다', async () => {
  stub({ '/api/targets': { targets: [] }, '/api/teams': [] });
  at('/targets');
  expect(await screen.findByText('아직 모을 자료가 없습니다')).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: '팀 공간' })).toBeNull();
  vi.unstubAllGlobals();
});
