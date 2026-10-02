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
