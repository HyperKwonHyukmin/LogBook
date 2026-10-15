/**
 * 사용자 화면 설정(10) — 서버(GET/PUT /api/me/prefs)에 두어 다른 PC 에서도 같은 설정으로 시작한다.
 *
 * localStorage 는 빠른 사본·대비책이다: 화면은 먼저 localStorage 값으로 그리고, 로그인·앱 시작 때 받은
 * 서버 값이 있으면 그 값으로 바꾼다(서버가 이긴다). 단, 아직 서버에 닿지 못한 내 변경(받아 오는 사이에
 * 바꿨거나, 보내기 전에 창을 닫았거나 새로 고침함)이 있으면 그 값을 지키고 다시 보낸다.
 * 쓰기는 마지막 변경 뒤 WRITE_DELAY_MS 에 한 번 보낸다.
 */
import { api } from '../api/client.js';

export const PREF_KEYS = { previewWidth: 'search.previewWidth', searchGroup: 'search.group' };
export const WRITE_DELAY_MS = 600;
// 보내지 못한 변경 — 새로 고침·창 닫기를 넘어 남겨, 다음 시작 때 서버의 옛 값이 덮지 않게 한다
export const UNSENT_KEY = 'logbook.prefsUnsent.v1';

const listeners = new Set();
let timer = null;
let server = {};

function readUnsent() {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(UNSENT_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function writeUnsent(v) {
  try {
    if (Object.keys(v).length) globalThis.localStorage?.setItem(UNSENT_KEY, JSON.stringify(v));
    else globalThis.localStorage?.removeItem(UNSENT_KEY);
  } catch { /* 저장소가 막혀도 이번 화면에서는 동작한다 */ }
}

/** 서버 값이 들어오면 불린다 — fn(key, value). 해제 함수를 돌려준다. */
export function subscribePrefs(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 로그인·앱 시작 때 한 번 — 받은 값을 알리고 돌려준다. 실패해도 화면은 localStorage 값으로 동작한다. */
export async function loadPrefs() {
  let got;
  try {
    got = await api('/me/prefs');
  } catch {
    return {};
  }
  server = got && typeof got === 'object' ? got : {};
  const unsent = readUnsent();
  for (const [key, value] of Object.entries(server)) {
    if (key in unsent) continue;   // 내 최근 변경이 이긴다(아래에서 다시 보낸다)
    listeners.forEach((fn) => fn(key, value));
  }
  if (Object.keys(unsent).length) {
    clearTimeout(timer);
    timer = setTimeout(flushPrefs, 0);
  }
  return server;
}

/** 대기 중인 변경을 바로 보낸다(로그아웃 직전 등). */
export async function flushPrefs() {
  clearTimeout(timer);
  timer = null;
  const body = readUnsent();
  if (Object.keys(body).length === 0) return;
  try {
    server = { ...server, ...(await api('/me/prefs', { method: 'PUT', body })) };
  } catch {
    return;   // 서버가 받지 못했다 — 남겨 두고 다음 변경·시작 때 다시 보낸다
  }
  // 보내는 사이에 또 바뀐 열쇠는 남긴다
  const now = readUnsent();
  for (const [k, v] of Object.entries(body)) if (now[k] === v) delete now[k];
  writeUnsent(now);
}

/** 설정 하나를 고친다(null = 기본값으로). 여러 번 불러도 마지막 값만 늦게 한 번 보낸다. */
export function savePref(key, value, { delay = WRITE_DELAY_MS } = {}) {
  writeUnsent({ ...readUnsent(), [key]: value ?? null });
  clearTimeout(timer);
  timer = setTimeout(flushPrefs, delay);
}

/** 로그아웃·테스트 — 앞 사용자의 서버 값·구독을 비운다(보내지 못한 변경은 flushPrefs 로 먼저 보낸다). */
export function resetPrefs({ keepListeners = true } = {}) {
  clearTimeout(timer);
  timer = null;
  server = {};
  writeUnsent({});
  if (!keepListeners) listeners.clear();
}
