import { vi } from 'vitest';

/**
 * fetch 가짜. map 의 열쇠는 `METHOD /api/경로?질의` (질의 포함 전체 주소).
 * 값: 객체·배열(200 JSON) | { __status, detail }(오류) | (init) => 값(동적) | Promise.
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
    return { ok: true, status: 200, json: () => Promise.resolve(r) };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export const calls = (fn) => fn.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`);
