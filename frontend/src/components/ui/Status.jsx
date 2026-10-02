import { Link } from 'react-router-dom';

const STATUS = {
  confirmed: ['확정', 'bg-ok', 'text-ok'],
  draft: ['미확정', 'bg-wait', 'text-wait'],
  trashed: ['휴지통', 'bg-err', 'text-err'],
};

/** 상태 = 점 + 글자(색만으로 구분하지 않는다). */
export function StatusDot({ status }) {
  const [label, dot, text] = STATUS[status] || [status, 'bg-n-400', 'text-n-600'];
  return (
    <span className={`inline-flex items-center gap-1.5 text-meta font-medium ${text}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span>{label}</span>
    </span>
  );
}

/** 결과 행의 미확정 배지. */
export function DraftBadge() {
  return (
    <span className="inline-flex h-[18px] shrink-0 items-center rounded-xs bg-wait-bg px-1.5 text-micro font-semibold text-wait">
      미확정
    </span>
  );
}

const hullChipClass = 'inline-flex h-5 items-center rounded-sm border border-brand-muted bg-n-0 px-1.5 font-mono text-meta '
  + 'font-medium text-brand transition-colors duration-120 ease-out hover:bg-brand-subtle active:bg-brand-muted';

/** 호선 칩(전역 1종) — 호선 화면으로 가는 링크. */
export function HullChip({ hull, title, onClick }) {
  return (
    <Link to={`/h/${encodeURIComponent(hull)}`} title={title} onClick={onClick} className={hullChipClass}>{hull}</Link>
  );
}

/** 태그·구역 칩. */
export function TagChip({ children, className = '' }) {
  return (
    <span className={`inline-flex h-6 items-center rounded-sm bg-n-100 px-2 text-meta text-n-700 ${className}`}>{children}</span>
  );
}
