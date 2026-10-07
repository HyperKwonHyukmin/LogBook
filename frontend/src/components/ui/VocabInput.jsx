import { useContext, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { AuthContext } from '../../auth/AuthContext.jsx';
import { errorText } from '../../lib/labels.js';
import { OTHER_TERM, invalidateVocab, isListed, loadVocab, matchTerms, resolveTerm, vocabKey } from '../../lib/vocab.js';

const chipBase = 'inline-flex h-6 max-w-full items-center gap-1 rounded-sm bg-n-100 text-meta text-n-700';
const outsideNote = '목록 밖 값 — 관리자가 분류 목록에서 합칠 수 있습니다';

/** 종류별 목록을 한 번 받아 둔다(같은 화면의 여러 칸이 공유). */
function useTerms(kind) {
  const [terms, setTerms] = useState([]);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    let alive = true;
    loadVocab(kind).then((t) => { if (alive) setTerms(t); }, () => {});
    return () => { alive = false; };
  }, [kind, rev]);
  return [terms, () => { invalidateVocab(kind); setRev((n) => n + 1); }];
}

/**
 * 분류 목록에서 고르는 입력(08 — 해석 종류 = 하나, 구역 = 여러 칩).
 * - 목록 용어만 고른다. 동의어·표기 변형을 치면 그 용어가 후보로 뜬다('FEM 해석 → FE 해석').
 * - 목록에 없으면 일반 사용자는 '기타' 를, 관리자는 그 자리에서 용어로 추가할 수 있다.
 * - 이미 저장된 목록 밖 값은 그대로 보이고(흐린 표시) 빼거나 바꿀 수 있다.
 * single: value / onChange(값|null). multiple: values / onChange(배열).
 * compact: 평소에는 값만 보이고 눌러서 고친다(Entry 상세 속성 레일).
 */
export default function VocabInput({ kind, label, value = null, values = [], multiple = false, onChange,
                                     disabled = false, compact = false, placeholder = '목록에서 고르기' }) {
  const isAdmin = !!useContext(AuthContext)?.user?.is_admin;
  const [terms, reload] = useTerms(kind);
  const [editing, setEditing] = useState(!compact);
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(-1);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const listId = useId();
  const inputRef = useRef(null);
  const boxRef = useRef(null);
  const openBtnRef = useRef(null);

  useEffect(() => { if (compact && editing) inputRef.current?.focus(); }, [compact, editing]);

  const chosen = multiple ? values : (value ? [value] : []);
  const typed = text.trim();
  const matches = matchTerms(terms, typed, multiple ? values : []);
  const exact = resolveTerm(terms, typed);
  const other = terms.find((t) => t.value === OTHER_TERM && t.active !== false);
  const options = matches.map((m) => ({ type: 'term', value: m.term.value, via: m.via }));
  const noMatch = typed && !exact;
  if (noMatch && isAdmin) options.push({ type: 'add', value: typed });
  if (noMatch && !isAdmin && matches.length === 0 && other && !chosen.includes(other.value)) {
    options.push({ type: 'term', value: other.value, via: null, fallback: true });
  }
  const listOpen = focused && !disabled && options.length > 0;
  // 입력하면 첫 '용어' 후보를 강조한다(Enter 로 고름). '목록에 추가'는 실수로 용어가 생기지 않게 직접 골라야 한다.
  const current = active >= 0 ? active : (typed && options[0]?.type === 'term' ? 0 : -1);

  function reset() { setText(''); setActive(-1); }
  function close({ focusButton = false } = {}) {
    reset(); setFocused(false); setError('');
    if (compact) {
      setEditing(false);
      if (focusButton) setTimeout(() => openBtnRef.current?.focus(), 0);
    }
  }
  function commit(v) {
    setError('');
    reset();
    if (multiple) {
      if (!values.some((x) => vocabKey(x) === vocabKey(v))) onChange([...values, v]);
      return;
    }
    if (v !== value) onChange(v);
    if (compact) close({ focusButton: true });
    else { setFocused(false); inputRef.current?.blur(); }
  }
  async function choose(opt) {
    if (opt.type !== 'add') { commit(opt.value); return; }
    setAdding(true);
    try {
      const t = await api('/vocab/terms', { method: 'POST', body: { kind, value: opt.value } });
      reload();
      commit(t.value);
    } catch (err) {
      setError(errorText(err, '목록에 추가하지 못했습니다.'));
    } finally {
      setAdding(false);
    }
  }
  function onKeyDown(e) {
    if (e.key === 'ArrowDown' && options.length) { e.preventDefault(); setActive(Math.min(current + 1, options.length - 1)); return; }
    if (e.key === 'ArrowUp' && options.length) { e.preventDefault(); setActive(Math.max(current - 1, 0)); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (typed) { reset(); return; }
      if (compact) close({ focusButton: true }); else inputRef.current?.blur();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (current >= 0 && options[current]) { choose(options[current]); return; }
      if (exact) { commit(exact.value); return; }
      if (options.length === 1 && options[0].type === 'term') { choose(options[0]); return; }
      if (typed) setError(isAdmin ? '후보에서 고르거나 ‘목록에 추가’를 누르세요.' : '목록에 없는 값입니다. ‘기타’를 고르거나 관리자에게 용어 추가를 요청해 주세요.');
      return;
    }
    if (e.key === 'Backspace' && multiple && !text && values.length) onChange(values.slice(0, -1));
  }

  const outside = (v) => terms.length > 0 && !isListed(terms, v);

  // compact 읽기 상태 — 값(또는 칩) + 고치기 단추
  if (compact && !editing) {
    const empty = chosen.length === 0;
    return (
      <div className="flex min-h-7 min-w-0 flex-wrap items-center gap-1">
        {multiple ? chosen.map((v) => (
          <span key={v} title={outside(v) ? outsideNote : undefined}
                className={`${chipBase} px-2 ${outside(v) ? 'text-n-500' : ''}`}>{v}</span>
        )) : !empty && (
          <span title={outside(value) ? outsideNote : undefined}
                className={`min-w-0 truncate text-ui ${outside(value) ? 'text-n-600' : 'text-n-900'}`}>{value}</span>
        )}
        {!disabled && (
          <button ref={openBtnRef} type="button" aria-label={`${label} 고치기`} title="목록에서 고르기" onClick={() => setEditing(true)}
                  className={`inline-flex h-6 min-w-6 items-center justify-center gap-1 rounded-sm px-1 text-meta text-n-500 ${empty ? '-ml-1' : ''} transition-colors duration-150 ease-out hover:bg-n-100 hover:text-n-900 active:bg-n-150`}>
            {multiple || empty ? <Plus size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            {empty && <span>추가</span>}
          </button>
        )}
        {disabled && empty && <span className="text-ui text-n-500">—</span>}
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative min-w-0"
         onBlur={(e) => {
           if (boxRef.current?.contains(e.relatedTarget)) return;
           if (compact) close(); else { reset(); setFocused(false); }
         }}>
      <div className={`field flex min-h-8 flex-wrap items-center gap-1 rounded-md border bg-n-0 px-1 py-[3px] shadow-xs transition-[border-color,box-shadow] duration-150 ease-out
                       ${disabled ? 'border-n-200 bg-n-50' : 'border-n-250 hover:border-n-300'}`}>
        {multiple && values.map((v) => (
          <span key={v} title={outside(v) ? outsideNote : undefined} className={`${chipBase} pl-2 ${disabled ? 'pr-2' : 'pr-1'} ${outside(v) ? 'text-n-500' : ''}`}>
            <span className="truncate">{v}</span>
            {!disabled && (
              <button type="button" aria-label={`${v} 빼기`} onClick={() => onChange(values.filter((x) => x !== v))}
                      className="flex h-4 w-4 items-center justify-center rounded-xs text-n-500 transition-colors duration-150 hover:bg-n-150 hover:text-n-900">
                <X size={12} aria-hidden="true" />
              </button>
            )}
          </span>
        ))}
        <input ref={inputRef} role="combobox" aria-label={label} aria-expanded={listOpen} aria-controls={listId}
               aria-autocomplete="list" aria-activedescendant={listOpen && current >= 0 ? `${listId}-opt-${current}` : undefined}
               aria-invalid={error ? true : undefined} disabled={disabled || adding}
               value={multiple || focused ? text : (value || '')}
               placeholder={multiple ? (values.length ? '' : placeholder) : (value || placeholder)}
               onFocus={() => { setFocused(true); setText(''); setActive(-1); }}
               onChange={(e) => { setText(e.target.value); setError(''); setActive(-1); }}
               onKeyDown={onKeyDown}
               className={`h-6 min-w-20 flex-1 bg-transparent px-1.5 text-ui outline-none placeholder:text-n-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:text-n-500
                 ${!multiple && !focused && value && outside(value) ? 'text-n-600' : 'text-n-900'}`} />
        {!multiple && value && !disabled && (
          <button type="button" aria-label={`${label} 지우기`} onClick={() => onChange(null)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-xs text-n-500 transition-colors duration-150 hover:bg-n-100 hover:text-n-900">
            <X size={12} aria-hidden="true" />
          </button>
        )}
        {!multiple && <ChevronDown size={14} aria-hidden="true" className="mr-1 shrink-0 text-n-400" />}
      </div>
      {listOpen && (
        <ul id={listId} role="listbox" aria-label={`${label} 후보`}
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-60 min-w-48 animate-pop overflow-auto rounded-lg bg-n-0 py-1 shadow-md">
          {noMatch && !isAdmin && matches.length === 0 && (
            <li role="presentation" className="px-2.5 pb-1 pt-0.5 text-meta text-n-500">목록에 없는 값입니다. 아래에서 고르세요.</li>
          )}
          {options.map((o, i) => (
            <li key={`${o.type}:${o.value}`} id={`${listId}-opt-${i}`} role="option" aria-selected={i === current} tabIndex={-1}
                onMouseDown={(e) => { e.preventDefault(); choose(o); }} onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-2 px-2.5 py-1 text-ui ${i === current ? 'bg-brand-subtle text-brand' : 'text-n-800'}`}>
              {o.type === 'add' ? (
                <><Plus size={14} aria-hidden="true" className="shrink-0" /><span className="min-w-0 truncate">‘{o.value}’ 목록에 추가</span></>
              ) : (
                <>
                  <span className="min-w-0 truncate">{o.value}</span>
                  {o.via && <span className="ml-auto shrink-0 text-meta text-n-500">{o.via} 의 대표 용어</span>}
                  {o.value === (multiple ? null : value) && <span className="ml-auto shrink-0 text-meta text-n-500">현재 값</span>}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-1 text-meta text-err">{error}</p>}
    </div>
  );
}
