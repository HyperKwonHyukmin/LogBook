import { vi } from 'vitest';
import {
  CHUNK_RELOAD_KEY, CHUNK_RELOAD_WINDOW_MS, installChunkReloadHandler, isChunkLoadError, reloadOnce,
} from './chunkReload.js';
import { engineFailure } from '../components/viewer/useModelViewer.js';

// 재배포 뒤 사라진 묶음 — 한 번만 새로 고침(sessionStorage 로 반복 막기)

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('동적 import 실패 문구를 알아본다(브라우저별)', () => {
  expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /assets/a.js'))).toBe(true);
  expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
  expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
  expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/x.css'))).toBe(true);
  expect(isChunkLoadError(new Error('WebGL context lost'))).toBe(false);
  expect(isChunkLoadError(null)).toBe(false);
});

test('vite:preloadError 는 한 번만 새로 고침하고, 그 안에 또 오면 오류를 흘려 화면이 안내하게 둔다', () => {
  const target = new EventTarget();
  const storage = memStorage();
  const reload = vi.fn();
  let now = 1_000_000;
  const off = installChunkReloadHandler(target, { storage, reload, get now() { return now; } });

  const first = new Event('vite:preloadError', { cancelable: true });
  target.dispatchEvent(first);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(first.defaultPrevented).toBe(true);
  expect(storage.getItem(CHUNK_RELOAD_KEY)).toBe(String(now));

  now += 5_000; // 새로 고침했는데도 또 실패
  const second = new Event('vite:preloadError', { cancelable: true });
  target.dispatchEvent(second);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(second.defaultPrevented).toBe(false);

  now += CHUNK_RELOAD_WINDOW_MS; // 한참 뒤의 또 다른 재배포는 다시 새로 고침한다
  target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
  expect(reload).toHaveBeenCalledTimes(2);
  off();
});

test('저장소를 쓸 수 없으면 반복 위험이 있어 새로 고침하지 않는다', () => {
  const reload = vi.fn();
  const storage = { getItem: () => null, setItem: () => { throw new Error('blocked'); } };
  expect(reloadOnce({ storage, reload })).toBe(false);
  expect(reload).not.toHaveBeenCalled();
});

test('3D 뷰어 — 엔진 묶음을 못 받은 것과 WebGL 을 못 쓰는 것을 가른다', () => {
  const chunk = new TypeError('Failed to fetch dynamically imported module: /assets/viewerEngine-abc.js');
  expect(engineFailure(chunk, { reload: () => true })).toEqual({ status: 'loading', error: '' });
  expect(engineFailure(chunk, { reload: () => false }))
    .toMatchObject({ status: 'error', reload: true, error: expect.stringContaining('새 버전이 배포되어') });
  expect(engineFailure(new Error('WebGL not supported'), { reload: () => true }))
    .toEqual({ status: 'error', error: '이 브라우저에서 3D 를 표시할 수 없습니다.' });
});
