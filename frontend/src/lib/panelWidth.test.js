import { PREVIEW_MIN, STORAGE_KEY, clampWidth, defaultPreviewWidth, keyWidth, previewBounds, readStoredWidth, writeStoredWidth } from './panelWidth.js';

test('기본 폭은 예전 clamp(360px, 34vw, 480px) 과 같다', () => {
  expect(defaultPreviewWidth(1366)).toBe(464);
  expect(defaultPreviewWidth(1920)).toBe(480);
  expect(defaultPreviewWidth(900)).toBe(360);
});

test('최대 폭은 작업 영역 70% 와 결과 열 420px 확보 중 작은 쪽', () => {
  expect(previewBounds(1158)).toEqual({ min: PREVIEW_MIN, max: 678 });         // 1366 - 208(메뉴): 1158-480
  expect(previewBounds(1712, 232)).toEqual({ min: PREVIEW_MIN, max: 1000 });   // 1920: 1712-232-480
  expect(previewBounds(3000)).toEqual({ min: PREVIEW_MIN, max: 2100 });        // 넓으면 70%
  expect(previewBounds(600)).toEqual({ min: PREVIEW_MIN, max: PREVIEW_MIN });  // 너무 좁아도 최소는 지킨다
});

test('폭은 범위 안으로 자르고, ←/→·Home·End 로 조절한다', () => {
  const b = { min: 360, max: 700 };
  expect(clampWidth(100, b)).toBe(360);
  expect(clampWidth(900, b)).toBe(700);
  expect(keyWidth('ArrowLeft', 400, b)).toBe(416);
  expect(keyWidth('ArrowRight', 400, b)).toBe(384);
  expect(keyWidth('ArrowLeft', 400, b, true)).toBe(464);
  expect(keyWidth('Home', 500, b)).toBe(360);
  expect(keyWidth('End', 500, b)).toBe(700);
  expect(keyWidth('Enter', 500, b)).toBeNull();
});

test('폭을 저장·복원하고, 저장소가 없거나 막혀도 동작한다', () => {
  writeStoredWidth(612);
  expect(localStorage.getItem(STORAGE_KEY)).toBe('612');
  expect(readStoredWidth()).toBe(612);
  writeStoredWidth(null);
  expect(readStoredWidth()).toBeNull();
  localStorage.setItem(STORAGE_KEY, 'abc');
  expect(readStoredWidth()).toBeNull();
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  expect(readStoredWidth(broken)).toBeNull();
  expect(() => writeStoredWidth(500, broken)).not.toThrow();
  expect(readStoredWidth(null)).toBeNull();
});
