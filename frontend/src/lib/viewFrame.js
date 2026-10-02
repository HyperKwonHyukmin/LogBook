/**
 * 시점 프리셋과 화면 맞춤(설계 §7.3). 모델은 원점 중심으로 옮겨져 있다(modelGeometry).
 * 평면도는 화면 →X·↑Y(WorkBench Studio 들과 같은 결정, 2026-10-01).
 */
export const VIEW_PRESETS = {
  iso: { label: 'ISO', key: 'i', dir: [1, -1, 0.75], up: [0, 0, 1] },
  front: { label: '정면', key: '1', dir: [0, -1, 0], up: [0, 0, 1] },
  side: { label: '측면', key: '2', dir: [1, 0, 0], up: [0, 0, 1] },
  top: { label: '평면', key: '3', dir: [0, 0, 1], up: [0, 1, 0] },
};

/** 직교 카메라 틀 — 중심에서 dir 방향 radius*4, 세로 반폭 radius*1.08(좁은 화면은 가로 기준). */
export function computeFrame(preset, radius, aspect) {
  const n = Math.hypot(...preset.dir);
  const dist = radius * 4;
  const position = preset.dir.map((v) => (v / n) * dist);
  let halfHeight = radius * 1.08;
  let halfWidth = halfHeight * aspect;
  if (aspect < 1) {
    halfWidth = radius * 1.08;
    halfHeight = halfWidth / aspect;
  }
  return { position, up: preset.up, halfHeight, halfWidth, near: -radius * 20, far: dist + radius * 20 };
}
