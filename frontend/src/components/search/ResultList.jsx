import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import Highlight, { TermHighlight } from '../ui/Highlight.jsx';
import KindBadge from '../ui/KindBadge.jsx';
import { BarChart3, Box, File, FileText, PenTool } from 'lucide-react';
import { DraftBadge, FilterLink, HullChip, TagLink } from '../ui/Status.jsx';
import { KIND_LABELS, formatDateTime } from '../../lib/labels.js';
import { filterValues, locatorLabel } from '../../lib/search.js';
import ModelThumb from '../viewer/ModelThumb.jsx';
import { CompareToggle } from '../compare/CompareBasket.jsx';
import { ModelLine, ReportLine } from './RowInsight.jsx';
import { FavoriteToggle } from '../favorites/Favorites.jsx';
import { AccessBadge } from '../access/AccessPanel.jsx';
import NeedsFixBadge from '../ui/NeedsFixBadge.jsx';
import RevisionBrief from '../revisions/RevisionBrief.jsx';

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

// 결과 열이 좁으면(미리보기를 넓게 끌었을 때) 썸네일을 접어 글자 줄이 부서지지 않게 한다(컨테이너 질의)
const THUMB = 'flex h-20 w-32 shrink-0 rounded-sm @max-[620px]/results:hidden';

/** 왼쪽 그림(128×80) — 대표 BDF 썸네일(화면에 들어올 때 받는다), 없으면 가장 앞선 파일 종류의 아이콘. */
function RowThumb({ item }) {
  if (item.thumb) {
    // 장식 그림 — 제목이 바로 옆에 있다.
    return <ModelThumb fileId={item.thumb.file_id} modelKey={item.thumb.model_key} alt="" className={THUMB} />;
  }
  const counts = item.kind_counts || {};
  const kind = [...COUNT_KINDS, 'other'].find((k) => counts[k] > 0) || item.kinds?.[0] || 'other';
  const Icon = KIND_ICONS[kind] || File;
  return (
    <div aria-hidden="true" className={`${THUMB} items-center justify-center bg-n-50 text-n-400`}>
      <Icon size={20} strokeWidth={1.5} />
    </div>
  );
}

/** 종류별 파일 수 — 'BDF 2 · 문서 1 · 도면 0 · 결과 0'. 0 은 흐리게. */
function KindCounts({ item }) {
  const counts = item.kind_counts;
  if (!counts) return <span className="flex gap-1">{item.kinds.map((k) => <KindBadge key={k} kind={k} />)}</span>;
  const kinds = counts.other > 0 ? [...COUNT_KINDS, 'other'] : COUNT_KINDS;
  return (
    <span className="tnum flex flex-wrap items-center gap-x-1.5" aria-label={`파일 ${kinds.map((k) => `${KIND_LABELS[k]} ${counts[k] || 0}`).join(', ')}`}>
      {kinds.map((k, i) => (
        <span key={k} aria-hidden="true" className={`whitespace-nowrap ${counts[k] ? 'text-n-700' : 'text-n-500'}`}>
          {i > 0 && <span className="mr-1.5 text-n-300">·</span>}{KIND_LABELS[k]} <span className="font-mono">{counts[k] || 0}</span>
        </span>
      ))}
    </span>
  );
}

function EntryRow({ item, on, terms, filters }) {
  // 호선 하나로 거른 검색이면 모든 행이 그 호선이라 칩을 빼서 줄을 짧게 한다(다른 호선은 남긴다).
  // 19 — 호선 여러 개(OR)로 걸렀으면 행마다 어느 호선인지가 정보라 그대로 둔다
  const hullFilter = filterValues(filters, 'hull');
  const hulls = hullFilter.length === 1 ? item.hulls.filter((h) => h !== hullFilter[0]) : item.hulls;
  const shared = !!item.no_hull && !item.hulls.length;
  // 둘째 줄 = 통제 값만, 고정 순서: 호선 · 구역 · 해석 종류 · 대상(38) · 선종
  // 값마다 그 값으로 거른 검색 링크(09) — '선미부' 를 누르면 구역 선미부 전체
  const meta = [...(item.zones || []).map((v) => ['zone', v]), ...(item.analysis_type ? [['analysis_type', item.analysis_type]] : []),
    ...(item.target ? [['target', item.target]] : []),
    ...(item.ship_types || []).map((v) => ['ship_type', v])];
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
          {/* 13 — 비공개(볼 수 있는 사람에게만 실린다) */}
          <AccessBadge item={item} />
          {/* 20 — 확정 BDF 자료의 빠진 필수 분류(올린 사람·LV3 에게만 실린다) */}
          <NeedsFixBadge missing={item.needs_fix} />
        </div>
        {(hulls.length > 0 || meta.length > 0 || shared) && (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-n-600">
            <Hulls hulls={hulls} />
            {/* 20 — '호선 없음(공용)' 을 고른 자료 */}
            {shared && <span title="호선 없음(공용)">공용</span>}
            {(hulls.length > 0 || shared) && meta.length > 0 && <Sep />}
            {meta.map(([k, v], i) => (
              <span key={`${k}:${v}`} className="flex min-w-0 items-center gap-x-2">
                {i > 0 && <Sep />}
                <FilterLink field={k} value={v} onClick={stop} />
              </span>
            ))}
          </div>
        )}
        {/* 09 — 대표 모델 한 줄(썸네일과 같은 BDF) */}
        <ModelLine model={item.model} />
        {/* 14 — 한 자료 안 BDF 판 묶음 */}
        <RevisionBrief brief={item.revisions} />
        {/* 발췌는 최대 2줄 — 조각 2개를 한 줄씩. 발췌가 있으면 검색어 맥락이 더 중요해 보고서 줄을 대신한다 */}
        {item.snippets?.length
          ? <Snippets snippets={item.snippets.slice(0, ROW_SNIPPETS)} clamp="line-clamp-1" />
          : <ReportLine report={item.report} />}
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-meta">
          <KindCounts item={item} />
          {item.tags?.length > 0 && (
            <span className="flex min-w-0 flex-wrap items-center gap-x-2">
              {item.tags.map((t) => <TagLink key={t} tag={t} small onClick={stop} />)}
            </span>
          )}
        </div>
      </div>
      {/* 10 — 즐겨찾기 별. 눌러도 행 선택·미리보기는 열리지 않는다. 꺼진 별은 행에 올리거나 고른 행에서만 보인다 */}
      <FavoriteToggle entryId={item.entry_id} initial={item.favorite} stop reveal={!on} className="-mr-2 -mt-1" />
      <div className="w-[104px] shrink-0 text-right text-meta">
        {/* 15 — 날짜 = 올린 날짜(확정일, 초안은 등록일). 해석 시기는 없앴다 */}
        {item.posted_at && (
          <div className="tnum text-n-600" title={formatDateTime(item.posted_at)}>올림 <span className="font-mono text-n-800">{item.posted_at.slice(0, 10)}</span></div>
        )}
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
        <AccessBadge item={item} compact />
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

/** 결과 항목 열쇠 — 묶어 보기(11)에서는 같은 Entry 가 여러 묶음에 나오므로 묶음 자리(_slot)가 열쇠다. */
export const itemKey = (item) => item._slot || (item.file_id ? `f${item.file_id}` : item.entry_id);

/**
 * 결과 목록 — ↑/↓·Home·End 로 고르고 Enter 로 연다(onOpen).
 * onSelect(item, { immediate }) — 마우스로 누르면 immediate=true(미리보기를 바로 연다), 키보드는 false.
 * sections(11): [{ key, header, footer, items, collapsed }] — 묶음 머리 아래에 행을 둔다. 키보드는 펼친 묶음의
 * 행을 위에서 아래로 한 줄로 이어 옮겨 다닌다(묶음 머리의 단추는 Tab 으로).
 */
export default function ResultList({ unit, items, sections, selectedKey, onSelect, onOpen, terms, filters }) {
  const listRef = useRef(null);
  const flat = sections ? sections.flatMap((sec) => (sec.collapsed ? [] : sec.items)) : items;
  // 키보드로 고른 항목이 화면 밖이면 보이게 스크롤한다(jsdom 에는 scrollIntoView 가 없다).
  useEffect(() => {
    if (!selectedKey) return;
    const el = [...(listRef.current?.querySelectorAll('[data-key]') || [])].find((x) => x.dataset.key === selectedKey);
    if (typeof el?.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);

  function onKeyDown(e) {
    // 안쪽 링크(제목·호선 칩)·묶음 머리 단추에서 누른 Enter 는 그쪽이 처리한다.
    if (e.target !== e.currentTarget) return;
    const i = flat.findIndex((it) => itemKey(it) === selectedKey);
    const last = flat.length - 1;
    const move = { ArrowDown: Math.min(last, i + 1), ArrowUp: Math.max(0, i - 1), Home: 0, End: last }[e.key];
    if (move !== undefined) {
      e.preventDefault();
      if (flat[move]) onSelect(flat[move], { immediate: false });
    } else if (e.key === 'Enter') {
      const it = flat[i >= 0 ? i : 0];
      if (it) onOpen(it);
    }
  }
  const row = (it) => {
    const key = itemKey(it);
    const on = key === selectedKey;
    return (
      <li key={key} id={`result-${key}`} data-key={key} role="option" aria-selected={on} onClick={() => onSelect(it, { immediate: true })}
          className={`group/row cursor-pointer border-b border-n-200 px-5 py-3
            ${on ? 'bg-brand-subtle hover:bg-brand-muted/60 group-focus-visible/list:outline-2 group-focus-visible/list:-outline-offset-2 group-focus-visible/list:outline-brand-ring'
              : 'hover:bg-n-50'}`}>
        {unit === 'file' ? <FileRow item={it} on={on} /> : <EntryRow item={it} on={on} terms={terms} filters={filters} />}
      </li>
    );
  };
  const listProps = {
    ref: listRef, role: 'listbox', 'aria-label': '검색 결과', tabIndex: 0, onKeyDown,
    'aria-activedescendant': selectedKey ? `result-${selectedKey}` : undefined,
    className: `group/list outline-none ${selectedKey ? 'focus-visible:outline-none' : 'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-ring'}`,
  };
  if (!sections) return <ul {...listProps}>{items.map(row)}</ul>;
  return (
    <div {...listProps}>
      {sections.map((sec) => (
        <div key={sec.key} role="group" aria-labelledby={`group-${sec.key}`}>
          {sec.header}
          {!sec.collapsed && <ul role="none">{sec.items.map(row)}</ul>}
          {!sec.collapsed && sec.footer}
        </div>
      ))}
    </div>
  );
}
