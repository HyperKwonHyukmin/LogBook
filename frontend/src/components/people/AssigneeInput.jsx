import { useContext, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, UserPlus, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { AuthContext } from '../../auth/AuthContext.jsx';
import Button from '../ui/Button.jsx';
import { inputClass } from '../ui/Field.jsx';
import { errorText } from '../../lib/labels.js';
import { personKey } from '../../lib/entryEdit.js';
import { canWriteShared } from '../../lib/levels.js';
import { writeSearch } from '../../lib/search.js';

/**
 * 46 — 담당자(과제를 한 사람). 올린 사람(작성자)과 따로 둔다. 여러 명, 첫 사람이 주 담당자.
 * 고르기: WorkBench 사용자·담당자 명부에서 찾기, 없으면 [직접 입력](이름·부서·직책·재직)으로 명부에 만든다.
 * 명부 고치기(연필, LV2 이상)는 바로 저장된다 — 그 사람이 담당인 모든 자료에 함께 보인다.
 */

const meta = (p) => [p.department, p.position].filter(Boolean).join(' · ');

export function RetiredBadge({ person }) {
  if (person.employed !== false) return null;
  return <span className="ml-1.5 rounded-xs bg-n-100 px-1 text-micro font-medium text-n-600">퇴사</span>;
}

/** 읽기 화면 — 이름(누르면 그 담당자의 자료 검색, 46)·부서·직책·퇴사 표시. */
export function AssigneeList({ people }) {
  if (!people?.length) return <span className="text-n-500">—</span>;
  return (
    <ul aria-label="담당자" className="flex min-w-0 flex-col gap-0.5">
      {people.map((p, i) => (
        <li key={personKey(p)} className="min-w-0">
          <span className="block truncate" title={p.employee_id || undefined}>
            <Link to={p.id ? `/?${writeSearch({ filters: { assignee: [String(p.id)] } })}` : `/?${writeSearch({ q: p.name })}`}
                  title={`담당자 ‘${p.name}’ 의 자료`} className="hover:underline">{p.name}</Link>
            <RetiredBadge person={p} />
            {people.length > 1 && i === 0 && <span className="ml-1.5 text-micro text-n-500">주</span>}
          </span>
          {meta(p) && <span className="block truncate text-meta text-n-500">{meta(p)}</span>}
        </li>
      ))}
    </ul>
  );
}

/** 이름·부서·직책·재직 칸(직접 입력·명부 고치기 공용). */
function PersonForm({ initial, submitLabel, busy, error, onSubmit, onCancel, note }) {
  const [v, setV] = useState(() => ({ name: initial?.name || '', department: initial?.department || '',
    position: initial?.position || '', employed: initial?.employed !== false }));
  const set = (k) => (e) => setV((d) => ({ ...d, [k]: k === 'employed' ? e.target.checked : e.target.value }));
  const ok = v.name.trim().length > 0;
  function submit(e) {
    e.preventDefault();
    e.stopPropagation();
    if (ok && !busy) onSubmit({ name: v.name.trim(), department: v.department.trim() || null,
      position: v.position.trim() || null, employed: v.employed });
  }
  return (
    <div role="group" aria-label={submitLabel} className="flex flex-col gap-1.5 rounded-md border border-n-200 bg-n-25 p-2"
         onKeyDown={(e) => {
           if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') submit(e);
           // 자료 화면의 Esc(고치기 취소)까지 가지 않게 — 이 칸만 닫는다
           if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
         }}>
      <input aria-label="이름" placeholder="이름(필수)" value={v.name} onChange={set('name')} maxLength={50}
             className={inputClass('h-7 text-meta')} autoFocus />
      <div className="flex gap-1.5">
        <input aria-label="부서" placeholder="부서" value={v.department} onChange={set('department')} maxLength={100}
               className={inputClass('h-7 min-w-0 flex-1 text-meta')} />
        <input aria-label="직책" placeholder="직책" value={v.position} onChange={set('position')} maxLength={50}
               className={inputClass('h-7 w-20 text-meta')} />
      </div>
      <label className="inline-flex w-fit items-center gap-1.5 text-meta text-n-700">
        <input type="checkbox" className="h-3.5 w-3.5 accent-brand" checked={v.employed} onChange={set('employed')} />
        재직 중
      </label>
      {note && <p className="text-micro text-n-500">{note}</p>}
      {error && <p role="alert" className="text-meta text-err">{error}</p>}
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>취소</Button>
        <Button size="sm" variant="primary" onClick={submit} disabled={!ok || busy} loading={busy}>{submitLabel}</Button>
      </div>
    </div>
  );
}

export default function AssigneeInput({ values, onChange, disabled = false, label = '담당자' }) {
  const user = useContext(AuthContext)?.user;   // 정리 대기 카드처럼 Provider 없이 그려져도 된다
  const canFix = canWriteShared(user);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [result, setResult] = useState({ term: null, rows: [], wbDown: false, failed: false });
  const [adding, setAdding] = useState(false);     // [직접 입력] 칸
  const [fixing, setFixing] = useState(null);      // 명부 고치는 사람의 열쇠
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const boxRef = useRef(null);
  const listId = useId();
  const list = values || [];
  const have = new Set(list.map(personKey));

  useEffect(() => {
    if (!open) return undefined;
    const term = q.trim();
    const id = ++seq.current;
    const t = setTimeout(() => {
      api(`/people?q=${encodeURIComponent(term)}`)
        .then((r) => { if (id === seq.current) setResult({ term, rows: r?.rows || [], wbDown: !!r?.wb_unavailable, failed: false }); })
        .catch(() => { if (id === seq.current) setResult({ term, rows: [], wbDown: false, failed: true }); });
    }, term ? 200 : 0);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const loading = open && result.term !== q.trim();
  const rows = loading ? [] : result.rows;

  function add(p) {
    if (!have.has(personKey(p))) onChange([...list, p]);
    setQ(''); setOpen(false);
  }
  const remove = (p) => onChange(list.filter((x) => personKey(x) !== personKey(p)));
  const toFirst = (p) => onChange([p, ...list.filter((x) => personKey(x) !== personKey(p))]);

  async function createPerson(body) {
    setBusy(true); setError('');
    try {
      const p = await api('/people', { method: 'POST', body });
      add(p);
      setAdding(false);
    } catch (err) {
      setError(errorText(err, '담당자를 만들지 못했습니다.'));
    } finally { setBusy(false); }
  }

  async function fixPerson(p, body) {
    setBusy(true); setError('');
    try {
      const saved = await api(`/people/${p.id}`, { method: 'PATCH', body });
      onChange(list.map((x) => (personKey(x) === personKey(p) ? saved : x)));
      setFixing(null);
    } catch (err) {
      setError(errorText(err, '명부를 고치지 못했습니다.'));
    } finally { setBusy(false); }
  }

  return (
    <div ref={boxRef} className="flex min-w-0 flex-col gap-1">
      {list.length > 0 && (
        <ul aria-label={`${label} 목록`} className="flex flex-col">
          {list.map((p, i) => (
            <li key={personKey(p)} className="flex flex-col">
              {fixing === personKey(p) ? (
                <PersonForm initial={p} submitLabel="명부 저장" busy={busy} error={error}
                            note="바로 저장됩니다 — 이 사람이 담당인 모든 자료에 함께 보입니다."
                            onSubmit={(body) => fixPerson(p, body)} onCancel={() => { setFixing(null); setError(''); }} />
              ) : (
                <div className="group flex min-h-7 items-center gap-1 text-ui">
                  <span className="min-w-0 flex-1" title={p.employee_id || '직접 입력'}>
                    <span className="block truncate">
                      {p.name}<RetiredBadge person={p} />
                      {i === 0 && list.length > 1 && <span className="ml-1.5 text-micro text-n-500">주</span>}
                    </span>
                    {meta(p) && <span className="block truncate text-meta text-n-500">{meta(p)}</span>}
                  </span>
                  {i > 0 && !disabled && (
                    <Button variant="ghost" size="sm" onClick={() => toFirst(p)} aria-label={`${p.name} 주 담당자로`}
                            className="px-1.5 text-micro">주로</Button>
                  )}
                  {canFix && p.id && !disabled && (
                    <Button variant="ghost" size="icon-sm" onClick={() => { setFixing(personKey(p)); setError(''); }}
                            aria-label={`${p.name} 명부 고치기`}><Pencil size={13} aria-hidden="true" /></Button>
                  )}
                  {!disabled && (
                    <Button variant="ghost" size="icon-sm" onClick={() => remove(p)} aria-label={`${p.name} 빼기`}>
                      <X size={14} aria-hidden="true" />
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (adding ? (
        <PersonForm submitLabel="만들어 넣기" busy={busy} error={error}
                    note="WorkBench 에 없는 사람(퇴사자 등)을 명부에 만듭니다."
                    onSubmit={createPerson} onCancel={() => { setAdding(false); setError(''); }} />
      ) : (
        <div className="relative">
          <label className="flex items-center gap-1.5">
            <UserPlus size={14} className="shrink-0 text-n-400" aria-hidden="true" />
            <input aria-label={`${label} 찾기`} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
                   onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
                   placeholder="이름·사번·부서로 찾기" aria-expanded={open} aria-controls={open ? listId : undefined}
                   className={inputClass('h-7 min-w-0 flex-1 text-meta')} />
          </label>
          {open && (
            <div id={listId} className="absolute left-0 right-0 top-full z-30 mt-1 animate-pop rounded-lg bg-n-0 shadow-md">
              <ul role="listbox" aria-label={`${label} 후보`} className="max-h-64 overflow-y-auto py-1">
                {rows.map((p) => {
                  const taken = have.has(personKey(p));
                  return (
                    <li key={personKey(p)} role="option" aria-selected={taken}>
                      <button type="button" disabled={taken} onClick={() => add(p)}
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ui text-n-800 hover:bg-n-50 disabled:cursor-default disabled:text-n-500">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{p.name}<RetiredBadge person={p} /></span>
                          <span className="block truncate text-meta text-n-500">
                            {p.employee_id && <span className="font-mono">{p.employee_id}</span>}
                            {p.employee_id && meta(p) && ' · '}{meta(p)}
                          </span>
                        </span>
                        <span className="shrink-0 text-micro text-n-500">{taken ? '넣음' : (p.id ? '명부' : 'WorkBench')}</span>
                      </button>
                    </li>
                  );
                })}
                {loading && <li className="px-3 py-2 text-meta text-n-500">불러오는 중…</li>}
                {!loading && result.failed && <li role="alert" className="px-3 py-2 text-meta text-err">목록을 읽지 못했습니다.</li>}
                {!loading && !result.failed && rows.length === 0 && <li className="px-3 py-2 text-meta text-n-500">찾는 사람이 없습니다.</li>}
                {!loading && result.wbDown && <li className="px-3 py-2 text-meta text-wait">WorkBench 사용자 표를 읽지 못해 명부에서만 찾았습니다.</li>}
              </ul>
              <div className="border-t border-n-200 px-3 py-2">
                <Button size="sm" variant="ghost" onClick={() => { setAdding(true); setOpen(false); setError(''); }}>
                  찾는 사람이 없으면 직접 입력
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
      {error && !adding && !fixing && <p role="alert" className="text-meta text-err">{error}</p>}
    </div>
  );
}
