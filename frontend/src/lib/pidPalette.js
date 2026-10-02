/** PID 색 — 어두운 뷰어 바탕(#0E1A2B) 위에서 서로 구별되는 12색. 3D 데이터 색이라 UI 토큰과 따로 둔다. */
export const PID_COLORS = ['#7aa7e6', '#5fd38d', '#f2a65a', '#b79cf2', '#4fc3d9', '#f07e94',
                           '#c2ccd8', '#7fd6b8', '#6fb6f2', '#a8d672', '#f29bd0', '#d8b49c'];

export function pidColor(pid) {
  return PID_COLORS[((pid % PID_COLORS.length) + PID_COLORS.length) % PID_COLORS.length];
}

/** 표시물 색(3D 데이터 색) — 엔진과 도구줄 칩이 같은 값을 쓴다. */
export const MARKER_COLORS = { rbe2: '#f2a65a', rbe3: '#b79cf2', conm2: '#f5d36b', spc: '#5fd38d' };
