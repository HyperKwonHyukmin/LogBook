/** 클릭한 요소의 정보(설계 §7.4 ③) — EID, 카드, PID·단면·치수, 재료, 절점, 길이. */
import { ELEM_BEAM, ELEM_TRI } from './modelGeometry.js';

const fmt = (v) => `${Number(Number(v).toPrecision(6))}`;

/** 단면 라벨 — 백엔드 지문과 같은 형식(PBEAML L 100x100x10x10, PSHELL t12, PROD A50). */
export function sectionLabel(p) {
  if (!p) return '';
  if ((p.card === 'PBARL' || p.card === 'PBEAML') && p.dims?.length) return `${p.card} ${p.type} ${p.dims.map(fmt).join('x')}`;
  if ((p.card === 'PSHELL' || p.card === 'PCOMP') && p.t) return `${p.card} t${fmt(p.t)}`;
  if ((p.card === 'PBAR' || p.card === 'PBEAM' || p.card === 'PROD') && p.A) return `${p.card} A${fmt(p.A)}`;
  return p.card || '';
}

function materialLabel(m) {
  if (!m) return '';
  if (m.card === 'MAT1') return ['MAT1', m.E != null && `E${fmt(m.E)}`, m.nu != null && `ν${fmt(m.nu)}`].filter(Boolean).join(' ');
  return m.card || '';
}

export function elementInfo({ header, blocks }, geometry, index) {
  const kind = geometry.elemKind[index];
  const row = geometry.elemRow[index];
  const ids = blocks.node_ids;
  const xyz = blocks.node_xyz;
  let eid; let pid; let card; let nodeIdx;
  if (kind === ELEM_BEAM) {
    const o = row * 4;
    [eid, pid] = [blocks.beams[o], blocks.beams[o + 1]];
    nodeIdx = [blocks.beams[o + 2], blocks.beams[o + 3]];
    card = header.cards?.beam?.[blocks.beam_cards[row]];
  } else if (kind === ELEM_TRI) {
    const o = row * 5;
    [eid, pid] = [blocks.tris[o], blocks.tris[o + 1]];
    nodeIdx = [blocks.tris[o + 2], blocks.tris[o + 3], blocks.tris[o + 4]];
    card = header.cards?.tri?.[blocks.tri_cards[row]];
  } else {
    const o = row * 6;
    [eid, pid] = [blocks.quads[o], blocks.quads[o + 1]];
    nodeIdx = [2, 3, 4, 5].map((k) => blocks.quads[o + k]);
    card = header.cards?.quad?.[blocks.quad_cards[row]];
  }
  let prop = header.properties?.[pid];
  if (card === 'CONROD') {
    // CONROD 는 PID 자리가 없고 단면적·재료를 카드에 직접 갖는다.
    const c = header.conrods?.[eid] || {};
    prop = { card: 'CONROD', A: c.A, mid: c.mid };
  }
  let length = null;
  if (kind === ELEM_BEAM) {
    const [a, b] = nodeIdx;
    length = Math.round(Math.hypot(xyz[b * 3] - xyz[a * 3], xyz[b * 3 + 1] - xyz[a * 3 + 1], xyz[b * 3 + 2] - xyz[a * 3 + 2]) * 10) / 10;
  }
  return {
    eid, card, pid,
    section: card === 'CONROD' && prop?.A ? `CONROD A${fmt(prop.A)}` : sectionLabel(prop),
    thickness: prop?.t ?? null,
    material: materialLabel(header.materials?.[prop?.mid]),
    nodes: nodeIdx.map((i) => ids[i]),
    length,
  };
}
