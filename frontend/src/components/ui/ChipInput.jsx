import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../api/client.js';

/**
 * 자유 입력 칩 + /api/suggest 자동완성(설계: 표준 목록 없이, 쓴 값을 다시 제안).
 * 키보드: ↑/↓ 로 후보 이동, Enter 로 고름, Escape 로 닫음.
 */
export default function ChipInput({ label, kind, values, onChange, validate, placeholder = '입력 후 Enter', disabled = false }) {
  const [text, setText] = useState('');
  const [options, setOptions] = useState([]);
  const [error, setError] = useState('');
  const [active, setActive] = useState(-1);
  const listId = useId();
  const requestRef = useRef(0);
  // values 는 부모가 매 렌더 새 배열로 줄 수 있다 — 내용이 같으면 다시 부르지 않게 문자열로 비교한다.
  const SEP = '\u0000';
  const valuesKey = values.join(SEP);

  function showOptions(rows) { setOptions(rows); setActive(-1); }

  useEffect(() => {
    const q = text.trim();
    const id = ++requestRef.current; // 이 질의 이후의 응답만 쓴다(늦게 온 옛 응답은 버린다)
    if (!q) { showOptions([]); return undefined; }
    const current = valuesKey ? valuesKey.split(SEP) : [];
    const t = setTimeout(() => {
      api(`/suggest?kind=${kind}&q=${encodeURIComponent(q)}`)
        .then((rows) => { if (id === requestRef.current) showOptions(rows.filter((r) => !current.includes(r))); })
        .catch(() => { if (id === requestRef.current) showOptions([]); });
    }, 150);
    return () => clearTimeout(t);
  }, [text, kind, valuesKey]);

  function add(raw) {
    const v = raw.trim();
    if (!v || values.includes(v)) { setText(''); return; }
    const verdict = validate ? validate(v) : true;
    if (verdict !== true) { setError(verdict); return; }
    setError('');
    setText('');
    showOptions([]);
    onChange([...values, v]);
  }

  return (
    <div>
      <div className="flex min-h-8 flex-wrap items-center gap-1 rounded-md border border-zinc-300 bg-white px-1.5 py-1 focus-within:border-brand focus-within:ring-3 focus-within:ring-brand-ring">
        {values.map((v) => (
          <span key={v} className="inline-flex h-6 items-center gap-1 rounded bg-brand-tint px-2 font-mono text-xs text-brand">
            {v}
            {!disabled && (
              <button type="button" aria-label={`${v} 빼기`} onClick={() => onChange(values.filter((x) => x !== v))}
                      className="rounded text-brand/70 hover:text-brand"><X size={12} aria-hidden="true" /></button>
            )}
          </span>
        ))}
        <input role="combobox" aria-label={label} aria-expanded={options.length > 0} aria-controls={listId}
               aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
               disabled={disabled} value={text} placeholder={values.length ? '' : placeholder}
               onChange={(e) => { setText(e.target.value); setError(''); }}
               onKeyDown={(e) => {
                 if (e.key === 'ArrowDown' && options.length) { e.preventDefault(); setActive((i) => Math.min(i + 1, options.length - 1)); return; }
                 if (e.key === 'ArrowUp' && options.length) { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
                 if (e.key === 'Escape' && options.length) { e.preventDefault(); requestRef.current += 1; showOptions([]); return; }
                 if (e.key === 'Enter' && active >= 0 && options[active]) { e.preventDefault(); add(options[active]); return; }
                 if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); }
                 if (e.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1));
               }}
               onBlur={() => text.trim() && add(text)}
               className="min-w-20 flex-1 bg-transparent px-1 text-[13px] outline-none focus-visible:outline-none" />
      </div>
      {options.length > 0 && (
        <ul id={listId} role="listbox" className="mt-1 max-h-40 overflow-auto rounded-md border border-line bg-white py-1 shadow-sm">
          {options.map((o, i) => (
            <li key={o} id={`${listId}-opt-${i}`} role="option" aria-selected={i === active} tabIndex={-1}
                onMouseDown={(e) => { e.preventDefault(); add(o); }} onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-2.5 py-1 text-[13px] ${i === active ? 'bg-brand-tint text-brand' : 'hover:bg-brand-tint'}`}>{o}</li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-err">{error}</p>}
    </div>
  );
}
