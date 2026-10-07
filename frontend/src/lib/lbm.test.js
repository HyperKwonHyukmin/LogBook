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

test('v2 블록(방향 벡터·오프셋)과 형식 버전', async () => {
  const { sampleModelV2, encodeModel } = await import('../test/modelFixtures.js');
  const { lbmVersion, beamExtras } = await import('./lbm.js');
  const m = parseLbm(encodeModel(sampleModelV2()));
  expect(m.header.version).toBe(2);
  expect(m.width.beam_orient).toBe(3);
  expect(m.width.beam_offsets).toBe(6);
  expect(Array.from(m.blocks.beam_orient.slice(6, 9))).toEqual([0, 1, 0]);
  const ex = beamExtras(m);
  expect(ex.orient).toBeInstanceOf(Float32Array);
  expect(ex.offsets[14]).toBe(50);
  expect(lbmVersion(m)).toBe(2);
  expect(lbmVersion(m, 1)).toBe(1);      // API 값이 우선
  expect(lbmVersion({ header: {} })).toBe(1);
  // 행 수가 안 맞는 블록은 쓰지 않는다
  expect(beamExtras({ blocks: { beams: new Int32Array(8), beam_orient: new Float32Array(3) } }).orient).toBeNull();
});
