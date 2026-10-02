import { vi } from 'vitest';

/**
 * fetch 가짜. map 의 열쇠는 `METHOD /api/경로?질의` (질의 포함 전체 주소).
 * 값: 객체·배열(200 JSON) | { __status, detail }(오류) | (init) => 값(동적) | Promise.
 * 바이너리: { __binary: ArrayBuffer }(arrayBuffer()) | { __blob: Blob }(blob()).
 * 등록되지 않은 요청은 실패시켜 테스트가 놓친 호출을 드러낸다.
 */
export function mockApi(map) {
  const fn = vi.fn(async (url, init = {}) => {
    const key = `${init.method || 'GET'} ${url}`;
    let r = map[key];
    if (typeof r === 'function') r = await r(init);
    if (r === undefined) throw new Error(`unmocked ${key}`);
    if (r && r.__status) {
      return { ok: false, status: r.__status, json: () => Promise.resolve({ detail: r.detail }) };
    }
    const body = r ?? null;
    return {
      ok: true, status: 200,
      json: () => Promise.resolve(body),
      arrayBuffer: () => Promise.resolve(body?.__binary ?? new ArrayBuffer(0)),
      blob: () => Promise.resolve(body?.__blob ?? new Blob([])),
    };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export const calls = (fn) => fn.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`);
