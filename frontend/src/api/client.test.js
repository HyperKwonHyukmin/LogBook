import { vi } from 'vitest';
import { api, ApiError, tokenStore } from './client.js';

function stubFetch(status, body) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }));
}

test('토큰이 있으면 Bearer 헤더를 붙인다', async () => {
  tokenStore.set('tok-1');
  stubFetch(200, { ok: true });
  await api('/auth/me');
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe('/api/auth/me');
  expect(init.headers.Authorization).toBe('Bearer tok-1');
});

test('본문은 JSON 으로 보낸다', async () => {
  stubFetch(200, {});
  await api('/auth/login', { method: 'POST', body: { employee_id: 'A1' }, auth: false });
  const [, init] = fetch.mock.calls[0];
  expect(init.body).toBe('{"employee_id":"A1"}');
  expect(init.headers['Content-Type']).toBe('application/json');
  expect(init.headers.Authorization).toBeUndefined();
});

test('실패하면 detail 을 담은 ApiError', async () => {
  stubFetch(403, { detail: 'pending_approval' });
  await expect(api('/auth/login', { method: 'POST', body: {}, auth: false }))
    .rejects.toMatchObject({ status: 403, detail: 'pending_approval' });
});

test('401 이면 토큰을 지우고 unauthorized 이벤트를 보낸다', async () => {
  tokenStore.set('tok-2');
  stubFetch(401, { detail: 'session_invalid' });
  const onUnauthorized = vi.fn();
  window.addEventListener('logbook:unauthorized', onUnauthorized);
  await expect(api('/auth/me')).rejects.toBeInstanceOf(ApiError);
  expect(tokenStore.get()).toBe('');
  expect(onUnauthorized).toHaveBeenCalled();
  window.removeEventListener('logbook:unauthorized', onUnauthorized);
});

test('응답을 받는 사이 토큰이 바뀌었으면 401 이어도 새 토큰을 지우지 않는다', async () => {
  tokenStore.set('old-tok');
  let resolveFetch;
  vi.stubGlobal('fetch', vi.fn().mockImplementation(
    () => new Promise((resolve) => { resolveFetch = resolve; }),
  ));
  const pending = api('/auth/me');
  // 요청이 응답을 기다리는 사이 다른 탭에서 재로그인해 토큰이 바뀌었다고 가정한다.
  tokenStore.set('new-tok');
  resolveFetch({ ok: false, status: 401, json: () => Promise.resolve({ detail: 'session_invalid' }) });
  await expect(pending).rejects.toBeInstanceOf(ApiError);
  expect(tokenStore.get()).toBe('new-tok');
});
