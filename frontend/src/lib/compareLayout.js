/**
 * 비교 화면 배치(07 §2) — 순수 함수.
 *   1개 = 한 칸, 2개 = 좌우, 3·4개 = 2×2(3개면 남는 한 칸은 '모델 담기 안내').
 *   창 폭이 STACK_BELOW 미만이면 위아래로 쌓는다(안내 칸 없음). 크게 보기면 그 칸 하나.
 */
export const STACK_BELOW = 1024;

/**
 * @param {number} count 모델 수(0~4)
 * @param {{ width?: number, maximized?: number|null }} opt
 * @returns {{ cols, rows, stacked, cells: Array<{ kind: 'pane', index } | { kind: 'empty' }> }}
 */
export function compareLayout(count, { width = Infinity, maximized = null } = {}) {
  const n = Math.max(0, Math.min(4, count | 0));
  if (maximized != null && maximized >= 0 && maximized < n) {
    return { cols: 1, rows: 1, stacked: false, cells: [{ kind: 'pane', index: maximized }] };
  }
  if (n === 0) return { cols: 1, rows: 1, stacked: false, cells: [{ kind: 'empty' }] };
  const panes = Array.from({ length: n }, (_, index) => ({ kind: 'pane', index }));
  if (width < STACK_BELOW) return { cols: 1, rows: n, stacked: true, cells: panes };
  if (n === 1) return { cols: 1, rows: 1, stacked: false, cells: panes };
  if (n === 2) return { cols: 2, rows: 1, stacked: false, cells: panes };
  return { cols: 2, rows: 2, stacked: false, cells: n === 3 ? [...panes, { kind: 'empty' }] : panes };
}
