import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';

/** 눌러서 고치는 글자 칸(설계 §6.4 — Notion 식 인라인 편집). Enter·blur 저장, Escape 취소. */
export default function InlineText({ label, value, onSave, multiline = false, placeholder = '—', className = '',
                                     validate, disabled = false }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value || '');
  const [err, setErr] = useState('');
  const ref = useRef(null);
  // Enter 로 저장한 직후 입력칸이 사라지며 blur 가 한 번 더 와도 두 번 저장하지 않게 한다.
  const editingRef = useRef(false);
  useEffect(() => { if (!editing) setText(value || ''); }, [value, editing]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

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
    if ((await onSave(next)) === false) {
      editingRef.current = true;
      setEditing(true);
      setText(next);
    }
  }
  function onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); setText(value || ''); setErr(''); stop(); }
    if (e.key === 'Enter' && (!multiline || e.ctrlKey)) { e.preventDefault(); commit(); }
  }

  if (!editing) {
    return (
      <span className={`group inline-flex items-center gap-1 ${className}`}>
        <span className={value ? '' : 'text-zinc-400'}>{value || placeholder}</span>
        {!disabled && (
          <button type="button" aria-label={`${label} 고치기`} onClick={start}
                  className="rounded p-0.5 text-zinc-400 opacity-0 hover:bg-zinc-100 hover:text-brand focus:opacity-100 group-hover:opacity-100">
            <Pencil size={13} aria-hidden="true" />
          </button>
        )}
      </span>
    );
  }
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <span className="inline-flex w-full max-w-xl flex-col">
      <Tag ref={ref} aria-label={label} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={onKeyDown}
           rows={multiline ? 3 : undefined} aria-invalid={err ? true : undefined}
           className={`rounded-md border border-brand bg-white px-2 py-1 text-zinc-900 outline-none ring-3 ring-brand-ring ${className}`} />
      {err && <span role="alert" className="mt-0.5 text-xs text-err">{err}</span>}
      {multiline && <span className="mt-0.5 text-[11px] text-zinc-500">Ctrl+Enter 로 저장, Esc 로 취소</span>}
    </span>
  );
}
