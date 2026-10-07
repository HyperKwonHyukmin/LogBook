import { useEffect, useId, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';

/**
 * 눌러서 고치는 글자 칸("조용한 필드"). 읽기 상태의 값 자체가 단추라 키보드로도 들어간다.
 * Enter·blur 저장, Escape 취소. multiline 은 Ctrl+Enter 저장.
 * placeholder: 빈 값일 때 읽기 상태에 보이는 글자. inputPlaceholder: 편집 중 형식 힌트(YYYY-MM 등).
 */
export default function InlineText({ label, value, onSave, multiline = false, placeholder, inputPlaceholder,
                                     className = '', validate, disabled = false, mono = false }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value || '');
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const ref = useRef(null);
  const valueId = useId();
  // Enter 로 저장한 직후 입력칸이 사라지며 blur 가 한 번 더 와도 두 번 저장하지 않게 한다.
  const editingRef = useRef(false);
  const savedTimer = useRef(null);
  useEffect(() => { if (!editing) setText(value || ''); }, [value, editing]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);
  useEffect(() => () => clearTimeout(savedTimer.current), []);

  function start() { editingRef.current = true; setEditing(true); }
  function stop() { editingRef.current = false; setEditing(false); }

  async function commit() {
    if (!editingRef.current) return;
    const next = text.trim();
    if (next === (value || '').trim()) { stop(); setErr(''); return; }
    const bad = validate?.(next);
    if (bad) { setErr(bad); return; }
    setErr('');
    stop();
    // 저장이 실패(false)하면 입력칸과 입력한 글자를 되살려 다시 시도할 수 있게 한다.
    // ('conflict' 는 남이 고친 최신 값을 보여 주는 것이 먼저라 되살리지 않는다.)
    const result = await onSave(next);
    if (result === false) {
      editingRef.current = true;
      setEditing(true);
      setText(next);
    } else if (result === true) {
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 1500);
    }
  }
  function onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); setText(value || ''); setErr(''); stop(); }
    if (e.key === 'Enter' && (!multiline || e.ctrlKey)) { e.preventDefault(); commit(); }
  }

  const monoCls = mono ? 'font-mono' : '';
  if (!editing) {
    const shown = value || (disabled ? '—' : placeholder || '추가');
    if (disabled) {
      return <span className={`${value ? '' : 'text-n-500'} ${monoCls} ${className}`}>{value || placeholder || '—'}</span>;
    }
    return (
      <span className="inline-flex max-w-full items-center gap-2">
        <button type="button" aria-label={`${label} 고치기`} aria-describedby={valueId} onClick={start}
                className={`group -mx-1.5 inline-flex min-h-7 min-w-0 cursor-text items-center gap-1.5 rounded-md px-1.5 text-left
                  transition-colors duration-150 ease-out hover:bg-n-100 active:bg-n-150 ${className}`}>
          <span id={valueId} className={`min-w-0 ${multiline ? 'whitespace-pre-wrap' : ''} ${value ? '' : 'text-n-500'} ${value ? monoCls : ''}`}>{shown}</span>
          <Pencil size={12} aria-hidden="true" className="shrink-0 text-n-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
        </button>
        {saved && <span role="status" className="animate-fade text-meta font-normal tracking-normal text-n-500">저장됨</span>}
      </span>
    );
  }
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <span className="-mx-1.5 inline-flex w-[calc(100%+12px)] max-w-2xl flex-col">
      <Tag ref={ref} aria-label={label} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={onKeyDown}
           rows={multiline ? 3 : undefined} aria-invalid={err ? true : undefined} placeholder={inputPlaceholder}
           className={`field rounded-md border border-brand bg-n-0 px-1.5 text-n-900 outline-none focus-visible:outline-none
             ${multiline ? 'py-1' : 'min-h-7'} ${monoCls} ${className}`} />
      {err && <span role="alert" className="mt-1 text-meta font-normal tracking-normal text-err">{err}</span>}
      {multiline && <span className="mt-1 text-meta font-normal tracking-normal text-n-500">Ctrl+Enter 로 저장, Esc 로 취소</span>}
    </span>
  );
}
