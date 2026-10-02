import { useRef } from 'react';

/**
 * 밑줄 탭(보기 전환) — 선택은 n-900 글자 + 2px n-900 밑줄(강조색 아님).
 * items: [{ id, label, count?, tabId? }]. ←/→ 로 옮겨 가며 바로 선택한다.
 */
export function Tabs({ items, value, onChange, label, controls, className = '' }) {
  const refs = useRef([]);
  function onKeyDown(e, idx) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = (idx + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length;
    onChange(items[next].id);
    refs.current[next]?.focus();
  }
  return (
    <div role="tablist" aria-label={label} className={`flex h-9 items-stretch gap-5 border-b border-n-200 ${className}`}>
      {items.map((t, idx) => {
        const on = t.id === value;
        return (
          <button key={t.id} ref={(el) => { refs.current[idx] = el; }} type="button" role="tab" id={t.tabId}
                  aria-selected={on} aria-controls={controls} tabIndex={on ? 0 : -1}
                  onClick={() => onChange(t.id)} onKeyDown={(e) => onKeyDown(e, idx)}
                  className={`relative -mb-px inline-flex items-center whitespace-nowrap border-b-2 px-0.5 text-ui font-medium transition-colors duration-120 ease-out
                    ${on ? 'border-n-900 text-n-900' : 'border-transparent text-n-500 hover:text-n-900'}`}>
            {t.label}
            {t.count != null && <span aria-hidden="true" className="ml-1.5 font-mono text-micro text-n-500">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 세그먼트(값 전환) — 선택은 흰 바탕 + 그림자. 파란 채움은 쓰지 않는다.
 * role: 'radiogroup'(기본) | 'tablist'
 */
export function Segmented({ items, value, onChange, label, role = 'radiogroup', size = 'sm', className = '', disabled = false, stretch = false }) {
  const itemRole = role === 'tablist' ? 'tab' : 'radio';
  const refs = useRef([]);
  function onKeyDown(e, idx) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = (idx + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length;
    onChange(items[next].id);
    refs.current[next]?.focus();
  }
  const h = size === 'lg' ? 'h-9' : 'h-7';
  const ih = size === 'lg' ? 'h-8 text-ui' : 'h-6 text-meta';
  return (
    <div role={role} aria-label={label} className={`inline-flex ${h} items-center rounded-md bg-n-100 p-0.5 ${className}`}>
      {items.map((t, idx) => {
        const on = t.id === value;
        const sel = itemRole === 'tab' ? { 'aria-selected': on } : { 'aria-checked': on };
        return (
          <button key={t.id} ref={(el) => { refs.current[idx] = el; }} type="button" role={itemRole} id={t.tabId}
                  aria-controls={t.controls} tabIndex={on ? 0 : -1} disabled={disabled} {...sel}
                  onClick={() => onChange(t.id)} onKeyDown={(e) => onKeyDown(e, idx)}
                  className={`${ih} ${stretch ? 'flex-1' : ''} whitespace-nowrap rounded-[4px] px-2.5 font-medium transition-[background-color,color,box-shadow] duration-120 ease-out
                    disabled:cursor-not-allowed disabled:text-n-500
                    ${on ? 'bg-n-0 text-n-900 shadow-sm' : 'text-n-600 hover:text-n-900 active:bg-n-150'}`}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
