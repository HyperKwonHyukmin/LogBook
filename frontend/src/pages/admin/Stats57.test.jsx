import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';
import { mockApi } from '../../test/mockApi.js';
import StatsPage from './StatsPage.jsx';
import EntryTablePage from './EntryTablePage.jsx';
import { bulkBody } from '../../components/search/BulkClassifyDialog.jsx';

afterEach(() => vi.unstubAllGlobals());
const inRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

const STATS = {
  summary: { confirmed: 18, drafts: 3, trashed: 21, files: 40, bytes: 64 * 1024 * 1024, hulls: 7 },
  categories: [
    { key: 'nastran', label: '해석 모델 (Nastran)', files: 18, entries: 18, bytes: 35e6,
      exts: [{ ext: '.bdf', files: 18, entries: 18, bytes: 35e6 }] },
    { key: 'abaqus', label: '해석 모델 (Abaqus)', files: 4, entries: 2, bytes: 1e6, exts: [{ ext: '.inp', files: 4, entries: 2, bytes: 1e6 }] },
    { key: 'report', label: '보고서', files: 10, entries: 9, bytes: 2e7,
      exts: [{ ext: '.pdf', files: 7, entries: 7, bytes: 1e7 }, { ext: '.pptx', files: 3, entries: 2, bytes: 1e7 }] },
  ],
  monthly: [{ month: '2026-10', entries: 15, files: 30 }, { month: '2026-11', entries: 3, files: 10 }],
  top: { zones: [{ value: 'Unit', entries: 7 }], targets: [{ value: 'Rudder', entries: 2 }], hulls: [{ value: '3515', entries: 3 }] },
};

test('57 자료 현황 — 요약·형식별(펼치면 확장자)·월별·상위 분류', async () => {
  mockApi({ 'GET /api/admin/stats': STATS });
  inRouter(<StatsPage />);
  expect(await screen.findByText('확정 자료')).toBeInTheDocument();
  expect(screen.getByText('정리 대기 3 · 휴지통 21')).toBeInTheDocument();
  expect(screen.getByText('22')).toBeInTheDocument();   // 해석 모델 = Nastran 18 + Abaqus 4
  expect(screen.queryByText('.pptx')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '보고서' }));
  expect(screen.getByText('.pptx')).toBeInTheDocument();
  expect(screen.getByRole('list', { name: '월별 확정 자료' })).toHaveTextContent('2026-10자료 15 · 파일 30');
  expect(screen.getByText('Rudder')).toBeInTheDocument();
});

const ROWS = [
  { entry_id: 'E000051', title: '3515 · Unit · 35030', status: 'confirmed', version: 3, hulls: ['3515'], no_hull: false,
    zones: ['Unit'], target: 'Rudder', assignees: [{ id: 1, name: '김미희' }], access: 'normal', uploaded_by: 'A1',
    uploader_name: '권혁민', confirmed_at: '2026-10-14T11:02', files: { nastran: 1, report: 2 } },
  { entry_id: 'E000036', title: '공용 · crane jungban', status: 'confirmed', version: 1, hulls: [], no_hull: true,
    zones: [], target: null, assignees: [], access: 'shared', uploaded_by: 'A1', uploader_name: '권혁민',
    confirmed_at: '2026-10-10T09:00', files: {} },
  { entry_id: 'E000040', title: '호선 빠짐', status: 'confirmed', version: 1, hulls: [], no_hull: false,
    zones: ['정반'], target: 'Crane', assignees: [{ id: 2, name: '이영희' }], access: 'blocked', uploaded_by: 'A2',
    uploader_name: null, confirmed_at: null, files: { abaqus: 4 } },
];

test('57 자료 목록 — 빠진 칸 표시와 거르개, 골라서 공개 범위까지 한 번에 바꾸기', async () => {
  const fetch = mockApi({
    'GET /api/admin/entry-table': { rows: ROWS, limit: 5000, categories: [] },
    'POST /api/entries/bulk-classify': (init) => {
      const b = JSON.parse(init.body);
      return { changed: b.entry_ids, same: [], failed: [] };
    },
  });
  inRouter(<EntryTablePage />);
  expect(await screen.findByText('3515 · Unit · 35030')).toBeInTheDocument();
  // 공용 표시 자료는 호선 칸이 '공용', 공용도 아니고 호선도 없으면 빠짐
  const crane = screen.getByText('공용 · crane jungban').closest('tr');
  expect(within(crane).getByText('공용')).toBeInTheDocument();
  expect(within(crane).queryByText('빠짐')).toBeNull();          // 공용이면 호선은 빠진 것이 아니다
  expect(within(crane).getAllByText('추가').length).toBeGreaterThanOrEqual(2);   // 빈 구역·대상 칸은 바로 [추가]
  expect(within(screen.getByText('호선 빠짐').closest('tr')).getByText('빠짐')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '구역 없음 1' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '호선 없음(공용 아님) 1' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '호선 없음(공용 아님) 1' }));
  expect(screen.queryByText('3515 · Unit · 35030')).toBeNull();
  expect(screen.getByText('호선 빠짐')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '호선 없음(공용 아님) 1' }));
  await userEvent.selectOptions(screen.getByRole('combobox', { name: '공개 범위 거르기' }), 'shared');
  expect(screen.getAllByRole('row')).toHaveLength(2);   // 머리줄 + 공유 1건
  await userEvent.selectOptions(screen.getByRole('combobox', { name: '공개 범위 거르기' }), '');
  await userEvent.type(screen.getByRole('textbox', { name: '자료 거르기' }), '김미희');
  expect(screen.getAllByRole('row')).toHaveLength(2);
  await userEvent.clear(screen.getByRole('textbox', { name: '자료 거르기' }));

  await userEvent.click(screen.getByRole('checkbox', { name: 'E000036 고르기' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'E000040 고르기' }));
  await userEvent.click(screen.getByRole('button', { name: '고른 2건 바꾸기' }));
  await userEvent.selectOptions(screen.getByRole('combobox', { name: '공개 범위 바꾸기' }), 'normal');
  await userEvent.click(screen.getByRole('button', { name: '미리보기' }));
  await userEvent.click(await screen.findByRole('button', { name: '2건 바꾸기' }));
  const posts = fetch.mock.calls.filter(([u]) => u === '/api/entries/bulk-classify').map(([, i]) => JSON.parse(i.body));
  expect(posts[1]).toEqual({ entry_ids: ['E000036', 'E000040'], access: 'normal', dry_run: false });
  expect(await screen.findByText(/2건의 분류를 바꿨습니다/)).toBeInTheDocument();
});

test('57 — 검색의 일괄 분류에는 공개 범위가 없고, bulkBody 는 고른 공개 범위만 보낸다', () => {
  const f = { zonesAdd: [], zonesRemove: [], targetMode: '', target: null, assigneesAdd: [], assigneesRemove: [], noHull: '', access: '' };
  expect(bulkBody(['E1'], f)).toBeNull();
  expect(bulkBody(['E1'], { ...f, access: 'blocked' })).toEqual({ entry_ids: ['E1'], access: 'blocked' });
});

test('57 자료 목록 — 표에서 바로 고치고 [변경 N건 저장]: 공개 범위는 PUT access, 담당자는 PATCH(version)', async () => {
  let table = { rows: ROWS, limit: 5000, categories: [] };
  const fetch = mockApi({
    'GET /api/admin/entry-table': () => table,
    'PUT /api/entries/E000036/access': { entry_id: 'E000036', version: 2 },
    'PATCH /api/entries/E000040': { __status: 409, detail: 'version_conflict' },
  });
  inRouter(<EntryTablePage />);
  await screen.findByText('공용 · crane jungban');
  expect(screen.getByRole('button', { name: '변경 0건 저장' })).toBeDisabled();
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'E000036 공개 범위' }), 'normal');
  const row = screen.getByText('공용 · crane jungban').closest('tr');
  expect(within(row).getByText('고침')).toBeInTheDocument();
  // 되돌려 놓으면 변경이 아니다
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'E000036 공개 범위' }), 'shared');
  expect(screen.getByRole('button', { name: '변경 0건 저장' })).toBeDisabled();
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'E000036 공개 범위' }), 'normal');
  // E000040 담당자 빼기(칩의 빼기 단추)
  const r40 = screen.getByText('호선 빠짐').closest('tr');
  await userEvent.click(within(r40).getByRole('button', { name: /이영희.*(빼기|삭제|제거)/ }));
  table = { ...table, rows: ROWS.map((r) => (r.entry_id === 'E000036' ? { ...r, access: 'normal', version: 2 } : r)) };
  await userEvent.click(screen.getByRole('button', { name: '변경 2건 저장' }));
  expect(await screen.findByText('1건을 저장했습니다.')).toBeInTheDocument();
  const sent = fetch.mock.calls.filter(([, i = {}]) => i.method === 'PUT' || i.method === 'PATCH')
    .map(([u, i]) => [i.method, u, JSON.parse(i.body)]);
  expect(sent).toContainEqual(['PUT', '/api/entries/E000036/access', { access: 'normal', version: 1 }]);
  expect(sent).toContainEqual(['PATCH', '/api/entries/E000040', { assignees: [], version: 1 }]);
  // 실패한 줄은 사유와 함께 고친 값이 남는다
  expect(within(screen.getByText('호선 빠짐').closest('tr')).getByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '변경 1건 저장' })).toBeEnabled();
});
