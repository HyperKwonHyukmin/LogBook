import { buildGeometry, decodePick, encodePick } from './modelGeometry.js';
import { sampleModel } from '../test/modelFixtures.js';

test('PID 묶음·삼각형 분할·경계선·요소 순번', () => {
  const g = buildGeometry(sampleModel());
  expect(g.groups.map((x) => x.pid)).toEqual([1, 5]);
  const [beam, shell] = g.groups;
  expect(Array.from(beam.beams)).toEqual([0, 1]);
  expect(Array.from(beam.beamElem)).toEqual([0]);
  // 요소 순번: beam 0, tri 1, quad 2 → 삼각형 순서는 tri 먼저
  expect(Array.from(shell.shell)).toEqual([1, 2, 4, 0, 1, 2, 0, 2, 3]);
  expect(Array.from(shell.shellElem)).toEqual([1, 2, 2]);
  expect(shell.edges.length).toBe((3 + 4) * 2);
  expect(shell.count).toBe(2);
  expect(Array.from(g.elemKind)).toEqual([0, 1, 2]);
  expect(Array.from(g.elemRow)).toEqual([0, 0, 0]);
  expect(g.total).toBe(3);
});

test('중심 이동·반지름·표시물', () => {
  const g = buildGeometry(sampleModel());
  expect(g.center).toEqual([500, 500, 250]);
  expect(Array.from(g.positions.slice(0, 3))).toEqual([-500, -500, -250]);
  expect(g.radius).toBeCloseTo(Math.hypot(1000, 1000, 500) / 2);
  expect(Array.from(g.rigid.rbe2)).toEqual([0, 1, 0, 2]);
  expect(Array.from(g.rigid.rbe3)).toEqual([3, 0]);
  expect(Array.from(g.masses)).toEqual([4]);
  expect(Array.from(g.spcs)).toEqual([0]);
  expect(g.groups[0].color).toMatch(/^#[0-9a-f]{6}$/);
});

test('피킹 색 왕복', () => {
  for (const i of [0, 1, 255, 256, 65535, 1_000_000]) {
    const [r, g, b] = encodePick(i);
    expect(decodePick(r, g, b)).toBe(i);
  }
  expect(decodePick(0, 0, 0)).toBeNull();
});
