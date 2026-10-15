import { vi } from 'vitest';
import { BUSY_NOTICE, createUploadStore } from './uploadStore.js';

// 셸 올리기 저장소 — 화면이 떠나도 이어지고, [취소]는 멈춘 뒤 서버 배치를 지우고, 실패하면 [이어 올리기]를 남긴다

const items = [{ file: new File(['GRID'], 'a.bdf'), relPath: 'a.bdf' }];
const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const abortable = (signal) => new Promise((_, reject) => {
  signal.addEventListener('abort', () => reject(Object.assign(new DOMException('x', 'AbortError'),
    { session: { key: 'K1', sent: 1, total: 4, done: new Set(), rejected: [], skipped: [] } })));
});
const flush = () => new Promise((r) => { setTimeout(r, 0); });

test('맡은 화면이 있으면 끝날 때 onUploaded, 떠났으면 셸에 알리고 상태를 비운다', async () => {
  const run = deferred();
  const upload = vi.fn(() => run.promise);
  const store = createUploadStore({ upload });
  const onUploaded = vi.fn();
  const detach = store.attach('inbox', { current: { onUploaded } });
  store.start('inbox', items, { away: { message: '올렸습니다' } });
  expect(store.getJob('inbox')).toMatchObject({ busy: true, phase: 'checking', checkTotal: 1 });

  detach(); // 올리는 중에 화면을 떠났다 — 올리기는 계속
  expect(store.getJob('inbox').busy).toBe(true);
  const orphan = vi.fn();
  store.onOrphanDone(orphan);
  run.resolve({ key: 'K1', uploaded: 1, rejected: [], skipped: [], blocked: [], deferred: 0 });
  await flush();
  expect(onUploaded).not.toHaveBeenCalled();
  expect(orphan).toHaveBeenCalledWith(expect.objectContaining({ scope: 'inbox', away: { message: '올렸습니다' } }));
  expect(store.getSnapshot().jobs.inbox).toBeUndefined();
});

test('같은 칸에서 올리는 중에 또 시작하면 안내만 한다', () => {
  const upload = vi.fn(() => new Promise(() => {}));
  const store = createUploadStore({ upload });
  expect(store.start('inbox', items)).toBe(true);
  expect(store.start('inbox', items)).toBe(false);
  expect(store.getJob('inbox').notice).toBe(BUSY_NOTICE);
  expect(store.anyBusy()).toBe(true);
});

test('끌어 놓은 폴더는 펼치는 동안에도 바쁨이고 찾은 파일 수가 보인다', async () => {
  const collect = deferred();
  const upload = vi.fn(() => new Promise(() => {}));
  const store = createUploadStore({ upload });
  let report;
  store.start('global', (onCount) => { report = onCount; return collect.promise; });
  report(120);
  expect(store.getJob('global')).toMatchObject({ busy: true, phase: 'checking', checked: 120 });
  expect(store.start('global', items)).toBe(false);
  collect.resolve(items);
  await flush();
  expect(upload).toHaveBeenCalledTimes(1);
});

test('[취소] — 보내기를 끊고(AbortController) 서버의 반쪽 배치를 지운다', async () => {
  const upload = vi.fn((_, { signal }) => abortable(signal));
  const cancelRemote = vi.fn(() => Promise.resolve('removed'));
  const store = createUploadStore({ upload, cancelRemote });
  store.start('inbox', items);
  await flush();
  await store.cancel('inbox');
  expect(upload.mock.calls[0][1].signal.aborted).toBe(true);
  expect(cancelRemote).toHaveBeenCalledWith('K1');
  expect(store.getJob('inbox')).toMatchObject({ busy: false, resumable: false, info: '올리기를 취소했습니다.' });
});

test('일시 오류로 멈추면 배치를 남기고 [이어 올리기]로 같은 세션을 이어 보낸다', async () => {
  const session = { key: 'K9', sent: 8, total: 20, done: new Set(['a.bdf']), rejected: [], skipped: [] };
  const upload = vi.fn(() => Promise.reject(Object.assign(new TypeError('network'), { session })));
  const resumeUpload = vi.fn(() => Promise.resolve({ key: 'K9', uploaded: 2, rejected: [], skipped: [], blocked: [], deferred: 0 }));
  const cancelRemote = vi.fn();
  const store = createUploadStore({ upload, resumeUpload, cancelRemote });
  const onUploaded = vi.fn();
  store.attach('inbox', { current: { onUploaded } });
  store.start('inbox', items);
  await flush();
  expect(store.getJob('inbox')).toMatchObject({ busy: false, resumable: true, progress: { sent: 8, total: 20 } });
  expect(cancelRemote).not.toHaveBeenCalled();

  store.resume('inbox');
  expect(resumeUpload.mock.calls[0][0]).toBe(session);
  await flush();
  expect(onUploaded).toHaveBeenCalledWith('K9');
  expect(store.getJob('inbox')).toMatchObject({ busy: false, resumable: false, result: { uploaded: 2 } });
});

test('다시 보내도 같은 거절(4xx)은 이어 올리기 없이 실패로 끝내고 반쪽 배치를 치운다', async () => {
  const { ApiError } = await import('../api/client.js');
  const session = { key: 'K7', sent: 0, total: 4, done: new Set(), rejected: [], skipped: [] };
  const upload = vi.fn(() => Promise.reject(Object.assign(new ApiError(422, 'invalid_path'), { session })));
  const cancelRemote = vi.fn(() => Promise.resolve('removed'));
  const store = createUploadStore({ upload, cancelRemote });
  store.start('inbox', items);
  await flush();
  expect(store.getJob('inbox')).toMatchObject({ resumable: false });
  expect(store.getJob('inbox').error).not.toBe('');
  expect(cancelRemote).toHaveBeenCalledWith('K7');
});

test('멈춘 올리기를 [취소]하면 서버 배치를 지운다(보내는 중이 아니어도)', async () => {
  const session = { key: 'K8', sent: 2, total: 4, done: new Set(), rejected: [], skipped: [] };
  const upload = vi.fn(() => Promise.reject(Object.assign(new TypeError('network'), { session })));
  const cancelRemote = vi.fn(() => Promise.resolve('failed'));
  const store = createUploadStore({ upload, cancelRemote });
  store.start('inbox', items);
  await flush();
  await store.cancel('inbox');
  expect(cancelRemote).toHaveBeenCalledWith('K8');
  expect(store.getJob('inbox').info).toMatch(/자동으로 정리/);
});

test('화면을 떠나도 멈춘 올리기는 남고, 끝난 결과는 화면과 함께 지운다', async () => {
  const session = { key: 'K10', sent: 2, total: 4, done: new Set(), rejected: [], skipped: [] };
  const upload = vi.fn()
    .mockImplementationOnce(() => Promise.reject(Object.assign(new TypeError('network'), { session })))
    .mockImplementationOnce(() => Promise.resolve({ key: 'K11', uploaded: 1, rejected: [], skipped: [], blocked: [], deferred: 0 }));
  const store = createUploadStore({ upload, cancelRemote: vi.fn() });
  const detachA = store.attach('a', { current: {} });
  store.start('a', items);
  await flush();
  detachA();
  expect(store.getJob('a').resumable).toBe(true);
  expect(store.getSnapshot().attached.a).toBeUndefined();

  const detachB = store.attach('b', { current: {} });
  store.start('b', items);
  await flush();
  detachB();
  expect(store.getSnapshot().jobs.b).toBeUndefined();
});
