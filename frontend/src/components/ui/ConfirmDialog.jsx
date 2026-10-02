import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Button from './Button.jsx';

/**
 * 되돌릴 수 없는 동작에만 쓰는 확인 대화상자(window.confirm 대신).
 * Esc·바깥 누르기 = 취소, 포커스는 대화상자 안에 가둔다, 닫히면 원래 자리로 돌려준다.
 */
function ConfirmDialog({ title, body, confirmLabel, cancelLabel = '취소', tone = 'danger', onConfirm, onCancel }) {
  const id = useId();
  const boxRef = useRef(null);
  const cancelRef = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    cancelRef.current?.focus();
    return () => { if (prev && typeof prev.focus === 'function') prev.focus(); };
  }, []);
  function onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
    if (e.key !== 'Tab') return;
    const items = [...boxRef.current.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length;
    e.preventDefault();
    items[next]?.focus();
  }
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 animate-fade" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={boxRef} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={body ? `${id}-d` : undefined}
           onKeyDown={onKeyDown} className="w-full max-w-[420px] animate-pop rounded-xl bg-n-0 p-5 shadow-lg">
        <h2 id={`${id}-t`} className="text-[16px] leading-6 font-semibold text-n-900">{title}</h2>
        {body && <p id={`${id}-d`} className="mt-1.5 text-ui text-n-600">{body}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={tone === 'danger' ? 'danger-solid' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** const [confirm, dialog] = useConfirm(); if (await confirm({ title, body, confirmLabel })) … ; {dialog} 을 그린다. */
export function useConfirm() {
  const [state, setState] = useState(null);
  const confirm = useCallback((opts) => new Promise((resolve) => setState({ ...opts, resolve })), []);
  const close = (v) => { state?.resolve(v); setState(null); };
  const dialog = state
    ? <ConfirmDialog {...state} onConfirm={() => close(true)} onCancel={() => close(false)} />
    : null;
  return [confirm, dialog];
}
