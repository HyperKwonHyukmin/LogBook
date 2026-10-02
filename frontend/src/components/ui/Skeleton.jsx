/** 스켈레톤 막대 — 300ms 뒤에 나타나고 opacity 로만 숨쉰다(쉬머 없음). */
export function Bar({ className = '' }) {
  return <div className={`animate-skeleton rounded-md bg-n-100 ${className}`} />;
}

/** 실제 레이아웃 모양을 따른 자리 표시. rows 줄, 각 줄 = 제목 + 메타 + 발췌. */
export function RowsSkeleton({ rows = 4, label = '불러오는 중', dense = false }) {
  return (
    <div role="status" aria-label={label} className="appear-late">
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
