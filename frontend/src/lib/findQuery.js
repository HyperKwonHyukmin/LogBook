/**
 * Ctrl+F 찾기(04c §2) — Model Builder Studio `data/findEntity.js` 의 검색어 규칙을 따른다.
 *
 * ⚠ Nastran 은 GRID 와 요소 번호 공간이 따로라 같은 숫자가 절점이면서 요소일 수 있다.
 *   숫자만으로 종류를 추측하지 않고 종류(kind)를 반드시 받는다. 입력 앞 n / e / r 머리글자가 종류를 바꾼다.
 *
 *   "1234"             → 지금 종류로 1234
 *   "n1234" · "N 1234" → 절점
 *   "101, 105 200-210" → 쉼표·공백 구분 + 범위(최대 FIND_MAX_IDS 개)
 */
export const FIND_KINDS = ['node', 'element', 'rigid'];
export const FIND_KIND_LABEL = { node: '절점', element: '요소', rigid: 'RBE' };
export const FIND_MAX_IDS = 500;

const PREFIX_KIND = { n: 'node', e: 'element', r: 'rigid' };

export function parseFindQuery(text, kind = 'node') {
  let rest = String(text ?? '').trim();
  let outKind = FIND_KINDS.includes(kind) ? kind : 'node';
  const m = /^([nerNER])\s*(?=\d)/.exec(rest);
  if (m) {
    outKind = PREFIX_KIND[m[1].toLowerCase()];
    rest = rest.slice(m[0].length);
  }
  const ids = [];
  const seen = new Set();
  const invalid = [];
  let truncated = false;
  const push = (n) => {
    if (seen.has(n)) return;
    if (ids.length >= FIND_MAX_IDS) { truncated = true; return; }
    seen.add(n);
    ids.push(n);
  };
  // 범위의 '-' 양옆 공백("200 - 210")은 먼저 붙인다.
  rest = rest.replace(/(\d)\s*[-~]\s*(?=\d)/g, '$1-');
  for (const raw of rest.split(/[\s,;]+/)) {
    if (!raw) continue;
    const tok = raw.replace(/^[nerNER](?=\d)/, '');
    const range = /^(\d+)-(\d+)$/.exec(tok);
    if (range) {
      let a = Number(range[1]); let b = Number(range[2]);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b && !truncated; i += 1) push(i);
      continue;
    }
    if (/^\d+$/.test(tok)) { push(Number(tok)); continue; }
    invalid.push(raw);
  }
  return { kind: outKind, ids, invalid, truncated };
}

/**
 * 검색어를 색인으로 풀어 찾은 대상 목록을 만든다.
 * @param {object} index createIdIndex 결과
 * @returns {{ kind, found: Array<{ kind, id, index }>, missing: number[], invalid: string[], truncated: boolean, empty: boolean }}
 */
export function runFind(index, text, kind) {
  const q = parseFindQuery(text, kind);
  const found = [];
  const missing = [];
  for (const id of q.ids) {
    const i = q.kind === 'node' ? index.node(id) : q.kind === 'element' ? index.element(id) : index.rigid(id);
    if (i == null) missing.push(id); else found.push({ kind: q.kind, id, index: i });
  }
  return { kind: q.kind, found, missing, invalid: q.invalid, truncated: q.truncated, empty: q.ids.length === 0 };
}
