import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { calls, mockApi } from '../../test/mockApi.js';
import RevisionSection from './RevisionSection.jsx';

const SUMMARY = {
  identical: false,
  nodes: { a: 5, b: 6, added: 1, removed: 0, moved: 1, max_move: 3, mean_move: 3, tol: 0.01 },
  elements: { a: 3, b: 5, added: 2, removed: 0, added_by_card: { CTRIA3: 2 }, removed_by_card: {}, conn_changed: 0, card_changed: 0, pid_changed: 1, other_changed: 0 },
  rigids: { a: 1, b: 1, added: 0, removed: 0, indep_changed: 0, dep_changed: 0, other_changed: 0 },
  properties: { a: 2, b: 2, added: 0, removed: 0, changed: 1, thickness: 1, section: 0 },
  materials: { a: 1, b: 1, added: 0, removed: 0, changed: 0 },
  loads: { sets_a: 1, sets_b: 1, sets_changed: 1, spc_added: 0, spc_removed: 0, spc_changed: 0, spc_nodes_a: 2, spc_nodes_b: 2 },
  mass: { a: 1, b: 1, added: 0, removed: 0, changed: 0, total_a: 2.5, total_b: 2.5 },
  control: { sol_a: '101', sol_b: '101', changed: false, added: 0, removed: 0, other_added: 0, other_removed: 0 },
  truncated: {},
};
const DETAIL = {
  nodes: { added: [6], removed: [], moved: [3], top_moved: [[3, 3]] },
  elements: { added: [30, 31], removed: [], conn: [], card: [], pid: [{ eid: 1, a: '5', b: '6' }], other: [] },
  rigids: { added: [], removed: [], indep: [], dep: [], other: [] },
  properties: { added: [], removed: [], changed: [{ id: 5, card: 'PSHELL', text: 'PSHELL 5: T 12 → 14', changes: [{ field: 'T', a: '12', b: '14' }], thickness: true }] },
  materials: { added: [], removed: [], changed: [] },
  loads: { sets: [{ sid: '10', text: 'SID 10: 힘 합 (0, 0, -1000) → (0, 0, -1200)' }], spc_nodes: [] },
  mass: { added: [], removed: [], changed: [] },
  control: { added: [], removed: [], other_added: [], other_removed: [] },
  truncated: {},
};
const item = (id, name, display, extra = {}) => ({ file_id: id, name, rel_path: name, order: 0, label: null, auto_label: display,
  display, mark: null, is_latest: false, manual: false, model_state: 'done', ...extra });
const DATA = {
  entry_id: 'E000001', token: 'tok', manual: false, can_edit: true,
  series: [{ key: 'n:deck', manual: false,
    items: [item(1, 'deck.bdf', 'R0'), item(2, 'deck_r1.bdf', 'R1'), item(3, 'deck_r2.bdf', 'R2', { is_latest: true })],
    diffs: [{ a: 1, b: 2, id: 10, state: 'done', summary: SUMMARY, error: null, stale: false },
      { a: 2, b: 3, id: 11, state: 'error', summary: null, error: 'drm', stale: false }] }],
  others: [{ file_id: 9, name: 'other.bdf', rel_path: 'other.bdf', model_state: 'done' }],
};

function Probe() { const l = useLocation(); return <span data-testid="loc">{l.pathname}{l.search}</span>; }

function renderSection(map, props = {}) {
  const fetch = mockApi({ 'GET /api/entries/E000001/revisions': DATA, ...map });
  const onPick = vi.fn();
  const onSaved = vi.fn();
  render(
    <MemoryRouter initialEntries={['/e/E000001']}>
      <Routes>
        <Route path="/e/:id" element={<RevisionSection entryId="E000001" selectedId={2} onPick={onPick} onSaved={onSaved} {...props} />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
  return { fetch, onPick, onSaved };
}

test('판 흐름 줄 — 판 단추·최신·칩 상태', async () => {
  const { onPick } = renderSection({});
  const flow = await screen.findByRole('list', { name: '판 흐름' });
  expect(within(flow).getByRole('button', { name: /R1 deck_r1\.bdf/ })).toHaveAttribute('aria-current', 'true');
  expect(within(flow).getByText('최신')).toBeInTheDocument();
  const ok = within(flow).getByRole('button', { name: /R0 → R1 변경 요약/ });
  expect(ok).toHaveTextContent('요소 +2 · PID 변경 1 · 절점 +1 · 절점 이동 1 · 외 2');
  expect(within(flow).getByRole('button', { name: /R1 → R2 변경 요약/ })).toHaveTextContent('비교 실패: DRM 암호화 파일입니다');
  await userEvent.click(within(flow).getByRole('button', { name: /R0 deck\.bdf/ }));
  expect(onPick).toHaveBeenCalledWith(1);
});

test('칩을 누르면 변경 요약 — 범주·전후 값 표·ID 목록·3D 나란히 보기', async () => {
  renderSection({
    'GET /api/files/1/diff/2': { a: 1, b: 2, ...DATA.series[0].diffs[0] },
    'GET /api/files/1/diff/2/detail': DETAIL,
  });
  await userEvent.click(await screen.findByRole('button', { name: /R0 → R1 변경 요약/ }));
  const panel = await screen.findByRole('region', { name: '변경 요약' });
  expect(within(panel).getByText(/R0 · deck\.bdf → R1 · deck_r1\.bdf/)).toBeInTheDocument();
  expect(await within(panel).findByText('PSHELL')).toBeInTheDocument();
  expect(within(panel).getByText('14')).toBeInTheDocument();
  expect(within(panel).getByText('SID 10: 힘 합 (0, 0, -1000) → (0, 0, -1200)')).toBeInTheDocument();
  expect(within(panel).getByRole('heading', { name: /재료\s*변경 없음/ })).toBeInTheDocument();
  const ids = within(panel).getByRole('button', { name: /추가 요소 ID 2개/ });
  await userEvent.click(ids);
  expect(within(panel).getByText('30 31')).toBeInTheDocument();
  await userEvent.click(within(panel).getByRole('button', { name: /두 판 3D 나란히 보기/ }));
  expect(screen.getByTestId('loc')).toHaveTextContent('/compare?ids=1,2');
});

test('두 판 고르기 — 계열 밖 모델과 비교를 요청한다', async () => {
  const { fetch } = renderSection({
    'POST /api/files/1/diff/9': { a: 1, b: 9, id: 20, state: 'queued', summary: null, error: null, stale: false },
  });
  await userEvent.click(await screen.findByRole('button', { name: '두 판 고르기' }));
  const g = screen.getByRole('group', { name: '두 판 고르기' });
  await userEvent.selectOptions(within(g).getByLabelText('뒤 판'), '9');
  await userEvent.click(within(g).getByRole('button', { name: '비교' }));
  expect(await screen.findByText(/비교 중입니다/)).toBeInTheDocument();
  expect(calls(fetch)).toContain('POST /api/files/1/diff/9');
});

test('판 정리 — 순서·빼기·최신판·이름을 한 번에 저장', async () => {
  const saved = { ...DATA, manual: true };
  let body = null;
  const { onSaved } = renderSection({
    'PUT /api/entries/E000001/revisions': (init) => { body = JSON.parse(init.body); return saved; },
  });
  await userEvent.click(await screen.findByRole('button', { name: '판 정리' }));
  const ed = screen.getByRole('region', { name: '판 정리' });
  await userEvent.click(within(ed).getByRole('button', { name: 'deck_r2.bdf 위로' }));
  await userEvent.click(within(ed).getByRole('button', { name: 'deck.bdf 계열에서 빼기' }));
  await userEvent.type(within(ed).getByLabelText('deck_r2.bdf 판 이름'), '최종');
  await userEvent.selectOptions(within(ed).getByLabelText('other.bdf 넣을 계열'), '0');
  await userEvent.click(within(ed).getAllByRole('radio')[1]);
  await userEvent.click(within(ed).getByRole('button', { name: '완료' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(body).toEqual({ token: 'tok', series: [{ file_ids: [3, 2, 9], latest: 2, labels: { 3: '최종' } }] });
  expect(screen.queryByRole('region', { name: '판 정리' })).toBeNull();
});

test('판 정리 충돌·고칠 수 없는 사람', async () => {
  renderSection({ 'PUT /api/entries/E000001/revisions': { __status: 409, detail: 'revisions_conflict' } });
  await userEvent.click(await screen.findByRole('button', { name: '판 정리' }));
  await userEvent.click(screen.getByRole('button', { name: '완료' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('다른 사람이 그 사이 판을 정리했습니다');
});

test('수정 권한이 없으면 판 정리 단추가 없고, 정보 고치는 중이면 잠긴다', async () => {
  renderSection({ 'GET /api/entries/E000001/revisions': { ...DATA, can_edit: false } });
  await screen.findByRole('list', { name: '판 흐름' });
  expect(screen.queryByRole('button', { name: '판 정리' })).toBeNull();
});

test('정보 고치는 중에는 판 정리 단추가 잠긴다', async () => {
  renderSection({}, { locked: true });
  expect(await screen.findByRole('button', { name: '판 정리' })).toBeDisabled();
});

test('자동 추정으로 되돌리기는 확인 후', async () => {
  const { fetch } = renderSection({
    'GET /api/entries/E000001/revisions': { ...DATA, manual: true },
    'POST /api/entries/E000001/revisions/reset': DATA,
  });
  await userEvent.click(await screen.findByRole('button', { name: '판 정리' }));
  await userEvent.click(screen.getByRole('button', { name: /자동 추정으로 되돌리기/ }));
  await userEvent.click(await screen.findByRole('button', { name: '되돌리기' }));
  await waitFor(() => expect(calls(fetch)).toContain('POST /api/entries/E000001/revisions/reset'));
});

test('변경 없는 범주에 숫자 0 이 새지 않는다', async () => {
  renderSection({
    'GET /api/files/1/diff/2': { a: 1, b: 2, ...DATA.series[0].diffs[0] },
    'GET /api/files/1/diff/2/detail': DETAIL,
  });
  await userEvent.click(await screen.findByRole('button', { name: /R0 → R1 변경 요약/ }));
  const panel = await screen.findByRole('region', { name: '변경 요약' });
  await within(panel).findByText('PSHELL');
  expect(within(panel).getByRole('heading', { name: /강체/ }).parentElement.textContent).toBe('강체변경 없음');
});

test('16 — 3D 변경 보기 진입: 판 흐름 칩 옆 단추(끝난 비교만), 변경 요약 패널 단추', async () => {
  renderSection({
    'GET /api/files/1/diff/2': { a: 1, b: 2, ...DATA.series[0].diffs[0] },
    'GET /api/files/1/diff/2/detail': DETAIL,
  });
  const flow = await screen.findByRole('list', { name: '판 흐름' });
  // 실패한 R1 → R2 에는 단추가 없다
  expect(within(flow).queryByRole('button', { name: 'R1 → R2 3D 변경 보기' })).toBeNull();
  await userEvent.click(within(flow).getByRole('button', { name: /R0 → R1 변경 요약/ }));
  const panel = await screen.findByRole('region', { name: '변경 요약' });
  await userEvent.click(within(panel).getByRole('button', { name: /3D로 변경 보기/ }));
  expect(screen.getByTestId('loc')).toHaveTextContent('/compare?ids=1,2&view=diff');
});

test('16 — 판 흐름 칩 옆 3D 단추로 바로 변경 보기', async () => {
  renderSection({});
  const flow = await screen.findByRole('list', { name: '판 흐름' });
  await userEvent.click(within(flow).getByRole('button', { name: 'R0 → R1 3D 변경 보기' }));
  expect(screen.getByTestId('loc')).toHaveTextContent('/compare?ids=1,2&view=diff');
});

test('16 — 같은 판이면 3D 단추가 없다', async () => {
  const same = { ...DATA, series: [{ ...DATA.series[0], diffs: [{ ...DATA.series[0].diffs[0], summary: { identical: true } }, DATA.series[0].diffs[1]] }] };
  renderSection({ 'GET /api/entries/E000001/revisions': same });
  const flow = await screen.findByRole('list', { name: '판 흐름' });
  expect(within(flow).queryByRole('button', { name: 'R0 → R1 3D 변경 보기' })).toBeNull();
});
