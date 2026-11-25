/**
 * 73 — 선박 지도: 구역(배 안의 위치, 40)을 단순 선체 위 자리로 놓는 정의와 셈(순수 함수).
 * 자리 = 길이 x(0 선미 끝 → 1 선수 끝) × 높이 z(0 기선 → 1 상갑판, 1 넘으면 갑판 위).
 * 실제 선형이 아니라 구역 경계만 맞춘 그림이다 — 자료가 어느 '칸'인지만 뜻하고 프레임 위치는 아니다.
 * 3D(components/shipmap/shipScene.js)와 2D 측면도(ShipSide2D.jsx)가 같은 정의를 쓴다.
 */

// 길이 방향 경계(선미부 | 기관실 | 화물창 | 선수부)와 이중저 높이
export const BOUNDS = { stern: 0.1, engine: 0.24, bow: 0.88, doubleBottom: 0.12 };
// 갑판 위 구조물 — 거주구(구역)와 연돌(구역 아님, 그림만)
export const HOUSE = { x: [0.105, 0.195], z: [1, 1.62], halfWidth: 0.78 };
export const FUNNEL = { x: [0.06, 0.098], z: [1.15, 1.85], halfWidth: 0.22 };

/** 그림에 자리가 있는 구역. anchor = 이름표를 붙일 자리(x, z, 폭 방향 y: 0 가운데 → 1 우현 끝). */
export const SHIP_ZONES = [
  { name: '선미부', part: 'hull', anchor: [0.03, 0.75, 0.9] },
  { name: '기관실', part: 'hull', anchor: [0.17, 0.35, 1] },
  { name: '거주구', part: 'house', anchor: [0.15, 1.62, 0.4] },
  { name: '상갑판', part: 'deck', anchor: [0.7, 1, 0.55] },
  { name: '화물창', part: 'hull', anchor: [0.45, 0.6, 1] },
  { name: '이중저', part: 'hull', anchor: [0.6, 0.04, 1] },
  { name: '선수부', part: 'hull', anchor: [0.95, 0.7, 0.5] },
];
export const ZONE_NAMES = SHIP_ZONES.map((z) => z.name);
export const UNPLACED = '__unplaced';   // 그림에 자리가 없는 자료(기타, 구역 없음, 목록에 새로 생긴 값)
export const UNPLACED_LABEL = '위치 없는 자료';
export const isShipZone = (name) => ZONE_NAMES.includes(name);

/** 선체 겉판 한 점(x, z)이 속한 구역. 갑판과 거주구는 따로 그린다. */
export function hullZoneAt(x, z) {
  if (x < BOUNDS.stern) return '선미부';
  if (x < BOUNDS.engine) return '기관실';
  if (x < BOUNDS.bow) return z < BOUNDS.doubleBottom ? '이중저' : '화물창';
  return '선수부';
}

const kindsOfEntry = (e, hullKinds) => (e.rows || []).filter((k) => k.startsWith('h:'))
  .map((k) => hullKinds?.[k.slice(2)]).filter(Boolean);

/** 선종, 대상으로 거른 자료. 빈 값('')은 거르지 않음. */
export function filterEntries(entries, { kind = '', target = '' } = {}, hullKinds = {}) {
  return (entries || []).filter((e) => (!kind || kindsOfEntry(e, hullKinds).includes(kind))
    && (!target || e.target === target));
}

/** 그림 칸의 자료 수. 구역이 여럿인 자료는 그 칸마다 센다(합은 자료 수보다 클 수 있다). */
export function zoneCounts(entries) {
  const counts = Object.fromEntries(ZONE_NAMES.map((n) => [n, 0]));
  let unplaced = 0;
  for (const e of entries || []) {
    const placed = (e.zones || []).filter(isShipZone);
    for (const z of new Set(placed)) counts[z] += 1;
    if (!placed.length) unplaced += 1;
  }
  const max = Math.max(0, ...Object.values(counts));
  return { counts, unplaced, max, total: (entries || []).length };
}

/** 한 칸의 자료(UNPLACED 면 그림에 자리가 없는 자료). 최근 확정 먼저. */
export function entriesIn(entries, zone) {
  const hit = (e) => (zone === UNPLACED ? !(e.zones || []).some(isShipZone) : (e.zones || []).includes(zone));
  return (entries || []).filter(hit)
    .sort((a, b) => String(b.confirmed_at || '').localeCompare(String(a.confirmed_at || '')) || String(b.id).localeCompare(String(a.id)));
}

/** 거르기 목록 — 자료가 많은 값부터. */
export function kindOptions(entries, hullKinds = {}) {
  const n = {};
  for (const e of entries || []) for (const k of new Set(kindsOfEntry(e, hullKinds))) n[k] = (n[k] || 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, count]) => ({ value, count }));
}
export function targetOptions(entries) {
  const n = {};
  for (const e of entries || []) if (e.target) n[e.target] = (n[e.target] || 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, count]) => ({ value, count }));
}

// 색 — 한 가지 색(브랜드 남색)의 밝음 → 어두움. 0건은 무채색(자료 없음과 적음을 가른다)
export const HEAT = { empty: '#E6EBF2', low: '#C9D7EC', high: '#002554' };
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** 건수 → 칠할 색. 제곱근 눈금(한두 칸에 몰려도 나머지 차이가 보이게). */
export function heatColor(n, max) {
  if (!n || !max) return HEAT.empty;
  const t = max <= 1 ? 1 : Math.sqrt((n - 1) / (max - 1));
  const [a, b] = [hex(HEAT.low), hex(HEAT.high)];
  return toHex(a.map((v, i) => v + (b[i] - v) * t));
}
/** 칠한 색 위 글자가 읽히도록 — 어두운 칸은 흰 글자. */
export const heatInk = (n, max) => (n && max && (max <= 1 || Math.sqrt((n - 1) / (max - 1)) > 0.45) ? '#FFFFFF' : '#13171C');

/** 2D 측면도 윤곽(x, z) — 선미 돌출, 선미 바닥 올림, 구상 선수, 선수 경사. */
export const SIDE_OUTLINE = [
  [-0.012, 1], [-0.012, 0.78], [0.0, 0.6], [0.03, 0.42], [0.06, 0.24], [0.09, 0.08], [0.12, 0],
  [0.955, 0], [0.985, 0.04], [0.996, 0.14], [0.988, 0.26], [0.975, 0.34], [0.99, 0.6], [1.02, 1],
];
