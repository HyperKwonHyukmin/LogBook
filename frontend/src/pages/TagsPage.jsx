import { useCallback, useEffect, useRef, useState } from 'react';
import { Link2, Unlink } from 'lucide-react';
import { api } from '../api/client.js';
import Button from '../components/ui/Button.jsx';
import { errorText } from '../lib/labels.js';

const KINDS = [['zone', '구역'], ['free', '자유 태그']];

/** 대표 태그(alias_of 없음)를 이름순으로, 그 아래에 동의어를 묶는다. */
function groupsOf(tags) {
  const roots = tags.filter((t) => !t.alias_of).sort((a, b) => a.value.localeCompare(b.value, 'ko'));
  return roots.map((r) => ({ root: r, aliases: tags.filter((t) => t.alias_of?.id === r.id) }));
}

function RootRow({ group, roots, onAlias, busy }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const others = roots.filter((r) => r.id !== group.root.id);
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-[13px]">
      <span className="font-semibold text-zinc-900">{group.root.value}</span>
      <span className="font-mono text-xs text-zinc-500" title="사용 횟수">{group.root.count}</span>
      <div className="flex-1" />
      {open ? (
        <>
          <select aria-label="대표 태그" value={target} onChange={(e) => setTarget(e.target.value)}
                  className="h-7 rounded-md border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-brand focus:ring-3 focus:ring-brand-ring">
            <option value="">대표 태그 선택…</option>
            {others.map((r) => <option key={r.id} value={r.id}>{r.value}</option>)}
          </select>
          <Button size="sm" disabled={!target || busy} onClick={() => onAlias(group.root, Number(target))}>묶기</Button>
          <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setTarget(''); }}>취소</Button>
        </>
      ) : (
        others.length > 0 && <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><Link2 size={13} aria-hidden="true" />동의어로 묶기</Button>
      )}
    </div>
  );
}

/** 태그 화면(설계 §6.1 `/tags`) — 사용 횟수, 동의어 묶기·풀기. 누구나 할 수 있고 기록된다. */
export default function TagsPage() {
  const [kind, setKind] = useState('zone');
  const [tags, setTags] = useState(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reqRef = useRef(0);

  // 탭을 빨리 바꿔도 마지막 탭의 목록만 쓴다(늦게 온 옛 응답은 버린다).
  const load = useCallback(() => {
    const id = ++reqRef.current;
    return api(`/tags?kind=${kind}`).then((r) => { if (id === reqRef.current) setTags(r); })
      .catch((err) => { if (id === reqRef.current) setError(errorText(err, '태그를 불러오지 못했습니다.')); });
  }, [kind]);
  useEffect(() => { setTags(null); setError(''); load(); }, [load]);

  async function act(fn) {
    setError(''); setBusy(true);
    try { await fn(); await load(); } catch (err) { setError(errorText(err, '처리하지 못했습니다.')); } finally { setBusy(false); }
  }
  const alias = (tag, targetId) => act(() => api(`/tags/${tag.id}/alias`, { method: 'POST', body: { target_id: targetId } }));
  const unalias = (tag) => act(() => api(`/tags/${tag.id}/alias`, { method: 'DELETE' }));

  const groups = groupsOf(tags || []);
  const f = filter.trim().toLowerCase();
  const shown = f ? groups.filter((g) => [g.root, ...g.aliases].some((t) => t.value.toLowerCase().includes(f))) : groups;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-lg font-bold tracking-tight">태그</h1>
      <p className="mt-1 text-[13px] text-zinc-600">동의어로 묶은 값은 검색·필터에서 함께 찾습니다. 원래 입력한 값은 그대로 남습니다.</p>
      <div className="mt-4 flex items-center gap-3">
        <div role="tablist" aria-label="태그 종류" className="flex rounded-md border border-line bg-white p-0.5 text-xs">
          {KINDS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => { if (k !== kind) { setKind(k); setFilter(''); } }}
                    className={`h-6 rounded px-3 ${kind === k ? 'bg-brand text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}>{label}</button>
          ))}
        </div>
        <input type="search" aria-label="태그 거르기" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="거르기"
               className="h-8 w-56 rounded-md border border-zinc-300 bg-white px-2.5 text-[13px] outline-none focus:border-brand focus:ring-3 focus:ring-brand-ring" />
      </div>
      {error && <p role="alert" className="mt-3 text-[13px] text-err">{error}</p>}
      {!tags && !error && <div className="mt-4 h-32 animate-pulse rounded-lg bg-zinc-200/60" />}
      {tags && shown.length === 0 && (
        <p className="mt-6 text-[13px] text-zinc-500">{f ? '맞는 태그가 없습니다.' : '태그가 없습니다.'}</p>
      )}
      {shown.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-white">
          {shown.map((g) => (
            <li key={g.root.id}>
              <RootRow group={g} roots={groups.map((x) => x.root)} onAlias={alias} busy={busy} />
              {g.aliases.length > 0 && (
                <ul className="pb-2">
                  {g.aliases.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 py-1 pl-10 pr-4 text-[13px] text-zinc-700">
                      <span className="text-zinc-400" aria-hidden="true">↳</span><span>{a.value}</span>
                      <span className="font-mono text-xs text-zinc-500" title="사용 횟수">{a.count}</span>
                      <div className="flex-1" />
                      <Button size="sm" variant="ghost" aria-label={`${a.value} 풀기`} disabled={busy} onClick={() => unalias(a)}>
                        <Unlink size={13} aria-hidden="true" />풀기
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
