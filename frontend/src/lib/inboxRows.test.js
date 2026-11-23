import { bulkPick, groupRows, flatRows, rowMeta } from './inboxRows.js';

const row = (id, key, state, o = {}) => ({ entry_id: id, title: id, state, reason: '', can_confirm: true, file_count: 1,
  hulls: [], assignees: [], batch: { key, name: key, received_at: o.at || '2026-11-23T10:00:00', state: 'processed' }, ...o });

test('묶음별로 모으고 할 일 순으로 정렬한다', () => {
  const rows = [row('E3', 'B1', 'waiting_files'), row('E1', 'B1', 'ready'), row('E2', 'B1', 'needs_check'),
    row('E9', 'B2', 'ready', { at: '2026-11-23T11:00:00' })];
  const { groups } = groupRows(rows, []);
  expect(groups.map((g) => g.key)).toEqual(['B2', 'B1']);   // 최근 묶음 먼저
  expect(groups[1].rows.map((r) => r.entry_id)).toEqual(['E1', 'E2', 'E3']);
  expect(flatRows(groups).map((r) => r.entry_id)).toEqual(['E9', 'E1', 'E2', 'E3']);
});

test('줄 없는 묶음: 분석 중은 머리만, 끝난 것은 settled, 임시 첨부 묶음은 뺀다', () => {
  const batches = [
    { key: 'S', original_name: '분석 중 폴더', state: 'staged', received_at: '2026-11-23T12:00:00' },
    { key: 'D', original_name: '같은 BDF', state: 'done', received_at: '2026-11-22T12:00:00', excluded: [{ reason: 'duplicate_model' }] },
    { key: 'A', original_name: '자동 확정', state: 'done', received_at: '2026-11-22T13:00:00', auto_result: { confirmed: ['E1'], kept: [] } },
    { key: 'T', original_name: '첨부', state: 'processed', attachment_target: 'E5', received_at: '2026-11-23T12:30:00' },
  ];
  const { groups, settled } = groupRows([], batches);
  expect(groups.map((g) => g.key)).toEqual(['S', 'A']);
  expect(settled.map((b) => b.key)).toEqual(['D']);
});

test('상태 거르기는 남은 줄이 없는 묶음을 뺀다', () => {
  const rows = [row('E1', 'B1', 'ready'), row('E2', 'B2', 'needs_check')];
  const batches = [{ key: 'S', original_name: 's', state: 'staged', received_at: '2026-11-23T12:00:00' }];
  const { groups } = groupRows(rows, batches, new Set(['ready']));
  expect(groups.map((g) => g.key)).toEqual(['B1']);
});

test('한꺼번에 확정은 확정 가능하고 권한 있는 줄만, 고치는 중인 초안은 건너뛴다', () => {
  const rows = [row('E1', 'B', 'ready'), row('E2', 'B', 'needs_check', { reason: '제목 없음' }),
    row('E3', 'B', 'ready', { can_confirm: false }), row('E4', 'B', 'ready'), row('E5', 'B', 'attaching')];
  const { go, skip } = bulkPick(rows, 'E4');
  expect(go.map((r) => r.entry_id)).toEqual(['E1']);
  expect(skip.map((s) => [s.row.entry_id, s.reason])).toEqual([
    ['E2', '제목 없음'], ['E3', '확정 권한 없음'], ['E4', '저장하지 않은 변경'], ['E5', '첨부 중']]);
});

test('줄 둘째 줄 — 호선, 담당자, 파일 수', () => {
  expect(rowMeta(row('E1', 'B', 'ready', { hulls: ['3496'], assignees: [{ name: '김해석' }], file_count: 3 })))
    .toEqual(['3496', '담당 김해석', '파일 3']);
  expect(rowMeta(row('E1', 'B', 'ready', { no_hull: true, file_count: 0 }))).toEqual(['공용', '파일 0']);
});
