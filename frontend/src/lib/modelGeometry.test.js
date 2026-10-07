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
  expect(g.groups[0].color).toMatch(/^#[0-9a-f]{6}$/i);
});

test('피킹 색 왕복', () => {
  for (const i of [0, 1, 255, 256, 65535, 1_000_000]) {
    const [r, g, b] = encodePick(i);
    expect(decodePick(r, g, b)).toBe(i);
  }
  expect(decodePick(0, 0, 0)).toBeNull();
});

test('PID 묶음 안 카드별 범위', async () => {
  const { sampleModelV2 } = await import('../test/modelFixtures.js');
  const m = sampleModelV2();
  m.blocks.tris = new Int32Array([21, 5, 4, 5, 6]);
  m.blocks.tri_cards = new Uint8Array([0]);
  const g = buildGeometry(m);
  const shell = g.groups.find((x) => x.pid === 5);
  expect(shell.shellRanges).toEqual([{ card: 'CTRIA3', start: 0, count: 3 }, { card: 'CQUAD4', start: 3, count: 6 }]);
  const beam = g.groups.find((x) => x.pid === 1);
  expect(beam.beamRanges).toEqual([{ card: 'CBEAM', start: 0, count: 2 }]);
});

test('같은 PID 에 카드가 섞이면 카드끼리 모은다', () => {
  const m = sampleModel();
  m.blocks.beams = new Int32Array([10, 1, 0, 1, 11, 1, 1, 2, 12, 1, 2, 3]);
  m.blocks.beam_cards = new Uint8Array([1, 0, 1]);
  const g = buildGeometry(m);
  const b = g.groups[0];
  expect(b.beamRanges).toEqual([{ card: 'CBAR', start: 0, count: 2 }, { card: 'CBEAM', start: 2, count: 4 }]);
  expect(Array.from(b.beamElem)).toEqual([1, 0, 2]);
  expect(Array.from(b.beams)).toEqual([1, 2, 0, 1, 2, 3]);
});
