import { useEffect, useId, useRef, useState } from 'react';

/**
 * 떠 있는 동작 메뉴. trigger(props) 로 단추를 그리고, items = [{ label, icon, onSelect, tone, disabled }].
 * ↑/↓ 이동, Enter 선택, Esc·바깥 누르기로 닫고 단추로 포커스를 돌린다.
 */
export default function Menu({ trigger, items, align = 'right', width = 220, header }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const itemRefs = useRef([]);

  useEffect(() => {
    if (!open) return undefined;
    itemRefs.current.find((el) => el && !el.disabled)?.focus();
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function close() { setOpen(false); btnRef.current?.focus(); }
  function onKeyDown(e) {
    const els = itemRefs.current.filter((el) => el && !el.disabled);
    const i = els.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      {trigger({ ref: btnRef, 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? id : undefined,
                 onClick: () => setOpen((o) => !o) })}
      {open && (
        <div id={id} role="menu" onKeyDown={onKeyDown} style={{ width }}
             className={`absolute top-full z-40 mt-1 animate-pop rounded-lg bg-n-0 py-1 shadow-md ${align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'}`}>
          {header}
          {items.map((it, i) => (it.divider ? <div key={i} role="separator" className="my-1 h-px bg-n-200" /> : (
            <button key={it.label} ref={(el) => { itemRefs.current[i] = el; }} type="button" role="menuitem" disabled={it.disabled}
                    onClick={() => { setOpen(false); btnRef.current?.focus(); it.onSelect(); }}
                    className={`flex h-8 w-full items-center gap-2 px-3 text-left text-ui outline-none transition-colors duration-150 ease-out
                      hover:bg-n-100 focus-visible:bg-n-100 active:bg-n-150 disabled:cursor-not-allowed disabled:text-n-500
                      ${it.tone === 'danger' ? 'text-err' : 'text-n-800'}`}>
              {it.icon && <it.icon size={14} aria-hidden="true" className={it.tone === 'danger' ? '' : 'text-n-500'} />}
              {it.label}
            </button>
          )))}
        </div>
      )}
    </div>
  );
}
