import { api } from '../api/client.js';

/** 해석 종류·구역 통제 어휘(08). 서버 vocab.key 와 같은 비교 열쇠 — 공백을 빼고 대소문자를 무시한다. */
export const vocabKey = (v) => String(v ?? '').replace(/\s+/g, '').toLowerCase();

export const VOCAB_KINDS = [{ id: 'atype', label: '해석 종류' }, { id: 'zone', label: '구역' }];
export const OTHER_TERM = '기타';

// 한 화면에서 여러 칸이 같은 목록을 쓴다 — 종류별로 한 번만 받는다(관리자가 바꾸면 invalidate).
const cache = new Map();

export function loadVocab(kind) {
  if (!cache.has(kind)) {
    const p = api(`/vocab?kind=${kind}`).then((r) => r.terms || []);
    cache.set(kind, p);
    p.catch(() => cache.delete(kind));
  }
  return cache.get(kind);
}

export function invalidateVocab(kind) {
  if (kind) cache.delete(kind); else cache.clear();
}

/** 입력한 글자와 정확히 같은 용어(용어 이름·동의어·표기 변형). 없으면 null. */
export function resolveTerm(terms, text) {
  const k = vocabKey(text);
  if (!k) return null;
  return terms.find((t) => vocabKey(t.value) === k)
    || terms.find((t) => t.synonyms?.some((s) => vocabKey(s.value) === k)) || null;
}

/**
 * 고를 수 있는 후보 — 사용 중인 용어 중 이름이나 동의어에 입력이 들어 있는 것(목록 순서 유지).
 * 동의어로만 맞으면 via 에 그 동의어를 담는다(화면: 'FEM 해석 → FE 해석').
 * exclude: 이미 고른 값(구역 칩).
 */
export function matchTerms(terms, text, exclude = []) {
  const k = vocabKey(text);
  const skip = new Set(exclude.map(vocabKey));
  const out = [];
  for (const t of terms) {
    if (t.active === false || skip.has(vocabKey(t.value))) continue;
    if (!k || vocabKey(t.value).includes(k)) { out.push({ term: t, via: null }); continue; }
    const syn = t.synonyms?.find((s) => vocabKey(s.value).includes(k));
    if (syn) out.push({ term: t, via: syn.value });
  }
  return out;
}

export const isListed = (terms, value) => !!value && terms.some((t) => vocabKey(t.value) === vocabKey(value));
