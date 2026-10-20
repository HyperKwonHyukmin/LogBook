import { vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../../auth/AuthContext.jsx';

vi.mock('../../lib/upload.js', async (orig) => ({ ...(await orig()), uploadBatch: vi.fn() }));
import { uploadBatch } from '../../lib/upload.js';
import DuplicateBlockedNotice, { HIDDEN_DUPLICATE_TEXT } from './DuplicateBlocked.jsx';
import UploadZone from './UploadZone.jsx';
import BatchCard from './BatchCard.jsx';
import DraftCard from './DraftCard.jsx';

// 17 — 완전 동일 BDF 안내(합성 데이터: 가상 호선 9999/9001, 가상 사번)
const SEEN = {
  name: '9999_새/copy.bdf', reason: 'duplicate_model', scope: 'existing', includes: ['9999_새/mesh.inc'],
  matches: [{ file_id: 7, entry_id: 'E000101', entry_title: '9001 기존 검토', entry_status: 'confirmed',
    name: 'model.bdf', rel_path: '9001_old/model.bdf', uploaded_by: 'B200001', uploaded_by_name: '박가상' }],
  total: 1, hidden: false,
};
const HIDDEN = { name: '9999_새/secret.bdf', reason: 'duplicate_model', scope: 'existing', includes: [], matches: [], total: 0, hidden: true };
const SAME = { name: '9999_새/b.bdf', reason: 'duplicate_model', scope: 'same_upload', same_as: '9999_새/a.bdf', includes: [], matches: [], total: 0, hidden: false };

const withUser = (ui, user) => (
  <MemoryRouter>
    <AuthContext.Provider value={{ user }}>{ui}</AuthContext.Provider>
  </MemoryRouter>
);
const LV2 = { employee_id: 'A100001', level: 2 };
const LV3 = { employee_id: 'C300001', level: 3 };

test('막힌 목록: 기존 자료 링크·제목·경로·올린 사람·상태, 함께 뺀 INCLUDE', () => {
  render(<MemoryRouter><DuplicateBlockedNotice blocked={[SEEN]} uploaded={2} /></MemoryRouter>);
  const box = screen.getByRole('region', { name: '올리지 않은 BDF' });
  expect(box).toHaveTextContent('올리지 않음: 동일 BDF 가 이미 있음');
  expect(box).toHaveTextContent('나머지 파일은 올렸습니다.');
  expect(within(box).getByRole('link', { name: 'E000101' })).toHaveAttribute('href', '/e/E000101');
  expect(box).toHaveTextContent('9001 기존 검토');
  expect(box).toHaveTextContent('9001_old/model.bdf');
  expect(within(box).getByText('박가상')).toHaveAttribute('title', 'B200001');
  expect(box).toHaveTextContent('확정');
  expect(box).toHaveTextContent('함께 빼 둔 INCLUDE 파일: 9999_새/mesh.inc');
  // 오류처럼 보이지 않는다(alert 아님), 일반 사용자에게 우회 단추 없음
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: '그래도 올리기' })).toBeNull();
});

test('볼 수 없는 대상은 링크 없이 익명 안내, 같은 업로드 안 중복은 짝 이름', () => {
  render(<MemoryRouter><DuplicateBlockedNotice blocked={[HIDDEN, SAME]} uploaded={0} /></MemoryRouter>);
  const box = screen.getByRole('region', { name: '올리지 않은 BDF' });
  expect(box).toHaveTextContent(HIDDEN_DUPLICATE_TEXT);
  expect(box).toHaveTextContent('새로 올린 파일이 없습니다.');
  expect(within(box).queryByRole('link')).toBeNull();
  expect(box).toHaveTextContent('이번 업로드 안의 9999_새/a.bdf 와 같아 하나만 올렸습니다.');
});

test('UploadZone: 모두 막히면 onUploaded 를 부르지 않고 목록을 보인다(LV2 는 우회 없음)', async () => {
  uploadBatch.mockResolvedValue({ key: null, uploaded: 0, rejected: [], blocked: [SEEN], deferred: 0 });
  const onUploaded = vi.fn();
  render(withUser(<UploadZone onUploaded={onUploaded} />, LV2));
  await userEvent.upload(screen.getByLabelText('파일 선택'), [new File(['GRID'], 'copy.bdf')]);
  expect(await screen.findByRole('region', { name: '올리지 않은 BDF' })).toBeInTheDocument();
  expect(onUploaded).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).toBeNull();   // 성공 문구 없음
  expect(screen.queryByRole('button', { name: '그래도 올리기' })).toBeNull();
});

test('UploadZone: LV3 [그래도 올리기] 는 막힌 파일(+INCLUDE)만 force 로 다시 올린다', async () => {
  uploadBatch.mockReset();
  uploadBatch
    .mockResolvedValueOnce({ key: 'K1', uploaded: 1, rejected: [], blocked: [SEEN], deferred: 0 })
    .mockResolvedValueOnce({ key: 'K2', uploaded: 2, rejected: [], blocked: [], deferred: 0 });
  const onUploaded = vi.fn();
  render(withUser(<UploadZone onUploaded={onUploaded} />, LV3));
  const input = screen.getByLabelText('파일 선택'); // multiple — 상대경로는 webkitRelativePath
  const mk = (name, rel) => { const f = new File(['G'], name); Object.defineProperty(f, 'webkitRelativePath', { value: rel }); return f; };
  await userEvent.upload(input, [mk('copy.bdf', '9999_새/copy.bdf'), mk('mesh.inc', '9999_새/mesh.inc'), mk('r.f06', '9999_새/r.f06')]);
  await waitFor(() => expect(onUploaded).toHaveBeenCalledWith('K1'));
  await userEvent.click(await screen.findByRole('button', { name: '그래도 올리기' }));
  await waitFor(() => expect(onUploaded).toHaveBeenCalledWith('K2'));
  const [items, opts] = uploadBatch.mock.calls[1];
  expect(items.map((i) => i.relPath)).toEqual(['9999_새/copy.bdf', '9999_새/mesh.inc']);
  expect(opts.force).toBe(true);
  expect(screen.queryByRole('region', { name: '올리지 않은 BDF' })).toBeNull();
});

test('BatchCard: 제외 목록에 동일 BDF 이유·대상 링크·원본 보존 안내(펼쳐 둠)', () => {
  const batch = { key: '20261008-090000-a17a', source: 'inbox', original_name: '9999_탐색기', uploader: 'A100001',
    received_at: '2026-10-08T09:00:00', state: 'processed', error: null, entries: [],
    excluded: [{ ...SEEN, kept: true }, { name: '9999_새/mesh.inc', reason: 'duplicate_include', of: '9999_새/copy.bdf' }] };
  render(<MemoryRouter><BatchCard batch={batch} me="A100001" isAdmin={false} onChanged={() => {}} onClaim={() => {}} /></MemoryRouter>);
  expect(screen.getByText(/동일 BDF/, { selector: 'summary span' })).toHaveTextContent('동일 BDF 1개는 올리지 않았습니다');
  expect(screen.getByText('동일 BDF 가 이미 있음')).toBeVisible();
  expect(screen.getByRole('link', { name: 'E000101' })).toHaveAttribute('href', '/e/E000101');
  expect(screen.getByText(/올리지 않은 BDF 의 INCLUDE 파일/)).toHaveTextContent('(9999_새/copy.bdf)');
  expect(screen.getByText(/원본은 서버 보관 폴더/)).toHaveTextContent('10_Vault\\_staging\\20261008-090000-a17a');
});

const DRAFT = {
  // 20 — BDF 초안은 구역 또는 대상이 있어야 확정 단추가 열린다
  entry_id: 'E000020', status: 'draft', title: '9999 초안', version: 1, description: null, zones: ['선수부'],
  hulls: [{ hull_no: '9999', ship_type: null, is_primary: true }], hull_evidence: [], suggested_entry: null, merge_into: null,
  files: [{ id: 5, rel_path: 'm.bdf', name: 'm.bdf', kind: 'model', size: 10, duplicate_of_entry: null, drm_encrypted: false }],
};
const DUP_409 = { code: 'duplicate_model', files: [{ file_id: 5, name: 'm.bdf', rel_path: 'm.bdf', matches: SEEN.matches, total: 1, hidden: false }] };

function stubConfirm(user) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn((url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${url}`);
    if (url.startsWith('/api/vocab') || url.startsWith('/api/suggest')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ kind: 'x', other: '기타', terms: [] }) });
    }
    if (url === '/api/entries/E000020/confirm') {
      return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ detail: DUP_409 }) });
    }
    if (url === '/api/entries/E000020/confirm?force=true') {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ entry_id: 'E000020', version: 2 }) });
    }
    throw new Error(url);
  }));
  render(withUser(<DraftCard entry={DRAFT} siblings={[]} canEdit onChanged={() => {}} />, user));
  return calls;
}

test('DraftCard: 확정 409 동일 BDF 는 빨간 오류 대신 대상 목록과 빼는 방법 안내(LV2 는 우회 없음)', async () => {
  stubConfirm(LV2);
  await userEvent.click(screen.getByRole('button', { name: '확정' }));
  const box = await screen.findByRole('region', { name: '확정하지 않음: 동일 BDF' });
  expect(box).toHaveTextContent('[새 묶음으로 나누기] 한 뒤 그 초안을 버리면');
  expect(within(box).getByRole('link', { name: 'E000101' })).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: '그래도 확정' })).toBeNull();
});

test('DraftCard: LV3 는 [그래도 확정](force=true)', async () => {
  const calls = stubConfirm(LV3);
  await userEvent.click(screen.getByRole('button', { name: '확정' }));
  await userEvent.click(await screen.findByRole('button', { name: '그래도 확정' }));
  await waitFor(() => expect(calls).toContain('POST /api/entries/E000020/confirm?force=true'));
});
test('BatchCard: 동일 BDF 만 있어 초안 없이 끝난 배치는 그 이유를 한 줄로', () => {
  const batch = { key: '20261008-090000-a17b', source: 'inbox', original_name: '9999_탐색기', uploader: 'A100001',
    received_at: '2026-10-08T09:00:00', state: 'done', error: null, entries: [], excluded: [{ ...SEEN, kept: true }] };
  render(<MemoryRouter><BatchCard batch={batch} me="A100001" isAdmin={false} onChanged={() => {}} onClaim={() => {}} /></MemoryRouter>);
  expect(screen.getByText(/같은 BDF 뿐이라 초안을 만들지 않았습니다/)).toBeInTheDocument();
  expect(screen.getByText('완료')).toBeInTheDocument();
});
