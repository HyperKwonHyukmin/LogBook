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

test('단축키 — I·1·2·3 과 A·S·D', async () => {
  const { VIEW_KEYS } = await import('./viewFrame.js');
  expect(VIEW_KEYS).toMatchObject({ i: 'iso', 1: 'front', s: 'front', 2: 'side', d: 'side', 3: 'top', a: 'top' });
});

test('절점 경계·원근 거리', async () => {
  const { nodeBounds, perspectiveDistance } = await import('./viewFrame.js');
  const pos = new Float32Array([0, 0, 0, 10, 0, 0, 0, 20, 0, 100, 100, 100]);
  expect(nodeBounds(pos, [0, 1, 2])).toEqual({ center: [5, 10, 0], radius: Math.hypot(10, 20) / 2 });
  expect(nodeBounds(pos, (i) => i === 3, 50)).toEqual({ center: [100, 100, 100], radius: 50 });
  expect(nodeBounds(pos, [])).toBeNull();
  expect(perspectiveDistance(100, 60, 1)).toBeCloseTo(216);
});
