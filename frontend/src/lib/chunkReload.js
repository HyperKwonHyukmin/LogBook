/**
 * 재배포 뒤 열려 있던 탭 — vite build 가 해시 붙은 묶음 파일을 바꿔 치워서, 옛 index.html 이 가리키는
 * 나중 묶음(비교 화면, 3D 엔진 등)을 부르면 404 가 난다. 그때는 한 번만 새로 고침해 새 index.html 을 받는다.
 * 새로 고침 뒤에도 또 실패하면(진짜로 파일이 없거나 네트워크 문제) 무한 반복하지 않고 안내만 한다.
 */

export const CHUNK_RELOAD_KEY = 'logbook_chunk_reload_at';
/** 이 시간 안에 이미 새로 고침했으면 다시 하지 않는다(ms). */
export const CHUNK_RELOAD_WINDOW_MS = 60_000;

const CHUNK_PATTERNS = [
  /failed to fetch dynamically imported module/i,   // Chrome
  /error loading dynamically imported module/i,     // Firefox
  /importing a module script failed/i,              // Safari
  /unable to preload css/i,                         // vite 의 CSS 미리 불러오기
  /loading (css )?chunk [\w-]+ failed/i,
];

/** 동적 import(나중 묶음) 실패인가. */
export function isChunkLoadError(err) {
  if (!err) return false;
  if (err.name === 'ChunkLoadError' || err.chunkLoad) return true;
  const msg = String(err.message || err);
  return CHUNK_PATTERNS.some((re) => re.test(msg));
}

function readAt(storage) {
  try { return Number(storage.getItem(CHUNK_RELOAD_KEY)) || 0; } catch { return 0; }
}

/** 최근에 이미 새로 고침해 봤는가(그렇다면 안내만 한다). */
export function reloadRecentlyTried({ storage = window.sessionStorage, now = Date.now() } = {}) {
  return now - readAt(storage) < CHUNK_RELOAD_WINDOW_MS;
}

/**
 * 한 번만 새로 고침한다. 새로 고침했으면 true, 방금 해 봤는데 또 실패라 멈췄으면 false.
 * sessionStorage 를 못 쓰면(막힌 저장소) 반복 위험이 있어 새로 고침하지 않는다.
 */
export function reloadOnce({ storage = window.sessionStorage, reload = () => window.location.reload(), now = Date.now() } = {}) {
  if (now - readAt(storage) < CHUNK_RELOAD_WINDOW_MS) return false;
  try {
    storage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}

/**
 * main.jsx 에서 한 번 건다. vite 는 나중 묶음의 의존 파일(JS·CSS) 미리 불러오기가 실패하면
 * window 에 'vite:preloadError' 를 쏜다. 새로 고침을 시작했으면 preventDefault 로 오류를 삼키고,
 * 이미 해 봤으면 오류를 그대로 흘려 화면(오류 경계)이 '새 버전' 안내를 보이게 한다.
 */
export function installChunkReloadHandler(target = window, deps) {
  const onPreloadError = (event) => {
    if (reloadOnce(deps)) event.preventDefault();
  };
  target.addEventListener('vite:preloadError', onPreloadError);
  return () => target.removeEventListener('vite:preloadError', onPreloadError);
}
