/**
 * 04b 3D 뷰어 테스트 공용 합성 모델(실제 호선 모델 아님).
 * 테스트 파일(*.test.js)에서 export 해 다른 테스트가 import 하면 그 파일의 test() 까지
 * 함께 등록돼 중복 실행되므로, 공용 도우미는 여기 둔다.
 */

/** 테스트용 인코더 — 04a 형식 그대로(머리말 4바이트 정렬, 블록 4바이트 정렬). */
export function encodeLbm(header, blocks) {
  const parts = [];
  let offset = 0;
  const metas = {};
  for (const [name, { dtype, width, data }] of Object.entries(blocks)) {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { parts.push(new Uint8Array(pad)); offset += pad; }
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    metas[name] = { offset, dtype, count: width > 1 ? data.length / width : data.length, width };
    parts.push(bytes);
    offset += bytes.byteLength;
  }
  let json = new TextEncoder().encode(JSON.stringify({ ...header, blocks: metas }));
  const hpad = (4 - (json.length % 4)) % 4;
  if (hpad) json = new Uint8Array([...json, ...new Array(hpad).fill(32)]);
  const out = new Uint8Array(8 + json.length + offset);
  out.set(new TextEncoder().encode('LBM1'), 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  let p = 8 + json.length;
  for (const part of parts) { out.set(part, p); p += part.byteLength; }
  return out.buffer;
}

/** parseLbm 결과 모양의 작은 모델. */
export function sampleModel() {
  // 절점 1..5, CBEAM(pid 1) 1-2, CQUAD4(pid 5) 1-2-3-4, CTRIA3(pid 5) 2-3-5, RBE2 1→2,3, RBE3 4←1, CONM2 at 5, SPC at 1
  const header = {
    bbox: { min: [0, 0, 0], max: [1000, 1000, 500] },
    cards: { beam: ['CBAR', 'CBEAM', 'CROD', 'CONROD', 'CBUSH'], tri: ['CTRIA3', 'CTRIA6', 'CTRIAR'],
             quad: ['CQUAD4', 'CQUAD8', 'CQUADR'], rigid: ['RBE2', 'RBE3'] },
    properties: { 1: { card: 'PBEAML', mid: 1, type: 'L', dims: [100, 100, 10, 10] }, 5: { card: 'PSHELL', mid: 1, t: 12 } },
    materials: { 1: { card: 'MAT1', E: 206000, G: null, nu: 0.3, rho: 7.85e-9 } },
    conrods: {},
  };
  const blocks = {
    node_ids: new Int32Array([1, 2, 3, 4, 5]),
    node_xyz: new Float32Array([0, 0, 0, 1000, 0, 0, 1000, 1000, 0, 0, 1000, 0, 1000, 1000, 500]),
    beams: new Int32Array([10, 1, 0, 1]), beam_cards: new Uint8Array([1]),
    tris: new Int32Array([21, 5, 1, 2, 4]), tri_cards: new Uint8Array([0]),
    quads: new Int32Array([20, 5, 0, 1, 2, 3]), quad_cards: new Uint8Array([0]),
    rigid_lines: new Int32Array([30, 0, 1, 30, 0, 2, 31, 3, 0]), rigid_kinds: new Uint8Array([0, 0, 1]),
    masses: new Int32Array([40, 4]), mass_values: new Float32Array([2.5]),
    spcs: new Int32Array([0, 123456]),
  };
  const width = { node_ids: 1, node_xyz: 3, beams: 4, beam_cards: 1, tris: 5, tri_cards: 1, quads: 6, quad_cards: 1,
                  rigid_lines: 3, rigid_kinds: 1, masses: 2, mass_values: 1, spcs: 2 };
  return { header, blocks, width };
}

const DTYPE = (a) => (a instanceof Float32Array ? '<f4' : a instanceof Uint8Array ? '|u1' : '<i4');

/** parseLbm 결과 모양({ header, blocks, width }) → lbm 바이트. v2 블록(beam_orient·beam_offsets)도 그대로 쓴다. */
export function encodeModel({ header, blocks, width }) {
  const out = {};
  for (const [name, data] of Object.entries(blocks)) out[name] = { dtype: DTYPE(data), width: width[name] || 1, data };
  return encodeLbm(header, out);
}

/**
 * 04c 형식 v2 합성 모델 — 떨어진 그룹 셋, 단면 여러 종류, 방향 벡터·오프셋, RBE2·RBE3, 자유단·고립 절점.
 *   절점 0..3  : X 축 1D 3개(0-1 L, 1-2 H, 2-3 T) — 그룹 0(주 구조, 쉘 1장 포함)
 *   절점 4,5,6 : 쉘 사각형 1장(1-4-5-6 → 절점 1 과 이어짐)
 *   절점 7,8   : 따로 떨어진 BOX 1D 1개 — 그룹 1
 *   절점 9,10  : 따로 떨어진 TUBE 1D, RBE2 로 절점 11 과 이어짐 — 그룹 2
 *   절점 11    : RBE2 종속
 *   절점 12    : 고립(아무것도 안 씀)
 */
export function sampleModelV2() {
  const header = {
    version: 2,
    bbox: { min: [0, -500, 0], max: [3000, 500, 1000] },
    cards: { beam: ['CBAR', 'CBEAM', 'CROD', 'CONROD', 'CBUSH'], tri: ['CTRIA3', 'CTRIA6', 'CTRIAR'],
             quad: ['CQUAD4', 'CQUAD8', 'CQUADR'], rigid: ['RBE2', 'RBE3'] },
    counts: { CBEAM: 3, CBAR: 2, CQUAD4: 1, RBE2: 1, GRID: 13 },
    properties: {
      1: { card: 'PBEAML', mid: 1, type: 'L', dims: [100, 150, 10, 12] },
      2: { card: 'PBEAML', mid: 1, type: 'I', dims: [300, 150, 150, 10, 15, 15] },
      3: { card: 'PBARL', mid: 1, type: 'T', dims: [200, 250, 12, 10] },
      4: { card: 'PBARL', mid: 1, type: 'BOX', dims: [200, 100, 10, 8] },
      5: { card: 'PSHELL', mid: 1, t: 10 },
      6: { card: 'PBARL', mid: 1, type: 'TUBE', dims: [50, 40] },
    },
    materials: { 1: { card: 'MAT1', E: 206000, nu: 0.3 } },
    conrods: {},
  };
  const xyz = [
    0, 0, 0, 1000, 0, 0, 2000, 0, 0, 3000, 0, 0,          // 0-3
    1000, 500, 0, 2000, 500, 0, 2000, 0, 0.001,          // 4-6 (6 은 2 와 겹치지 않게 살짝 위)
    0, -500, 1000, 1000, -500, 1000,                       // 7-8
    2000, -500, 1000, 3000, -500, 1000,                    // 9-10
    3000, -500, 500,                                        // 11
    1500, 500, 1000,                                        // 12 고립
  ];
  const blocks = {
    node_ids: new Int32Array([101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113]),
    node_xyz: new Float32Array(xyz),
    beams: new Int32Array([1, 1, 0, 1, 2, 2, 1, 2, 3, 3, 2, 3, 4, 4, 7, 8, 5, 6, 9, 10]),
    beam_cards: new Uint8Array([1, 1, 0, 0, 1]),
    beam_orient: new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1]),
    beam_offsets: new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50, 0, 0, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    tris: new Int32Array(0), tri_cards: new Uint8Array(0),
    quads: new Int32Array([20, 5, 1, 4, 5, 6]), quad_cards: new Uint8Array([0]),
    rigid_lines: new Int32Array([30, 10, 11]), rigid_kinds: new Uint8Array([0]),
    masses: new Int32Array(0), mass_values: new Float32Array(0),
    spcs: new Int32Array([0, 123456]),
  };
  const width = { node_ids: 1, node_xyz: 3, beams: 4, beam_cards: 1, beam_orient: 3, beam_offsets: 6, tris: 5, tri_cards: 1,
                  quads: 6, quad_cards: 1, rigid_lines: 3, rigid_kinds: 1, masses: 2, mass_values: 1, spcs: 2 };
  return { header, blocks, width };
}
