import { useEffect, useRef, useState } from 'react';
import { ExternalLink, LocateFixed, X } from 'lucide-react';

/**
 * 2026-11-20 — 사용 설명서를 새 탭 대신 오른쪽 패널로 연다(사용자: "새 페이지로 뜨면 사용 흐름이 끊긴다").
 * 화면을 가리지 않는 패널이라 설명서를 보면서 왼쪽 앱을 그대로 누를 수 있다.
 * 2026-11-20 — 처음 폭은 화면의 절반(사용자: "너무 작다, 절반쯤 차지해도 된다. 가려지면 닫고 보면 된다").
 * 넓으면 설명서가 A4 쪽 그대로(글자 원래 크기), 760px 이하로 좁히면 설명서가 글을 다시 흘리는 웹판 배치로 바뀐다.
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
      <iframe ref={frame} src={src} title="사용 설명서 본문"
              className={`min-h-0 w-full flex-1 border-0 ${dragging ? 'pointer-events-none' : ''}`} />
    </aside>
  );
}
