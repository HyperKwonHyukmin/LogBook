import { useCallback, useEffect, useRef, useState } from 'react';
import { CornerDownRight, Link2, Search, Unlink } from 'lucide-react';
import { api } from '../api/client.js';
import Button from '../components/ui/Button.jsx';
import { inputClass, selectClass } from '../components/ui/Field.jsx';
import { ErrorNote, Page, PageHeader } from '../components/ui/Page.jsx';
import { RowsSkeleton } from '../components/ui/Skeleton.jsx';
import { Segmented } from '../components/ui/Tabs.jsx';
import { errorText } from '../lib/labels.js';

const KINDS = [{ id: 'zone', label: '구역' }, { id: 'free', label: '자유 태그' }];
const COLS = 'grid grid-cols-[minmax(0,1fr)_64px_minmax(180px,auto)] items-center gap-3';
/** 행 끝 부차 동작 — 행 hover·포커스 때만 보이고, 터치 기기에서는 늘 보인다. */
const reveal = 'opacity-0 transition-opacity duration-120 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100';

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
    <div className={`group ${COLS} min-h-10 px-3 py-1 text-ui transition-colors duration-120 hover:bg-n-25`}>
      <span className="truncate font-medium text-n-900">{group.root.value}</span>
      <span className="text-right font-mono text-meta text-n-600" title="사용 횟수">{group.root.count}</span>
      <div className="flex items-center justify-end gap-1.5">
        {open ? (
          <>
            <select aria-label="대표 태그" value={target} onChange={(e) => setTarget(e.target.value)} className={selectClass('h-7 text-meta')}>
              <option value="">대표 태그 선택…</option>
              {others.map((r) => <option key={r.id} value={r.id}>{r.value}</option>)}
            </select>
            <Button size="sm" disabled={!target || busy} onClick={() => onAlias(group.root, Number(target))}>묶기</Button>
            <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setTarget(''); }}>취소</Button>
          </>
        ) : (
          others.length > 0 && (
            <Button size="sm" variant="ghost" className={reveal} onClick={() => setOpen(true)}>
              <Link2 size={14} aria-hidden="true" />동의어로 묶기
            </Button>
          )
        )}
      </div>
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
    <Page>
      <PageHeader title="태그" description="동의어로 묶은 값은 검색과 필터에서 함께 찾습니다. 원래 입력한 값은 그대로 남습니다." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented role="tablist" label="태그 종류" items={KINDS} value={kind}
                   onChange={(k) => { if (k !== kind) { setKind(k); setFilter(''); } }} />
        <label className={inputClass('flex w-56 items-center gap-2 px-2')}>
          <Search size={14} className="shrink-0 text-n-500" aria-hidden="true" />
          <input type="search" aria-label="태그 거르기" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="값으로 거르기"
                 className="min-w-0 flex-1 bg-transparent text-ui outline-none focus-visible:outline-none" />
        </label>
      </div>
      {error && <ErrorNote className="mb-4 max-w-[880px]">{error}</ErrorNote>}
      <div className="max-w-[880px] overflow-hidden rounded-lg border border-n-200">
        <div className={`${COLS} h-8 border-b border-n-200 bg-n-25 px-3 text-meta font-medium text-n-500`}>
          <span>값</span><span className="text-right">사용</span><span />
        </div>
        {!tags && !error && <RowsSkeleton rows={4} dense label="태그를 불러오는 중" />}
        {tags && shown.length === 0 && (
          <p className="py-10 text-center text-ui text-n-500">{f ? '맞는 태그가 없습니다.' : '태그가 없습니다.'}</p>
        )}
        {shown.length > 0 && (
          <ul>
            {shown.map((g) => (
              <li key={g.root.id} className="border-b border-n-200 last:border-0">
                <RootRow group={g} roots={groups.map((x) => x.root)} onAlias={alias} busy={busy} />
                {g.aliases.length > 0 && (
                  <ul className="pb-1">
                    {g.aliases.map((a) => (
                      <li key={a.id} className={`group ${COLS} h-9 px-3 text-ui text-n-700 transition-colors duration-120 hover:bg-n-25`}>
                        <span className="flex min-w-0 items-center gap-1.5 pl-2">
                          <CornerDownRight size={14} className="shrink-0 text-n-400" aria-hidden="true" />
                          <span className="truncate">{a.value}</span>
                          <span className="text-meta text-n-500">동의어</span>
                        </span>
                        <span className="text-right font-mono text-meta text-n-500" title="사용 횟수">{a.count}</span>
                        <span className="flex justify-end">
                          <Button size="sm" variant="ghost" className={reveal} aria-label={`${a.value} 풀기`} disabled={busy} onClick={() => unalias(a)}>
                            <Unlink size={14} aria-hidden="true" />풀기
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Page>
  );
}
