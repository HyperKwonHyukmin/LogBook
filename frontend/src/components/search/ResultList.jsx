import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import Highlight, { TermHighlight } from '../ui/Highlight.jsx';
import KindBadge from '../ui/KindBadge.jsx';
import { DraftBadge, HullChip } from '../ui/Status.jsx';
import { formatDateTime } from '../../lib/labels.js';
import { locatorLabel } from '../../lib/search.js';

const stop = (e) => e.stopPropagation();

function Snippets({ snippets, showName = true }) {
  if (!snippets?.length) return null;
  return (
    <ul className="mt-1.5 flex flex-col gap-1">
      {snippets.map((s, i) => (
        <li key={i} className="line-clamp-2 text-meta text-n-600">
          <span className="mr-1.5 font-medium text-n-500">
            {showName && <><span>{s.name}</span> · </>}<span>{locatorLabel(s.locator)}</span>
          </span>
          <Highlight text={s.text} highlights={s.highlights} />
        </li>
      ))}
    </ul>
  );
}

const Hulls = ({ hulls }) => hulls.map((h) => <HullChip key={h} hull={h} onClick={stop} />);
const Sep = () => <span aria-hidden="true" className="text-n-300">·</span>;

function EntryRow({ item, on, terms }) {
  const date = item.analysis_period || formatDateTime(item.confirmed_at).slice(0, 10);
  const meta = [item.zones?.length ? item.zones.join(', ') : null, item.analysis_type].filter(Boolean);
  return (
    <>
      <div className="flex items-baseline gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Link to={`/e/${item.entry_id}`} onClick={stop}
                className={`min-w-0 truncate text-body font-semibold tracking-[-0.005em] hover:underline ${on ? 'text-brand' : 'text-n-900'}`}>
            <TermHighlight text={item.title} terms={terms} />
          </Link>
          {item.status === 'draft' && <DraftBadge />}
        </div>
        <span className="shrink-0 font-mono text-meta text-n-500">{date}</span>
      </div>
      <div className="mt-1 flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-n-600">
          <Hulls hulls={item.hulls} />
          {meta.length > 0 && <span className="truncate">{meta.join(' · ')}</span>}
          {item.kinds.length > 0 && (meta.length > 0 || item.hulls.length > 0) && <Sep />}
          <span className="flex gap-1">{item.kinds.map((k) => <KindBadge key={k} kind={k} />)}</span>
        </div>
        <span className="shrink-0 font-mono text-meta text-n-500">{item.entry_id}</span>
      </div>
      <Snippets snippets={item.snippets} />
    </>
  );
}

function FileRow({ item, on }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <KindBadge kind={item.kind} name={item.name} />
        <span className={`min-w-0 truncate text-body font-semibold tracking-[-0.005em] ${on ? 'text-brand' : 'text-n-900'}`} title={item.rel_path}>{item.name}</span>
        {item.entry_status === 'draft' && <DraftBadge />}
      </div>
      <div className="mt-1 flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-meta text-n-600">
          <Hulls hulls={item.hulls} />
          <span className="truncate">{item.entry_title}</span>
        </div>
        <span className="shrink-0 font-mono text-meta text-n-500">{item.entry_id}</span>
      </div>
      <Snippets snippets={item.snippets} showName={false} />
    </>
  );
}

export const itemKey = (item) => (item.file_id ? `f${item.file_id}` : item.entry_id);

/**
 * 결과 목록 — ↑/↓·Home·End 로 고르고 Enter 로 연다(onOpen).
 * onSelect(item, { immediate }) — 마우스로 누르면 immediate=true(미리보기를 바로 연다), 키보드는 false.
 */
export default function ResultList({ unit, items, selectedKey, onSelect, onOpen, terms }) {
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
        className={`group/list outline-none ${selectedKey ? 'focus-visible:outline-none' : 'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-ring'}`}>
      {items.map((it) => {
        const key = itemKey(it);
        const on = key === selectedKey;
        return (
          <li key={key} id={`result-${key}`} data-key={key} role="option" aria-selected={on} onClick={() => onSelect(it, { immediate: true })}
              className={`cursor-pointer border-b border-n-200 px-5 py-3
                ${on ? 'bg-brand-subtle hover:bg-brand-muted/60 group-focus-visible/list:outline-2 group-focus-visible/list:-outline-offset-2 group-focus-visible/list:outline-brand-ring'
                  : 'hover:bg-n-25'}`}>
            {unit === 'file' ? <FileRow item={it} on={on} /> : <EntryRow item={it} on={on} terms={terms} />}
          </li>
        );
      })}
    </ul>
  );
}
