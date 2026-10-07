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
// 분류 목록(08) — 해석 종류·구역 입력이 받아 간다
const VOCAB = {
  '/api/vocab?kind=atype': { kind: 'atype', other: '기타', terms: [
    { id: 1, value: '강도 평가', active: true, count: 0, synonyms: [] },
    { id: 2, value: '피로 평가', active: true, count: 0, synonyms: [{ id: 9, value: '피로 해석' }] },
    { id: 3, value: '기타', active: true, count: 0, synonyms: [] }] },
  '/api/vocab?kind=zone': { kind: 'zone', other: '기타', terms: [
    { id: 4, value: '선수부', active: true, count: 0, synonyms: [{ id: 8, value: 'FWD' }] },
    { id: 5, value: '기타', active: true, count: 0, synonyms: [] }] },
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

test('제목을 고치고 칸을 벗어나면 version 과 함께 저장한다', async () => {
  mockFetch({ 'PATCH /api/entries/E000010': { ...ENTRY, title: '새 제목', version: 4 } });
  const onChanged = vi.fn();
  render(<DraftCard entry={ENTRY} siblings={[OTHER]} canEdit onChanged={onChanged} />);
  const title = screen.getByLabelText('제목');
  await userEvent.clear(title);
  await userEvent.type(title, '새 제목');
  await userEvent.tab();
  expect(bodyOf('PATCH', '/api/entries/E000010')).toEqual({ version: 3, title: '새 제목' });
  expect(onChanged).toHaveBeenCalled();
});

test('버전 충돌이면 안내하고 새로 부른다', async () => {
  mockFetch({ 'PATCH /api/entries/E000010': { __status: 409, detail: 'version_conflict' } });
  const onChanged = vi.fn();
  render(<DraftCard entry={ENTRY} siblings={[]} canEdit onChanged={onChanged} />);
  await userEvent.type(screen.getByLabelText('제목'), '!');
  await userEvent.tab();
  expect(await screen.findByRole('alert')).toHaveTextContent('다른 사람이 먼저 고쳤습니다');
  expect(onChanged).toHaveBeenCalled();
});

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
  render(<DraftCard entry={ENTRY} siblings={[]} canEdit onChanged={onChanged} />);
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

test('제목을 고친 뒤 곧바로 확정을 누르면 저장이 끝난 다음 확정한다', async () => {
  const q = deferredFetch();
  const onChanged = vi.fn();
  render(<DraftCard entry={ENTRY} siblings={[]} canEdit onChanged={onChanged} />);
  await userEvent.type(screen.getByLabelText('제목'), '!');
  await userEvent.click(screen.getByRole('button', { name: '확정' }));
  await vi.waitFor(() => expect(q.map((c) => c.key)).toEqual(['PATCH /api/entries/E000010']));
  q[0].resolve({ ...ENTRY, title: '9999 연결시험!', version: 4 });
  await vi.waitFor(() => expect(q.map((c) => c.key)).toEqual(['PATCH /api/entries/E000010', 'POST /api/entries/E000010/confirm']));
  q[1].resolve({ ...ENTRY, status: 'confirmed' });
  await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
});

test('빠르게 두 칸을 저장하면 두 번째 PATCH 는 첫 응답의 version 을 쓴다', async () => {
  const q = deferredFetch();
  render(<DraftCard entry={ENTRY} siblings={[]} canEdit onChanged={() => {}} />);
  await userEvent.type(screen.getByLabelText('제목'), '!');
  await userEvent.tab();
  const kind = screen.getByLabelText('해석 종류');
  expect(kind).toHaveFocus();
  expect(kind).toBeEnabled();
  // 해석 종류는 목록에서 고른다(08) — 동의어 '피로 해석' 을 쳐도 용어 '피로 평가' 로 저장
  await userEvent.type(kind, '피로 해석');
  await userEvent.keyboard('{Enter}');
  expect(q).toHaveLength(1);
  q[0].resolve({ ...ENTRY, title: '9999 연결시험!', version: 4 });
  await vi.waitFor(() => expect(q).toHaveLength(2));
  expect(q[1].body).toEqual({ version: 4, analysis_type: '피로 평가' });
});

test('첫 저장이 끝나기 전에 호선 칩을 둘 더해도 두 번째 PATCH 에 모두 실린다', async () => {
  const q = deferredFetch();
  render(<DraftCard entry={ENTRY} siblings={[]} canEdit onChanged={() => {}} />);
  const hull = screen.getByRole('combobox', { name: '호선' });
  await userEvent.type(hull, '9998{Enter}');
  await userEvent.type(hull, '9997{Enter}');
  expect(screen.getByRole('button', { name: '9998 빼기' })).toBeInTheDocument();
  await vi.waitFor(() => expect(q).toHaveLength(1));
  expect(q[0].body).toEqual({ version: 3, hulls: ['9999', '9998'] });
  q[0].resolve({ ...ENTRY, version: 4 });
  await vi.waitFor(() => expect(q).toHaveLength(2));
  expect(q[1].body).toEqual({ version: 4, hulls: ['9999', '9998', '9997'] });
});

test('합치기 응답(이 Entry)의 version 을 다음 저장에 쓰고, 나누기 응답(새 Entry)의 version 은 쓰지 않는다', async () => {
  const q = deferredFetch();
  render(<DraftCard entry={ENTRY} siblings={[OTHER]} canEdit onChanged={() => {}} />);
  await userEvent.selectOptions(screen.getByLabelText('다른 묶음과 합치기'), 'E000011');
  await vi.waitFor(() => expect(q).toHaveLength(1));
  q[0].resolve({ ...ENTRY, version: 7 });
  await userEvent.click(screen.getByRole('checkbox', { name: '9999_시험/r.pdf 선택' }));
  await userEvent.click(screen.getByRole('button', { name: '새 묶음으로 나누기' }));
  await vi.waitFor(() => expect(q).toHaveLength(2));
  q[1].resolve({ entry_id: 'E000012', version: 1 });
  await userEvent.type(screen.getByLabelText('제목'), '!');
  await userEvent.tab();
  await vi.waitFor(() => expect(q).toHaveLength(3));
  expect(q[2].body).toEqual({ version: 7, title: '9999 연결시험!' });
});

test('앞선 저장이 실패한 채로 확정을 누르면 확정하지 않고 그 이유를 다시 알린다', async () => {
  mockFetch({ 'PATCH /api/entries/E000010': { __status: 422, detail: 'invalid_period' } });
  render(<DraftCard entry={ENTRY} siblings={[]} canEdit onChanged={() => {}} />);
  await userEvent.type(screen.getByLabelText('해석 시기'), '2026/09');
  await userEvent.tab();
  expect(await screen.findByRole('alert')).toHaveTextContent('해석 시기는 YYYY-MM 형식입니다.');
  await userEvent.click(screen.getByRole('button', { name: '확정' }));
  await vi.waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('저장하지 못한 내용이 있어 확정하지 않았습니다'));
  expect(screen.getByRole('alert')).toHaveTextContent('해석 시기는 YYYY-MM 형식입니다.');
  expect(fetch.mock.calls.some(([u]) => u.endsWith('/confirm'))).toBe(false);
});

test('구역은 목록에서 칩으로 고르고, 동의어를 치면 대표 용어가 들어간다', async () => {
  mockFetch({ 'PATCH /api/entries/E000010': { ...ENTRY, zones: ['선수부'], version: 4 } });
  render(<DraftCard entry={ENTRY} siblings={[]} canEdit onChanged={() => {}} />);
  const zone = screen.getByRole('combobox', { name: '구역' });
  await userEvent.type(zone, 'fwd');
  expect(await screen.findByRole('option', { name: /선수부/ })).toHaveTextContent('FWD 의 대표 용어');
  await userEvent.keyboard('{Enter}');
  expect(bodyOf('PATCH', '/api/entries/E000010')).toEqual({ version: 3, zones: ['선수부'] });
});
