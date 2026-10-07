import { ChevronRight } from 'lucide-react';

const UNIT = { page: (n) => `${n}쪽`, slide: (n) => `슬라이드 ${n}장`, sheet: (n) => `시트 ${n}개`, paragraph: (n) => `문단 ${n}개` };
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** 표지 글에서 제목과 같은 줄을 빼고, 목차에서 제목과 같은 항목을 뺀다(같은 글이 세 번 보이지 않게). */
export function dedupeSummary(summary, hide = []) {
  const known = new Set([summary.title, ...hide].map(norm).filter(Boolean));
  const headings = (summary.headings || []).filter((h) => !known.has(norm(h)));
  const coverLines = (summary.cover || '').split('\n').filter((l) => l.trim() && !known.has(norm(l)));
  const cover = coverLines.join('\n').trim();
  return { headings, cover: norm(cover) && !known.has(norm(cover)) ? cover : '' };
}

/**
 * 규칙 기반 요약(설계 §5.2) — 접을 수 있는 한 블록. 머리줄에 분량·작성자·작성일,
 * 펼치면 제목·목차·표지 글. hideTitles 와 같은 글은 되풀이하지 않는다.
 */
export default function SummaryCard({ summary, hideTitles = [], defaultOpen = false }) {
  if (!summary) return null;
  const count = summary.count != null ? UNIT[summary.unit]?.(summary.count) : null;
  const { headings, cover } = dedupeSummary(summary, hideTitles);
  const titleShown = summary.title && !hideTitles.map(norm).includes(norm(summary.title));
  const hasBody = titleShown || headings.length > 0 || cover;
  return (
    <details aria-label="요약" open={defaultOpen} className="group rounded-lg border border-n-200 bg-n-0 text-ui">
      <summary className={`flex h-9 list-none items-center gap-2 rounded-lg px-3 text-meta text-n-600 marker:hidden [&::-webkit-details-marker]:hidden
                           ${hasBody ? 'cursor-pointer hover:bg-n-50' : 'cursor-default'}`}>
        {hasBody && <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-n-400 transition-transform duration-150 group-open:rotate-90" />}
        <span className="font-semibold text-n-700">요약</span>
        <dl className="flex min-w-0 flex-wrap items-center gap-x-3">
          {count && <div><dt className="sr-only">분량</dt><dd>{count}</dd></div>}
          {summary.author && <div className="flex gap-1"><dt className="text-n-500">작성</dt><dd>{summary.author}</dd></div>}
          {summary.created && <div className="flex gap-1"><dt className="text-n-500">작성일</dt><dd className="font-mono">{summary.created}</dd></div>}
          {summary.truncated && <div><dt className="sr-only">색인 범위</dt><dd className="text-wait">본문이 길어 앞부분만 색인했습니다</dd></div>}
        </dl>
      </summary>
      {hasBody && (
        <div className="border-t border-n-200 px-3 pb-3 pt-2.5">
          {titleShown && <h3 className="text-ui font-semibold text-n-900">{summary.title}</h3>}
          {headings.length > 0 && (
            <ol className={`${titleShown ? 'mt-2' : ''} list-decimal space-y-0.5 pl-5 text-ui text-n-700 marker:text-n-500`}>
              {headings.slice(0, 12).map((h, i) => <li key={i} className="truncate">{h}</li>)}
              {headings.length > 12 && <li className="list-none text-n-500">외 {headings.length - 12}개</li>}
            </ol>
          )}
          {cover && <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-meta text-n-500">{cover}</p>}
        </div>
      )}
    </details>
  );
}
