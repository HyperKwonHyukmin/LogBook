import { VIEW_PRESETS, computeFrame } from './viewFrame.js';

test('프리셋 4종', () => {
  expect(Object.keys(VIEW_PRESETS)).toEqual(['iso', 'front', 'side', 'top']);
  expect(VIEW_PRESETS.top.up).toEqual([0, 1, 0]);
});

test('화면 맞춤 — 세로 기준, 좁으면 가로 기준', () => {
  const f = computeFrame(VIEW_PRESETS.front, 100, 2);
  expect(f.position.map((v) => Math.round(v))).toEqual([0, -400, 0]);
  expect(f.halfHeight).toBeCloseTo(108);
  expect(f.halfWidth).toBeCloseTo(216);
  const narrow = computeFrame(VIEW_PRESETS.front, 100, 0.5);
  expect(narrow.halfWidth).toBeCloseTo(108);
  expect(narrow.halfHeight).toBeCloseTo(216);
  expect(f.near).toBeLessThan(0);
  expect(f.far).toBeGreaterThan(400);
});
