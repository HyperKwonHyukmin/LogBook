import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { mockApi } from '../../test/mockApi.js';

// 값만 보이는 가짜 입력 — 기본값이 채워졌는지와 고친 값이 보내지는지만 본다
vi.mock('../ui/VocabInput.jsx', () => ({
  default: ({ label, values, value, onChange }) => (
    <button type="button" aria-label={label} onClick={() => onChange(values ? [] : null)}>
      {values ? values.join(',') : value || ''}
    </button>
  ),
}));
vi.mock('../people/AssigneeInput.jsx', () => ({
  default: ({ values }) => <span data-testid="assignees">{values.map((p) => p.name).join(',')}</span>,
}));
import FolderUploadDialog from './FolderUploadDialog.jsx';
import { planFolder } from '../../lib/folderPlan.js';

afterEach(() => vi.unstubAllGlobals());

const plan = planFolder([{ relPath: '6_Rudder/doc/a.pdf', file: { size: 1 }, size: 1 }]);
const HINT = { zones: ['선미부'], target: 'Rudder', from_entry: 'E000051', from_title: '3515 · 선미부 · Rudder · 35030' };

test('56 — 폴더 이름으로 비슷한 기존 자료를 찾아 구역·대상을 채우고, 그대로 올리면 그 값이 간다(담당자는 비움)', async () => {
  const fetch = mockApi({ 'POST /api/uploads/similar-preset': HINT });
  const onSubmit = vi.fn();
  render(<FolderUploadDialog plan={plan} onSubmit={onSubmit} onCancel={() => {}} />);
  expect(await screen.findByText(/비슷한 기존 자료/)).toHaveTextContent('E000051');
  expect(screen.getByText(/비슷한 기존 자료/)).toHaveTextContent('3515 · 선미부 · Rudder · 35030');
  const [, init] = fetch.mock.calls.find(([u]) => u === '/api/uploads/similar-preset');
  expect(JSON.parse(init.body)).toEqual({ texts: ['6_Rudder'] });
  await vi.waitFor(() => expect(screen.getByRole('button', { name: '구역' })).toHaveTextContent('선미부'));
  expect(screen.getByRole('button', { name: '대상' })).toHaveTextContent('Rudder');
  expect(screen.getByTestId('assignees')).toHaveTextContent('');
  fireEvent.click(screen.getByRole('button', { name: /^올리기/ }));
  expect(onSubmit.mock.calls[0][0].preset).toEqual({ zones: ['선미부'], target: 'Rudder', assignees: [] });
});

test('56 — 기본값을 지우고 올리면 빈 공통 분류를 보낸다(서버가 다시 채우지 않게)', async () => {
  mockApi({ 'POST /api/uploads/similar-preset': HINT });
  const onSubmit = vi.fn();
  render(<FolderUploadDialog plan={plan} onSubmit={onSubmit} onCancel={() => {}} />);
  await screen.findByText(/비슷한 기존 자료/);
  await vi.waitFor(() => expect(screen.getByRole('button', { name: '구역' })).toHaveTextContent('선미부'));
  fireEvent.click(screen.getByRole('button', { name: '구역' }));
  fireEvent.click(screen.getByRole('button', { name: '대상' }));
  fireEvent.click(screen.getByRole('button', { name: /^올리기/ }));
  expect(onSubmit.mock.calls[0][0].preset).toEqual({ zones: [], target: null, assignees: [] });
});

test('56 — 비슷한 자료가 없으면 빈 칸으로 시작한다', async () => {
  const fetch = mockApi({ 'POST /api/uploads/similar-preset': { zones: [], target: null, from_entry: null, from_title: null } });
  render(<FolderUploadDialog plan={plan} onSubmit={() => {}} onCancel={() => {}} />);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(screen.queryByText(/비슷한 기존 자료/)).toBeNull();
  expect(screen.getByRole('button', { name: '구역' })).toHaveTextContent('');
});

test("56 — '하위 폴더마다' 를 고르면 자동 채움을 비우고, 비운 채 올리면 공통 분류를 보내지 않는다", async () => {
  const splitPlan = planFolder([
    { relPath: '2021/5_Rudder_3143/a.pdf', file: { size: 1 }, size: 1 },
    { relPath: '2021/Manifold_support/b.pdf', file: { size: 1 }, size: 1 },
  ]);
  mockApi({ 'POST /api/uploads/similar-preset': HINT });
  const onSubmit = vi.fn();
  render(<FolderUploadDialog plan={splitPlan} onSubmit={onSubmit} onCancel={() => {}} />);
  expect(await screen.findByText(/비슷한 기존 자료/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: '하위 폴더마다 자료 1건' }));
  expect(screen.getByRole('button', { name: '구역' })).toHaveTextContent('');
  expect(screen.queryByText(/비슷한 기존 자료 E000051/)).toBeNull();
  expect(screen.getByText(/초안마다 자기 폴더 이름으로/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /초안 2건으로 올리기/ }));
  expect(onSubmit.mock.calls[0][0]).toMatchObject({ preset: null, splitTop: true });
});

test('62 — 같은 이름의 묶음이 정리 대기에 있으면 경고한다(막지는 않는다)', async () => {
  mockApi({ 'POST /api/uploads/similar-preset': {} });
  const { InboxSummaryContextForTest } = await import('../shell/InboxSummary.jsx');
  const summary = { drafts: 1, staged: 0, uploading: 0, names: [{ name: '6_rudder', state: 'processed', received_at: '2026-11-09T10:20:00' }] };
  render(
    <InboxSummaryContextForTest.Provider value={{ summary, refresh: () => {} }}>
      <FolderUploadDialog plan={plan} onSubmit={() => {}} onCancel={() => {}} />
    </InboxSummaryContextForTest.Provider>,
  );
  const warn = await screen.findByRole('alert');
  expect(warn).toHaveTextContent('6_rudder');
  expect(warn).toHaveTextContent('11-09 10:20');
  expect(warn).toHaveTextContent('하나 더 생깁니다');
});

test('62 — 같은 이름 묶음이 없으면 경고가 없다', () => {
  mockApi({ 'POST /api/uploads/similar-preset': {} });
  render(<FolderUploadDialog plan={plan} onSubmit={() => {}} onCancel={() => {}} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('62 — 파일 추가(attach): 이 자료에 같은 이름 파일이 있으면 새 이름으로 더한다고 미리 알린다', () => {
  const p = planFolder([{ relPath: 'R1/doc/a.pdf', file: { size: 1 }, size: 1 }, { relPath: 'R1/b.pdf', file: { size: 1 }, size: 1 }]);
  render(<FolderUploadDialog plan={p} attach existing={['R1/doc/a.pdf', 'doc/b.pdf']} onSubmit={() => {}} onCancel={() => {}} />);
  const note = screen.getByRole('note');
  expect(note).toHaveTextContent('같은 이름의 파일이 1개');
  expect(note).toHaveTextContent('a.pdf');
});
