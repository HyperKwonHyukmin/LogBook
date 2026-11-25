import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TaskSheetCard, { matchRows } from './TaskSheetCard.jsx';

const row = (index, no, o = {}) => ({ index, no: String(no), row: 8 + index, name: `과제 ${no}`, status: '완료', key: `K-${no}`,
  exists: null, assignee_text: '구조가 연구원', assignees: [{ name: '구조가', label: '구조가(구조해석부, 연구원)', ref: { id: 1 } }],
  hull: '3496', target: '서비스타워', target_text: null, category: '안전', request_no: `R-${no}`, notices: [], checked: true, ...o });
const batch = (o = {}) => ({ key: 'B1', state: 'review', uploader: 'M1', original_name: '통합과제.xlsx', task_sheet: {
  file: '통합과제.xlsx', sheet: '과제 현황', year: 2026, total: 3, skipped: ['계획M/H'], unread: ['비고'], error: null, result: null,
  can_create: true, can_discard: true,
  rows: [row(0, 1), row(1, 2, { status: '착수 전', checked: false, assignees: [{ name: '없는이름', label: null, ref: null }], notices: ['명부에 없음(없는이름)'] }),
    row(2, 3, { exists: { entry_id: 'E000005', status: 'confirmed' }, checked: false, notices: ['이미 있음(E000005)'] })] }, ...o });

test('68 — 기본 체크(완료 등), 이미 있는 행은 고르지 못하고, 고른 행만 보낸다', async () => {
  const sent = [];
  vi.stubGlobal('fetch', vi.fn((url, init = {}) => {
    sent.push([url, init.body && JSON.parse(init.body)]);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ created: ['E000010', 'E000011'], failed: [], skipped: [] }) });
  }));
  const onChanged = vi.fn();
  render(<TaskSheetCard batch={batch()} onChanged={onChanged} />);
  expect(screen.getByRole('checkbox', { name: 'NO.1 고르기' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'NO.2 고르기' })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'NO.3 고르기' })).toBeDisabled();
  expect(screen.getByText(/넣지 않는 열: 계획M\/H/)).toBeInTheDocument();
  expect(screen.getByText('명부에 없음(없는이름)')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: 'NO.2 고르기' }));
  await userEvent.click(screen.getByRole('button', { name: '초안 2건 만들기' }));
  await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '2건 만들기' }));
  await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(sent).toEqual([['/api/batches/B1/task-drafts', { rows: [0, 1] }]]);
  vi.unstubAllGlobals();
});

test('과제 이름, 담당자로 찾아 그 행만 고른다. 휴지통에 같은 과제가 있는 행도 고를 수 있다', async () => {
  const sent = [];
  vi.stubGlobal('fetch', vi.fn((url, init = {}) => {
    sent.push(init.body && JSON.parse(init.body));
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ created: ['E000020'], failed: [], skipped: [] }) });
  }));
  const b = batch();
  b.task_sheet.rows = [row(0, 1, { name: '서비스타워 상세 검토' }),
    row(1, 2, { name: 'Shaft Generator TMH', assignees: [{ name: '이정훈', label: '이정훈(기장설계부, 책임)', ref: { id: 2 } }], assignee_text: '이정훈 책임' }),
    row(2, 3, { name: '골리앗 크레인', checked: false, trashed: { entry_id: 'E000262' }, notices: ['휴지통에 같은 과제가 있음(E000262), 고르면 새 초안을 만듭니다'] })];
  render(<TaskSheetCard batch={b} onChanged={() => {}} />);
  expect(matchRows(b.task_sheet.rows, '이정훈 shaft').map((r) => r.no)).toEqual(['2']);
  // 휴지통 행: 기본은 안 고름, 고를 수는 있다
  const trashRow = screen.getByRole('checkbox', { name: 'NO.3 고르기' });
  expect(trashRow).not.toBeChecked();
  expect(trashRow).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: '모두 해제' }));
  await userEvent.type(screen.getByRole('searchbox', { name: '과제 찾기' }), '크레인');
  expect(screen.queryByRole('checkbox', { name: 'NO.1 고르기' })).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('1행 보임');
  await userEvent.click(screen.getByRole('button', { name: '보이는 행 고르기' }));
  await userEvent.click(screen.getByRole('button', { name: '초안 1건 만들기' }));
  const dlg = await screen.findByRole('alertdialog');
  expect(dlg).toHaveTextContent('휴지통에 같은 과제가 있는 1건도 새 초안으로 만듭니다');
  await userEvent.click(within(dlg).getByRole('button', { name: '1건 만들기' }));
  await vi.waitFor(() => expect(sent).toEqual([{ rows: [2] }]));
  // 찾는 말에 맞는 행이 없을 때
  await userEvent.clear(screen.getByRole('searchbox', { name: '과제 찾기' }));
  await userEvent.type(screen.getByRole('searchbox', { name: '과제 찾기' }), '없는과제');
  expect(screen.getByText(/찾는 말에 맞는 과제가 없습니다/)).toBeInTheDocument();
  vi.unstubAllGlobals();
});

test('68 — LV1(만들 권한 없음)은 미리보기만, 만든 뒤에는 결과만 보인다', () => {
  const { unmount } = render(<TaskSheetCard batch={batch({ task_sheet: { ...batch().task_sheet, can_create: false, can_discard: false } })} />);
  expect(screen.getByText(/LV2 이상인 올린 사람만/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '초안 1건 만들기' })).toBeDisabled();
  unmount();
  render(<TaskSheetCard batch={batch({ state: 'processed', task_sheet: { file: 'x.xlsx', total: 3, result: { created: ['E1', 'E2'], failed: [], skipped: ['3'] } } })} />);
  expect(screen.getByRole('status')).toHaveTextContent('초안 2건을 만들었습니다. 이미 있어 건너뛴 행 1개.');
  expect(screen.queryByRole('table')).toBeNull();
});
