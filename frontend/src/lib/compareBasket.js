/**
 * 비교 바구니(07) — 순수 함수. 바구니 = [{ id, name, hull }] (최대 4개, 담은 순서).
 * 저장은 이 브라우저의 localStorage 만 쓴다(편의 상태 — 다른 사람과 공유하지 않는다). 읽고 쓰기가 막히면 메모리만.
 * 비교 화면의 원본은 주소(`/compare?ids=12,34`)다 — 주소로 열면 바구니를 그 목록으로 맞춘다.
 */

export const BASKET_MAX = 4;
export const BASKET_KEY = 'lb.compare.basket.v1';
export const BASKET_FULL_TEXT = `최대 ${BASKET_MAX}개까지 비교할 수 있습니다`;

const toId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** 들어온 값 → { id, name, hull } (모양이 틀리면 null). 이름·호선은 모르면 빈 글자. */
export function normalizeItem(x) {
  const id = toId(x?.id);
  if (id == null) return null;
  return { id, name: typeof x.name === 'string' ? x.name : '', hull: typeof x.hull === 'string' ? x.hull : '' };
}

/** 같은 id 를 한 번만 남기고 최대 개수로 자른다. */
export function cleanItems(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const it = normalizeItem(raw);
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
    if (out.length >= BASKET_MAX) break;
  }
  return out;
}

/**
 * 담기. @returns {{ items, result: 'added'|'exists'|'full'|'invalid' }}
 * 이미 있으면 이름·호선만 채운다(빈 값을 아는 값으로).
 */
export function addItem(items, raw) {
  const it = normalizeItem(raw);
  if (!it) return { items, result: 'invalid' };
  const i = items.findIndex((x) => x.id === it.id);
  if (i >= 0) {
    const cur = items[i];
    const merged = { ...cur, name: cur.name || it.name, hull: cur.hull || it.hull };
    if (merged.name === cur.name && merged.hull === cur.hull) return { items, result: 'exists' };
    const next = items.slice();
    next[i] = merged;
    return { items: next, result: 'exists' };
  }
  if (items.length >= BASKET_MAX) return { items, result: 'full' };
  return { items: [...items, it], result: 'added' };
}

export function removeItem(items, id) {
  const n = toId(id);
  return items.some((x) => x.id === n) ? items.filter((x) => x.id !== n) : items;
}

/** 알게 된 이름·호선을 채운다(비교 화면이 파일 메타를 받은 뒤). 바뀐 것이 없으면 같은 배열. */
export function patchItem(items, id, patch) {
  const n = toId(id);
  let changed = false;
  const next = items.map((x) => {
    if (x.id !== n) return x;
    const name = patch.name || x.name;
    const hull = patch.hull || x.hull;
    if (name === x.name && hull === x.hull) return x;
    changed = true;
    return { ...x, name, hull };
  });
  return changed ? next : items;
}

/** 주소의 ids → 바구니(아는 이름·호선은 남긴다). */
export function itemsFromIds(ids, known = []) {
  const byId = new Map(known.map((x) => [x.id, x]));
  return cleanItems(ids.map((id) => byId.get(id) || { id }));
}

export const sameIds = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/* ── 주소 ↔ 목록 ───────────────────────────────────────────────────────────── */

/** '12,34,,abc,12,56' → [12, 34, 56] (숫자만, 중복 없이, 최대 4개). */
export function parseIds(text) {
  const out = [];
  for (const part of String(text || '').split(',')) {
    const id = toId(part.trim());
    if (id == null || out.includes(id)) continue;
    out.push(id);
    if (out.length >= BASKET_MAX) break;
  }
  return out;
}

export const formatIds = (ids) => ids.join(',');

export const compareHref = (ids) => (ids.length ? `/compare?ids=${formatIds(ids)}` : '/compare');

/* ── 저장 ─────────────────────────────────────────────────────────────────── */

/** 저장소에서 읽는다. 없거나·깨졌거나·막혀 있으면 빈 바구니. */
export function readBasket(storage) {
  try {
    const raw = storage?.getItem(BASKET_KEY);
    return raw ? cleanItems(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/** 저장한다. 막혀 있으면 false(메모리 상태는 그대로 쓴다). */
export function writeBasket(storage, items) {
  try {
    if (!storage) return false;
    if (items.length) storage.setItem(BASKET_KEY, JSON.stringify(items));
    else storage.removeItem(BASKET_KEY);
    return true;
  } catch {
    return false;
  }
}
