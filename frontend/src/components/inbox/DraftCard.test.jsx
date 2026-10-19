import { vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DraftCard from './DraftCard.jsx';
import { invalidateVocab } from '../../lib/vocab.js';

const ENTRY = {
  entry_id: 'E000010', status: 'draft', title: '9999 연결시험', version: 3, analysis_type: null,
  analysis_period: null, description: null, zones: [],
  hulls: [{ hull_no: '9999', ship_type: null, is_primary: true }],
  hull_evidence: [{ hull_no: '9999', score: 5, reasons: ['파일명 2개'] }],
  suggested_entry: { entry_id: 'E000001', title: '기존 해석' }, merge_into: null,
  files: [
    { id: 1, rel_path: '9999_시험/a.bdf', name: 'a.bdf', kind: 'model', size: 2048, duplicate_of_entry: null, drm_encrypted: false },
    { id: 2, rel_path: '9999_시험/r.pdf', name: 'r.pdf', kind: 'report', size: 10, duplicate_of_entry: 'E000045', drm_encrypted: false },
  ],
};
const OTHER = { entry_id: 'E000011', title: '다른 묶음' };
// 20 — BDF 자료는 호선·구역·해석 종류가 있어야 확정 단추가 열린다
const READY = { ...ENTRY, zones: ['선수부'], analysis_type: '강도 평가' };
// 분류 목록(08) — 해석 종류·구역 입력이 받아 간다
const VOCAB = {
  '/api/vocab?kind=atype': { kind: 'atype', other: '기타', terms: [
    { id: 1, value: '강도 평가', active: true, count: 0, synonyms: [] },
    { id: 2, value: '피로 평가', active: true, count: 0, synonyms: [{ id: 9, value: '피로 해석' }] },
    { id: 3, value: '기타', active: true, count: 0, synonyms: [] }] },
  '/api/vocab?kind=zone': { kind: 'zone', other: '기타', terms: [
    { id: 4, value: '선수부', active: true, count: 0, synonyms: [{ id: 8, value: 'FWD' }] },
    { id: 5, value: '기타', active: true, count: 0, synonyms: [] }] },
  // 38 — 대상 구조물
  '/api/vocab?kind=target': { kind: 'target', other: '기타', terms: [
    { id: 6, value: '계류 의장품', active: true, count: 0, synonyms: [{ id: 7, value: 'Mooring Fitting' }] }] },
};
const vocabReply = (url) => VOCAB[url] && Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(VOCAB[url]) });

beforeEach(() => invalidateVocab());

function mockFetch(map) {
  vi.stubGlobal('fetch', vi.fn((url, init = {}) => {
    const key = `${init.method || 'GET'} ${url}`;
    if (key.startsWith('GET /api/suggest')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    if (VOCAB[url]) return vocabReply(url);
    const r = map[key];
    if (!r) throw new Error(`unexpected ${key}`);
    return Promise.resolve(r.__status ? { ok: false, status: r.__status, json: () => Promise.resolve({ detail: r.detail }) }
                                     : { ok: true, status: 200, json: () => Promise.resolve(r) });
  }));
}
const bodyOf = (method, url) => JSON.parse(fetch.mock.calls.find(([u, i = {}]) => u === url && i.method === method)[1].body);

test('중복 파일에 기존 Entry 번호를 보여 준다', () => {
  mockFetch({});
  render(<DraftCard entry={ENTRY} siblings={[]} canEdit onChanged={() => {}} />);
  expect(screen.getByText('E000045 에 이미 있음')).toBeInTheDocument();
});

test('파일을 골라 새 묶음으로 나눈다', async () => {
  mockFetch({ 'POST /api/entries/E000010/split': { entry_id: 'E000012' } });
  const onChanged = vi.fn();
  render(<DraftCard entry={ENTRY} siblings={[]} canEdit onChanged={onChanged} />);
  await userEvent.click(screen.getByRole('checkbox', { name: '9999_시험/r.pdf 선택' }));
  await userEvent.click(screen.getByRole('button', { name: '새 묶음으로 나누기' }));
  expect(bodyOf('POST', '/api/entries/E000010/split')).toEqual({ file_ids: [2] });
  expect(onChanged).toHaveBeenCalled();
});

test('옮기기 선택으로 파일을 다른 묶음에 보낸다', async () => {
  mockFetch({ 'POST /api/files/1/move': { ok: true } });
  render(<DraftCard entry={ENTRY} siblings={[OTHER]} canEdit onChanged={() => {}} />);
  await userEvent.selectOptions(screen.getByLabelText('9999_시험/a.bdf 옮기기'), 'E000011');
  expect(bodyOf('POST', '/api/files/1/move')).toEqual({ to_entry_id: 'E000011' });
});

test('다른 카드에서 끌어 온 파일을 놓으면 이 묶음으로 옮긴다', async () => {
  mockFetch({ 'POST /api/files/7/move': { ok: true } });
  render(<DraftCard entry={ENTRY} siblings={[OTHER]} canEdit onChanged={() => {}} />);
  const card = screen.getByRole('article', { name: /E000010/ });
  fireEvent.drop(card, { dataTransfer: { getData: () => JSON.stringify({ fileId: 7, from: 'E000011' }) } });
  await vi.waitFor(() => expect(bodyOf('POST', '/api/files/7/move')).toEqual({ to_entry_id: 'E000010' }));
});

test('기존 Entry 추가 제안을 받아들인다', async () => {
  mockFetch({ 'PATCH /api/entries/E000010': { ...ENTRY, merge_into: ENTRY.suggested_entry, version: 4 } });
  render(<DraftCard entry={ENTRY} siblings={[]} canEdit onChanged={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: 'E000001 에 추가' }));
  expect(bodyOf('PATCH', '/api/entries/E000010')).toEqual({ version: 3, merge_into_id: 'E000001' });
});

test('확정과 버리기', async () => {
  mockFetch({ 'POST /api/entries/E000010/confirm': { ...ENTRY, status: 'confirmed' },
              'DELETE /api/entries/E000010': { ...ENTRY, status: 'trashed' } });
  const onChanged = vi.fn();
  render(<DraftCard entry={READY} siblings={[]} canEdit onChanged={onChanged} />);
  await userEvent.click(screen.getByRole('button', { name: '확정' }));
  await userEvent.click(screen.getByRole('button', { name: '버리기' }));
  // 초안은 복원할 수 없어 확인 대화상자를 거친다.
  await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '버리기' }));
  const calls = fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`);
  expect(calls).toContain('POST /api/entries/E000010/confirm');
  expect(calls).toContain('DELETE /api/entries/E000010');
  expect(onChanged).toHaveBeenCalledTimes(2);
});

test('남의 초안은 고칠 수 없다', () => {
  mockFetch({});
  render(<DraftCard entry={ENTRY} siblings={[]} canEdit={false} onChanged={() => {}} />);
  expect(screen.getByLabelText('제목')).toBeDisabled();
  expect(screen.getByRole('button', { name: '확정' })).toBeDisabled();
  expect(within(screen.getByRole('article')).queryByRole('checkbox')).toBeNull();
});

function deferredFetch() {
  const queue = [];
  vi.stubGlobal('fetch', vi.fn((url, init = {}) => {
    if (url.startsWith('/api/suggest')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    if (VOCAB[url]) return vocabReply(url);
    return new Promise((resolve) => {
      queue.push({ key: `${init.method || 'GET'} ${url}`, body: init.body ? JSON.parse(init.body) : null,
        resolve: (r) => resolve({ ok: true, status: 200, json: () => Promise.resolve(r) }) });
    });
  }));
  return queue;
}

test('같은 내용의 새 entry 객체로 다시 그려도(폴링) 저장 전 입력이 남는다', async () => {
  mockFetch({});
  const { rerender } = render(<DraftCard entry={ENTRY} siblings={[]} canEdit onChanged={() => {}} />);
  const title = screen.getByLabelText('제목');
  await userEvent.type(title, ' 수정중');
  await userEvent.click(screen.getByRole('checkbox', { name: '9999_시험/a.bdf 선택' }));
  rerender(<DraftCard entry={{ ...ENTRY, files: [...ENTRY.files] }} siblings={[]} canEdit onChanged={() => {}} />);
  expect(screen.getByLabelText('제목')).toHaveValue('9999 연결시험 수정중');
  expect(screen.getByRole('checkbox', { name: '9999_시험/a.bdf 선택' })).toBeChecked();
});

/* ── 11 — 고친 칸은 바로 저장하지 않는다: [변경 저장] 또는 [저장하고 확정] 이 한 번의 PATCH 로 ── */

const patches = () => fetch.mock.calls.filter(([, i = {}]) => i.method === 'PATCH').map(([, i]) => JSON.parse(i.body));

test('고쳐도 칸을 벗어날 때 저장하지 않고, [변경 저장] 이 바뀐 칸 전부를 한 번에 보낸다', async () => {
  mockFetch({ 'PATCH /api/entries/E000010': { ...ENTRY, title: '새 제목', analysis_type: '피로 평가', hulls: [{ hull_no: '9999' }, { hull_no: '9998' }], version: 4 } });
  const onChanged = vi.fn();
  const onDirty = vi.fn();
  render(<DraftCard entry={ENTRY} siblings={[OTHER]} canEdit onChanged={onChanged} onDirtyChange={onDirty} />);
  const title = screen.getByLabelText('제목');
  await userEvent.clear(title);
  await userEvent.type(title, '새 제목');
  await userEvent.tab();
  // 해석 종류는 목록에서 고른다(08) — 동의어 '피로 해석' 을 쳐도 용어 '피로 평가'
  await userEvent.type(screen.getByLabelText('해석 종류'), '피로 해석');
  await userEvent.keyboard('{Enter}');
  await userEvent.type(screen.getByRole('combobox', { name: '호선' }), '9998{Enter}');
  expect(patches()).toHaveLength(0);
  expect(onDirty).toHaveBeenLastCalledWith('E000010', true);
  const bar = screen.getByRole('status', { name: '저장하지 않은 변경' });
  expect(bar).toHaveTextContent('저장하지 않은 변경 3칸 · 제목, 해석 종류, 호선');
  expect(screen.getByRole('button', { name: '저장하고 확정' })).toBeInTheDocument();
  await userEvent.click(within(bar).getByRole('button', { name: '변경 저장' }));
  await vi.waitFor(() => expect(patches()).toEqual([{ version: 3, title: '새 제목', analysis_type: '피로 평가', hulls: ['9999', '9998'] }]));
  await vi.waitFor(() => expect(screen.queryByRole('status', { name: '저장하지 않은 변경' })).toBeNull());
  expect(onChanged).toHaveBeenCalled();
  expect(onDirty).toHaveBeenLastCalledWith('E000010', false);
});

test('되돌리기는 서버 값으로 돌아간다(PATCH 없음)', async () => {
  mockFetch({});
  render(<DraftCard entry={ENTRY} siblings={[]} canEdit onChanged={() => {}} />);
  await userEvent.type(screen.getByLabelText('설명'), '메모');
  await userEvent.click(screen.getByRole('button', { name: '되돌리기' }));
  expect(screen.getByLabelText('설명')).toHaveValue('');
  expect(screen.getByRole('button', { name: '확정' })).toBeInTheDocument();
  expect(patches()).toHaveLength(0);
});

test('저장하지 않은 변경이 있으면 [저장하고 확정] 이 저장이 끝난 다음 확정한다', async () => {
  const q = deferredFetch();
  const onChanged = vi.fn();
  render(<DraftCard entry={READY} siblings={[]} canEdit onChanged={onChanged} />);
  await userEvent.type(screen.getByLabelText('제목'), '!');
  await userEvent.click(screen.getByRole('button', { name: '저장하고 확정' }));
  await vi.waitFor(() => expect(q.map((c) => c.key)).toEqual(['PATCH /api/entries/E000010']));
  expect(q[0].body).toEqual({ version: 3, title: '9999 연결시험!' });
  q[0].resolve({ ...ENTRY, title: '9999 연결시험!', version: 4 });
  await vi.waitFor(() => expect(q.map((c) => c.key)).toEqual(['PATCH /api/entries/E000010', 'POST /api/entries/E000010/confirm']));
  q[1].resolve({ ...ENTRY, status: 'confirmed' });
  await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
});

test('저장이 실패(충돌)하면 확정하지 않고 알리고 새로 부른다', async () => {
  mockFetch({ 'PATCH /api/entries/E000010': { __status: 409, detail: 'version_conflict' } });
  const onChanged = vi.fn();
  render(<DraftCard entry={READY} siblings={[]} canEdit onChanged={onChanged} />);
  await userEvent.type(screen.getByLabelText('제목'), '!');
  await userEvent.click(screen.getByRole('button', { name: '저장하고 확정' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('저장하지 못해 확정하지 않았습니다. 다른 사람이 먼저 고쳤습니다');
  expect(fetch.mock.calls.some(([u]) => u.endsWith('/confirm'))).toBe(false);
  expect(onChanged).toHaveBeenCalled();
  // 고친 글자는 남는다
  expect(screen.getByLabelText('제목')).toHaveValue('9999 연결시험!');
});

test('해석 시기 칸은 없다(15)', () => {
  mockFetch({});
  render(<DraftCard entry={{ ...ENTRY, analysis_period: '2026-09' }} siblings={[]} canEdit onChanged={() => {}} />);
  expect(screen.queryByLabelText('해석 시기')).toBeNull();
  expect(screen.queryByText('2026-09')).toBeNull();
});

test('공개 범위 — 기본 일반, 블록은 LV3(can_block)에게만, 고르면 그 한 칸만 바로 저장', async () => {
  mockFetch({ 'PATCH /api/entries/E000010': { ...ENTRY, version: 4, access: 'shared' } });
  const onChanged = vi.fn();
  const { unmount } = render(<DraftCard entry={ENTRY} siblings={[]} canEdit onChanged={onChanged} />);
  const select = screen.getByRole('combobox', { name: '공개 범위' });
  expect(select).toHaveValue('normal');
  expect([...select.options].map((o) => o.value)).toEqual(['shared', 'normal']);
  await userEvent.selectOptions(select, 'shared');
  await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(bodyOf('PATCH', '/api/entries/E000010')).toEqual({ version: 3, access: 'shared' });
  unmount();
  render(<DraftCard entry={{ ...ENTRY, can_block: true }} siblings={[]} canEdit onChanged={() => {}} />);
  expect([...screen.getByRole('combobox', { name: '공개 범위' }).options].map((o) => o.value)).toEqual(['shared', 'normal', 'blocked']);
});

test('나누기 전에 바뀐 칸을 먼저 저장하고, 합치기 응답(이 Entry)의 version 을 다음 저장에 쓴다', async () => {
  const q = deferredFetch();
  render(<DraftCard entry={ENTRY} siblings={[OTHER]} canEdit onChanged={() => {}} />);
  await userEvent.selectOptions(screen.getByLabelText('다른 묶음과 합치기'), 'E000011');
  await vi.waitFor(() => expect(q).toHaveLength(1));
  q[0].resolve({ ...ENTRY, version: 7 });
  await userEvent.type(screen.getByLabelText('제목'), '!');
  await userEvent.click(screen.getByRole('checkbox', { name: '9999_시험/r.pdf 선택' }));
  await userEvent.click(screen.getByRole('button', { name: '새 묶음으로 나누기' }));
  await vi.waitFor(() => expect(q).toHaveLength(2));
  expect(q[1]).toMatchObject({ key: 'PATCH /api/entries/E000010', body: { version: 7, title: '9999 연결시험!' } });
  q[1].resolve({ ...ENTRY, title: '9999 연결시험!', version: 8 });
  await vi.waitFor(() => expect(q).toHaveLength(3));
  expect(q[2]).toMatchObject({ key: 'POST /api/entries/E000010/split', body: { file_ids: [2] } });
});

test('구역은 목록에서 칩으로 고르고, 동의어를 치면 대표 용어가 들어간다', async () => {
  mockFetch({ 'PATCH /api/entries/E000010': { ...ENTRY, zones: ['선수부'], version: 4 } });
  render(<DraftCard entry={ENTRY} siblings={[]} canEdit onChanged={() => {}} />);
  const zone = screen.getByRole('combobox', { name: '구역' });
  await userEvent.type(zone, 'fwd');
  expect(await screen.findByRole('option', { name: /선수부/ })).toHaveTextContent('FWD 의 대표 용어');
  await userEvent.keyboard('{Enter}');
  await userEvent.click(screen.getByRole('button', { name: '변경 저장' }));
  await vi.waitFor(() => expect(bodyOf('PATCH', '/api/entries/E000010')).toEqual({ version: 3, zones: ['선수부'] }));
});

const SAME_REF = { file_id: 9, name: 'a_원본.bdf', rel_path: '9999/a_원본.bdf', entry_id: 'E000123',
  entry_title: '9999 원본', entry_status: 'confirmed' };

test('같은 BDF(12) — 동일 BDF 는 주의 칩(링크), 형상만 같으면 옅은 정보 칩', () => {
  mockFetch({});
  const entry = { ...ENTRY, files: [
    { ...ENTRY.files[0], model: { state: 'done', same_model: [SAME_REF, { ...SAME_REF, file_id: 10, entry_id: 'E000124' }],
      same_model_total: 2, same_geometry: [], same_geometry_total: 0 } },
    { ...ENTRY.files[0], id: 3, rel_path: '9999_시험/b.bdf', name: 'b.bdf',
      model: { state: 'done', same_model: [], same_model_total: 0,
        same_geometry: [{ ...SAME_REF, differs: ['material'] }], same_geometry_total: 1 } },
    { ...ENTRY.files[0], id: 4, rel_path: '9999_시험/c.bdf', name: 'c.bdf',
      model: { state: 'queued', same_model: [], same_model_total: 0, same_geometry: [], same_geometry_total: 0 } },
  ] };
  render(<DraftCard entry={entry} siblings={[]} canEdit onChanged={() => {}} />);
  const dup = screen.getByRole('link', { name: /동일 BDF 있음: E000123 a_원본\.bdf 외 1/ });
  expect(dup).toHaveAttribute('href', '/e/E000123');
  expect(dup.title).toContain('E000124 / 9999/a_원본.bdf');
  const shape = screen.getByRole('link', { name: /같은 형상: E000123 a_원본\.bdf/ });
  expect(shape.title).toContain('재료 다름');
  expect(screen.getAllByRole('link', { name: /동일 BDF 있음|같은 형상/ })).toHaveLength(2);   // 변환 전(c.bdf)은 없음
});

test('초안 안에 판 묶음이 있으면 흐름 한 줄(14)', () => {
  mockFetch({});
  const entry = { ...ENTRY, revisions: [{ key: 'n:a', items: [
    { file_id: 1, name: 'a.bdf', display: 'R0', is_latest: false },
    { file_id: 3, name: 'a_r1.bdf', display: 'R1', is_latest: true }] }] };
  render(<DraftCard entry={entry} siblings={[]} canEdit onChanged={() => {}} />);
  const line = screen.getByRole('list', { name: '판 묶음' });
  expect(line).toHaveTextContent('판R0 a.bdf→R1 a_r1.bdf최신');
});

test('판 묶음이 없으면 흐름 줄도 없다', () => {
  mockFetch({});
  render(<DraftCard entry={{ ...ENTRY, revisions: [] }} siblings={[]} canEdit onChanged={() => {}} />);
  expect(screen.queryByRole('list', { name: '판 묶음' })).toBeNull();
});

/* ── 20 — 필수 분류·공용 호선·제목 형식·비슷한 제목 ── */

test('BDF 자료는 구역·해석 종류가 없으면 확정 단추가 잠기고 이유를 보인다', () => {
  mockFetch({});
  render(<DraftCard entry={ENTRY} siblings={[]} canEdit onChanged={() => {}} />);
  const btn = screen.getByRole('button', { name: '확정' });
  expect(btn).toBeDisabled();
  expect(btn).toHaveAttribute('title', expect.stringContaining('구역 없음'));
  expect(screen.getByLabelText('확인할 것')).toHaveTextContent('해석 종류 없음: BDF 자료는 해석 종류가 필요합니다');
});

test('확정 409 required_fields 는 빠진 칸을 사람 말로 보인다', async () => {
  mockFetch({ 'POST /api/entries/E000010/confirm': { __status: 409, detail: { code: 'required_fields', missing: ['zone'] } } });
  render(<DraftCard entry={READY} siblings={[]} canEdit onChanged={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: '확정' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('빠진 칸: 구역');
});

test("'호선 없음(공용)' 을 고르면 호선을 비우고, 바뀐 칸 하나로 저장한다", async () => {
  mockFetch({ 'PATCH /api/entries/E000010': { ...READY, hulls: [], no_hull: true, version: 4 } });
  render(<DraftCard entry={READY} siblings={[]} canEdit onChanged={() => {}} />);
  await userEvent.click(screen.getByRole('checkbox', { name: /호선 없음\(공용\)/ }));
  expect(screen.queryByText('9999')).toBeNull();
  // 공용이면 호선 없이도 확정을 막지 않는다
  expect(screen.getByRole('button', { name: '저장하고 확정' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: '변경 저장' }));
  await vi.waitFor(() => expect(patches()).toEqual([{ version: 3, hulls: [], no_hull: true }]));
});

test('제목이 초안 그대로면 값을 바꿀 때 "저장하면 형식대로" 안내, 직접 고친 제목이면 [형식대로 다시 만들기]', async () => {
  mockFetch({ 'PATCH /api/entries/E000010': { ...READY, title: '9999 · 선수부 · 강도 평가 · 시험', version: 4 } });
  const auto = { ...READY, title: '9999 · 시험', title_draft: '9999 · 선수부 · 강도 평가 · 시험', title_is_auto: true };
  const { unmount } = render(<DraftCard entry={{ ...auto, title_draft: auto.title, zones: [], analysis_type: null }} siblings={[]} canEdit onChanged={() => {}} />);
  await userEvent.type(screen.getByLabelText('설명'), 'x');
  expect(screen.queryByText(/저장하면 제목이 형식대로/)).toBeNull();   // 분류 값이 아니면 안내 없음
  await userEvent.type(screen.getByLabelText('해석 종류'), '피로 해석');
  await userEvent.keyboard('{Enter}');
  expect(await screen.findByText(/저장하면 제목이 형식대로 바뀝니다/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '형식대로 다시 만들기' })).toBeNull();
  unmount();
  render(<DraftCard entry={{ ...auto, title: '직접 지은 제목', title_is_auto: false }} siblings={[]} canEdit onChanged={() => {}} />);
  expect(screen.getByText('9999 · 선수부 · 강도 평가 · 시험')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '형식대로 다시 만들기' }));
  await vi.waitFor(() => expect(patches()).toEqual([{ version: 3, title_auto: true }]));
});

test('같은 호선의 같은·비슷한 제목 — 경고와 자료 링크, [새 판이면 이 자료에 추가] 는 합치기 제안과 같은 PATCH', async () => {
  mockFetch({ 'PATCH /api/entries/E000010': { ...READY, version: 4 } });
  const entry = { ...READY, suggested_entry: null, similar_entries: [
    { entry_id: 'E000077', title: '9999 연결시험', match: 'same' },
    { entry_id: 'E000078', title: '9999 연결시험 2차', match: 'similar' }] };
  render(<DraftCard entry={entry} siblings={[]} canEdit onChanged={() => {}} />);
  const box = screen.getByRole('region', { name: '비슷한 제목' });
  expect(within(box).getByRole('link', { name: 'E000077' })).toHaveAttribute('href', '/e/E000077');
  expect(box).toHaveTextContent('같은 제목');
  expect(box).toHaveTextContent('비슷한 제목');
  // 막지 않는다
  expect(screen.getByRole('button', { name: '확정' })).toBeEnabled();
  await userEvent.click(within(box).getByRole('button', { name: 'E000078 에 새 판으로 추가' }));
  await vi.waitFor(() => expect(patches()).toEqual([{ version: 3, merge_into_id: 'E000078' }]));
});
