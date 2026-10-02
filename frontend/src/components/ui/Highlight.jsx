import { highlightParts } from '../../lib/search.js';

const markClass = 'rounded-xs bg-hit px-px text-n-900';

/** 발췌문 강조 — 서버가 준 글자 위치로 칠한다(HTML 을 받지 않아 안전하다). */
export default function Highlight({ text, highlights }) {
  return (
    <>
      {highlightParts(text, highlights).map((p, i) => (p.hit
        ? <mark key={i} className={markClass}>{p.text}</mark>
        : <span key={i}>{p.text}</span>))}
    </>
  );
}

/** 검색어(terms)가 든 부분을 칠한다 — 제목처럼 서버가 위치를 주지 않는 글자에 쓴다. */
export function TermHighlight({ text, terms }) {
  const words = (terms || []).map((t) => t.trim()).filter((t) => t.length > 0);
  if (!text || words.length === 0) return text || null;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'gi'));
  if (parts.length === 1) return text;
  const lower = words.map((w) => w.toLowerCase());
  return parts.map((p, i) => (lower.includes(p.toLowerCase())
    ? <mark key={i} className={markClass}>{p}</mark>
    : p));
}
