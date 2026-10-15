/**
 * 검색 미리보기 패널 폭(09) — 사용자가 왼쪽 가장자리를 끌어 바꾸고, 브라우저마다 기억한다.
 * 결과 열은 RESULTS_MIN 아래로 줄지 않고, 패널은 작업 영역의 MAX_RATIO 를 넘지 않는다.
 */
export const PREVIEW_MIN = 360;
export const RESULTS_MIN = 480;   // 결과 행(제목·속성 줄·파일 수)이 부서지지 않는 최소 폭
export const MAX_RATIO = 0.7;
export const STEP = 16;          // ←/→ 한 번
export const STEP_LARGE = 64;    // Shift + ←/→
export const STORAGE_KEY = 'logbook.searchPreviewWidth.v1';

/** 예전 기본 폭과 같다 — clamp(360px, 34vw, 480px). */
export const defaultPreviewWidth = (viewport) => Math.round(Math.min(480, Math.max(PREVIEW_MIN, viewport * 0.34)));

/**
 * area: 검색 화면 전체 폭(필터 열 + 결과 + 패널), reserved: 패널·결과 말고 자리를 차지한 폭(펼친 필터 열).
 * 화면이 너무 좁으면 max 가 min 보다 작아질 수 있는데, 그때는 min 으로 둔다(패널을 쓸 수는 있어야 한다).
 */
export function previewBounds(area, reserved = 0) {
  const max = Math.floor(Math.min(area * MAX_RATIO, area - reserved - RESULTS_MIN));
  return { min: PREVIEW_MIN, max: Math.max(PREVIEW_MIN, max) };
}

export const clampWidth = (w, { min, max }) => Math.round(Math.min(max, Math.max(min, w)));

/** 키보드 조절 — 손잡이가 왼쪽 가장자리라 ← 가 넓히기. 해당 없는 키면 null. */
export function keyWidth(key, width, bounds, shift = false) {
  const step = shift ? STEP_LARGE : STEP;
  if (key === 'ArrowLeft') return clampWidth(width + step, bounds);
  if (key === 'ArrowRight') return clampWidth(width - step, bounds);
  if (key === 'Home') return bounds.min;
  if (key === 'End') return bounds.max;
  return null;
}

/** 저장소가 막혀 있거나(사생활 모드·정책) 값이 이상하면 null — 기본 폭을 쓴다. */
export function readStoredWidth(storage = globalThis.localStorage) {
  try {
    const n = Number(storage?.getItem(STORAGE_KEY));
    return Number.isFinite(n) && n >= PREVIEW_MIN ? n : null;
  } catch {
    return null;
  }
}

export function writeStoredWidth(width, storage = globalThis.localStorage) {
  try {
    if (width == null) storage?.removeItem(STORAGE_KEY);
    else storage?.setItem(STORAGE_KEY, String(Math.round(width)));
  } catch { /* 저장소 없이도 이번 화면에서는 동작한다 */ }
}
