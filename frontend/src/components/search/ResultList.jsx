import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import Highlight from '../ui/Highlight.jsx';
import KindBadge from '../ui/KindBadge.jsx';
import { MATCH_LABELS, formatDateTime } from '../../lib/labels.js';
import { locatorLabel } from '../../lib/search.js';

function Snippets({ snippets }) {
  if (!snippets?.length) return null;
  return (
    <ul className="mt-1.5 space-y-1">
      {snippets.map((s, i) => (
        <li key={i} className="text-xs leading-relaxed text-zinc-600">
          <span className="mr-1.5 rounded bg-zinc-100 px-1 py-px font-mono text-[11px] text-zinc-500">
            <span>{s.name}</span> · <span>{locatorLabel(s.locator)}</span>
          </span>
          <Highlight text={s.text} highlights={s.highlights} />
        </li>
      ))}
    </ul>
  );
}

function HullChips({ hulls }) {
  return hulls.map((h) => (
    <Link key={h} to={`/h/${h}`} onClick={(e) => e.stopPropagation()}
          className="rounded bg-brand-tint px-1.5 font-mono text-xs font-semibold text-brand hover:underline">{h}</Link>
  ));
}

const DraftBadge = () => <span className="rounded bg-amber-50 px-1.5 text-[11px] font-semibold text-wait">미확정</span>;

function EntryRow({ item }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-zinc-500">{item.entry_id}</span>
        {item.status === 'draft' && <DraftBadge />}
        <Link to={`/e/${item.entry_id}`} onClick={(e) => e.stopPropagation()}
              className="min-w-0 truncate text-sm font-semibold text-zinc-900 hover:text-brand hover:underline">{item.title}</Link>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-600">
        <HullChips hulls={item.hulls} />
        {item.analysis_type && <span>{item.analysis_type}</span>}
        {item.zones?.length > 0 && <span className="text-zinc-500">· {item.zones.join(', ')}</span>}
        <span className="flex gap-1">{item.kinds.map((k) => <KindBadge key={k} kind={k} />)}</span>
        <span className="ml-auto font-mono text-zinc-500">{item.analysis_period || formatDateTime(item.confirmed_at).slice(0, 10)}</span>
      </div>
      {item.matched?.length > 0 && (
        <p className="mt-1 text-[11px] text-zinc-500">일치: {item.matched.map((m) => MATCH_LABELS[m] || m).join('·')}</p>
      )}
      <Snippets snippets={item.snippets} />
    </>
  );
}

function FileRow({ item }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <KindBadge kind={item.kind} name={item.name} />
        <span className="min-w-0 truncate text-sm font-semibold text-zinc-900" title={item.rel_path}>{item.name}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-600">
        <HullChips hulls={item.hulls} />
        <span className="font-mono text-zinc-500">{item.entry_id}</span>
        <span className="truncate">{item.entry_title}</span>
        {item.entry_status === 'draft' && <DraftBadge />}
      </div>
      <Snippets snippets={item.snippets} />
    </>
  );
}

export const itemKey = (item) => (item.file_id ? `f${item.file_id}` : item.entry_id);

/**
 * 결과 목록 — ↑/↓·Home·End 로 고르고 Enter 로 연다(onOpen).
 * onSelect(item, { immediate }) — 마우스로 누르면 immediate=true(미리보기를 바로 연다), 키보드는 false.
 */
export default function ResultList({ unit, items, selectedKey, onSelect, onOpen }) {
  const listRef = useRef(null);
  // 키보드로 고른 항목이 화면 밖이면 보이게 스크롤한다(jsdom 에는 scrollIntoView 가 없다).
  useEffect(() => {
    if (!selectedKey) return;
    const el = listRef.current?.querySelector(`[data-key="${selectedKey}"]`);
    if (typeof el?.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);

  function onKeyDown(e) {
    // 안쪽 링크(제목·호선 칩)에서 누른 Enter 는 링크가 처리한다.
    if (e.target !== e.currentTarget) return;
    const i = items.findIndex((it) => itemKey(it) === selectedKey);
    const last = items.length - 1;
    const move = { ArrowDown: Math.min(last, i + 1), ArrowUp: Math.max(0, i - 1), Home: 0, End: last }[e.key];
    if (move !== undefined) {
      e.preventDefault();
      if (items[move]) onSelect(items[move], { immediate: false });
    } else if (e.key === 'Enter') {
      const it = items[i >= 0 ? i : 0];
      if (it) onOpen(it);
    }
  }
  return (
    <ul ref={listRef} role="listbox" aria-label="검색 결과" tabIndex={0} onKeyDown={onKeyDown}
        aria-activedescendant={selectedKey ? `result-${selectedKey}` : undefined}
        className="divide-y divide-line rounded-lg border border-line bg-white outline-none focus-visible:ring-3 focus-visible:ring-brand-ring">
      {items.map((it) => {
        const key = itemKey(it);
        const on = key === selectedKey;
        return (
          <li key={key} id={`result-${key}`} data-key={key} role="option" aria-selected={on} onClick={() => onSelect(it, { immediate: true })}
              className={`cursor-pointer px-4 py-3 ${on ? 'bg-brand-tint/60' : 'hover:bg-zinc-50'}`}>
            {unit === 'file' ? <FileRow item={it} /> : <EntryRow item={it} />}
          </li>
        );
      })}
    </ul>
  );
}
