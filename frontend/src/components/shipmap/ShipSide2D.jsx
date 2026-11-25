import { BOUNDS, FUNNEL, HOUSE, SIDE_OUTLINE, isShipZone } from '../../lib/shipZones.js';

// 73 — 2D 측면도(선수가 오른쪽). 높이는 읽기 쉽게 실제 비율보다 키웠다(구역 칸만 뜻함).
const X = (x) => 12 + x * 960;
const Z = (z) => 150 - z * 100;
const outline = `M ${SIDE_OUTLINE.map(([x, z]) => `${X(x).toFixed(1)} ${Z(z).toFixed(1)}`).join(' L ')} Z`;
const box = (x0, x1, z0, z1) => ({ x: X(x0), y: Z(z1), width: X(x1) - X(x0), height: Z(z0) - Z(z1) });
const HULL_PARTS = [
  ['선미부', box(-0.05, BOUNDS.stern, -0.1, 1.05)],
  ['기관실', box(BOUNDS.stern, BOUNDS.engine, -0.1, 1.05)],
  ['화물창', box(BOUNDS.engine, BOUNDS.bow, BOUNDS.doubleBottom, 1.05)],
  ['이중저', box(BOUNDS.engine, BOUNDS.bow, -0.1, BOUNDS.doubleBottom)],
  ['선수부', box(BOUNDS.bow, 1.05, -0.1, 1.05)],
];

/**
 * 자료의 구역을 배 옆모습 위에 칠한다. zones 중 그림에 자리가 있는 것만 진하게.
 * 자료 화면(작게)에서 쓴다 — 크기는 감싼 요소의 폭을 따른다.
 */
export default function ShipSide2D({ zones = [], className = '', idPrefix = 'ship' }) {
  const on = new Set(zones.filter(isShipZone));
  const fill = (name) => (on.has(name) ? 'var(--color-brand)' : 'var(--color-n-150)');
  const clip = `${idPrefix}-hull-clip`;
  const label = on.size ? `배 옆모습에서 ${[...on].join(', ')} 위치` : '배 옆모습';
  return (
    <svg viewBox="0 -38 1000 196" role="img" aria-label={label} className={`block h-auto w-full ${className}`}>
      <defs><clipPath id={clip}><path d={outline} /></clipPath></defs>
      <g clipPath={`url(#${clip})`}>
        {HULL_PARTS.map(([name, r]) => <rect key={name} {...r} fill={fill(name)} />)}
        {/* 구역 경계 */}
        {[BOUNDS.stern, BOUNDS.engine, BOUNDS.bow].map((x) => (
          <line key={x} x1={X(x)} x2={X(x)} y1={Z(1)} y2={Z(-0.1)} stroke="var(--color-n-0)" strokeWidth="3" />
        ))}
        <line x1={X(BOUNDS.engine)} x2={X(BOUNDS.bow)} y1={Z(BOUNDS.doubleBottom)} y2={Z(BOUNDS.doubleBottom)} stroke="var(--color-n-0)" strokeWidth="3" />
      </g>
      <path d={outline} fill="none" stroke="var(--color-n-400)" strokeWidth="2" strokeLinejoin="round" />
      {/* 상갑판 — 갑판 선을 굵게 */}
      <line x1={X(-0.012)} x2={X(1.02)} y1={Z(1)} y2={Z(1)} stroke={on.has('상갑판') ? 'var(--color-brand)' : 'var(--color-n-300)'}
            strokeWidth={on.has('상갑판') ? 9 : 4} strokeLinecap="round" />
      {/* 연돌(구역 아님) */}
      <rect {...box(FUNNEL.x[0], FUNNEL.x[1], 1.02, FUNNEL.z[1])} fill="var(--color-n-200)" stroke="var(--color-n-400)" strokeWidth="1.5" />
      {/* 거주구 */}
      <rect {...box(HOUSE.x[0], HOUSE.x[1], 1.02, HOUSE.z[1])} rx="2" fill={fill('거주구')} stroke="var(--color-n-400)" strokeWidth="1.5" />
    </svg>
  );
}
