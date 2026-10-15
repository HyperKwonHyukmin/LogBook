import { vi } from 'vitest';
import { cancelUpload, continueUpload, isAbortError, uploadBatch, withRetry } from './upload.js';
import { ApiError } from '../api/client.js';

// 큰 올리기 견디기 — 재시도 간격·이어 올리기·[취소]·읽을 수 없는 파일 건너뛰기·작은 파일 함께 보내기

function file(name, content) {
  return new File([content], name);
}
function routeFetch(handler) {
  vi.stubGlobal('fetch', vi.fn((url, init = {}) => Promise.resolve().then(() => handler(url, init))));
}
const ok = (body) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });
const fail = (status, detail) => ({ ok: false, status, json: () => Promise.resolve({ detail }) });
const noSleep = () => vi.fn(() => Promise.resolve());
const chunkUrls = () => fetch.mock.calls.map(([u]) => u).filter((u) => u.includes('/chunk'));
const methods = (m) => fetch.mock.calls.filter(([, init]) => init?.method === m);

afterEach(() => { vi.useRealTimers(); });

test('일시 오류가 계속되면 1·2·4·8·16·16초(합 47초, 60초 안)까지만 기다리고 실패한다', async () => {
  routeFetch((url) => {
    if (url === '/api/uploads') return { ...ok({ key: 'K1' }), status: 201 };
    if (url.includes('/chunk')) return fail(503, 'storage_unreachable');
    throw new Error(url);
  });
  const sleep = noSleep();
  const err = await uploadBatch([{ file: file('a.bdf', 'ABCD'), relPath: 'a.bdf' }], { sleep }).catch((e) => e);
  expect(err).toMatchObject({ status: 503 });
  expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000, 8000, 16000, 16000]);
  // 도중 실패는 서버 배치를 지우지 않는다 — 이어 올리기 상태를 싣는다
  expect(methods('DELETE')).toHaveLength(0);
  expect(err.session).toMatchObject({ key: 'K1', sent: 0, total: 4 });
});

test('가짜 시계로도 실제 대기 간격이 지수로 늘어난다', async () => {
  vi.useFakeTimers();
  let n = 0;
  const fn = vi.fn(() => { n += 1; if (n < 4) throw new TypeError('network'); return 'ok'; });
  const done = withRetry(fn);
  await vi.advanceTimersByTimeAsync(999);
  expect(fn).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fn).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2000);
  expect(fn).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(3999);
  expect(fn).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1);
  await expect(done).resolves.toBe('ok');
});

test('408·429 는 다시 보내고, 400·422 는 바로 실패한다', async () => {
  for (const status of [408, 429]) {
    let n = 0;
    await expect(withRetry(() => { n += 1; if (n === 1) throw new ApiError(status, null); return n; }, { sleep: noSleep() }))
      .resolves.toBe(2);
  }
  for (const status of [400, 422]) {
    const sleep = noSleep();
    await expect(withRetry(() => { throw new ApiError(status, 'invalid_path'); }, { sleep })).rejects.toMatchObject({ status });
    expect(sleep).not.toHaveBeenCalled();
  }
});

test('멈춘 올리기를 이어 올리면 끝난 파일은 건너뛰고 멈춘 파일은 받은 자리부터 보낸다', async () => {
  let down = true;
  let serverSize = 0;
  routeFetch((url, init) => {
    if (url === '/api/uploads') return { ...ok({ key: 'K2' }), status: 201 };
    if (url.includes('/chunk')) {
      if (url.includes('path=b.bdf') && url.includes('offset=2') && down) return fail(502, null);
      if (url.includes('path=b.bdf')) serverSize = Number(new URL(url, 'http://x').searchParams.get('offset')) + 2;
      return ok({ size: serverSize });
    }
    if (url.endsWith('/finish')) return ok({ key: 'K2', state: 'staged' });
    throw new Error(`${init.method} ${url}`);
  });
  const items = [
    { file: file('a.bdf', 'AAAAAAAAAA'), relPath: 'a.bdf' },   // 10바이트 — 큰 파일(조각 여러 개)
    { file: file('b.bdf', 'BBBBBB'), relPath: 'b.bdf' },       // 6바이트 — 둘째 조각에서 멈춘다
  ];
  const err = await uploadBatch(items, { chunkSize: 2, sleep: noSleep(), parallel: 1 }).catch((e) => e);
  expect(err.status).toBe(502);
  const { session } = err;
  expect([...session.done]).toEqual(['a.bdf']);
  expect(session.offsets['b.bdf']).toBe(2);
  expect(session.sent).toBe(12);

  fetch.mockClear();
  down = false;
  const progress = vi.fn();
  const res = await continueUpload(session, { chunkSize: 2, sleep: noSleep(), onProgress: progress });
  expect(res).toEqual({ key: 'K2', uploaded: 2, rejected: [], skipped: [], blocked: [], deferred: 0 });
  // a.bdf 는 다시 보내지 않고, b.bdf 는 offset=2 부터
  expect(chunkUrls().every((u) => u.includes('path=b.bdf'))).toBe(true);
  expect(chunkUrls()[0]).toContain('offset=2');
  expect(progress).toHaveBeenLastCalledWith({ sent: 16, total: 16 });
  expect(methods('POST').filter(([u]) => u === '/api/uploads')).toHaveLength(0); // 같은 배치
});

test('이어 올릴 때 서버가 더 받아 두었으면(offset_mismatch) 서버 크기로 맞춘다', async () => {
  routeFetch((url) => {
    if (url.includes('offset=2')) return fail(409, { code: 'offset_mismatch', size: 4 });
    if (url.includes('/chunk')) return ok({ size: 6 });
    if (url.endsWith('/finish')) return ok({ key: 'K3', state: 'staged' });
    throw new Error(url);
  });
  const it = { file: file('b.bdf', 'BBBBBB'), relPath: 'b.bdf' };
  const session = { key: 'K3', items: [it], rejected: [], skipped: [], done: new Set(), offsets: { 'b.bdf': 2 },
    sent: 2, total: 6, force: false, finishAttempts: 0 };
  await continueUpload(session, { chunkSize: 2, sleep: noSleep() });
  expect(chunkUrls()).toEqual(['/api/uploads/K3/chunk?path=b.bdf&offset=2', '/api/uploads/K3/chunk?path=b.bdf&offset=4']);
});

test('[취소] — signal 을 끊으면 AbortError 와 세션을 던지고, cancelUpload 가 배치를 지운다', async () => {
  const ctrl = new AbortController();
  routeFetch((url, init) => {
    if (url === '/api/uploads') return { ...ok({ key: 'K4' }), status: 201 };
    if (url.includes('/chunk')) {
      ctrl.abort(); // 첫 조각을 보내는 사이 사용자가 [취소]
      return ok({ size: 2 });
    }
    if (init.method === 'DELETE') return { ok: true, status: 204, json: () => Promise.resolve(null) };
    throw new Error(url);
  });
  const err = await uploadBatch([{ file: file('a.bdf', 'ABCD'), relPath: 'a.bdf' }], { chunkSize: 2, signal: ctrl.signal })
    .catch((e) => e);
  expect(isAbortError(err)).toBe(true);
  expect(err.session.key).toBe('K4');
  expect(chunkUrls()).toHaveLength(1);
  expect(await cancelUpload('K4')).toBe('removed');
  expect(methods('DELETE').map(([u]) => u)).toEqual(['/api/uploads/K4']);
});

test('재시도 대기 중에도 [취소]가 바로 먹는다', async () => {
  const ctrl = new AbortController();
  const never = () => new Promise(() => {});
  const p = withRetry(() => { throw new TypeError('network'); }, { sleep: never, signal: ctrl.signal });
  ctrl.abort();
  await expect(p).rejects.toMatchObject({ name: 'AbortError' });
});

test('cancelUpload — 이미 없으면 지운 것으로, 이미 받았으면 finished, 공유 폴더가 끊기면 failed', async () => {
  routeFetch((url) => (url.endsWith('/gone') ? fail(404, 'upload_not_found')
    : url.endsWith('/done') ? fail(409, 'not_uploading') : fail(503, 'storage_unreachable')));
  expect(await cancelUpload('gone')).toBe('removed');
  expect(await cancelUpload('done')).toBe('finished');
  expect(await cancelUpload('down')).toBe('failed');
});

/** 첫 n 번 slice 읽기는 되고 그 뒤로는 잠겨서(NotReadableError) 읽지 못하는 파일. */
function lockedAfter(name, content, okReads) {
  const real = new File([content], name);
  let reads = 0;
  return {
    name, size: real.size,
    slice: (a, b) => {
      reads += 1;
      if (reads > okReads) return { arrayBuffer: () => Promise.reject(new DOMException('locked', 'NotReadableError')) };
      return real.slice(a, b);
    },
  };
}

test('도중에 읽을 수 없게 된 파일은 건너뛰고 나머지를 마친 뒤 알린다(서버에는 받은 파일만 선언)', async () => {
  routeFetch((url) => {
    if (url === '/api/uploads') return { ...ok({ key: 'K5' }), status: 201 };
    if (url.includes('/chunk')) return ok({ size: 2 });
    if (url.endsWith('/finish')) return ok({ key: 'K5', state: 'staged' });
    throw new Error(url);
  });
  const progress = vi.fn();
  const res = await uploadBatch([
    { file: lockedAfter('locked.pptx', 'LLLLLL', 2), relPath: 'r/locked.pptx' }, // DRM 확인 + 첫 조각만 읽힌다
    { file: file('a.bdf', 'GRID'), relPath: 'r/a.bdf' },
  ], { chunkSize: 2, sleep: noSleep(), onProgress: progress, parallel: 1 });
  expect(res).toMatchObject({ key: 'K5', uploaded: 1, skipped: ['r/locked.pptx'] });
  const finish = fetch.mock.calls.find(([u]) => u.endsWith('/finish'));
  expect(JSON.parse(finish[1].body).files).toEqual([{ rel_path: 'r/a.bdf', size: 4 }]);
  expect(progress).toHaveBeenLastCalledWith({ sent: 4, total: 4 });
});

test('처음부터 읽을 수 없는 파일은 확인 단계에서 건너뛴다. 모두 그렇다면 배치를 만들지 않는다', async () => {
  routeFetch((url) => { throw new Error(url); });
  const err = await uploadBatch([{ file: lockedAfter('x.pdf', 'X', 0), relPath: 'x.pdf' }]).catch((e) => e);
  expect(err).toMatchObject({ code: 'none_uploadable', skipped: ['x.pdf'] });
  expect(fetch).not.toHaveBeenCalled();
});

test('작은 파일은 셋씩 함께 보낸다', async () => {
  let inFlight = 0;
  let peak = 0;
  const pending = [];
  vi.stubGlobal('fetch', vi.fn((url) => {
    if (url === '/api/uploads') return Promise.resolve({ ...ok({ key: 'K6' }), status: 201 });
    if (url.endsWith('/finish')) return Promise.resolve(ok({ key: 'K6', state: 'staged' }));
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    return new Promise((resolve) => { pending.push(() => { inFlight -= 1; resolve(ok({ size: 1 })); }); });
  }));
  const items = ['a', 'b', 'c', 'd', 'e'].map((n) => ({ file: file(`${n}.txt`, n), relPath: `${n}.txt` }));
  let settled = false;
  const done = uploadBatch(items, { sleep: noSleep() }).finally(() => { settled = true; });
  for (let i = 0; i < 50 && !settled; i += 1) {
    await new Promise((r) => { setTimeout(r, 0); });
    pending.splice(0).forEach((f) => f());
  }
  await expect(done).resolves.toMatchObject({ uploaded: 5 });
  expect(peak).toBe(3);
});
