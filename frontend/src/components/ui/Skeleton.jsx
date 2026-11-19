import { useEffect, useState } from 'react';

/** 스켈레톤 막대 — 300ms 뒤에 나타나고 opacity 로만 숨쉰다(쉬머 없음). */
export function Bar({ className = '' }) {
  return <div className={`animate-skeleton rounded-md bg-n-100 ${className}`} />;
}

/**
 * 2026-11-19 — 오래 걸리면(slowAfter ms) 안내 한 줄. 서버가 Update 로 다시 시작되는 동안 요청은 실패하지 않고 기다려
 * 회색 줄만 한동안 보였다(사용자 신고). 무엇을 기다리는지 말해 준다.
 */
function SlowNote({ after, children }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), after);
    return () => clearTimeout(t);
  }, [after]);
  if (!show) return null;
  return <p className="px-5 pt-3 text-meta text-n-600">{children}</p>;
}

/** 실제 레이아웃 모양을 따른 자리 표시. rows 줄, 각 줄 = 제목 + 메타 + 발췌. slowNote 를 주면 slowAfter 뒤에 그 안내를 보인다. */
export function RowsSkeleton({ rows = 4, label = '불러오는 중', dense = false, slowNote = null, slowAfter = 5000 }) {
  return (
    <div role="status" aria-label={label} className="appear-late">
      {slowNote && <SlowNote after={slowAfter}>{slowNote}</SlowNote>}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`border-b border-n-200 ${dense ? 'px-3 py-3' : 'px-5 py-3.5'}`}>
          <Bar className="h-3.5 w-3/5" />
          {!dense && <Bar className="mt-2.5 h-2.5 w-2/5" />}
          {!dense && <Bar className="mt-2 h-2.5 w-11/12" />}
        </div>
      ))}
    </div>
  );
}

/** 블록 하나짜리 자리 표시. */
export function BlockSkeleton({ className = 'h-40', label = '불러오는 중' }) {
  return (
    <div role="status" aria-label={label} className="appear-late">
      <Bar className={className} />
    </div>
  );
}
