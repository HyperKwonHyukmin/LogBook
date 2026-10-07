import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { api } from '../../api/client.js';

const chipBase = 'inline-flex h-6 max-w-full items-center gap-1 rounded-sm text-meta';
const toneOf = (mono) => (mono
  ? 'bg-brand px-1.5 font-mono font-medium text-on-navy' // 호선 칩 = 전역 HullChip 과 같은 네이비 채움
  : 'bg-n-100 px-2 text-n-700');

/**
 * 자유 입력 칩 + /api/suggest 자동완성(표준 목록 없이, 쓴 값을 다시 제안).
 * 키보드: ↑/↓ 로 후보 이동, Enter 로 고름, Escape 로 닫음.
 * compact: 평소에는 칩만 보이고 끝의 + 단추로 입력칸을 연다(Esc·바깥으로 나가면 닫힌다).
 * chipHref(v): 칩을 링크로(호선 → 호선 화면). mono: 호선처럼 숫자 값.
 */
export default function ChipInput({ label, kind, values, onChange, validate, placeholder = '입력 후 Enter', disabled = false,
                                    compact = false, chipHref, mono = false }) {
  const [text, setText] = useState('');
  const [options, setOptions] = useState([]);
  const [error, setError] = useState('');
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(!compact);
  const listId = useId();
  const requestRef = useRef(0);
  const inputRef = useRef(null);
  const boxRef = useRef(null);
  const openBtnRef = useRef(null);
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

  useEffect(() => { if (compact && open) inputRef.current?.focus(); }, [compact, open]);

  function add(raw) {
    const v = raw.trim();
    if (!v || values.includes(v)) { setText(''); return true; }
    const verdict = validate ? validate(v) : true;
    if (verdict !== true) { setError(verdict); return false; }
    setError('');
    setText('');
    showOptions([]);
    onChange([...values, v]);
    return true;
  }
  function closeEditor({ focusButton = false } = {}) {
    if (!compact) return;
    setOpen(false); setError(''); setText(''); showOptions([]);
    if (focusButton) setTimeout(() => openBtnRef.current?.focus(), 0);
  }

  const chipLabel = (v) => (chipHref
    ? <Link to={chipHref(v)} className="rounded-xs hover:underline">{v}</Link>
    : <span className="truncate">{v}</span>);

  // compact 읽기 상태 — 칩 + 고치기 단추
  if (compact && !open) {
    return (
      <div className="flex min-h-7 flex-wrap items-center gap-1">
        {values.map((v) => (
          <span key={v} className={`${chipBase} ${toneOf(mono)} ${chipHref ? `transition-colors duration-150 ${mono ? 'hover:bg-navy-700' : 'hover:bg-n-150'}` : ''}`}>{chipLabel(v)}</span>
        ))}
        {!disabled && (
          <button ref={openBtnRef} type="button" aria-label={`${label} 고치기`} title="추가하거나 빼기" onClick={() => setOpen(true)}
                  className={`inline-flex h-6 min-w-6 items-center justify-center gap-1 rounded-sm px-1 text-meta text-n-500 ${values.length === 0 ? '-ml-1' : ''} transition-colors duration-150 ease-out hover:bg-n-100 hover:text-n-900 active:bg-n-150`}>
            <Plus size={14} aria-hidden="true" />{values.length === 0 && <span>추가</span>}
          </button>
        )}
        {disabled && values.length === 0 && <span className="text-ui text-n-500">—</span>}
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative"
         onBlur={(e) => {
           if (!compact || boxRef.current?.contains(e.relatedTarget)) return;
           // 칸을 벗어나면: 적던 값이 있으면 더하고, 틀렸으면 열어 둔다.
           if (text.trim() && !add(text)) return;
           closeEditor();
         }}>
      <div className={`field flex min-h-8 flex-wrap items-center gap-1 rounded-md border bg-n-0 px-1 py-[3px] shadow-xs transition-[border-color,box-shadow] duration-150 ease-out
                       ${disabled ? 'border-n-200 bg-n-50' : 'border-n-250 hover:border-n-300'}`}>
        {values.map((v) => (
          <span key={v} className={`${chipBase} ${toneOf(mono)} ${disabled ? '' : 'pr-1'}`}>
            {chipLabel(v)}
            {!disabled && (
              <button type="button" aria-label={`${v} 빼기`} onClick={() => onChange(values.filter((x) => x !== v))}
                      className={`flex h-4 w-4 items-center justify-center rounded-xs transition-colors duration-150 ${mono
                        ? 'text-on-navy-muted hover:bg-navy-700 hover:text-on-navy' : 'text-n-500 hover:bg-n-150 hover:text-n-900'}`}>
                <X size={12} aria-hidden="true" />
              </button>
            )}
          </span>
        ))}
        <input ref={inputRef} role="combobox" aria-label={label} aria-expanded={options.length > 0} aria-controls={listId}
               aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
               aria-invalid={error ? true : undefined}
               disabled={disabled} value={text} placeholder={values.length ? '' : placeholder}
               onChange={(e) => { setText(e.target.value); setError(''); }}
               onKeyDown={(e) => {
                 if (e.key === 'ArrowDown' && options.length) { e.preventDefault(); setActive((i) => Math.min(i + 1, options.length - 1)); return; }
                 if (e.key === 'ArrowUp' && options.length) { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
                 if (e.key === 'Escape' && options.length) { e.preventDefault(); requestRef.current += 1; showOptions([]); return; }
                 if (e.key === 'Escape' && compact) { e.preventDefault(); closeEditor({ focusButton: true }); return; }
                 if (e.key === 'Enter' && active >= 0 && options[active]) { e.preventDefault(); add(options[active]); return; }
                 if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); }
                 if (e.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1));
               }}
               onBlur={() => { if (!compact && text.trim()) add(text); }}
               className={`h-6 min-w-20 flex-1 bg-transparent px-1 text-ui text-n-900 outline-none focus-visible:outline-none disabled:cursor-not-allowed disabled:text-n-500 ${mono ? 'font-mono' : ''}`} />
      </div>
      {options.length > 0 && (
        <ul id={listId} role="listbox"
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-48 animate-pop overflow-auto rounded-lg bg-n-0 py-1 shadow-md">
          {options.map((o, i) => (
            <li key={o} id={`${listId}-opt-${i}`} role="option" aria-selected={i === active} tabIndex={-1}
                onMouseDown={(e) => { e.preventDefault(); add(o); }} onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-2.5 py-1 text-ui ${i === active ? 'bg-brand-subtle text-brand' : 'text-n-800'}`}>{o}</li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-1 text-meta text-err">{error}</p>}
    </div>
  );
}
