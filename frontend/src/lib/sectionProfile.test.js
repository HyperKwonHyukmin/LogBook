import { polygonArea, profileBounds, sectionKey, sectionOf, sectionProfile } from './sectionProfile.js';

const area = (p) => Math.abs(polygonArea(p.outer)) - (p.hole ? Math.abs(polygonArea(p.hole)) : 0);

test('L — 가로 다리 +z(DIM1), 세로 다리 +y(DIM2), 원점 = 두 다리 중심선 교점', () => {
  const p = sectionProfile('L', [100, 150, 10, 12]);
  const b = profileBounds(p);
  expect(b.zmin).toBeCloseTo(-6);          // −DIM4/2
  expect(b.zmax).toBeCloseTo(100 - 6);     // DIM1 − DIM4/2
  expect(b.ymin).toBeCloseTo(-5);          // −DIM3/2
  expect(b.ymax).toBeCloseTo(150 - 5);     // DIM2 − DIM3/2
  expect(area(p)).toBeCloseTo(100 * 10 + (150 - 10) * 12);
});

test('I — DIM1 높이(y), 위·아래 플랜지 폭과 두께', () => {
  const p = sectionProfile('I', [300, 150, 120, 10, 15, 20]);
  const b = profileBounds(p);
  expect([b.ymin, b.ymax]).toEqual([-150, 150]);
  expect(b.zmax).toBeCloseTo(75);
  expect(area(p)).toBeCloseTo(150 * 15 + 120 * 20 + (300 - 35) * 10);
  // 위 플랜지(y=150)는 폭 120
  const top = p.outer.filter(([y]) => y === 150).map(([, z]) => z);
  expect(Math.max(...top) - Math.min(...top)).toBeCloseTo(120);
});

test('H — 날개는 y 방향 세로판, 웹은 z 방향', () => {
  const p = sectionProfile('H', [200, 20, 300, 12]);
  const b = profileBounds(p);
  expect([b.zmin, b.zmax]).toEqual([-110, 110]);
  expect([b.ymin, b.ymax]).toEqual([-150, 150]);
  expect(area(p)).toBeCloseTo(20 * 300 + 200 * 12);
});

test('T — 플랜지는 위(+y), 원점은 플랜지 두께 가운데', () => {
  const p = sectionProfile('T', [200, 250, 12, 10]);
  const b = profileBounds(p);
  expect(b.ymax).toBeCloseTo(6);
  expect(b.ymin).toBeCloseTo(-250 + 6);
  expect([b.zmin, b.zmax]).toEqual([-100, 100]);
  expect(area(p)).toBeCloseTo(200 * 12 + (250 - 12) * 10);
});

test('BOX·CHAN·BAR·ROD·TUBE', () => {
  const box = sectionProfile('BOX', [200, 100, 10, 8]);
  expect(box.hole).not.toBeNull();
  expect(profileBounds(box)).toEqual({ ymin: -50, ymax: 50, zmin: -100, zmax: 100 });
  expect(area(box)).toBeCloseTo(200 * 100 - (200 - 16) * (100 - 20));
  const ch = sectionProfile('CHAN', [80, 200, 8, 10]);
  expect(profileBounds(ch)).toEqual({ ymin: -100, ymax: 100, zmin: 0, zmax: 80 });
  expect(area(ch)).toBeCloseTo(2 * 80 * 10 + (200 - 20) * 8);
  const bar = sectionProfile('BAR', [40, 60]);
  expect(profileBounds(bar)).toEqual({ ymin: -30, ymax: 30, zmin: -20, zmax: 20 });
  const rod = sectionProfile('ROD', [10]);
  expect(rod.round).toBe(true);
  expect(Math.max(...rod.outer.map(([y]) => y))).toBeCloseTo(10);
  const tube = sectionProfile('TUBE', [50, 40]);
  expect(tube.hole).not.toBeNull();
  expect(Math.max(...tube.hole.map(([y]) => y))).toBeCloseTo(40);
});

test('크기 0·모르는 형상', () => {
  expect(sectionProfile('L', [0, 0, 1, 1])).toBeNull();
  expect(sectionProfile('ROD', [])).toBeNull();
  // 모르는 형상은 앞 두 DIM 상자
  expect(profileBounds(sectionProfile('Z', [30, 80, 5, 5]))).toEqual({ ymin: -40, ymax: 40, zmin: -15, zmax: 15 });
});

test('속성 → 단면(근사 포함)', () => {
  expect(sectionOf({ card: 'PBEAML', type: 'L', dims: [100, 100, 10, 10] }, 'CBEAM')).toMatchObject({ type: 'L', approx: false });
  expect(sectionOf({ card: 'PBAR', A: 400 }, 'CBAR')).toEqual({ type: 'BAR', dims: [20, 20], approx: true, shape: 'BAR' });
  expect(sectionOf({ card: 'PROD', A: Math.PI * 25 }, 'CROD').dims[0]).toBeCloseTo(5);
  expect(sectionOf({ card: 'PTUBE', type: 'TUBE', dims: [30, 25] }, 'CROD').type).toBe('TUBE');
  expect(sectionOf({ card: 'PBARL', type: 'HAT', dims: [10, 20, 3, 4] }, 'CBAR')).toMatchObject({ type: 'OTHER', approx: true, shape: 'HAT' });
  expect(sectionOf(null, 'CONROD', { A: Math.PI })).toMatchObject({ type: 'ROD', dims: [1] });
  expect(sectionOf({ card: 'PBUSH' }, 'CBUSH')).toBeNull();
  expect(sectionOf({ card: 'PSHELL', t: 10 }, 'CBAR')).toBeNull();
  expect(sectionKey(sectionOf({ card: 'PBAR', A: 400 }, 'CBAR'))).toBe('BAR:20x20');
});
