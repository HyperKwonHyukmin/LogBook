import { vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../lib/upload.js', async (orig) => ({ ...(await orig()), uploadBatch: vi.fn() }));
import { uploadBatch } from '../../lib/upload.js';
import UploadZone from './UploadZone.jsx';

test('파일을 고르면 올리고, 끝나면 onUploaded 와 DRM 거부 안내', async () => {
  uploadBatch.mockResolvedValue({ key: 'K1', uploaded: 1, rejected: ['enc.pdf'] });
  const onUploaded = vi.fn();
  render(<UploadZone onUploaded={onUploaded} />);
  await userEvent.upload(screen.getByLabelText('파일 선택'), [new File(['GRID'], 'a.bdf'), new File(['x'], 'enc.pdf')]);
  await waitFor(() => expect(onUploaded).toHaveBeenCalledWith('K1'));
  expect(screen.getByRole('status')).toHaveTextContent('1개 파일을 올렸습니다');
  expect(screen.getByText('enc.pdf')).toBeInTheDocument();
  expect(screen.getByText(/탐색기로 00_Inbox/)).toBeInTheDocument();
});

test('모든 파일이 DRM 이면 오류로 안내한다', async () => {
  uploadBatch.mockRejectedValue(Object.assign(new Error('all_drm'), { code: 'all_drm', rejected: ['e.pdf'] }));
  render(<UploadZone onUploaded={() => {}} />);
  await userEvent.upload(screen.getByLabelText('파일 선택'), [new File(['x'], 'e.pdf')]);
  expect(await screen.findByRole('alert')).toHaveTextContent('DRM 암호화');
});

test('공유 폴더가 끊기면 올리기를 막는다', () => {
  render(<UploadZone onUploaded={() => {}} disabled />);
  expect(screen.getByLabelText('파일 선택')).toBeDisabled();
  expect(screen.getByText(/연결되면 올릴 수 있습니다/)).toBeInTheDocument();
});

test('올리는 중에는 창 밖으로 떨어진 끌어 놓기와 창 닫기를 막고 안내한다', async () => {
  let finish;
  uploadBatch.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<UploadZone onUploaded={() => {}} />);
  await userEvent.upload(screen.getByLabelText('파일 선택'), [new File(['GRID'], 'a.bdf')]);
  const files = { dataTransfer: { types: ['Files'] } };
  expect(fireEvent.dragOver(window, files)).toBe(false);
  expect(fireEvent.drop(window, files)).toBe(false);
  expect(await screen.findByText(/올리는 중입니다/)).toBeInTheDocument();
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);

  finish({ key: 'K1', uploaded: 1, rejected: [] });
  await screen.findByRole('status');
  expect(fireEvent.drop(window, files)).toBe(true);
  const after = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});

test('올리는 중이어도 화면 안의 파일 옮기기 끌기(초안 카드)는 건드리지 않는다', async () => {
  uploadBatch.mockImplementation(() => new Promise(() => {}));
  render(<UploadZone onUploaded={() => {}} />);
  await userEvent.upload(screen.getByLabelText('파일 선택'), [new File(['GRID'], 'a.bdf')]);
  const internal = { dataTransfer: { types: ['application/x-logbook-file'] } };
  expect(fireEvent.dragOver(window, internal)).toBe(true);
  expect(fireEvent.drop(window, internal)).toBe(true);
  // 카드가 이미 처리한(preventDefault) 파일 끌기도 무시한다
  const handled = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(handled, 'dataTransfer', { value: { types: ['Files'] } });
  handled.preventDefault();
  window.dispatchEvent(handled);
  await new Promise((r) => { setTimeout(r, 20); });
  expect(screen.queryByText(/올리는 중입니다/)).toBeNull();
});
