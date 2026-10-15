import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PREVIEW_MIN, clampWidth, defaultPreviewWidth, keyWidth, previewBounds, readStoredWidth, writeStoredWidth } from '../../lib/panelWidth.js';
import { PREF_KEYS, savePref, subscribePrefs } from '../../lib/prefs.js';

const viewport = () => (typeof window === 'undefined' ? 1366 : window.innerWidth);

/**
 * 미리보기 패널 폭(09) — 왼쪽 가장자리 손잡이로 끌어 바꾸고 기억한다.
 * 10 — 기억한 값(stored)은 사용자가 끌거나 키로 바꿀 때만 바뀐다. 화면이 좁아 잘라 보이는 폭(width)은
 * 저장하지 않는다(창을 다시 넓히면 원래 폭으로 돌아온다). 바꾼 값은 localStorage 와 서버(사용자 설정)에
 * 함께 남기고, 서버 값이 들어오면(다른 PC 에서 바꾼 값) 그 값을 쓴다.
 *
 * areaRef: 검색 화면 전체(필터 열 + 결과 + 패널), reservedRef: 펼쳐져 자리를 차지하는 필터 열.
 * 끄는 동안에는 React 상태를 바꾸지 않고 패널 DOM 의 width 만 rAF 로 고친다 — 결과 목록이 매 움직임마다
 * 다시 그려지지 않게. 놓을 때 한 번 상태·저장소에 반영한다.
 */
export default function usePreviewWidth({ areaRef, reservedRef, active }) {
  const [stored, setStored] = useState(() => readStoredWidth());
  const [area, setArea] = useState(() => ({ width: viewport(), reserved: 0 }));
  const panelRef = useRef(null);
  const handleRef = useRef(null);
  const drag = useRef(null);

  // 패널이 열릴 때(필터 열이 접히는 시점)와 화면 크기가 바뀔 때 다시 잰다.
  useLayoutEffect(() => {
    if (!active) return undefined;
    const el = areaRef.current;
    if (!el) return undefined;
    const measure = () => setArea({ width: el.clientWidth || viewport(), reserved: reservedRef.current?.offsetWidth || 0 });
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, areaRef, reservedRef]);

  // 10 — 로그인·앱 시작 때 받은 서버 값(다른 PC 에서 바꾼 폭)을 쓰고 localStorage 사본도 맞춘다
  useEffect(() => subscribePrefs((key, value) => {
    if (key !== PREF_KEYS.previewWidth) return;
    const n = Number(value);
    const w = value != null && Number.isFinite(n) && n >= PREVIEW_MIN ? Math.round(n) : null;
    setStored(w);
    writeStoredWidth(w);
  }), []);

  // 끄는 중에 패널이 닫혀도(Esc) 화면 전체의 끌기 표시가 남지 않게
  useEffect(() => () => { delete document.body.dataset.resizing; }, []);

  const bounds = previewBounds(area.width, area.reserved);
  const width = clampWidth(stored ?? defaultPreviewWidth(viewport()), bounds);

  const commit = useCallback((w) => { setStored(w); writeStoredWidth(w); savePref(PREF_KEYS.previewWidth, w); }, []);

  function apply(w) {
    if (panelRef.current) panelRef.current.style.width = `${w}px`;
    handleRef.current?.setAttribute('aria-valuenow', String(w));
  }
  function end() {
    const d = drag.current;
    if (!d) return;
    cancelAnimationFrame(d.raf);
    drag.current = null;
    if (handleRef.current) delete handleRef.current.dataset.dragging;
    delete document.body.dataset.resizing;
    if (d.next !== d.start) commit(d.next);
  }
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, start: width, next: width, raf: 0 };
    // 상태로 두지 않는다 — 끄는 시작·끝에 결과 목록을 다시 그리지 않게(손잡이 색은 data 속성으로)
    if (handleRef.current) handleRef.current.dataset.dragging = 'true';
    // 끄는 동안 PDF iframe·3D 캔버스가 포인터를 가로채지 않게(index.css), 글자 선택도 막는다.
    document.body.dataset.resizing = 'col';
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    d.next = clampWidth(d.start + (d.x - e.clientX), bounds);
    cancelAnimationFrame(d.raf);
    d.raf = requestAnimationFrame(() => apply(d.next));
  };
  const onKeyDown = (e) => {
    const w = keyWidth(e.key, width, bounds, e.shiftKey);
    if (w == null) return;
    e.preventDefault();
    commit(w);
  };
  const reset = () => { setStored(null); writeStoredWidth(null); savePref(PREF_KEYS.previewWidth, null); };

  const handleProps = {
    ref: handleRef, role: 'separator', 'aria-orientation': 'vertical', 'aria-label': '미리보기 폭 조절',
    'aria-valuenow': width, 'aria-valuemin': bounds.min, 'aria-valuemax': bounds.max, tabIndex: 0,
    title: '끌어서 폭 조절 · ←/→ · 두 번 누르면 기본 폭',
    onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end,
    onKeyDown, onDoubleClick: reset,
  };
  return { width, panelRef, handleProps };
}

/** 패널 왼쪽 가장자리 손잡이 — 보이는 선은 1px, 잡는 폭은 8px. */
export function PreviewResizer({ handleProps }) {
  return (
    <div {...handleProps}
         className="group absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none outline-none">
      <span aria-hidden="true"
            className="absolute inset-y-0 left-[3px] w-0.5 bg-transparent transition-colors duration-150 ease-out
                       group-hover:bg-n-300 group-focus-visible:bg-brand group-data-[dragging=true]:bg-brand" />
    </div>
  );
}
