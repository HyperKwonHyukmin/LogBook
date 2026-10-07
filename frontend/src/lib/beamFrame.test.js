import { beamBasis, fillBeamFrames } from './beamFrame.js';

const close = (a, b) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

test('X 축 1D, v=(0,0,1) → y = +Z, z = −Y (Nastran: z = x × v, y = z × x)', () => {
  const f = beamBasis([0, 0, 0], [1000, 0, 0], [0, 0, 1]);
  close(f.x, [1, 0, 0]);
  close(f.y, [0, 0, 1]);
  close(f.z, [0, -1, 0]);
  expect(f.length).toBeCloseTo(1000);
  expect(f.fallback).toBe(false);
});

test('v 가 x-y 평면을 정한다 — v 의 x 성분은 무시된다', () => {
  const f = beamBasis([0, 0, 0], [0, 2000, 0], [5, 3, 0]);
  close(f.x, [0, 1, 0]);
  close(f.y, [1, 0, 0]);
  close(f.z, [0, 0, -1]);
});

test('오프셋 WA·WB 를 끝점에 더한다', () => {
  const f = beamBasis([0, 0, 0], [1000, 0, 0], [0, 0, 1], [0, 0, 50], [0, 0, 150]);
  close(f.start, [0, 0, 50]);
  close(f.end, [1000, 0, 150]);
  expect(f.length).toBeCloseTo(Math.hypot(1000, 100));
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  expect(dot(f.x, f.y)).toBeCloseTo(0);
  expect(dot(f.y, f.z)).toBeCloseTo(0);
  expect(dot(f.x, f.z)).toBeCloseTo(0);
});

test('v 가 x 와 나란하거나 없으면 대체 v(전역 Z, 세로 요소는 전역 X)', () => {
  const par = beamBasis([0, 0, 0], [1000, 0, 0], [3, 0, 0]);
  expect(par.fallback).toBe(true);
  close(par.y, [0, 0, 1]);
  const none = beamBasis([0, 0, 0], [1000, 0, 0], null);
  expect(none.fallback).toBe(true);
  close(none.y, [0, 0, 1]);
  const vertical = beamBasis([0, 0, 0], [0, 0, 500], [0, 0, 0]);
  expect(vertical.fallback).toBe(true);
  close(vertical.x, [0, 0, 1]);
  close(vertical.y, [1, 0, 0]);
  close(vertical.z, [0, 1, 0]);
});

test('길이 0 은 그리지 않는다', () => {
  const f = beamBasis([5, 5, 5], [5, 5, 5], [0, 0, 1]);
  expect(f.length).toBe(0);
  expect(f.x).toBeNull();
});

test('fillBeamFrames — 행렬 열 = x·L, y, z, A', () => {
  const positions = new Float32Array([0, 0, 0, 1000, 0, 0, 0, 0, 0, 0, 0, 0]);
  const beams = new Int32Array([1, 1, 0, 1, 2, 1, 2, 3]);
  const orient = new Float32Array([0, 0, 1, 0, 0, 0]);
  const offsets = new Float32Array([0, 0, 10, 0, 0, 10, 0, 0, 0, 0, 0, 0]);
  const out = new Float32Array(32);
  const fb = fillBeamFrames({ positions, beams, orient, offsets }, new Int32Array([0, 1]), out);
  expect(Array.from(out.slice(0, 16)).map((v) => v + 0)).toEqual([1000, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 10, 1]);
  // 둘째는 길이 0 → 0 행렬
  expect(Array.from(out.slice(16))).toEqual(new Array(16).fill(0));
  expect(fb).toBe(0);
});
