const UNIT = { page: (n) => `${n}쪽`, slide: (n) => `슬라이드 ${n}장`, sheet: (n) => `시트 ${n}개`, paragraph: (n) => `문단 ${n}개` };

/** 규칙 기반 요약 카드(설계 §5.2) — 제목, 쪽·슬라이드 수, 작성자·작성일, 목차, 표지 글. */
export default function SummaryCard({ summary }) {
  if (!summary) return null;
  const count = summary.count != null ? UNIT[summary.unit]?.(summary.count) : null;
  return (
    <section aria-label="요약" className="rounded-lg border border-line bg-white p-4 text-[13px]">
      <h3 className="text-sm font-semibold text-zinc-900">{summary.title || '제목 없음'}</h3>
      <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
        {count && <div><dt className="sr-only">분량</dt><dd>{count}</dd></div>}
        {summary.author && <div className="flex gap-1"><dt>작성</dt><dd>{summary.author}</dd></div>}
        {summary.created && <div className="flex gap-1"><dt>작성일</dt><dd className="font-mono">{summary.created}</dd></div>}
        {summary.truncated && <div><dt className="sr-only">색인 범위</dt><dd className="text-wait">본문이 길어 앞부분만 색인됨</dd></div>}
      </dl>
      {summary.headings?.length > 0 && (
        <ol className="mt-3 list-decimal space-y-0.5 pl-5 text-zinc-700">
          {summary.headings.slice(0, 12).map((h, i) => <li key={i} className="truncate">{h}</li>)}
          {summary.headings.length > 12 && <li className="list-none text-zinc-500">외 {summary.headings.length - 12}개</li>}
        </ol>
      )}
      {summary.cover && <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-xs text-zinc-500">{summary.cover}</p>}
    </section>
  );
}
