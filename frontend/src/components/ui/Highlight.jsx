import { highlightParts } from '../../lib/search.js';

/** 발췌문 강조 — 서버가 준 글자 위치로 칠한다(HTML 을 받지 않아 안전하다). */
export default function Highlight({ text, highlights }) {
  return (
    <>
      {highlightParts(text, highlights).map((p, i) => (p.hit
        ? <mark key={i} className="rounded-sm bg-amber-100 px-0.5 text-zinc-900">{p.text}</mark>
        : <span key={i}>{p.text}</span>))}
    </>
  );
}
