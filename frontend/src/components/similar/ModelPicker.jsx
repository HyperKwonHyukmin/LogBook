import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { errorText } from '../../lib/labels.js';
import { titleWithoutHull } from '../../lib/similar.js';
import Button from '../ui/Button.jsx';
import Spinner from '../ui/Spinner.jsx';
import { Segmented } from '../ui/Tabs.jsx';
import ModelThumb from '../viewer/ModelThumb.jsx';

const SCOPES = [{ id: 'all', label: '전체' }, { id: 'fav', label: '즐겨찾기' }];
const LIMIT = 30;
const DEBOUNCE_MS = 250;

/**
 * 선례 찾기(27) — LogBook 에 이미 있는 확정 BDF 를 기준으로 고르는 칸.
 * 검색(GET /api/search?unit=file&kind=model)을 그대로 쓴다: 호선 번호·제목·파일 이름·자료 번호로 찾고,
 * 검색어가 없으면 최근 올린 BDF. 변환이 끝난 모델만 고를 수 있다(특징이 model_summaries 에 있어야 한다).
 * ↑/↓ 로 옮기고 Enter 로 고른다. Esc 는 onClose.
 */
export default function ModelPicker({ onPick, onClose, currentId }) {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('all');
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const p = new URLSearchParams({ unit: 'file', kind: 'model', q: q.trim(), limit: String(LIMIT) });
        if (!q.trim()) p.set('sort', 'recent');
        if (scope === 'fav') p.set('fav', '1');
        const r = await api(`/search?${p}`);
        if (!alive) return;
        setItems(r.items || []); setTotal(r.total ?? (r.items || []).length); setActive(0); setError('');
      } catch (err) {
        if (alive) setError(errorText(err, 'BDF 를 찾지 못했습니다.'));
      }
    }, DEBOUNCE_MS);
    return () => { alive = false; clearTimeout(t); };
  }, [q, scope]);

  const usable = (it) => it.model_state === 'done' && it.entry_status === 'confirmed';
  function choose(it) { if (it && usable(it)) onPick(it.file_id); }
  function onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); onClose?.(); return; }
    if (!items?.length) return;
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (step) {
      e.preventDefault();
      const n = (active + step + items.length) % items.length;
      setActive(n);
      listRef.current?.querySelector(`[data-idx="${n}"]`)?.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter') { e.preventDefault(); choose(items[active]); }
  }

  return (
    <section aria-label="LogBook 에서 기준 BDF 고르기" className="rounded-lg border border-n-200 bg-n-0 shadow-md" onKeyDown={onKeyDown}>
      <div className="flex flex-wrap items-center gap-2 border-b border-n-200 p-2.5">
        <label className="field flex h-8 min-w-[240px] flex-1 items-center gap-2 rounded-md border border-n-250 px-2.5">
          <Search size={14} className="text-n-400" aria-hidden="true" />
          <input ref={inputRef} type="search" value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="호선 번호, 제목, 파일 이름, 자료 번호" aria-label="기준 BDF 찾기"
                 aria-controls="model-picker-list" aria-activedescendant={items?.[active] ? `mp-${items[active].file_id}` : undefined}
                 // 칸 테두리(.field:focus-within)가 포커스를 보이므로 입력 자체의 전역 포커스 링은 끈다(전역 규칙이 유틸리티보다 강하다)
                 style={{ outline: 'none' }}
                 className="min-w-0 flex-1 bg-transparent text-ui text-n-900 placeholder:text-n-500" />
        </label>
        <Segmented label="범위" items={SCOPES} value={scope} onChange={setScope} />
        {onClose && <Button variant="ghost" size="icon-sm" aria-label="고르기 닫기" onClick={onClose}><X size={16} /></Button>}
      </div>
      <p className="px-3 pt-2 text-meta text-n-600">
        {items == null ? '불러오는 중…' : q.trim() ? `찾은 BDF ${total}개${total > LIMIT ? ` 중 ${LIMIT}개` : ''}` : `최근 올린 BDF ${items.length}개`}
        {' · '}변환이 끝난 확정 자료의 BDF 만 고를 수 있습니다.
      </p>
      {error && <p role="alert" className="px-3 py-2 text-ui text-err">{error}</p>}
      <ul id="model-picker-list" ref={listRef} role="listbox" aria-label="기준으로 고를 BDF" className="max-h-[360px] overflow-auto p-1.5">
        {items == null && <li className="flex justify-center p-6"><Spinner size={18} /></li>}
        {items?.map((it, i) => {
          const ok = usable(it);
          const cur = String(it.file_id) === String(currentId);
          return (
            <li key={it.file_id} id={`mp-${it.file_id}`} role="option" data-idx={i} aria-selected={i === active} aria-disabled={!ok}
                onMouseEnter={() => setActive(i)} onClick={() => choose(it)}
                className={`grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-1.5
                  ${ok ? 'cursor-pointer' : 'cursor-not-allowed'} ${i === active ? 'bg-brand-subtle' : ''}`}>
              <span className="block h-[44px] overflow-hidden rounded-sm bg-viewer">
                {it.model_key && <ModelThumb fileId={it.file_id} modelKey={it.model_key} alt="" className="h-full w-full object-cover" />}
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5">
                  {it.hulls?.slice(0, 3).map((h) => (
                    <span key={h} className="inline-flex h-5 items-center rounded-sm bg-brand px-1.5 font-mono text-meta font-medium text-on-navy">{h}</span>
                  ))}
                  <span className={`truncate text-ui font-medium ${i === active ? 'text-brand' : 'text-n-900'}`}>{titleWithoutHull(it.entry_title, it.hulls)}</span>
                </span>
                <span className="mt-0.5 block truncate text-meta text-n-600">
                  <span className="font-mono">{it.entry_id}</span> · {it.name}{it.posted_at ? <> · <span className="font-mono">{it.posted_at.slice(0, 7)}</span></> : null}
                </span>
              </span>
              <span className="text-meta text-n-600">
                {cur ? '지금 기준' : !ok ? (it.entry_status !== 'confirmed' ? '확정 전' : '변환 중') : ''}
              </span>
            </li>
          );
        })}
        {items?.length === 0 && (
          <li className="px-3 py-6 text-center text-ui text-n-600">
            {scope === 'fav' ? '즐겨찾기한 BDF 가 없습니다.' : '맞는 BDF 가 없습니다. 호선 번호나 파일 이름 일부로 찾아 보세요.'}
          </li>
        )}
      </ul>
    </section>
  );
}
