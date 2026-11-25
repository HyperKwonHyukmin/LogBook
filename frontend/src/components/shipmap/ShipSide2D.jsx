import { BOUNDS, COMPARTMENTS, FUNNEL, HOUSE, SIDE_OUTLINE, isShipZone } from '../../lib/shipZones.js';

// 73 — 2D 옆모습(선수가 오른쪽). 3D 와 같은 칸 정의를 쓴다. 높이는 읽기 쉽게 실제 비율보다 키웠다(구역 칸만 뜻함).
const X = (x) => x * 960;
const Z = (z) => 150 - z * 100;
const outline = `M ${SIDE_OUTLINE.map(([x, z]) => `${X(x).toFixed(1)} ${Z(z).toFixed(1)}`).join(' L ')} Z`;
const box = (x0, x1, z0, z1) => ({ x: X(x0), y: Z(z1), width: X(x1) - X(x0), height: Z(z0) - Z(z1) });
// 칸 — 겉판에서 조금 들여 그리고(위 끝 1 은 갑판 아래까지), 선체 윤곽으로 잘라 선수와 선미 곡선을 따른다
const CELLS = COMPARTMENTS.map((c, i) => ({ key: `${c.zone}-${i}`, zone: c.zone, ...box(c.x[0], c.x[1], Math.max(c.z[0], 0) + 0.035, c.z[1] >= 1 ? 0.93 : c.z[1] - 0.02) }));
const TIERS = [
  box(HOUSE.x[0], HOUSE.x[1], 1.02, 1.42),
  box(HOUSE.x[0] + 0.01, HOUSE.x[1] - 0.004, 1.42, 1.6),
  box(HOUSE.x[1] - 0.042, HOUSE.x[1] + 0.004, 1.6, 1.71),
];

/**
 * 자료의 구역을 배 옆모습 위에 칠한다. zones 중 그림에 자리가 있는 것만 진하게(나머지 칸은 옅게).
 * 크기는 감싼 요소의 폭을 따른다. 색은 감싼 쪽의 hover 와 무관하게 토큰 고정.
 */
export default function ShipSide2D({ zones = [], className = '', idPrefix = 'ship' }) {
  const on = new Set(zones.filter(isShipZone));
  const clip = `${String(idPrefix).replace(/[^\w-]/g, '_')}-hull-clip`;
  const label = on.size ? `배 옆모습에서 ${[...on].join(', ')} 위치` : '배 옆모습';
  const deckOn = on.has('상갑판'); const houseOn = on.has('거주구');
  return (
    <svg viewBox="-30 -42 1040 208" role="img" aria-label={label} className={`block h-auto w-full ${className}`}>
      <defs><clipPath id={clip}><path d={outline} /></clipPath></defs>
      <path d={outline} fill="var(--color-n-0)" />
      <g clipPath={`url(#${clip})`}>
        {CELLS.map((c) => (
          <rect key={c.key} x={c.x} y={c.y} width={c.width} height={c.height} rx="5"
                fill={on.has(c.zone) ? 'var(--color-brand)' : 'var(--color-n-150)'} />
        ))}
      </g>
      <path d={outline} fill="none" stroke="var(--color-n-400)" strokeWidth="2.5" strokeLinejoin="round" />
      {/* 타 */}
      <rect {...box(0.008, 0.03, 0.05, 0.42)} rx="2" fill="var(--color-n-300)" />
      {/* 상갑판 — 갑판 선을 굵게 */}
      <line x1={X(-0.014)} x2={X(BOUNDS.bow + 0.02)} y1={Z(1)} y2={Z(1)} stroke={deckOn ? 'var(--color-brand)' : 'var(--color-n-300)'}
            strokeWidth={deckOn ? 10 : 4} strokeLinecap="round" />
      {/* 연돌(구역 아님) */}
      <rect {...box(FUNNEL.x[0], FUNNEL.x[1], 1.03, FUNNEL.z[1])} rx="2" fill="var(--color-n-200)" stroke="var(--color-n-400)" strokeWidth="1.5" />
      {/* 거주구 */}
      {TIERS.map((t) => (
        <rect key={`${t.x}-${t.y}`} {...t} rx="2" fill={houseOn ? 'var(--color-brand)' : 'var(--color-n-200)'}
              stroke={houseOn ? 'var(--color-brand)' : 'var(--color-n-400)'} strokeWidth="1.5" />
      ))}
    </svg>
  );
}
