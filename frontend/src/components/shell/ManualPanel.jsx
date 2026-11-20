import { useEffect, useRef, useState } from 'react';
import { ExternalLink, LocateFixed, X } from 'lucide-react';

/**
 * 2026-11-20 — 사용 설명서를 새 탭 대신 오른쪽 패널로 연다(사용자: "새 페이지로 뜨면 사용 흐름이 끊긴다").
 * 화면을 가리지 않는 패널이라 설명서를 보면서 왼쪽 앱을 그대로 누를 수 있다.
 * 설명서 HTML 은 폭 760px 이하에서 A4 틀을 풀고 글을 다시 흘리는 웹판 배치가 들어 있다 → 패널 폭을 그 아래로 묶는다.
 * 쪽 이동은 설명서의 postMessage({manualSection}) 로 한다(주소를 다시 읽지 않아 읽던 자리가 날아가지 않는다).
 */
export const PANEL_MIN = 360;
export const PANEL_MAX = 720;   // 설명서 웹판 배치 경계(760px) 아래
const PANEL_DEFAULT = 480;
const WIDTH_KEY = 'logbook.manual.width';

const clamp = (w) => Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(w)));

function savedWidth() {
  try {
    const w = Number(window.localStorage.getItem(WIDTH_KEY));
    return w ? clamp(w) : PANEL_DEFAULT;
  } catch {
    return PANEL_DEFAULT;
  }
}

export default function ManualPanel({ href, section, onClose }) {
  const [width, setWidth] = useState(savedWidth);
  const [dragging, setDragging] = useState(false);
  const frame = useRef(null);
  const [src] = useState(href);   // 연 순간의 쪽 — 앱에서 화면을 옮겨도 읽던 설명서는 그대로 둔다

  useEffect(() => {
    try { window.localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* 저장 못 해도 패널은 된다 */ }
  }, [width]);

  const startDrag = (e) => {
    e.preventDefault();
    setDragging(true);   // 끄는 동안 iframe 이 포인터를 가져가지 않게 막는다
    const move = (ev) => setWidth(clamp(window.innerWidth - ev.clientX));
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const nudge = (e) => {
    if (e.key === 'ArrowLeft') setWidth((w) => clamp(w + 40));
    if (e.key === 'ArrowRight') setWidth((w) => clamp(w - 40));
  };
  const showHere = () => {
    frame.current?.contentWindow?.postMessage({ manualSection: section }, window.location.origin);
  };

  return (
    <aside aria-label="사용 설명서" style={{ width }}
           className="fixed bottom-0 right-0 top-12 z-40 flex max-w-[100vw] flex-col border-l border-n-200 bg-n-0 shadow-lg">
      <div role="separator" aria-orientation="vertical" aria-label="설명서 폭 조절" tabIndex={0}
           aria-valuemin={PANEL_MIN} aria-valuemax={PANEL_MAX} aria-valuenow={width}
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
      <iframe ref={frame} src={src} title="사용 설명서 본문"
              className={`min-h-0 w-full flex-1 border-0 ${dragging ? 'pointer-events-none' : ''}`} />
    </aside>
  );
}
