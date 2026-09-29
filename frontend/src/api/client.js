/**
 * Logbook API 클라이언트. 프론트와 백엔드가 같은 출처라 상대 경로 /api 만 쓴다
 * (다른 출처로 토큰이 새는 경로가 없다 — WorkBench workbenchRequest.js 의 걱정이 불필요).
 */
export const TOKEN_KEY = 'logbook_token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY) || '',
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(status, detail) {
    super(typeof detail === 'string' ? detail : `HTTP ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = tokenStore.get();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // 응답을 기다리는 사이 토큰이 바뀌었으면(다른 탭 재로그인 등) 그 새 토큰은 지우지 않는다.
    if (res.status === 401 && auth && tokenStore.get() === token) {
      tokenStore.clear();
      window.dispatchEvent(new Event('logbook:unauthorized'));
    }
    throw new ApiError(res.status, data?.detail ?? null);
  }
  return data;
}

/** 조각 업로드용 — 본문이 바이너리(Blob)다. 오류 처리·401 처리는 api() 와 같다. */
export async function apiBinary(path, blob, { method = 'PUT' } = {}) {
  const token = tokenStore.get();
  const headers = { 'Content-Type': 'application/octet-stream' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { method, headers, body: blob });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && tokenStore.get() === token) {
      tokenStore.clear();
      window.dispatchEvent(new Event('logbook:unauthorized'));
    }
    throw new ApiError(res.status, data?.detail ?? null);
  }
  return data;
}
