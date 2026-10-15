/**
 * Logbook API 클라이언트. 프론트와 백엔드가 같은 출처라 상대 경로 /api 만 쓴다
 * (다른 출처로 토큰이 새는 경로가 없다 — WorkBench workbenchRequest.js 의 걱정이 불필요).
 */
import { WB_SESSION_KEY } from '../lib/workbenchBridge.js';

export const TOKEN_KEY = 'logbook_token';
// 18 — 로그인 화면이 한 번 보여 줄 '왜 로그아웃됐는가'(sessionStorage). 'wb_logout' = WorkBench 에서 로그아웃
export const LOGOUT_REASON_KEY = 'logbook_logout_reason';

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

/**
 * 세션이 무효(401)가 됐다 — 토큰을 지우고 셸에 알린다(RequireAuth 가 /login 으로 보낸다).
 * 18 — WorkBench 자동 로그인으로 들어온 세션(sessionStorage.logbook_wb)이면 WorkBench 로그아웃이 원인이므로
 * 로그인 화면에 그 이유를 남기고, 선택 모드를 끝낸다(이후 사번 로그인은 WorkBench 경유 세션이 아니다).
 */
function onUnauthorized() {
  tokenStore.clear();
  try {
    if (sessionStorage.getItem(WB_SESSION_KEY) != null) {
      sessionStorage.removeItem(WB_SESSION_KEY);
      sessionStorage.setItem(LOGOUT_REASON_KEY, 'wb_logout');
    }
  } catch { /* 저장소가 막혀도 로그아웃은 한다 */ }
  window.dispatchEvent(new Event('logbook:unauthorized'));
}

/** signal: AbortSignal — 올리기 [취소]처럼 요청을 도중에 끊을 때. 끊기면 fetch 의 AbortError 를 그대로 던진다. */
export async function api(path, { method = 'GET', body, auth = true, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = tokenStore.get();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // 응답을 기다리는 사이 토큰이 바뀌었으면(다른 탭 재로그인 등) 그 새 토큰은 지우지 않는다.
    if (res.status === 401 && auth && tokenStore.get() === token) onUnauthorized();
    throw new ApiError(res.status, data?.detail ?? null);
  }
  return data;
}

/** 조각 업로드용 — 본문이 바이너리(Blob·ArrayBuffer)다. 오류 처리·401 처리·signal 은 api() 와 같다. */
export async function apiBinary(path, blob, { method = 'PUT', signal } = {}) {
  const token = tokenStore.get();
  const headers = { 'Content-Type': 'application/octet-stream' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { method, headers, body: blob, signal });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && tokenStore.get() === token) onUnauthorized();
    throw new ApiError(res.status, data?.detail ?? null);
  }
  return data;
}

/** 인증 GET — 오류·401 처리는 api() 와 같고, 본문 해석은 호출자가 한다. */
async function fetchAuthed(path) {
  const token = tokenStore.get();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`/api${path}`, { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (res.status === 401 && tokenStore.get() === token) onUnauthorized();
    throw new ApiError(res.status, data?.detail ?? null);
  }
  return res;
}

/** 바이너리 응답(model.lbm). gzip 은 브라우저가 Content-Encoding 으로 이미 풀어 준다. */
export async function apiArrayBuffer(path) {
  return (await fetchAuthed(path)).arrayBuffer();
}

/** 이미지 등 Blob 응답(썸네일). */
export async function apiBlob(path) {
  return (await fetchAuthed(path)).blob();
}
