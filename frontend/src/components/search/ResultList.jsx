import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import Highlight, { TermHighlight } from '../ui/Highlight.jsx';
import KindBadge from '../ui/KindBadge.jsx';
import { BarChart3, Box, File, FileText, PenTool } from 'lucide-react';
import { DraftBadge, HullChip, TagLink } from '../ui/Status.jsx';
import { KIND_LABELS } from '../../lib/labels.js';
import { locatorLabel } from '../../lib/search.js';
import ModelThumb from '../viewer/ModelThumb.jsx';
import { CompareToggle } from '../compare/CompareBasket.jsx';

const stop = (e) => e.stopPropagation();

function Snippets({ snippets, showName = true, clamp = 'line-clamp-2' }) {
  if (!snippets?.length) return null;
  return (
    <ul className="mt-1.5 flex flex-col gap-1">
      {snippets.map((s, i) => (
        <li key={i} className={`${clamp} text-meta text-n-600`}>
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

// 결과 행의 종류별 파일 수 — 이 넷은 0 이어도 보이고(무엇이 없는지도 정보다), 기타는 있을 때만.
const COUNT_KINDS = ['model', 'report', 'drawing', 'result'];
const KIND_ICONS = { model: Box, report: FileText, drawing: PenTool, result: BarChart3, other: File };
const ROW_SNIPPETS = 2;

/** 왼쪽 그림 — 대표 BDF 썸네일, 없으면 가장 앞선 파일 종류의 아이콘. */
function RowThumb({ item }) {
  if (item.thumb) {
    // 장식 그림 — 제목이 바로 옆에 있다.
    return <ModelThumb fileId={item.thumb.file_id} modelKey={item.thumb.model_key} alt="" className="h-12 w-16 shrink-0 rounded-sm" />;
  }
  const counts = item.kind_counts || {};
  const kind = [...COUNT_KINDS, 'other'].find((k) => counts[k] > 0) || item.kinds?.[0] || 'other';
  const Icon = KIND_ICONS[kind] || File;
  return (
    <div aria-hidden="true" className="flex h-12 w-16 shrink-0 items-center justify-center rounded-sm bg-n-50 text-n-400">
      <Icon size={18} strokeWidth={1.5} />
    </div>
  );
}

/** 종류별 파일 수 — 'BDF 2 · 보고서 1 · 도면 0 · 결과 0'. 0 은 흐리게. */
function KindCounts({ item }) {
  const counts = item.kind_counts;
  if (!counts) return <span className="flex gap-1">{item.kinds.map((k) => <KindBadge key={k} kind={k} />)}</span>;
  const kinds = counts.other > 0 ? [...COUNT_KINDS, 'other'] : COUNT_KINDS;
  return (
    <span className="tnum flex items-center gap-x-1.5" aria-label={`파일 ${kinds.map((k) => `${KIND_LABELS[k]} ${counts[k] || 0}`).join(', ')}`}>
      {kinds.map((k, i) => (
        <span key={k} aria-hidden="true" className={counts[k] ? 'text-n-700' : 'text-n-500'}>
          {i > 0 && <span className="mr-1.5 text-n-300">·</span>}{KIND_LABELS[k]} <span className="font-mono">{counts[k] || 0}</span>
        </span>
      ))}
    </span>
  );
}

function EntryRow({ item, on, terms, filters }) {
  // 호선 하나로 거른 검색이면 모든 행이 그 호선이라 칩을 빼서 줄을 짧게 한다(다른 호선은 남긴다)
  const hulls = filters?.hull ? item.hulls.filter((h) => h !== filters.hull) : item.hulls;
  // 둘째 줄 = 통제 값만, 고정 순서: 호선 · 구역 · 해석 종류 · 선종
  const meta = [item.zones?.length ? item.zones.join(', ') : null, item.analysis_type,
    item.ship_types?.length ? item.ship_types.join(', ') : null].filter(Boolean);
  return (
    <div className="flex max-w-[1080px] items-start gap-3">
      <RowThumb item={item} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <Link to={`/e/${item.entry_id}`} onClick={stop}
                className={`min-w-0 truncate text-body font-semibold tracking-[-0.005em] hover:underline ${on ? 'text-brand' : 'text-n-900'}`}>
            <TermHighlight text={item.title} terms={terms} />
          </Link>
          {item.status === 'draft' && <DraftBadge />}
        </div>
        {(hulls.length > 0 || meta.length > 0) && (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-n-600">
            <Hulls hulls={hulls} />
            {hulls.length > 0 && meta.length > 0 && <Sep />}
            {meta.length > 0 && <span className="min-w-0 truncate">{meta.join(' · ')}</span>}
          </div>
        )}
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-meta">
          <KindCounts item={item} />
          {item.tags?.length > 0 && (
            <span className="flex min-w-0 flex-wrap items-center gap-x-2">
              {item.tags.map((t) => <TagLink key={t} tag={t} small onClick={stop} />)}
            </span>
          )}
        </div>
        {/* 발췌는 최대 2줄 — 조각 2개를 한 줄씩 */}
        <Snippets snippets={item.snippets?.slice(0, ROW_SNIPPETS)} clamp="line-clamp-1" />
      </div>
      <div className="w-[104px] shrink-0 text-right text-meta">
        {item.analysis_period
          ? <div className="tnum text-n-600">해석 <span className="font-mono text-n-800">{item.analysis_period}</span></div>
          : <div className="text-n-500">해석 시기 미입력</div>}
        <div className="mt-1 font-mono text-n-500">{item.entry_id}</div>
      </div>
    </div>
  );
}

function FileRow({ item, on }) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        <KindBadge kind={item.kind} name={item.name} />
        <span className={`min-w-0 truncate text-body font-semibold tracking-[-0.005em] ${on ? 'text-brand' : 'text-n-900'}`} title={item.rel_path}>{item.name}</span>
        {item.entry_status === 'draft' && <DraftBadge />}
        {/* 모델은 비교 바구니에 담을 수 있다(07) — 변환 전이어도 */}
        {item.kind === 'model' && (
          <CompareToggle stop variant="ghost" className="-my-1 ml-auto"
                         file={{ id: item.file_id, name: item.name, hull: item.hulls?.[0] || '' }} />
        )}
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
  // BDF 는 왼쪽에 썸네일(64×40)을 둔다. 변환이 끝났거나 이전 결과(model_key)가 있을 때만 —
  // 그 밖에는 서버에 그림이 없어 요청이 404 로 헛돈다.
  if (item.kind !== 'model' || !(item.model_state === 'done' || item.model_key)) return body;
  return (
    <div className="flex items-start gap-3">
      {/* 장식 그림 — 파일 이름이 바로 옆에 있다. */}
      <ModelThumb fileId={item.file_id} modelKey={item.model_key} alt="" className="mt-0.5 h-10 w-16 shrink-0 rounded-sm" />
      <div className="min-w-0 flex-1">{body}</div>
    </div>
  );
}

export const itemKey = (item) => (item.file_id ? `f${item.file_id}` : item.entry_id);

/**
 * 결과 목록 — ↑/↓·Home·End 로 고르고 Enter 로 연다(onOpen).
 * onSelect(item, { immediate }) — 마우스로 누르면 immediate=true(미리보기를 바로 연다), 키보드는 false.
 */
export default function ResultList({ unit, items, selectedKey, onSelect, onOpen, terms, filters }) {
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
                  : 'hover:bg-n-50'}`}>
            {unit === 'file' ? <FileRow item={it} on={on} /> : <EntryRow item={it} on={on} terms={terms} filters={filters} />}
          </li>
        );
      })}
    </ul>
  );
}
