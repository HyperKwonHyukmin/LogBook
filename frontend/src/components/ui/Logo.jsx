import markUrl from '../../assets/hitess-mark.png';

/**
 * Hi-TESS LogBook 로고(15) — WorkBench 의 Hi-TESS 마크(회색 고리 + 빨강·파랑·초록 면, `assets/hitess-mark.png`)와
 * 글자 워드마크 'Hi-TESS' + 'LogBook'. WorkBench 잠금 그림(hitess_logo_lockup)은 'WorkBench' 글자가 박혀 있어 쓰지 않는다.
 * 부제(구조해석 항해일지)는 로그인 화면에서만 쓴다.
 *
 * tone: 'navy'(네이비 크롬 위 — 흰 'Hi-TESS' + 민트 'LogBook', WorkBench 잠금 로고와 같은 짝) |
 *       'light'(흰 바탕 — 네이비 'Hi-TESS' + 네이비 'LogBook', 민트는 흰 바탕에서 대비가 모자라 쓰지 않는다)
 * 마크 색 대비: navy-900 위 파랑 3.1·빨강 3.3·회색 고리 4.8, 흰 바탕 위 4.9·4.6·3.2(그래픽 3:1 이상).
 */
export default function Logo({ size = 22, withText = true, subtitle = false, tone = 'light', textClassName = '' }) {
  const onNavy = tone === 'navy';
  return (
    <div className="flex items-center gap-2">
      <img src={markUrl} alt="" aria-hidden="true" width={size} height={size} decoding="async"
           className="shrink-0 object-contain" style={{ width: size, height: size }} />
      {withText && (
        <div className="flex flex-col">
          <span className={`${textClassName || (subtitle ? 'text-[16px] leading-5' : 'text-body')} whitespace-nowrap font-semibold tracking-[-0.01em]`}>
            <span className={onNavy ? 'text-on-navy' : 'text-n-900'}>Hi-TESS</span>{' '}
            <span className={onNavy ? 'text-brand-mint' : 'text-brand'}>LogBook</span>
          </span>
          {subtitle && <span className={`text-meta ${onNavy ? 'text-on-navy-muted' : 'text-n-500'}`}>구조해석 항해일지</span>}
        </div>
      )}
    </div>
  );
}
