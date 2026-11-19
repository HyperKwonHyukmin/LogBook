import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Highlight, { TermHighlight } from '../ui/Highlight.jsx';
import KindBadge from '../ui/KindBadge.jsx';
import { BarChart3, Box, Check, Copy, File, FileText, PenTool } from 'lucide-react';
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
import { copyText } from '../../lib/files.js';
import { useToast } from '../ui/Toast.jsx';

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

// 결과 행의 종류별 파일 수 순서 — 있는 종류만 보인다(2026-11-19, 없는 것은 구성 배지가 말한다).
const COUNT_KINDS = ['model', 'report', 'drawing', 'result'];
const KIND_ICONS = { model: Box, report: FileText, drawing: PenTool, result: BarChart3, other: File };
const ROW_SNIPPETS = 2;

// 결과 열이 좁으면(미리보기를 넓게 끌었을 때) 썸네일을 접어 글자 줄이 부서지지 않게 한다(컨테이너 질의)
const THUMB = 'flex h-20 w-32 shrink-0 rounded-sm @max-[620px]/results:hidden';

/**
 * 왼쪽 그림(128×80) — 대표 BDF 썸네일(화면에 들어올 때 받는다). 52 — 없으면 보고서 PDF 첫 쪽 → PPTX 썸네일 → 이미지,
 * 그것도 없거나 못 만들면 가장 앞선 파일 종류의 아이콘.
 */
function RowThumb({ item }) {
  if (item.thumb) {
    // 장식 그림 — 제목이 바로 옆에 있다.
    return <ModelThumb fileId={item.thumb.file_id} modelKey={item.thumb.model_key} alt="" className={THUMB} />;
  }
  if (item.cover) {
    return <ModelThumb kind="cover" fileId={item.cover.file_id} modelKey={item.cover.key} alt="" className={THUMB}
                       fallback={<KindIcon item={item} />} />;
  }
  return <KindIcon item={item} />;
}

function KindIcon({ item }) {
  const counts = item.kind_counts || {};
  const kind = [...COUNT_KINDS, 'other'].find((k) => counts[k] > 0) || item.kinds?.[0] || 'other';
  const Icon = KIND_ICONS[kind] || File;
  return (
    <div aria-hidden="true" className={`${THUMB} items-center justify-center bg-n-50 text-n-400`}>
      <Icon size={20} strokeWidth={1.5} />
    </div>
  );
}

/**
 * 종류별 파일 수 — 'BDF 2 · 결과 1 · 기타 4'. 2026-11-19 — 0 인 종류는 뺀다(모델, 문서가 없다는 것은 제목 앞 구성 배지가 말한다).
 */
function KindCounts({ item }) {
  const counts = item.kind_counts;
  if (!counts) return <span className="flex gap-1">{item.kinds.map((k) => <KindBadge key={k} kind={k} />)}</span>;
  const kinds = [...COUNT_KINDS, 'other'].filter((k) => counts[k] > 0);
  if (!kinds.length) return null;
  return (
    <span className="tnum flex flex-wrap items-center gap-x-1.5 text-n-600" aria-label={`파일 ${kinds.map((k) => `${KIND_LABELS[k]} ${counts[k]}`).join(', ')}`}>
      {kinds.map((k, i) => (
        <span key={k} aria-hidden="true" className="whitespace-nowrap">
          {i > 0 && <span className="mr-1.5 text-n-300">·</span>}{KIND_LABELS[k]} <span className="font-mono text-n-800">{counts[k]}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * 2026-11-19 — 제목에서 둘째 줄과 겹치는 머리(이름 규칙 20·42: '호선 · 구역 · 대상 · 구별자')를 뺀 나머지.
 * 머리는 앞에서부터 차례로 맞을 때만 떼고, 구별자는 적어도 한 토막 남긴다. 전체 제목은 링크 title 에 둔다.
 */
export function titleTail(item) {
  const parts = String(item.title || '').split(' · ');
  const heads = [
    (p) => (item.hulls || []).includes(p) || (!!item.no_hull && p === '공용'),
    (p) => (item.zones || []).includes(p),
    (p) => !!item.target && p === item.target,
  ];
  let i = 0;
  for (const match of heads) {
    if (i < parts.length - 1 && match(parts[i])) i += 1;
  }
  return parts.slice(i).join(' · ');
}

/** 2026-11-19 — 담당자(과제를 한 사람, 주 담당자 먼저). 올린 사람은 일괄 이관으로 대부분 같아 행에 두지 않는다. */
function Assignees({ people }) {
  if (!people?.length) return null;
  const [main, ...rest] = people;
  const all = people.map((p) => `${p.name}${p.employed ? '' : '(퇴사)'}`).join(', ');
  return (
    <div className="truncate text-n-600" title={`담당자 ${all}`}>
      담당 <span className="text-n-800">{main.name}</span>
      {!main.employed && <span className="text-n-500"> 퇴사</span>}
      {rest.length > 0 && <span className="text-n-500"> 외 {rest.length}</span>}
    </div>
  );
}

/**
 * 2026-11-19 — 자료 구성 표시: 모델(BDF)과 문서(보고서, 발표자료)가 있는지를 제목 앞에서 바로 보이게.
 * 맨 아래 'BDF 2, 문서 1' 줄은 작고 흐려서 목록을 훑을 때 눈에 들어오지 않았다. 둘 다 없으면(도면, 기타만) 그리지 않는다.
 */
export function contentKind(item) {
  const c = item.kind_counts;
  const has = (k) => (c ? (c[k] || 0) > 0 : (item.kinds || []).includes(k));
  const m = has('model');
  const r = has('report');
  return m && r ? 'both' : m ? 'model' : r ? 'report' : null;
}
// 2026-11-19 — 세 가지 모두 중성 바탕. 초록은 '확정' 전용, 남색 옅은 바탕은 선택 행 바탕과 같아 배지가 묻혔다.
// 구분은 아이콘(상자, 문서)과 글자가 맡는다.
const CONTENT = {
  both: { label: '모델+문서', tip: 'BDF 모델과 문서(보고서, 발표자료)가 모두 있는 자료' },
  model: { label: '모델만', tip: 'BDF 모델만 있고 문서는 없는 자료' },
  report: { label: '문서만', tip: '문서(보고서, 발표자료)만 있고 BDF 모델은 없는 자료' },
};

export function ContentBadge({ item }) {
  const k = contentKind(item);
  if (!k) return null;
  const { label, tip } = CONTENT[k];
  return (
    <span title={tip} data-testid="content-kind"
          className="inline-flex h-5 shrink-0 items-center gap-1 rounded-xs bg-n-100 px-1.5 text-micro font-semibold text-n-700">
      {k !== 'report' && <Box size={11} aria-hidden="true" />}
      {k !== 'model' && <FileText size={11} aria-hidden="true" />}
      {label}
    </span>
  );
}

/** 자료 번호 + 복사 단추(2026-11-19). 눌러도 행 선택과 미리보기는 열리지 않는다. */
export function EntryIdCopy({ entryId }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  async function click(e) {
    e.stopPropagation();
    if (await copyText(entryId)) {
      setCopied(true);
      toast.show({ tone: 'ok', message: `자료 번호 ${entryId} 를 복사했습니다` });
    } else {
      toast.show({ tone: 'err', message: '복사하지 못했습니다. 번호를 직접 골라 복사해 주세요.' });
    }
  }
  return (
    <span className="inline-flex items-center justify-end gap-0.5">
      <span className="select-all font-mono text-n-500">{entryId}</span>
      <button type="button" onClick={click} onKeyDown={stop} aria-label={`자료 번호 ${entryId} 복사`} title="번호 복사"
              className={`-mr-1 inline-flex h-6 w-6 items-center justify-center rounded-sm transition-colors duration-150
                          hover:bg-n-100 hover:text-n-900 ${copied ? 'text-ok' : 'text-n-500'}`}>
        {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      </button>
    </span>
  );
}

/** 54 — 여러 자료 고르기 칸. 행을 누르면 미리보기, 이 칸을 누르면 고르기(행 동작으로 번지지 않게). */
function PickBox({ item, picked, onPick }) {
  return (
    <label onClick={stop} className="-ml-1 flex h-8 w-6 shrink-0 cursor-pointer items-center justify-center">
      <input type="checkbox" checked={picked.has(item.entry_id)} onChange={(e) => onPick(item.entry_id, e.target.checked)}
             aria-label={`${item.title || item.entry_id} 고르기`} className="h-4 w-4 cursor-pointer accent-brand" />
    </label>
  );
}

function EntryRow({ item, on, terms, filters, picked, onPick }) {
  // 호선 하나로 거른 검색이면 모든 행이 그 호선이라 칩을 빼서 줄을 짧게 한다(다른 호선은 남긴다).
  // 19 — 호선 여러 개(OR)로 걸렀으면 행마다 어느 호선인지가 정보라 그대로 둔다
  const hullFilter = filterValues(filters, 'hull');
  const hulls = hullFilter.length === 1 ? item.hulls.filter((h) => h !== hullFilter[0]) : item.hulls;
  const shared = !!item.no_hull && !item.hulls.length;
  // 둘째 줄 = 통제 값만, 고정 순서: 호선 · 구역 · 대상(38) · 선종 (42 — 해석 종류는 없앴다)
  // 값마다 그 값으로 거른 검색 링크(09) — '선미부' 를 누르면 구역 선미부 전체
  const meta = [...(item.zones || []).map((v) => ['zone', v]),
    ...(item.target ? [['target', item.target]] : []),
    ...(item.ship_types || []).map((v) => ['ship_type', v])];
  return (
    <div className="flex max-w-[1080px] items-start gap-3">
      {picked && <PickBox item={item} picked={picked} onPick={onPick} />}
      <RowThumb item={item} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <ContentBadge item={item} />
          {/* 2026-11-19 — 둘째 줄(호선, 구역, 대상)과 겹치는 제목 머리는 빼고 구별자만. 전체 제목은 title 로 */}
          <Link to={`/e/${item.entry_id}`} onClick={stop} title={item.title}
                className={`min-w-0 truncate text-body font-semibold tracking-[-0.005em] hover:underline ${on ? 'text-brand' : 'text-n-900'}`}>
            <TermHighlight text={titleTail(item)} terms={terms} />
          </Link>
          {item.status === 'draft' && <DraftBadge />}
          {/* 13 — 비공개(볼 수 있는 사람에게만 실린다) */}
          <AccessBadge item={item} />
          {/* 20 — 확정 BDF 자료의 빠진 필수 분류(올린 사람·LV3 에게만 실린다) */}
          <NeedsFixBadge missing={item.needs_fix} />
          {/* 53 — 다른 사람이 결론을 보고 서명한 자료(글자 + 아이콘, 색만으로 알리지 않는다) */}
          {item.reviewed && (
            <span title="검토 서명이 있는 자료" className="inline-flex shrink-0 items-center gap-0.5 text-meta text-ok">
              <Check size={12} aria-hidden="true" />검토됨
            </span>
          )}
        </div>
        {/* 53 — 결론 한 줄(자료가 알려 주는 것) */}
        {item.conclusion && (
          <p className="mt-1 line-clamp-1 text-ui text-n-800"><TermHighlight text={item.conclusion} terms={terms} /></p>
        )}
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
        {/* 2026-11-18 — 파일 이름으로 맞았으면 어느 파일인지. 제목·본문에 검색어가 없어도 왜 나왔는지 보이게 */}
        {item.matched_files?.length > 0 && (
          <p className="mt-1 line-clamp-1 text-meta text-n-600">
            <span className="mr-1.5 font-medium text-n-500">파일 이름</span>
            {item.matched_files.map((n, i) => <span key={n}>{i > 0 && ', '}<TermHighlight text={n} terms={terms} /></span>)}
          </p>
        )}
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
      <div className="w-[104px] shrink-0 space-y-0.5 text-right text-meta">
        <Assignees people={item.assignees} />
        {/* 15 — 날짜 = 올린 날짜(확정일, 초안은 등록일). 해석 시기는 없앴다. 2026-11-19 — 담당자 아래로, 한 단계 흐리게 */}
        {item.posted_at && (
          <div className="tnum text-n-500" title={formatDateTime(item.posted_at)}>올림 <span className="font-mono text-n-600">{item.posted_at.slice(0, 10)}</span></div>
        )}
        <div className="mt-1"><EntryIdCopy entryId={item.entry_id} /></div>
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
/** picked(Set entry_id)·onPick(entry_id, on) — 54 여러 자료 고르기(문서 보기에서만). 없으면 고르기 칸을 그리지 않는다. */
export default function ResultList({ unit, items, sections, selectedKey, onSelect, onOpen, terms, filters, picked, onPick }) {
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
        {unit === 'file' ? <FileRow item={it} on={on} /> : <EntryRow item={it} on={on} terms={terms} filters={filters} picked={picked} onPick={onPick} />}
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
