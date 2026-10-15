import { Layers } from 'lucide-react';
import { revisionBrief } from '../../lib/revisions.js';

/** 검색 결과 행·미리보기 한 줄(14) — '판 3개 · 최신 R2'. 판 계열이 없으면 그리지 않는다. */
export default function RevisionBrief({ brief, className = 'mt-1' }) {
  const text = revisionBrief(brief);
  if (!text) return null;
  return (
    <div className={`${className} flex min-w-0 items-center gap-1 text-meta text-n-600`} title="이 자료 안 BDF 판(Revision) 묶음">
      <Layers size={12} className="shrink-0 text-n-400" aria-hidden="true" />
      <span className="truncate">{text}</span>
    </div>
  );
}
