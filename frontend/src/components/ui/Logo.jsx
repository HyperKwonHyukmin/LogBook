/**
 * 로고 마크 + 이름. 부제(구조해석 항해일지)는 로그인 화면에서만 쓴다.
 * tone: 'light'(흰 바탕 — 네이비 마크) | 'navy'(네이비 크롬 위 — 흰 마크 + 네이비 그림, 흰 글자)
 */
export default function Logo({ size = 22, withText = true, subtitle = false, tone = 'light', textClassName = '' }) {
  const onNavy = tone === 'navy';
  return (
    <div className="flex items-center gap-2">
      <div className={`relative flex shrink-0 items-center justify-center rounded-[6px] ${onNavy ? 'bg-n-0 text-brand' : 'bg-brand text-white'}`}
           style={{ width: size, height: size }} aria-hidden="true">
        <span className="absolute rounded-full bg-spark" style={{ width: size / 6, height: size / 6, top: size / 7, right: size / 7 }} />
        <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="none"
             stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 6.5c3.2-1.5 5.8-1.5 8.5 0 2.7-1.5 5.3-1.5 8.5 0v11c-3.2-1.5-5.8-1.5-8.5 0-2.7-1.5-5.3-1.5-8.5 0z" />
          <path d="M12 6.5v11" />
        </svg>
      </div>
      {withText && (
        <div className="flex flex-col">
          <span className={`${textClassName || (subtitle ? 'text-[16px] leading-5' : 'text-body')} font-semibold tracking-[-0.01em] ${onNavy ? 'text-on-navy' : 'text-n-900'}`}>Logbook</span>
          {subtitle && <span className={`text-meta ${onNavy ? 'text-on-navy-muted' : 'text-n-500'}`}>구조해석 항해일지</span>}
        </div>
      )}
    </div>
  );
}
