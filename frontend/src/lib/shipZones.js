/**
 * 73 — 선박 지도: 구역(배 안의 위치, 40)을 단순 선체 안의 칸으로 놓는 정의와 셈(순수 함수).
 * 자리 = 길이 x(0 선미 끝 → 1 선수 끝) × 높이 z(0 기선 → 1 상갑판, 1 넘으면 갑판 위).
 * 실제 선형이 아니라 구역 경계만 맞춘 그림이다 — 자료가 어느 '칸'인지만 뜻하고 프레임 위치는 아니다.
 * 3D(components/shipmap/shipScene.js)와 2D 옆모습(ShipSide2D.jsx)이 같은 정의를 쓴다.
 */

// 길이 방향 경계(선미부 | 기관실 | 화물창 | 선수부)와 이중저 높이
export const BOUNDS = { stern: 0.1, engine: 0.24, bow: 0.88, doubleBottom: 0.12 };
export const HOLDS = 5;   // 화물창을 나눠 그리는 수(그림만 — 모두 '화물창' 한 구역)
// 갑판 위 구조물 — 거주구(구역)와 연돌(구역 아님, 그림만)
export const HOUSE = { x: [0.108, 0.192], z: [1, 1.74], halfWidth: 0.74 };
export const FUNNEL = { x: [0.062, 0.096], z: [1, 1.82], halfWidth: 0.2 };

/** 그림에 자리가 있는 구역(선미 → 선수 순). inside = 선체 안쪽 칸(겉판을 투명하게 해야 보인다). */
export const SHIP_ZONES = [
  { name: '선미부', inside: true },
  { name: '기관실', inside: true },
  { name: '거주구', inside: false },
  { name: '상갑판', inside: false },
  { name: '화물창', inside: true },
  { name: '이중저', inside: true },
  { name: '선수부', inside: true },
];
export const ZONE_NAMES = SHIP_ZONES.map((z) => z.name);
export const UNPLACED = '__unplaced';   // 그림에 자리가 없는 자료(기타, 구역 없음, 목록에 새로 생긴 값)
export const UNPLACED_LABEL = '위치 없는 자료';
export const isShipZone = (name) => ZONE_NAMES.includes(name);

const GAP = 0.006;   // 칸 사이 격벽 틈
const holdEdges = Array.from({ length: HOLDS + 1 }, (_, i) => BOUNDS.engine + ((BOUNDS.bow - BOUNDS.engine) * i) / HOLDS);
/** 선체 안의 칸(x, z 범위). z 의 위 끝 1 은 '갑판 바로 아래까지'. */
export const COMPARTMENTS = [
  { zone: '선미부', x: [0.004, BOUNDS.stern - GAP], z: [0, 1] },
  { zone: '기관실', x: [BOUNDS.stern + GAP, BOUNDS.engine - GAP], z: [0, 1] },
  ...holdEdges.slice(0, -1).map((a, i) => ({ zone: '화물창', x: [a + GAP, holdEdges[i + 1] - GAP], z: [BOUNDS.doubleBottom + 0.02, 1] })),
  { zone: '이중저', x: [BOUNDS.engine + GAP, BOUNDS.bow - GAP], z: [0, BOUNDS.doubleBottom] },
  { zone: '선수부', x: [BOUNDS.bow + GAP, 0.985], z: [0, 1] },
];

const hullsOfEntry = (e) => (e.rows || []).filter((k) => k.startsWith('h:')).map((k) => k.slice(2));
const kindsOfEntry = (e, hullKinds) => hullsOfEntry(e).map((h) => hullKinds?.[h]).filter(Boolean);

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
  const covered = Object.values(counts).filter((n) => n > 0).length;
  return { counts, unplaced, max, covered, total: (entries || []).length };
}

/** 한 칸의 자료(UNPLACED 면 그림에 자리가 없는 자료). 최근 확정 먼저. */
export function entriesIn(entries, zone) {
  const hit = (e) => (zone === UNPLACED ? !(e.zones || []).some(isShipZone) : (e.zones || []).includes(zone));
  return (entries || []).filter(hit)
    .sort((a, b) => String(b.confirmed_at || '').localeCompare(String(a.confirmed_at || '')) || String(b.id).localeCompare(String(a.id)));
}

const ranked = (n) => Object.entries(n).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, count]) => ({ value, count }));

/** 거르기 목록 — 자료가 많은 값부터. */
export function kindOptions(entries, hullKinds = {}) {
  const n = {};
  for (const e of entries || []) for (const k of new Set(kindsOfEntry(e, hullKinds))) n[k] = (n[k] || 0) + 1;
  return ranked(n);
}
export function targetOptions(entries) {
  const n = {};
  for (const e of entries || []) if (e.target) n[e.target] = (n[e.target] || 0) + 1;
  return ranked(n);
}

/** 얼마나 넓게 검토했나 — 호선 수, 대상 종류 수, 선종 수. */
export function breadthOf(entries, hullKinds = {}) {
  const hulls = new Set(); const targets = new Set(); const kinds = new Set();
  for (const e of entries || []) {
    hullsOfEntry(e).forEach((h) => hulls.add(h));
    if (e.target) targets.add(e.target);
    kindsOfEntry(e, hullKinds).forEach((k) => kinds.add(k));
  }
  return { hulls: hulls.size, targets: targets.size, kinds: kinds.size };
}

// 색 — 어두운 뷰어 바탕 위 한 가지 색(파랑)의 어두움 → 밝음. 많을수록 밝게 빛난다. 0건은 색 없이 테두리만
export const HEAT = { empty: '#1B2A40', stops: ['#2F5288', '#5E93D6', '#DCEEFF'] };
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));

/** 건수 → 0~1(제곱근 눈금 — 한두 칸에 몰려도 나머지 차이가 보이게). */
export const heatLevel = (n, max) => (!n || !max ? 0 : max <= 1 ? 1 : Math.sqrt((n - 1) / (max - 1)));

/** 건수 → 칠할 색. */
export function heatColor(n, max) {
  if (!n || !max) return HEAT.empty;
  const t = heatLevel(n, max);
  const [a, b, c] = HEAT.stops;
  return t < 0.5 ? mix(a, b, t * 2) : mix(b, c, (t - 0.5) * 2);
}

/** 2D 옆모습 윤곽(x, z) — 선미 돌출, 선미 바닥 올림, 구상 선수, 선수 경사와 올라간 선수 갑판. */
export const SIDE_OUTLINE = [
  [-0.014, 1], [-0.014, 0.78], [0.0, 0.6], [0.03, 0.42], [0.06, 0.24], [0.09, 0.08], [0.12, 0],
  [0.955, 0], [0.985, 0.04], [1.0, 0.14], [0.992, 0.27], [0.978, 0.36], [0.99, 0.6], [1.03, 1.1],
  [0.97, 1.08], [0.9, 1],
];
