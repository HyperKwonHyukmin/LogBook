import { parseLbm } from './lbm.js';
import { encodeLbm } from '../test/modelFixtures.js';

test('블록을 형식대로 읽는다', () => {
  const buf = encodeLbm({ version: 1, counts: { CROD: 1 } }, {
    node_ids: { dtype: '<i4', width: 1, data: new Int32Array([1, 2]) },
    node_xyz: { dtype: '<f4', width: 3, data: new Float32Array([0, 0, 0, 1000, 0, 0]) },
    beam_cards: { dtype: '|u1', width: 1, data: new Uint8Array([2]) },
    beams: { dtype: '<i4', width: 4, data: new Int32Array([7, 1, 0, 1]) },
  });
  const m = parseLbm(buf);
  expect(m.header.counts.CROD).toBe(1);
  expect(Array.from(m.blocks.node_ids)).toEqual([1, 2]);
  expect(m.blocks.node_xyz).toBeInstanceOf(Float32Array);
  expect(Array.from(m.blocks.node_xyz)).toEqual([0, 0, 0, 1000, 0, 0]);
  expect(Array.from(m.blocks.beams)).toEqual([7, 1, 0, 1]);
  expect(m.blocks.beam_cards).toBeInstanceOf(Uint8Array);
  expect(m.width.beams).toBe(4);
});

test('형식이 아니면 오류', () => {
  expect(() => parseLbm(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]).buffer)).toThrow('LBM');
});
