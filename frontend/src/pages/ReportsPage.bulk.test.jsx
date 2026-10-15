import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import ReportsPage from './ReportsPage.jsx';
import { ToastProvider } from '../components/ui/Toast.jsx';
import { mockApi } from '../test/mockApi.js';

// 24 — 목록 체크박스로 여러 문서를 골라 문서 분류를 한꺼번에 바꾼다(POST /api/reports/meta/bulk)
vi.mock('../components/preview/FilePreview.jsx', () => ({ default: () => null }));
const OPTIONS = ['해석 보고서', '연구 보고서', '시험 보고서', '기술 검토', '발표자료', '회의자료', '계산서', '지침', '기타'];
const row = (file_id, name, extra = {}) => ({ file_id, name, entry_id: 'E000001', entry_title: '자료', scope: 'unclassified',
  project: null, document_type: '', hulls: [], model_count: 0, snippets: [], can_edit: true, ...extra });
const ITEMS = [
  row(11, '검토.pdf'),
  row(12, '중간발표.pptx', { document_type: '발표자료', document_type_auto: true }),
  row(13, '남의.pdf', { can_edit: false }),
];
const list = (items = ITEMS) => ({ total: items.length, items, projects: [], no_project: 0, scopes: {}, document_types: {},
  document_type_options: OPTIONS, document_type_groups: [] });

const setup = (map = {}) => {
  const fetch = mockApi({
    'GET /api/reports?limit=50&offset=0': list(),
    'GET /api/reports/index-status': { total: 3, ready: 3, embedding_available: false, index_available: true },
    ...map,
  });
  render(<MemoryRouter initialEntries={['/reports']}><ToastProvider>
    <Routes><Route path="/reports" element={<ReportsPage />} /></Routes>
  </ToastProvider></MemoryRouter>);
  return fetch;
};
const bulkCalls = (fetch) => fetch.mock.calls.filter(([url, init]) => url === '/api/reports/meta/bulk' && init.method === 'POST');

test('행 체크박스 — 고칠 수 없는 행은 비활성(사유 title), 고르면 작업 바가 뜬다', async () => {
  const user = userEvent.setup();
  setup();
  const mine = await screen.findByRole('checkbox', { name: '검토.pdf 선택' });
  const others = screen.getByRole('checkbox', { name: '남의.pdf 선택' });
  expect(others).toBeDisabled();
  expect(others.closest('label')).toHaveAttribute('title', expect.stringContaining('올린 사람과 관리자만'));
  expect(screen.queryByRole('region', { name: '선택한 문서 분류 바꾸기' })).not.toBeInTheDocument();
  await user.click(mine);
  const bar = screen.getByRole('region', { name: '선택한 문서 분류 바꾸기' });
  expect(within(bar).getByText('1')).toBeInTheDocument();
  expect(within(bar).getByRole('button', { name: '적용' })).toBeDisabled();   // 분류를 고르기 전
  expect(within(bar).getByRole('button', { name: '해석 보고서(으)로' })).toBeEnabled();
  expect(within(bar).getByRole('button', { name: '발표자료(으)로' })).toBeEnabled();
  await user.click(within(bar).getByRole('button', { name: '선택 해제' }));
  expect(screen.queryByRole('region', { name: '선택한 문서 분류 바꾸기' })).not.toBeInTheDocument();
  expect(mine).not.toBeChecked();
});

test('전체 선택 — 고칠 수 있는 행만, 일부만 고르면 indeterminate', async () => {
  const user = userEvent.setup();
  setup();
  const all = await screen.findByRole('checkbox', { name: '현재 목록 전체 선택' });
  expect(screen.getByText('(바꿀 수 있는 2건)')).toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: '검토.pdf 선택' }));
  expect(all.indeterminate).toBe(true);
  expect(all).not.toBeChecked();
  await user.click(all);
  expect(all).toBeChecked();
  expect(all.indeterminate).toBe(false);
  expect(screen.getByRole('checkbox', { name: '중간발표.pptx 선택' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: '남의.pdf 선택' })).not.toBeChecked();
  await user.click(all);
  expect(screen.getByRole('checkbox', { name: '검토.pdf 선택' })).not.toBeChecked();
});

test('적용 — 확인 요약 뒤 bulk API 를 부르고, 결과 토스트·목록 갱신·선택 해제', async () => {
  const user = userEvent.setup();
  let listCalls = 0;
  const fetch = setup({
    'GET /api/reports?limit=50&offset=0': () => { listCalls += 1; return list(); },
    'POST /api/reports/meta/bulk': { updated: [{ file_id: 11, before: '', document_type: '해석 보고서', version: 1 }],
      skipped: [{ file_id: 12, reason: 'not_uploader' }] },
  });
  await user.click(await screen.findByRole('checkbox', { name: '현재 목록 전체 선택' }));
  const bar = screen.getByRole('region', { name: '선택한 문서 분류 바꾸기' });
  await user.selectOptions(within(bar).getByLabelText('바꿀 문서 분류'), '해석 보고서');
  await user.click(within(bar).getByRole('button', { name: '적용' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveTextContent('2건의 문서 분류를 ‘해석 보고서’(으)로 바꿀까요?');
  expect(dialog).toHaveTextContent('미분류 1건, 발표자료(자동) 1건 → 해석 보고서');
  await user.click(within(dialog).getByRole('button', { name: '바꾸기' }));
  expect(await screen.findByText('변경 1건 · 건너뜀 1건(권한 없음 1)')).toBeInTheDocument();
  const [[, init]] = bulkCalls(fetch);
  expect(JSON.parse(init.body)).toEqual({ file_ids: [11, 12], document_type: '해석 보고서' });
  await waitFor(() => expect(listCalls).toBe(2));   // 목록 다시 불러오기
  expect(screen.queryByRole('region', { name: '선택한 문서 분류 바꾸기' })).not.toBeInTheDocument();
});

test('확인에서 취소하면 API 를 부르지 않는다 · 빠른 단추는 그 값으로 확인을 띄운다', async () => {
  const user = userEvent.setup();
  const fetch = setup();
  await user.click(await screen.findByRole('checkbox', { name: '중간발표.pptx 선택' }));
  await user.click(screen.getByRole('button', { name: '발표자료(으)로' }));
  const dialog = await screen.findByRole('alertdialog');
  // 자동(추정)값은 같은 값이어도 저장해 확정하므로 건너뛴다고 하지 않는다
  expect(dialog).toHaveTextContent('발표자료(자동) 1건 → 발표자료');
  expect(dialog).not.toHaveTextContent('건너뜁니다');
  await user.click(within(dialog).getByRole('button', { name: '취소' }));
  expect(bulkCalls(fetch)).toHaveLength(0);
  expect(screen.getByRole('checkbox', { name: '중간발표.pptx 선택' })).toBeChecked();
});

test('목록이 바뀌어 안 보이게 된 행은 선택에서 빠진다', async () => {
  const user = userEvent.setup();
  setup({ 'GET /api/reports?document_type=%EA%B8%B0%ED%83%80&limit=50&offset=0': list([ITEMS[0], ITEMS[2]]) });
  await user.click(await screen.findByRole('checkbox', { name: '현재 목록 전체 선택' }));
  expect(within(screen.getByRole('region', { name: '선택한 문서 분류 바꾸기' })).getByText('2')).toBeInTheDocument();
  await user.selectOptions(screen.getByRole('combobox', { name: '문서 분류' }), '기타');
  await waitFor(() => expect(screen.queryByRole('checkbox', { name: '중간발표.pptx 선택' })).not.toBeInTheDocument());
  const bar = await screen.findByRole('region', { name: '선택한 문서 분류 바꾸기' });
  expect(within(bar).getByText('1')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: '검토.pdf 선택' })).toBeChecked();
});
