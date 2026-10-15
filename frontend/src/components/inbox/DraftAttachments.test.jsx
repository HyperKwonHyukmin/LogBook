import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import DraftAttachments from './DraftAttachments.jsx';
import DraftCard from './DraftCard.jsx';
import { PageDropOverlay } from './UploadZone.jsx';
import { uploadBatch } from '../../lib/upload.js';
import { mockApi } from '../../test/mockApi.js';

vi.mock('../../lib/upload.js', async (original) => ({ ...(await original()), uploadBatch: vi.fn() }));
vi.mock('../ui/VocabInput.jsx', () => ({ default: ({ label }) => <span>{label}</span> }));
vi.mock('../ui/ProjectInput.jsx', () => ({ default: () => <span>프로젝트</span> }));

const entry = { entry_id: 'E000010', status: 'draft', title: '사용자가 검토한 제목', version: 3,
  analysis_type: '강도 평가', zones: ['선수부'], hulls: [{ hull_no: '3496' }], tags: [],
  files: [{ id: 1, name: 'model.bdf', rel_path: 'model.bdf', kind: 'model', size: 20 }],
  pending_attachments: [] };

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

test('추가 파일 업로드는 새 자료가 아닌 선택한 초안 번호를 대상으로 보낸다', async () => {
  const user = userEvent.setup();
  uploadBatch.mockResolvedValue({ key: 'attached', uploaded: 1, rejected: [] });
  mockApi({});
  render(<DraftAttachments entry={entry} onChanged={vi.fn()} onBusyChange={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: '파일 추가' }));
  fireEvent.change(screen.getByLabelText('파일 선택'), { target: { files: [new File(['report'], 'report.pdf')] } });
  await waitFor(() => expect(uploadBatch).toHaveBeenCalled());
  expect(uploadBatch.mock.calls[0][1].targetEntryId).toBe('E000010');
  expect(uploadBatch.mock.calls[0][1].targetEntryStatus).toBe('draft');
  expect(screen.getByText(/파일 첨부 중입니다/)).toBeInTheDocument();
});

test('처리된 배치는 자동 첨부 완료까지 기다리고 같은 카드만 새로 부른다', async () => {
  vi.useFakeTimers();
  uploadBatch.mockResolvedValue({ key: 'attached', uploaded: 1, rejected: [] });
  let requests = 0;
  mockApi({ 'GET /api/batches/attached': () => ({ state: ++requests === 1 ? 'processed' : 'done', excluded: [] }) });
  const changed = vi.fn(), busy = vi.fn();
  render(<DraftAttachments entry={entry} onChanged={changed} onBusyChange={busy} />);
  fireEvent.click(screen.getByRole('button', { name: '파일 추가' }));
  await act(async () => fireEvent.change(screen.getByLabelText('파일 선택'), { target: { files: [new File(['report'], 'report.pdf')] } }));
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(screen.queryByText(/첨부 처리가 끝났습니다/)).not.toBeInTheDocument();
  expect(busy).toHaveBeenLastCalledWith(true);
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(screen.getByText(/첨부 처리가 끝났습니다/)).toBeInTheDocument();
  expect(busy).toHaveBeenLastCalledWith(false);
  expect(changed).toHaveBeenCalledTimes(2);
});

test('첨부 처리 중 확정·나누기를 차단하고 사용자 수정 제목은 유지한다', async () => {
  vi.useFakeTimers();
  uploadBatch.mockResolvedValue({ key: 'attached', uploaded: 1, rejected: [] });
  mockApi({ 'GET /api/batches/attached': { state: 'staged' } });
  render(<DraftCard entry={entry} siblings={[]} canEdit onChanged={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('제목'), { target: { value: '수정 중인 제목' } });
  const section = screen.getByRole('region', { name: '이 초안에 파일 추가' });
  fireEvent.click(within(section).getByRole('button', { name: '파일 추가' }));
  await act(async () => fireEvent.change(within(section).getByLabelText('파일 선택'), { target: { files: [new File(['report'], 'report.pdf')] } }));
  expect(screen.getByRole('button', { name: '저장하고 확정' })).toBeDisabled();
  expect(screen.getByLabelText('제목')).toHaveValue('수정 중인 제목');
});

test('서버에 대기 첨부가 있으면 새로 연 카드에서도 확정을 막는다', () => {
  mockApi({});
  render(<DraftCard entry={{ ...entry, pending_attachments: [{ key: 'other-tab', state: 'staged' }] }} siblings={[]} canEdit onChanged={vi.fn()} />);
  expect(screen.getByRole('button', { name: '확정', exact: true })).toBeDisabled();
  expect(screen.getByText(/파일 첨부 중입니다/)).toBeInTheDocument();
});

test('첨부 실패 연결을 해제할 수 있고 원본 초안 삭제 API는 호출하지 않는다', async () => {
  const user = userEvent.setup();
  const fetch = mockApi({ 'POST /api/entries/E000010/attachments/failed-batch/release': { ok: true } });
  const changed = vi.fn();
  render(<DraftAttachments entry={{ ...entry, pending_attachments: [{ key: 'failed-batch', state: 'failed' }] }} onChanged={changed} />);
  await user.click(screen.getByRole('button', { name: '첨부 연결 해제' }));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(fetch.mock.calls).toHaveLength(1);
  expect(fetch.mock.calls[0][1].method).toBe('POST');
});

test('읽기 전용 카드에는 첨부 버튼이 없다', () => {
  mockApi({});
  render(<DraftCard entry={entry} siblings={[]} canEdit={false} onChanged={vi.fn()} />);
  expect(screen.queryByRole('button', { name: '파일 추가' })).not.toBeInTheDocument();
});

test('첨부 완료 후 BDF와 보고서가 같은 목록에 보이고 입력 중 제목이 유지된다', async () => {
  vi.useFakeTimers();
  uploadBatch.mockResolvedValue({ key: 'attached', uploaded: 1, rejected: [] });
  mockApi({ 'GET /api/batches/attached': { state: 'done', excluded: [] } });
  const changed = vi.fn();
  const { rerender } = render(<DraftCard entry={entry} siblings={[]} canEdit onChanged={changed} />);
  fireEvent.change(screen.getByLabelText('제목'), { target: { value: '입력 중인 제목' } });
  const section = screen.getByRole('region', { name: '이 초안에 파일 추가' });
  fireEvent.click(within(section).getByRole('button', { name: '파일 추가' }));
  await act(async () => fireEvent.change(within(section).getByLabelText('파일 선택'), { target: { files: [new File(['report'], 'report.pdf')] } }));
  await act(async () => vi.advanceTimersByTimeAsync(500));
  rerender(<DraftCard entry={{ ...entry, version: 4, files: [...entry.files,
    { id: 2, name: 'report.pdf', rel_path: 'report.pdf', kind: 'report', size: 6 }] }} siblings={[]} canEdit onChanged={changed} />);
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByText('model.bdf')).toBeInTheDocument();
  expect(screen.getByText('report.pdf')).toBeInTheDocument();
  expect(screen.getByLabelText('제목')).toHaveValue('입력 중인 제목');
  expect(screen.getByRole('button', { name: '저장하고 확정' })).toBeEnabled();
});

// ── 끌어 놓기로 첨부(놓을 곳 = 초안 카드 전체) ─────────────────────────
const osFiles = (name = 'report.pdf') => ({ dataTransfer: { types: ['Files'], items: [], files: [new File(['R'], name)] } });
const card = () => screen.getByRole('article', { name: /E000010/ });

test('탐색기 파일을 초안 카드에 끌어 놓으면 이 초안에 첨부한다', async () => {
  uploadBatch.mockResolvedValue({ key: 'attached', uploaded: 1, rejected: [] });
  mockApi({});
  render(<DraftCard entry={entry} siblings={[]} canEdit onChanged={vi.fn()} />);
  act(() => { fireEvent.dragEnter(card(), osFiles()); });
  expect(fireEvent.dragOver(card(), osFiles())).toBe(false); // 놓을 수 있다
  expect(within(card()).getByRole('status', { name: '' })).toHaveTextContent('사용자가 검토한 제목에 놓으면 첨부합니다');
  await act(async () => { fireEvent.drop(card(), osFiles()); });
  await waitFor(() => expect(uploadBatch).toHaveBeenCalled());
  expect(uploadBatch.mock.calls[0][1].targetEntryId).toBe('E000010');
  expect(uploadBatch.mock.calls[0][1].targetEntryStatus).toBe('draft');
});

test('첨부가 진행 중이면 끌어 놓아도 올리지 않고 안내한다', async () => {
  mockApi({});
  render(<DraftCard entry={{ ...entry, pending_attachments: [{ key: 'k', state: 'queued' }] }} siblings={[]} canEdit onChanged={vi.fn()} />);
  await act(async () => { fireEvent.drop(card(), osFiles()); });
  expect(uploadBatch).not.toHaveBeenCalled();
  expect(screen.getByText('첨부가 끝난 뒤 다시 놓아 주세요.')).toBeInTheDocument();
});

test('올린 사람이 아니면 카드가 받지 않는다(화면 덮개가 새 배치로 올린다)', async () => {
  mockApi({});
  const page = { busy: false, disabled: false, onDrop: vi.fn() };
  render(<><PageDropOverlay u={page} /><DraftCard entry={entry} siblings={[]} canEdit={false} onChanged={vi.fn()} /></>);
  act(() => { fireEvent.dragEnter(card(), osFiles()); });
  await act(async () => { fireEvent.drop(card(), osFiles()); });
  expect(page.onDrop).toHaveBeenCalledTimes(1);
  expect(uploadBatch).not.toHaveBeenCalled();
});

test('정리 대기 화면 덮개는 카드에 놓은 파일을 새 배치로 가져가지 않고, 빈 곳은 새 배치로 올린다', async () => {
  uploadBatch.mockResolvedValue({ key: 'attached', uploaded: 1, rejected: [] });
  mockApi({});
  const page = { busy: false, disabled: false, onDrop: vi.fn() };
  render(<><PageDropOverlay u={page} /><DraftCard entry={entry} siblings={[]} canEdit onChanged={vi.fn()} /></>);
  act(() => { fireEvent.dragEnter(card(), osFiles()); });
  // 받는 곳이 둘이면 가운데 상자 대신 위쪽 안내 띠
  expect(screen.getByText(/빈 곳에 놓으면/)).toBeInTheDocument();
  expect(screen.queryByText('여기에 놓아 올리기')).toBeNull();
  await act(async () => { fireEvent.drop(card(), osFiles()); });
  expect(page.onDrop).not.toHaveBeenCalled();
  await waitFor(() => expect(uploadBatch).toHaveBeenCalled());
  expect(uploadBatch.mock.calls[0][1].targetEntryId).toBe('E000010');
  act(() => { fireEvent.dragEnter(document.body, osFiles()); });
  await act(async () => { fireEvent.drop(document.body, osFiles('other.bdf')); });
  expect(page.onDrop).toHaveBeenCalledTimes(1);
});

test('[파일 추가]로 펼치면 포커스가 파일 선택 단추로 간다', async () => {
  const user = userEvent.setup();
  mockApi({});
  render(<DraftAttachments entry={entry} onChanged={vi.fn()} onBusyChange={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: '파일 추가' }));
  expect(screen.getByRole('button', { name: '파일 선택' })).toHaveFocus();
});
