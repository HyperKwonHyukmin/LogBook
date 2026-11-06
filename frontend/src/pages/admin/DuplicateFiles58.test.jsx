import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { calls, mockApi } from '../../test/mockApi.js';
import CleanupPage from './CleanupPage.jsx';

// 58 — 관리 › 자료 정비 › 중복 파일: 파일명이 같은 보고서·엑셀·모델 찾기와 정리

const file = (o) => ({ name: 'r.pdf', size: 2048, sha256: 'a'.repeat(64), status: 'confirmed', version: 1,
  uploaded_by: 'A100001', uploader_name: '홍길동', created_at: '2026-10-01T09:00:00', keep: false, ...o });
const DUPS = {
  total: 2, all: 2, counts: { report: 1, excel: 1, model: 0 }, same_counts: { content: 1, name: 1 },
  items: [
    { key: 'r.pdf', name: 'r.pdf', category: 'report', same_content: true, files: [
      file({ file_id: 1, entry_id: 'E000001', title: '원본', rel_path: 'a/r.pdf', entry_file_count: 3, keep: true }),
      file({ file_id: 2, entry_id: 'E000002', title: '사본', rel_path: 'b/r.pdf', entry_file_count: 1 }),
    ] },
    { key: 's.xlsx', name: 's.xlsx', category: 'excel', same_content: false, files: [
      file({ file_id: 3, entry_id: 'E000001', title: '원본', rel_path: 'a/s.xlsx', entry_file_count: 3, keep: true, sha256: 'b'.repeat(64) }),
      file({ file_id: 4, entry_id: 'E000003', title: '다른 판', rel_path: 'c/s.xlsx', entry_file_count: 2, sha256: 'c'.repeat(64) }),
    ] },
  ],
};

function renderPage(map = {}) {
  const fetch = mockApi({
    'GET /api/admin/cleanup/missing?limit=100': { total: 0, all: 0, counts: {}, uploaders: [], items: [] },
    'GET /api/admin/cleanup/duplicates?limit=50': DUPS, ...map,
  });
  render(<MemoryRouter><CleanupPage /></MemoryRouter>);
  return fetch;
}

test('중복 파일 — 묶음마다 내용 같음 여부·남길 것, 거르기', async () => {
  const fetch = renderPage({ 'GET /api/admin/cleanup/duplicates?limit=50&category=excel': { ...DUPS, items: [DUPS.items[1]] } });
  await userEvent.click(screen.getByRole('tab', { name: '중복 파일' }));
  const g = await screen.findByRole('group', { name: 'r.pdf' });
  expect(g).toHaveTextContent('내용도 같음');
  expect(within(g).getByRole('link', { name: 'E000001' }).closest('tr')).toHaveTextContent('남길 것');
  expect(within(g).getByRole('link', { name: 'E000002' }).closest('tr')).toHaveTextContent('자료째 휴지통');
  expect(screen.getByRole('group', { name: 's.xlsx' })).toHaveTextContent('이름만 같음(내용 다름)');
  await userEvent.click(screen.getByRole('tab', { name: /엑셀/ }));
  await vi.waitFor(() => expect(calls(fetch)).toContain('GET /api/admin/cleanup/duplicates?limit=50&category=excel'));
});

test('중복 파일 — 내용도 같은 것만 자동으로 고르고 확인 후 정리', async () => {
  let n = 0;
  const fetch = renderPage({
    'GET /api/admin/cleanup/duplicates?limit=50': () => (n++ === 0 ? DUPS : { ...DUPS, total: 1, items: [DUPS.items[1]] }),
    'POST /api/admin/cleanup/duplicates/resolve': { done: 1, skipped: 0,
      results: [{ file_id: 2, status: 'entry_trashed', entry_id: 'E000002' }] },
  });
  await userEvent.click(screen.getByRole('tab', { name: '중복 파일' }));
  await screen.findByRole('group', { name: 'r.pdf' });
  expect(screen.getByRole('button', { name: /고른 0개 정리/ })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: /내용도 같은 것 고르기/ }));
  // 이름만 같은 묶음(s.xlsx)과 남길 것은 고르지 않는다
  expect(screen.getByRole('checkbox', { name: 'E000002 b/r.pdf 고르기' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'E000001 a/r.pdf 고르기' })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'E000003 c/s.xlsx 고르기' })).not.toBeChecked();
  await userEvent.click(screen.getByRole('button', { name: /고른 1개 정리/ }));
  const dlg = await screen.findByRole('alertdialog');
  expect(dlg).toHaveTextContent('자료째 휴지통 1건: E000002');
  await userEvent.click(within(dlg).getByRole('button', { name: '정리하기' }));
  expect(await screen.findByText(/자료 1건을 휴지통으로 옮겼습니다/)).toBeInTheDocument();
  const post = fetch.mock.calls.find(([u, i]) => i?.method === 'POST');
  expect(JSON.parse(post[1].body)).toEqual({ file_ids: [2] });
  expect(screen.queryByRole('group', { name: 'r.pdf' })).toBeNull();
});

const MODELS = {
  total: 2, all: 2, counts: { report: 0, excel: 0, model: 2 }, same_counts: { content: 1, name: 1 },
  items: [
    { key: 'a.bdf', name: 'a.bdf', category: 'model', same_content: false, same_model: true, files: [
      file({ file_id: 11, entry_id: 'E000011', title: '원본', rel_path: 'a/a.bdf', entry_file_count: 2, keep: true,
             counts: { GRID: 100 }, compare: null }),
      file({ file_id: 12, entry_id: 'E000012', title: '주석만 다름', rel_path: 'b/a.bdf', entry_file_count: 2,
             sha256: 'd'.repeat(64), counts: { GRID: 100 },
             compare: { same_model: true, diff: [], same: ['geometry', 'property', 'material', 'load'], counts: {} } }),
    ] },
    { key: 'm.bdf', name: 'm.bdf', category: 'model', same_content: false, same_model: false, files: [
      file({ file_id: 13, entry_id: 'E000013', title: '1차', rel_path: 'a/m.bdf', entry_file_count: 2, keep: true,
             counts: { GRID: 10086 }, compare: null }),
      file({ file_id: 14, entry_id: 'E000014', title: '2차', rel_path: 'c/m.bdf', entry_file_count: 2,
             sha256: 'e'.repeat(64), counts: { GRID: 9667 },
             compare: { same_model: false, diff: ['geometry', 'load'], same: ['property', 'material'], counts: { GRID: -419 } } }),
    ] },
  ],
};

test('중복 파일 — 모델은 남길 것과 범주별 비교, 서명이 같으면 자동 고르기에 든다', async () => {
  renderPage({ 'GET /api/admin/cleanup/duplicates?limit=50': MODELS });
  await userEvent.click(screen.getByRole('tab', { name: '중복 파일' }));
  const same = await screen.findByRole('group', { name: 'a.bdf' });
  expect(same).toHaveTextContent('모델 내용 같음(형식만 다름)');
  expect(same).toHaveTextContent('남길 것과 모델 내용 같음(주석·줄 형식만 다름)');
  const diff = screen.getByRole('group', { name: 'm.bdf' });
  const row = within(diff).getByRole('link', { name: 'E000014' }).closest('tr');
  expect(row).toHaveTextContent('형상 다름 · 속성 같음 · 재료 같음 · 하중 다름');
  expect(row).toHaveTextContent('GRID −419');
  expect(row).toHaveTextContent('GRID 9,667');
  await userEvent.click(screen.getByRole('button', { name: /내용도 같은 것 고르기/ }));
  expect(screen.getByRole('checkbox', { name: 'E000012 b/a.bdf 고르기' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'E000014 c/m.bdf 고르기' })).not.toBeChecked();
});
