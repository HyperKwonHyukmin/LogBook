import { useEffect, useRef, useState } from 'react';
import { ExternalLink, LocateFixed, X } from 'lucide-react';

/**
 * 2026-11-20 — 사용 설명서를 새 탭 대신 오른쪽 패널로 연다(사용자: "새 페이지로 뜨면 사용 흐름이 끊긴다").
 * 화면을 가리지 않는 패널이라 설명서를 보면서 왼쪽 앱을 그대로 누를 수 있다.
 * 2026-11-20 — 처음 폭은 화면의 절반(사용자: "너무 작다, 절반쯤 차지해도 된다. 가려지면 닫고 보면 된다").
 * 패널 안에서는 폭과 상관없이 늘 웹판으로 본다(사용자: "A4 버전 넣은 거 맞아?" — A4 쪽 틀, 회색 바탕, 쪽 번호가 그대로 보였다).
 * 설명서 HTML 은 그대로 두고(새 탭과 PDF 는 A4), iframe 이 열리면 WEB_LAYOUT_CSS 를 넣어 쪽 틀을 푼다(같은 출처라 가능).
 * 2단 배치(글 + 그림)는 넓을 때 그대로, 760px 이하면 설명서의 원래 규칙대로 위아래로 바뀐다.
 * 폭은 화면 비율로 기억한다(모니터가 달라도 같은 비율).
 * 쪽 이동은 설명서의 postMessage({manualSection}) 로 한다(주소를 다시 읽지 않아 읽던 자리가 날아가지 않는다).
 */
export const RATIO_MIN = 0.3;
export const RATIO_MAX = 0.85;
const RATIO_DEFAULT = 0.5;
const RATIO_KEY = 'logbook.manual.ratio';
const STEP = 0.05;

const clamp = (r) => Math.min(RATIO_MAX, Math.max(RATIO_MIN, Math.round(r * 100) / 100));

function savedRatio() {
  try {
    const r = Number(window.localStorage.getItem(RATIO_KEY));
    return r ? clamp(r) : RATIO_DEFAULT;
  } catch {
    return RATIO_DEFAULT;
  }
}

/** A4 쪽 틀을 풀어 한 장으로 흘리는 웹판 배치. 설명서의 760px 이하 규칙과 같은 생각이고 넓은 패널에도 쓴다. */
export const WEB_LAYOUT_CSS = `
html,body{background:#fff!important}
body{padding:0!important;font-size:10.5pt}
.page,.page.roomy{width:auto!important;height:auto!important;overflow:visible!important;max-width:960px;
  margin:0 auto!important;padding:0!important;box-shadow:none!important;border-radius:0!important;border-bottom:1px solid #e2e8f0}
.page.cover{display:none!important}
.page header{position:static!important;padding:18px 28px 6px!important;margin:0!important}
.page main{position:static!important;overflow:visible!important;padding:6px 28px 24px!important}
.page footer{display:none!important}
img{max-width:100%;height:auto}
`;
const WEB_STYLE_ID = 'logbook-web-layout';

/** 설명서 문서에 웹판 배치를 넣는다(이미 있으면 그대로). 넣었으면 true. */
export function applyWebLayout(doc) {
  if (!doc?.head || doc.getElementById(WEB_STYLE_ID)) return false;
  const style = doc.createElement('style');
  style.id = WEB_STYLE_ID;
  style.textContent = WEB_LAYOUT_CSS;
  doc.head.appendChild(style);
  return true;
}

export default function ManualPanel({ href, section, onClose }) {
  const [ratio, setRatio] = useState(savedRatio);
  const [dragging, setDragging] = useState(false);
  const frame = useRef(null);
  const [src] = useState(href);   // 연 순간의 쪽 — 앱에서 화면을 옮겨도 읽던 설명서는 그대로 둔다

  useEffect(() => {
    try { window.localStorage.setItem(RATIO_KEY, String(ratio)); } catch { /* 저장 못 해도 패널은 된다 */ }
  }, [ratio]);

  const startDrag = (e) => {
    e.preventDefault();
    setDragging(true);   // 끄는 동안 iframe 이 포인터를 가져가지 않게 막는다
    const move = (ev) => setRatio(clamp((window.innerWidth - ev.clientX) / window.innerWidth));
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const nudge = (e) => {
    if (e.key === 'ArrowLeft') setRatio((r) => clamp(r + STEP));
    if (e.key === 'ArrowRight') setRatio((r) => clamp(r - STEP));
  };
  const onFrameLoad = () => {
    let doc = null;
    try { doc = frame.current?.contentDocument; } catch { return; }   // 다른 출처면(있을 수 없지만) A4 그대로
    if (!applyWebLayout(doc)) return;
    // 배치가 바뀌어 처음 쪽 위치가 달라졌다 — 주소의 구역으로 다시 맞춘다
    frame.current.contentWindow?.postMessage({ manualSection: (src.split('#')[1] || 'toc') }, window.location.origin);
  };
  const showHere = () => {
    frame.current?.contentWindow?.postMessage({ manualSection: section }, window.location.origin);
  };

  return (
    <aside aria-label="사용 설명서" style={{ width: `${ratio * 100}vw` }}
           className="fixed bottom-0 right-0 top-12 z-40 flex max-w-[100vw] flex-col border-l border-n-200 bg-n-0 shadow-lg">
      <div role="separator" aria-orientation="vertical" aria-label="설명서 폭 조절" tabIndex={0}
           aria-valuemin={RATIO_MIN * 100} aria-valuemax={RATIO_MAX * 100} aria-valuenow={Math.round(ratio * 100)}
           aria-valuetext={`화면의 ${Math.round(ratio * 100)}%`}
           onPointerDown={startDrag} onKeyDown={nudge}
           className="absolute inset-y-0 -left-1 w-2 cursor-col-resize focus-visible:bg-brand-ring hover:bg-brand-ring" />
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-n-200 pl-3 pr-1.5">
        <h2 className="min-w-0 flex-1 truncate text-ui font-semibold text-n-900">사용 설명서</h2>
        <button type="button" onClick={showHere} title="지금 보고 있는 화면의 설명으로 이동"
                className="flex h-7 items-center gap-1 rounded-md px-2 text-meta text-n-700 hover:bg-n-100">
          <LocateFixed size={14} aria-hidden="true" />이 화면
        </button>
        <a href={href} target="_blank" rel="noopener" title="새 탭으로 열기" aria-label="새 탭으로 열기"
           className="flex h-7 w-7 items-center justify-center rounded-md text-n-600 hover:bg-n-100">
          <ExternalLink size={14} aria-hidden="true" />
        </a>
        <button type="button" onClick={onClose} aria-label="설명서 닫기" title="닫기"
                className="flex h-7 w-7 items-center justify-center rounded-md text-n-600 hover:bg-n-100">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <iframe ref={frame} src={src} title="사용 설명서 본문" onLoad={onFrameLoad}
              className={`min-h-0 w-full flex-1 border-0 ${dragging ? 'pointer-events-none' : ''}`} />
    </aside>
  );
}
