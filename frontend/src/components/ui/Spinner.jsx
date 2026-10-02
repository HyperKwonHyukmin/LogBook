/** 작은 스피너 — currentColor, 1.5px 선. */
export default function Spinner({ size = 14, className = '' }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" className={`animate-spin ${className}`}>
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
      <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
