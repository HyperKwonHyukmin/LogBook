import { vi } from 'vitest';
import { batchName, collectFromInput, hasDrmHeader, uploadBatch } from './upload.js';

function file(name, content, relPath = '') {
  const f = new File([content], name);
  if (relPath) Object.defineProperty(f, 'webkitRelativePath', { value: relPath });
  return f;
}

test('DRM 머리(HHIDRMC)를 알아본다', async () => {
  expect(await hasDrmHeader(file('a.pdf', 'HHIDRMC\0\0'))).toBe(true);
  expect(await hasDrmHeader(file('a.pdf', '%PDF-1.4'))).toBe(false);
});

test('input 선택 파일은 webkitRelativePath 를 상대경로로 쓴다', () => {
  const items = collectFromInput([file('a.bdf', 'x', '9999_시험/a.bdf'), file('b.pdf', 'y')]);
  expect(items.map((i) => i.relPath)).toEqual(['9999_시험/a.bdf', 'b.pdf']);
});

test('배치 이름: 최상위 폴더가 하나면 그 이름, 아니면 파일 수', () => {
  expect(batchName([{ relPath: '9999_시험/a.bdf' }, { relPath: '9999_시험/r/b.pdf' }])).toBe('9999_시험');
  expect(batchName([{ relPath: 'a.bdf' }, { relPath: 'b.pdf' }])).toBe('파일 2개');
});

function routeFetch(handler) {
  vi.stubGlobal('fetch', vi.fn((url, init = {}) => Promise.resolve(handler(url, init))));
}
const ok = (body) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });
const fail = (status, detail) => ({ ok: false, status, json: () => Promise.resolve({ detail }) });

test('조각으로 올리고 DRM 파일은 거부 목록으로 마친다', async () => {
  const calls = [];
  routeFetch((url, init) => {
    calls.push(`${init.method} ${url}`);
    if (url === '/api/uploads') return { ...ok({ key: 'K1' }), status: 201 };
    if (url.includes('/chunk')) return ok({ size: 4 });
    if (url.endsWith('/finish')) return ok({ key: 'K1', state: 'staged' });
    throw new Error(url);
  });
  const progress = vi.fn();
  const res = await uploadBatch([
    { file: file('a.bdf', 'GRID'), relPath: '9999_시험/a.bdf' },
    { file: file('enc.pdf', 'HHIDRMC..'), relPath: '9999_시험/enc.pdf' },
  ], { onProgress: progress, chunkSize: 2 });
  expect(res).toEqual({ key: 'K1', uploaded: 1, rejected: ['9999_시험/enc.pdf'] });
  expect(calls.filter((c) => c.includes('/chunk'))).toHaveLength(2); // 4바이트 / 2바이트 조각
  const finish = fetch.mock.calls.find(([u]) => u.endsWith('/finish'));
  expect(JSON.parse(finish[1].body)).toEqual({
    files: [{ rel_path: '9999_시험/a.bdf', size: 4 }],
    rejected: [{ rel_path: '9999_시험/enc.pdf', reason: 'drm' }],
  });
  expect(progress).toHaveBeenLastCalledWith({ sent: 4, total: 4 });
});

test('모든 파일이 DRM 이면 배치를 만들지 않고 오류를 던진다', async () => {
  routeFetch((url) => { throw new Error(url); });
  await expect(uploadBatch([{ file: file('e.pdf', 'HHIDRMC'), relPath: 'e.pdf' }]))
    .rejects.toMatchObject({ code: 'all_drm', rejected: ['e.pdf'] });
  expect(fetch).not.toHaveBeenCalled();
});

test('조각이 offset_mismatch 면 서버 크기에서 이어 보낸다', async () => {
  let n = 0;
  routeFetch((url) => {
    if (url === '/api/uploads') return { ...ok({ key: 'K3' }), status: 201 };
    if (url.includes('/chunk')) {
      n += 1;
      if (n === 2) return fail(409, { code: 'offset_mismatch', size: 2 });
      return ok({ size: 0 });
    }
    return ok({ key: 'K3', state: 'staged' });
  });
  await uploadBatch([{ file: file('a.bdf', 'ABCD'), relPath: 'a.bdf' }], { chunkSize: 2 });
  const chunkUrls = fetch.mock.calls.map(([u]) => u).filter((u) => u.includes('/chunk'));
  expect(chunkUrls.at(-1)).toContain('offset=2');
});

const noSleep = () => vi.fn(() => Promise.resolve());

test('네트워크·5xx 오류는 1s/2s 간격으로 다시 시도한다', async () => {
  let n = 0;
  routeFetch((url) => {
    if (url === '/api/uploads') return { ...ok({ key: 'K4' }), status: 201 };
    if (url.includes('/chunk')) {
      n += 1;
      if (n === 1) throw new TypeError('network');
      if (n === 2) return fail(503, 'storage_unreachable');
      return ok({ size: 4 });
    }
    return ok({ key: 'K4', state: 'staged' });
  });
  const sleep = noSleep();
  await uploadBatch([{ file: file('a.bdf', 'ABCD'), relPath: 'a.bdf' }], { sleep });
  expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
});

test('처리하지 않는 4xx(409 not_uploading, 403 등)는 다시 시도하지 않는다', async () => {
  let chunks = 0;
  routeFetch((url, init) => {
    if (url === '/api/uploads') return { ...ok({ key: 'K5' }), status: 201 };
    if (url.includes('/chunk')) { chunks += 1; return fail(409, 'not_uploading'); }
    if (init.method === 'DELETE') return { ok: true, status: 204, json: () => Promise.resolve(null) };
    throw new Error(url);
  });
  const sleep = noSleep();
  await expect(uploadBatch([{ file: file('a.bdf', 'ABCD'), relPath: 'a.bdf' }], { sleep }))
    .rejects.toMatchObject({ status: 409, detail: 'not_uploading' });
  expect(chunks).toBe(1);
  expect(sleep).not.toHaveBeenCalled();
});

test('offset_mismatch 재동기화는 5번까지만 하고 오류를 던진다', async () => {
  let chunks = 0;
  routeFetch((url, init) => {
    if (url === '/api/uploads') return { ...ok({ key: 'K6' }), status: 201 };
    if (url.includes('/chunk')) { chunks += 1; return fail(409, { code: 'offset_mismatch', size: 0 }); }
    if (init.method === 'DELETE') return { ok: true, status: 204, json: () => Promise.resolve(null) };
    throw new Error(url);
  });
  await expect(uploadBatch([{ file: file('a.bdf', 'ABCD'), relPath: 'a.bdf' }], { sleep: noSleep() }))
    .rejects.toMatchObject({ status: 409 });
  expect(chunks).toBe(6);
});

test('서버 크기가 파일보다 크면 처음(offset 0)부터 한 번 다시 보낸다', async () => {
  let n = 0;
  routeFetch((url) => {
    if (url === '/api/uploads') return { ...ok({ key: 'K7' }), status: 201 };
    if (url.includes('/chunk')) {
      n += 1;
      if (n === 1) return fail(409, { code: 'offset_mismatch', size: 99 });
      return ok({ size: 4 });
    }
    return ok({ key: 'K7', state: 'staged' });
  });
  await uploadBatch([{ file: file('a.bdf', 'ABCD'), relPath: 'a.bdf' }], { chunkSize: 4, sleep: noSleep() });
  const chunkUrls = fetch.mock.calls.map(([u]) => u).filter((u) => u.includes('/chunk'));
  expect(chunkUrls).toHaveLength(2);
  expect(chunkUrls[1]).toContain('offset=0');
});

test('finish 응답을 못 받았어도 서버가 이미 받았으면(DELETE 409 not_uploading) 성공으로 본다', async () => {
  routeFetch((url, init) => {
    if (url === '/api/uploads') return { ...ok({ key: 'K8' }), status: 201 };
    if (url.includes('/chunk')) return ok({ size: 4 });
    if (url.endsWith('/finish')) throw new TypeError('network');
    if (init.method === 'DELETE') return fail(409, 'not_uploading');
    throw new Error(url);
  });
  const res = await uploadBatch([{ file: file('a.bdf', 'ABCD'), relPath: 'a.bdf' }], { sleep: noSleep() });
  expect(res).toEqual({ key: 'K8', uploaded: 1, rejected: [] });
});
