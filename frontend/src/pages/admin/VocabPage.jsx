import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Merge, Plus, X } from 'lucide-react';
import { api } from '../../api/client.js';
import Button, { buttonClass } from '../../components/ui/Button.jsx';
import { inputClass, selectClass } from '../../components/ui/Field.jsx';
import InlineText from '../../components/ui/InlineText.jsx';
import { ErrorNote, OkNote, Page, PageHeader, SectionTitle } from '../../components/ui/Page.jsx';
import { RowsSkeleton } from '../../components/ui/Skeleton.jsx';
import { Segmented } from '../../components/ui/Tabs.jsx';
import { errorText } from '../../lib/labels.js';
import { VOCAB_KINDS, invalidateVocab } from '../../lib/vocab.js';

const TERM_COLS = 'grid grid-cols-[56px_minmax(140px,220px)_minmax(0,1fr)_56px_96px] items-center gap-3';
const OUT_COLS = 'grid grid-cols-[minmax(0,1fr)_56px_minmax(260px,auto)] items-center gap-3';
const KIND_NAME = Object.fromEntries(VOCAB_KINDS.map((k) => [k.id, k.label]));

/** 동의어 더하기 — 짧은 입력칸, Enter 로 더한다. */
function SynonymAdd({ term, onAdd, busy }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label={`${term.value} 동의어 추가`}
              className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-meta text-n-500 transition-colors duration-150 hover:bg-n-100 hover:text-n-900">
        <Plus size={12} aria-hidden="true" />동의어
      </button>
    );
  }
  async function submit() {
    if (!text.trim()) { setOpen(false); return; }
    if (await onAdd(term, text.trim())) { setText(''); setOpen(false); }
  }
  return (
    <input autoFocus aria-label={`${term.value} 의 새 동의어`} value={text} disabled={busy} placeholder="동의어 입력 후 Enter"
           onChange={(e) => setText(e.target.value)} onBlur={() => { if (!text.trim()) setOpen(false); }}
           onKeyDown={(e) => {
             if (e.key === 'Enter') { e.preventDefault(); submit(); }
             if (e.key === 'Escape') { e.preventDefault(); setText(''); setOpen(false); }
           }}
           className={inputClass('h-6 w-36 px-1.5 text-meta')} />
  );
}

function TermRow({ term, index, last, busy, onMove, onRename, onToggle, onAddSynonym, onRemoveSynonym }) {
  return (
    <li className={`${TERM_COLS} min-h-11 border-b border-n-200 px-3 py-1.5 text-ui last:border-0 ${term.active ? '' : 'bg-n-25'}`}>
      <span className="flex gap-0.5">
        <button type="button" aria-label={`${term.value} 위로`} disabled={busy || index === 0} onClick={() => onMove(index, -1)}
                className={buttonClass('ghost', 'icon-sm', `h-6 w-6 ${index === 0 ? 'invisible' : ''}`)}><ArrowUp size={14} aria-hidden="true" /></button>
        <button type="button" aria-label={`${term.value} 아래로`} disabled={busy || last} onClick={() => onMove(index, 1)}
                className={buttonClass('ghost', 'icon-sm', `h-6 w-6 ${last ? 'invisible' : ''}`)}><ArrowDown size={14} aria-hidden="true" /></button>
      </span>
      <span className={`min-w-0 font-medium ${term.active ? 'text-n-900' : 'text-n-500'}`}>
        <InlineText label={`${term.value} 이름`} value={term.value} onSave={(v) => onRename(term, v)}
                    validate={(v) => (!v ? '이름을 입력해 주세요.' : '')} />
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-1">
        {term.synonyms.map((s) => (
          <span key={s.id} className="inline-flex h-6 items-center gap-1 whitespace-pre rounded-sm bg-n-100 pl-2 pr-1 text-meta text-n-700">
            {s.value}
            <button type="button" aria-label={`동의어 ${s.value} 빼기`} disabled={busy} onClick={() => onRemoveSynonym(s)}
                    className="flex h-4 w-4 items-center justify-center rounded-xs text-n-500 transition-colors duration-150 hover:bg-n-150 hover:text-n-900">
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
        <SynonymAdd term={term} onAdd={onAddSynonym} busy={busy} />
      </span>
      <span className="text-right font-mono text-meta text-n-600" title="쓰인 Entry 수(동의어 포함)">{term.count}</span>
      <span className="flex justify-end">
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onToggle(term)}
                aria-label={`${term.value} ${term.active ? '사용 중지' : '다시 사용'}`}>
          {term.active ? '사용 중지' : '다시 사용'}
        </Button>
      </span>
    </li>
  );
}

function OutsideRow({ row, terms, busy, onMerge, onPromote }) {
  const [target, setTarget] = useState('');
  const term = terms.find((t) => String(t.id) === target);
  return (
    <li className={`${OUT_COLS} min-h-10 border-b border-n-200 px-3 py-1 text-ui last:border-0`}>
      <span className="truncate text-n-900">{row.value}</span>
      <span className="text-right font-mono text-meta text-n-600" title="쓰인 Entry 수">{row.count}</span>
      <span className="flex items-center justify-end gap-1.5">
        <select aria-label={`${row.value} 합칠 용어`} value={target} onChange={(e) => setTarget(e.target.value)} className={selectClass('h-7 text-meta')}>
          <option value="">합칠 용어 고르기…</option>
          {terms.map((t) => <option key={t.id} value={t.id}>{t.value}</option>)}
        </select>
        <Button size="sm" disabled={!term || busy} onClick={() => onMerge(row, term)}>
          <Merge size={14} aria-hidden="true" />{term ? `${term.value} 로 합치기` : '합치기'}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onPromote(row)}>용어로 추가</Button>
      </span>
    </li>
  );
}

/** 분류 목록(관리자, 08) — 해석 종류·구역의 용어·동의어·순서·사용 여부, 목록 밖 값 합치기. 모든 변경은 기록된다. */
export default function VocabPage() {
  const [kind, setKind] = useState('atype');
  const [terms, setTerms] = useState(null);
  const [outside, setOutside] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [newTerm, setNewTerm] = useState('');
  const reqRef = useRef(0);

  const load = useCallback(() => {
    const id = ++reqRef.current; // 탭을 빨리 바꿔도 마지막 탭 것만 쓴다
    return Promise.all([api(`/vocab?kind=${kind}`), api(`/vocab/unlisted?kind=${kind}`)])
      .then(([v, u]) => { if (id === reqRef.current) { setTerms(v.terms); setOutside(u); } })
      .catch((err) => { if (id === reqRef.current) setError(errorText(err, '목록을 불러오지 못했습니다.')); });
  }, [kind]);
  useEffect(() => { setTerms(null); setOutside(null); setError(''); setNotice(''); load(); }, [load]);

  /** 바꾸고 다시 읽는다. 성공하면 true(입력칸이 닫히게). */
  async function act(fn, done) {
    setError(''); setNotice(''); setBusy(true);
    try {
      const r = await fn();
      invalidateVocab(kind);
      await load();
      if (done) setNotice(done(r));
      return true;
    } catch (err) {
      setError(errorText(err, '처리하지 못했습니다.'));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const changed = (r) => (r?.entries?.length ? ` Entry ${r.entries.length}건의 값을 바꿨습니다.` : '');

  const addTerm = () => newTerm.trim() && act(() => api('/vocab/terms', { method: 'POST', body: { kind, value: newTerm.trim() } }),
    (t) => { setNewTerm(''); return `‘${t.value}’ 를 목록에 추가했습니다.`; });
  const rename = (t, value) => act(() => api(`/vocab/terms/${t.id}`, { method: 'PATCH', body: { value } }),
    () => `‘${t.value}’ 를 ‘${value}’ 로 바꿨습니다. 옛 이름은 동의어로 남습니다.`);
  const toggle = (t) => act(() => api(`/vocab/terms/${t.id}`, { method: 'PATCH', body: { active: !t.active } }),
    () => (t.active ? `‘${t.value}’ 는 이제 입력 목록에 보이지 않습니다. 이미 쓴 값과 검색은 그대로입니다.` : `‘${t.value}’ 를 다시 씁니다.`));
  function move(i, d) {
    const ids = terms.map((t) => t.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    return act(() => api('/vocab/reorder', { method: 'POST', body: { kind, ids } }));
  }
  const addSynonym = (t, value) => act(() => api(`/vocab/terms/${t.id}/synonyms`, { method: 'POST', body: { value } }),
    (r) => `‘${value}’ 를 ‘${t.value}’ 의 동의어로 등록했습니다.${changed(r)}`);
  const removeSynonym = (s) => act(() => api(`/vocab/synonyms/${s.id}`, { method: 'DELETE' }), () => `동의어 ‘${s.value}’ 를 뺐습니다.`);
  const merge = (row, t) => act(() => api(`/vocab/terms/${t.id}/merge`, { method: 'POST', body: { value: row.value } }),
    (r) => `‘${row.value}’ 를 ‘${t.value}’ 로 합쳤습니다.${changed(r)}`);
  const promote = (row) => act(() => api('/vocab/terms', { method: 'POST', body: { kind, value: row.value } }),
    () => `‘${row.value}’ 를 목록에 추가했습니다.`);

  const name = KIND_NAME[kind];
  return (
    <Page>
      <PageHeader title="분류 목록"
                  description="해석 종류와 구역은 이 목록에서만 고릅니다. 동의어로 입력해도 대표 용어로 저장되고, 검색·필터에서 함께 찾습니다." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented role="tablist" label="분류 종류" items={VOCAB_KINDS} value={kind}
                   onChange={(k) => { if (k !== kind) setKind(k); }} />
      </div>
      {error && <ErrorNote className="mb-4 max-w-[960px]">{error}</ErrorNote>}
      {notice && <OkNote className="mb-4 max-w-[960px]">{notice}</OkNote>}

      <section aria-label={`${name} 용어`} className="max-w-[960px]">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <SectionTitle>{name} 용어 {terms && <span className="font-mono font-normal text-n-500">{terms.length}</span>}</SectionTitle>
          <form className="ml-auto flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); addTerm(); }}>
            <input aria-label={`새 ${name} 용어`} value={newTerm} onChange={(e) => setNewTerm(e.target.value)} placeholder="새 용어"
                   className={inputClass('h-7 w-44 text-meta')} />
            <Button size="sm" variant="secondary" type="submit" disabled={busy || !newTerm.trim()}><Plus size={14} aria-hidden="true" />추가</Button>
          </form>
        </div>
        <div className="overflow-hidden rounded-lg border border-n-200">
          <div className={`${TERM_COLS} h-9 border-b border-n-200 bg-n-50 px-3 text-meta font-medium text-n-600`}>
            <span>순서</span><span>용어</span><span>동의어</span><span className="text-right">사용</span><span />
          </div>
          {!terms && !error && <RowsSkeleton rows={5} dense label="용어를 불러오는 중" />}
          {terms?.length === 0 && <p className="py-8 text-center text-ui text-n-500">용어가 없습니다. 위에서 추가하세요.</p>}
          {terms?.length > 0 && (
            <ul>
              {terms.map((t, i) => (
                <TermRow key={t.id} term={t} index={i} last={i === terms.length - 1} busy={busy} onMove={move}
                         onRename={rename} onToggle={toggle} onAddSynonym={addSynonym} onRemoveSynonym={removeSynonym} />
              ))}
            </ul>
          )}
        </div>
        <p className="mt-2 text-meta text-n-500">‘기타’ 는 늘 끝에 둡니다. 사용 중지한 용어는 입력 목록에서만 빠지고, 이미 쓴 값과 검색은 그대로입니다.</p>
      </section>

      <section aria-label="목록 밖 값" className="mt-8 max-w-[960px]">
        <div className="mb-2 flex items-baseline gap-2">
          <SectionTitle>목록 밖 값 {outside && <span className="font-mono font-normal text-n-500">{outside.length}</span>}</SectionTitle>
          <span className="text-meta text-n-500">데이터에 있지만 어떤 용어로도 맞춰지지 않는 값. 합치면 Entry 값을 바꾸고 그 값을 동의어로 남깁니다.</span>
        </div>
        <div className="overflow-hidden rounded-lg border border-n-200">
          <div className={`${OUT_COLS} h-9 border-b border-n-200 bg-n-50 px-3 text-meta font-medium text-n-600`}>
            <span>값</span><span className="text-right">사용</span><span />
          </div>
          {!outside && !error && <RowsSkeleton rows={3} dense label="목록 밖 값을 불러오는 중" />}
          {outside?.length === 0 && <p className="py-8 text-center text-ui text-n-500">목록 밖 값이 없습니다.</p>}
          {outside?.length > 0 && (
            <ul>
              {outside.map((row) => (
                <OutsideRow key={row.value} row={row} terms={terms || []} busy={busy} onMerge={merge} onPromote={promote} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </Page>
  );
}
