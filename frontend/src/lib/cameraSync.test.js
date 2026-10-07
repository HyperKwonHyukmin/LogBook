import { orthoZoom, perspView, syncCamera } from './cameraSync.js';

const src = {
  projection: 'ortho', position: [40, -40, 30], target: [10, 0, 0], quaternion: [0.1, 0.2, 0.3, 0.9], up: [0, 0, 1],
  view: 50, radius: 100, center: [1000, 0, 500],
};
const unit = (a) => a.map((v) => v / Math.hypot(...a));

test('각 모델 크기 기준 — 방향 그대로, 거리·target·보이는 크기는 반지름 비율', () => {
  const s = syncCamera(src, { radius: 200, center: [0, 0, 0] }, 'scale');
  expect(s.target).toEqual([20, 0, 0]);
  expect(s.position).toEqual([80, -80, 60]);
  expect(s.view).toBe(100);
  expect(s.quaternion).toEqual(src.quaternion);
  expect(s.up).toEqual([0, 0, 1]);
  expect(s.projection).toBe('ortho');
  const d1 = [30, -40, 30];
  const d2 = s.position.map((v, i) => v - s.target[i]);
  unit(d2).forEach((v, i) => expect(v).toBeCloseTo(unit(d1)[i], 9));
});

test('같은 좌표 — 원래 좌표의 위치·target·크기를 그대로', () => {
  const s = syncCamera(src, { radius: 300, center: [1100, 0, 500] }, 'same');
  // 원래 좌표 target = 10 + 1000 = 1010 → 받는 쪽 엔진 좌표 1010 − 1100 = −90
  expect(s.target).toEqual([-90, 0, 0]);
  expect(s.position).toEqual([-60, -40, 30]);
  expect(s.view).toBe(50);
});

test('같은 모델끼리 크기 기준은 그대로 복사', () => {
  const s = syncCamera(src, { radius: 100, center: [0, 0, 0] }, 'scale');
  expect(s.position).toEqual(src.position);
  expect(s.view).toBe(50);
});

test('직교 zoom — 짧은 쪽 반폭 / 보일 크기', () => {
  expect(orthoZoom(160, 100, 50)).toBe(2);
  expect(orthoZoom(80, 120, 40)).toBe(2);
  expect(orthoZoom(80, 120, 0)).toBe(1);
  expect(orthoZoom(0, 120, 10)).toBe(1);
});

test('원근 보이는 크기', () => {
  expect(perspView(100, 90)).toBeCloseTo(100, 9);
});
