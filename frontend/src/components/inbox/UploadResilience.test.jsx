import { vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../lib/upload.js', async (orig) => ({ ...(await orig()), uploadBatch: vi.fn(), continueUpload: vi.fn() }));
import { continueUpload, uploadBatch } from '../../lib/upload.js';
import UploadZone, { UploadButtons, UploadFeedback, useUploader } from './UploadZone.jsx';
import { UploadProvider } from './UploadProvider.jsx';
import GlobalDrop from '../shell/GlobalDrop.jsx';
import { ToastProvider } from '../ui/Toast.jsx';
import { mockApi, calls } from '../../test/mockApi.js';

// 올리기 화면 — [취소]·[이어 올리기]·파일 확인 중·건너뛴 파일, 화면을 옮겨도 이어지는 올리기

const session = (over = {}) => ({ key: 'K1', sent: 4, total: 10, done: new Set(), rejected: [], skipped: [], ...over });
const abortWithSession = (signal, s = session()) => new Promise((_, reject) => {
  signal.addEventListener('abort', () => reject(Object.assign(new DOMException('x', 'AbortError'), { session: s })));
});

afterEach(() => { vi.clearAllMocks(); });

test('올리는 중에는 [취소]가 보이고, 누르면 멈추고 서버 배치를 지운다', async () => {
  const fetch = mockApi({ 'DELETE /api/uploads/K1': null });
  uploadBatch.mockImplementation((_, { signal, onPhase, onProgress }) => {
    onPhase({ phase: 'uploading' });
    onProgress({ sent: 4, total: 10 });
    return abortWithSession(signal);
  });
  render(<UploadZone onUploaded={() => {}} />);
  await userEvent.upload(screen.getByLabelText('파일 선택'), [new File(['GRID'], 'a.bdf')]);
  expect(await screen.findByRole('progressbar', { name: '올리기 진행률' })).toHaveAttribute('aria-valuenow', '40');
  await userEvent.click(screen.getByRole('button', { name: '취소' }));
  expect(await screen.findByText('올리기를 취소했습니다.')).toBeInTheDocument();
  expect(uploadBatch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(calls(fetch)).toEqual(['DELETE /api/uploads/K1']);
  expect(screen.getByLabelText('파일 선택')).not.toBeDisabled();
});

test('도중에 멈추면 [이어 올리기]를 띄우고, 누르면 같은 배치를 이어 보낸다', async () => {
  const onUploaded = vi.fn();
  const s = session();
  uploadBatch.mockRejectedValue(Object.assign(new TypeError('network'), { session: s }));
  continueUpload.mockResolvedValue({ key: 'K1', uploaded: 2, rejected: [], skipped: [], blocked: [], deferred: 0 });
  render(<UploadZone onUploaded={onUploaded} />);
  await userEvent.upload(screen.getByLabelText('파일 선택'), [new File(['GRID'], 'a.bdf')]);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('올리기가 중간에 멈췄습니다');
  expect(alert).toHaveTextContent('4 B / 10 B');
  await userEvent.click(screen.getByRole('button', { name: '이어 올리기' }));
  await waitFor(() => expect(onUploaded).toHaveBeenCalledWith('K1'));
  expect(continueUpload.mock.calls[0][0]).toBe(s);
  expect(screen.getByRole('status')).toHaveTextContent('2개 파일을 올렸습니다');
});

test('보내기 전 확인 단계는 "파일 확인 중"으로 보이고 그동안 단추를 막는다', async () => {
  uploadBatch.mockImplementation((_, { onPhase }) => { onPhase({ phase: 'checking', checked: 1, total: 2 }); return new Promise(() => {}); });
  render(<UploadZone onUploaded={() => {}} />);
  await userEvent.upload(screen.getByLabelText('파일 선택'), [new File(['A'], 'a.bdf'), new File(['B'], 'b.pdf')]);
  expect(await screen.findByText(/파일 확인 중/)).toHaveTextContent('파일 확인 중 1 / 2개');
  expect(screen.getByRole('button', { name: /파일 선택/ })).toBeDisabled();
});

test('읽을 수 없어 건너뛴 파일은 결과와 함께 목록으로 알린다', async () => {
  uploadBatch.mockResolvedValue({ key: 'K2', uploaded: 1, rejected: [], skipped: ['r/열린보고서.pptx'], blocked: [], deferred: 0 });
  render(<UploadZone onUploaded={() => {}} />);
  await userEvent.upload(screen.getByLabelText('파일 선택'), [new File(['A'], 'a.bdf')]);
  expect(await screen.findByText(/읽을 수 없는 파일 1개는 건너뛰었습니다/)).toBeInTheDocument();
  expect(screen.getByText('r/열린보고서.pptx')).toBeInTheDocument();
});

/** 정리 대기 비슷한 화면 — 자기 올리기 칸(scope 'inbox')을 갖는다. */
function FakeInbox({ onUploaded }) {
  const u = useUploader({ scope: 'inbox', onUploaded,
    away: { title: '정리 대기로 올리기', message: '정리 대기 올리기가 끝났습니다.', to: '/inbox', label: '정리 대기로' } });
  return <div><UploadButtons u={u} /><UploadFeedback u={u} /><Link to="/">검색으로 가기</Link></div>;
}

test('올리는 중에 다른 화면으로 가도 올리기는 이어지고 진행률은 오른쪽 아래로, 끝나면 토스트로 알린다', async () => {
  let progress;
  let finish;
  uploadBatch.mockImplementation((_, opts) => {
    progress = opts.onProgress;
    return new Promise((resolve) => { finish = resolve; });
  });
  const onUploaded = vi.fn();
  render(
    <MemoryRouter initialEntries={['/inbox']}>
      <ToastProvider>
        <UploadProvider>
          <GlobalDrop storage={{ reachable: true }} />
          <Routes>
            <Route path="/inbox" element={<FakeInbox onUploaded={onUploaded} />} />
            <Route path="/" element={<Link to="/inbox">정리 대기로 돌아가기</Link>} />
          </Routes>
        </UploadProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  await userEvent.upload(screen.getByLabelText('파일 선택'), [new File(['GRID'], 'a.bdf')]);
  act(() => progress({ sent: 3, total: 10 }));
  await userEvent.click(screen.getByRole('link', { name: '검색으로 가기' }));

  // 화면은 바뀌었지만 같은 올리기가 셸의 떠 있는 상자에 이어 보인다(창 닫기 경고도 그대로)
  expect(screen.getByText('정리 대기로 올리기')).toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: '올리기 진행률' })).toHaveAttribute('aria-valuenow', '30');
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  expect(uploadBatch).toHaveBeenCalledTimes(1);

  await act(async () => { finish({ key: 'K3', uploaded: 1, rejected: [], skipped: [], blocked: [], deferred: 0 }); });
  expect(await screen.findByText('정리 대기 올리기가 끝났습니다.')).toBeInTheDocument();
  expect(onUploaded).not.toHaveBeenCalled(); // 떠난 화면의 콜백은 부르지 않는다
  expect(screen.queryByRole('progressbar')).toBeNull();
});

test('떠났다가 돌아오면 그 화면이 올리기를 다시 이어받는다', async () => {
  let finish;
  uploadBatch.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const onUploaded = vi.fn();
  render(
    <MemoryRouter initialEntries={['/inbox']}>
      <UploadProvider>
        <GlobalDrop storage={{ reachable: true }} />
        <Routes>
          <Route path="/inbox" element={<FakeInbox onUploaded={onUploaded} />} />
          <Route path="/" element={<Link to="/inbox">정리 대기로 돌아가기</Link>} />
        </Routes>
      </UploadProvider>
    </MemoryRouter>,
  );
  await userEvent.upload(screen.getByLabelText('파일 선택'), [new File(['GRID'], 'a.bdf')]);
  await userEvent.click(screen.getByRole('link', { name: '검색으로 가기' }));
  await userEvent.click(screen.getByRole('link', { name: '정리 대기로 돌아가기' }));
  // 떠 있는 상자는 걷히고 화면 안 칸이 진행 상태를 보인다(같은 작업 하나)
  expect(screen.queryByText('정리 대기로 올리기')).toBeNull();
  expect(screen.getAllByText(/파일 확인 중/)).toHaveLength(1);
  expect(screen.getByRole('button', { name: /파일 선택/ })).toBeDisabled();
  await act(async () => { finish({ key: 'K4', uploaded: 1, rejected: [], skipped: [], blocked: [], deferred: 0 }); });
  expect(onUploaded).toHaveBeenCalledWith('K4');
});

test('셸 저장소에서도 올리는 중 바깥 놓기는 막고 안내한다', async () => {
  uploadBatch.mockImplementation(() => new Promise(() => {}));
  render(
    <MemoryRouter initialEntries={['/inbox']}>
      <UploadProvider>
        <Routes><Route path="/inbox" element={<FakeInbox onUploaded={() => {}} />} /></Routes>
      </UploadProvider>
    </MemoryRouter>,
  );
  await userEvent.upload(screen.getByLabelText('파일 선택'), [new File(['GRID'], 'a.bdf')]);
  const files = { dataTransfer: { types: ['Files'] } };
  expect(fireEvent.drop(window, files)).toBe(false);
  expect(await screen.findByText(/올리는 중입니다/)).toBeInTheDocument();
});
