import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { calls, mockApi } from '../../test/mockApi.js';
import CleanupPage from './CleanupPage.jsx';

// 20 — 관리자 '자료 정비': 빠진 필수 분류 목록 · 제목 형식 미리보기→적용 · 바꾼 기록 되돌리기

const MISSING = {
  total: 1, all: 1, counts: { hull: 0, zone_or_target: 1, analysis_type: 1 },
  uploaders: [{ employee_id: 'A100001', name: '홍길동', count: 1 }],
  items: [{ entry_id: 'E000005', title: '옛 모델', version: 2, missing: ['zone_or_target', 'analysis_type'], hulls: ['3496'],
            no_hull: false, zones: [], analysis_type: null, uploaded_by: 'A100001', uploader_name: '홍길동', confirmed_at: null }],
};
const TITLES = {
  total: 2, counts: { ready: 2, blocked: 1 },
  items: [
    { entry_id: 'E000007', version: 3, title: '옛 제목', new_title: '3496 · 선수부 · 강도 평가 · M04', status: 'ready',
      source: '3496_선수부_M04_final', missing: [], uploaded_by: 'A100001', uploader_name: '홍길동' },
    { entry_id: 'E000008', version: 1, title: '또 옛 제목', new_title: '3497 · 선미부 · FE 해석', status: 'ready',
      source: '3497', missing: [], uploaded_by: 'A100001', uploader_name: '홍길동' },
  ],
};
const APPLIED = [
  { audit_id: 9, at: '2026-10-12T10:00:00', employee_id: 'C300001', entry_id: 'E000007', old_title: '옛 제목',
    new_title: '3496 · 선수부 · 강도 평가 · M04', current_title: '3496 · 선수부 · 강도 평가 · M04', reverted: false, can_revert: true },
];

function renderPage(map = {}) {
  const fetch = mockApi({ 'GET /api/admin/cleanup/missing?limit=100': MISSING, ...map });
  render(<MemoryRouter><CleanupPage /></MemoryRouter>);
  return fetch;
}

test('빠진 필수 분류 — 무엇이 빠졌는지·올린 사람·자료 링크, 빠진 칸으로 거르기', async () => {
  const fetch = renderPage({ 'GET /api/admin/cleanup/missing?limit=100&missing=zone_or_target': MISSING });
  const row = (await screen.findByRole('link', { name: 'E000005' })).closest('tr');
  expect(row).toHaveTextContent('구역 또는 대상, 해석 종류');
  expect(row).toHaveTextContent('홍길동');
  expect(within(row).getByRole('link', { name: 'E000005' })).toHaveAttribute('href', '/e/E000005');
  await userEvent.click(screen.getByRole('tab', { name: /구역 또는 대상/ }));
  await vi.waitFor(() => expect(calls(fetch)).toContain('GET /api/admin/cleanup/missing?limit=100&missing=zone_or_target'));
});

test('제목 형식 — 골라서 적용(확인 대화상자), 결과 안내 후 다시 불러온다', async () => {
  let n = 0;
  const fetch = renderPage({
    'GET /api/admin/cleanup/titles?status=ready&limit=100': () => (n++ === 0 ? TITLES : { ...TITLES, total: 1, items: [TITLES.items[1]] }),
    'POST /api/admin/cleanup/titles/apply': { applied: [{ entry_id: 'E000007' }], skipped: [] },
  });
  await userEvent.click(screen.getByRole('tab', { name: '제목 형식' }));
  expect(await screen.findByText('3496 · 선수부 · 강도 평가 · M04')).toBeInTheDocument();
  const apply = screen.getByRole('button', { name: /선택한 0건 바꾸기/ });
  expect(apply).toBeDisabled();
  await userEvent.click(screen.getByRole('checkbox', { name: 'E000007 고르기' }));
  await userEvent.click(screen.getByRole('button', { name: /선택한 1건 바꾸기/ }));
  await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '바꾸기' }));
  await vi.waitFor(() => expect(calls(fetch)).toContain('POST /api/admin/cleanup/titles/apply'));
  const body = JSON.parse(fetch.mock.calls.find(([u]) => u === '/api/admin/cleanup/titles/apply')[1].body);
  expect(body).toEqual({ items: [{ entry_id: 'E000007', version: 3, new_title: '3496 · 선수부 · 강도 평가 · M04' }] });
  expect(await screen.findByText(/제목 1건을 바꿨습니다/)).toBeInTheDocument();
  await vi.waitFor(() => expect(screen.queryByText('3496 · 선수부 · 강도 평가 · M04')).toBeNull());
});

test('제외(사유) 보기 — 필수 분류가 빠진 자료는 바꾸지 않는다', async () => {
  renderPage({
    'GET /api/admin/cleanup/titles?status=ready&limit=100': TITLES,
    'GET /api/admin/cleanup/titles?status=blocked&limit=100': { total: 1, counts: { ready: 2, blocked: 1 }, items: [
      { entry_id: 'E000005', version: 2, title: '옛 모델', new_title: null, status: 'blocked', source: 'x',
        missing: ['zone_or_target'], reason: '필수 분류 빠짐: 구역 또는 대상' }] },
  });
  await userEvent.click(screen.getByRole('tab', { name: '제목 형식' }));
  await userEvent.click(await screen.findByRole('tab', { name: /제외/ }));
  expect(await screen.findByText('필수 분류 빠짐: 구역 또는 대상')).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'E000005 고르기' })).toBeNull();
});

test('바꾼 기록 — 원래 제목으로 되돌린다', async () => {
  let n = 0;
  const fetch = renderPage({
    'GET /api/admin/cleanup/titles/applied?limit=200': () => (n++ === 0 ? APPLIED : [{ ...APPLIED[0], reverted: true, can_revert: false }]),
    'POST /api/admin/cleanup/titles/revert': { entry_id: 'E000007', title: '옛 제목', version: 5 },
  });
  await userEvent.click(screen.getByRole('tab', { name: '바꾼 기록' }));
  await userEvent.click(await screen.findByRole('button', { name: 'E000007 원래 제목으로 되돌리기' }));
  await vi.waitFor(() => expect(calls(fetch)).toContain('POST /api/admin/cleanup/titles/revert'));
  expect(await screen.findByText('되돌림')).toBeInTheDocument();
});
