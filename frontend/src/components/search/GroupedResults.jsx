import { ChevronDown, ChevronRight } from 'lucide-react';
import Button from '../ui/Button.jsx';
import ResultList, { itemKey } from './ResultList.jsx';
import { GROUP_SHARED, GROUPS } from '../../lib/search.js';

/** 묶음 안 자리 열쇠 — 같은 Entry 가 두 묶음에 나와도 고르기·키보드 이동이 섞이지 않게(묶음 번호를 붙인다). */
export function slotItems(items, gi) {
  return items.map((it) => ({ ...it, _slot: `g${gi}-${it.file_id ? `f${it.file_id}` : it.entry_id}` }));
}

const MONO = new Set(['hull']);

/** 묶음 머리의 값 글자 — 호선은 mono, 올린 사람은 이름(사번은 title). */
function GroupValue({ group, by }) {
  if (by === 'uploaded_by') return <span title={group.value}>{group.label || <span className="font-mono">{group.value}</span>}</span>;
  return <span className={MONO.has(by) ? 'font-mono' : ''}>{group.value}</span>;
}

/**
 * 묶어 보기(11) — 묶음 머리(접기·값으로 거르기·건수) 아래에 결과 행. 행 모양·키보드·미리보기는 ResultList 그대로.
 * groups: [{ value|null, label, count, items, more }], collapsed: Set(묶음 번호), onMore(gi), onFilter(value).
 */
export default function GroupedResults({ by, groups, collapsed, onToggle, onMore, onFilter, selectedKey, onSelect, onOpen,
                                         terms, filters, multiValued }) {
  const meta = GROUPS.find((g) => g.id === by) || { none: '없음' };
  const multiNote = {
    hull: '호선이 둘 이상인 자료', zone: '구역이 둘 이상인 자료', tag: '태그가 둘 이상인 자료',   // 19 — 태그별(프로젝트는 자료당 하나)
  }[by];
  const sections = groups.map((g, gi) => {
    const isOpen = !collapsed.has(gi);
    // 20 — '공용'(호선 없음을 고른 자료) 묶음은 거르기 값이 아니다(호선 필터에 없는 값)
    const shared = by === 'hull' && g.value === GROUP_SHARED;
    const title = g.value == null ? meta.none : shared ? '공용' : (by === 'uploaded_by' ? (g.label || g.value) : g.value);
    const left = g.count - g.items.length;
    return {
      key: `g${gi}`,
      collapsed: !isOpen,
      items: g.items,
      header: (
        <div id={`group-g${gi}`} className="sticky top-0 z-[5] flex h-9 items-center gap-1.5 border-b border-n-200 bg-n-50 pl-2 pr-5">
          <button type="button" aria-expanded={isOpen} aria-label={`${title} ${isOpen ? '접기' : '펼치기'}`} onClick={() => onToggle(gi)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-n-500 transition-colors duration-150 ease-out hover:bg-n-150 hover:text-n-900 active:bg-n-200">
            {isOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          </button>
          {g.value == null || shared ? (
            <span className="text-ui font-semibold text-n-600" title={shared ? "'호선 없음(공용)' 을 고른 자료" : undefined}>{title}</span>
          ) : (
            <button type="button" onClick={() => onFilter(g.value)} title={`‘${title}’ 로 거르기`}
                    className="min-w-0 truncate rounded-xs text-ui font-semibold text-n-900 underline-offset-2 transition-colors duration-150 hover:text-brand hover:underline">
              <GroupValue group={g} by={by} />
            </button>
          )}
          {by === 'hull' && !shared && g.label && <span className="shrink-0 text-meta text-n-500">{g.label}</span>}
          <span className="tnum shrink-0 text-meta text-n-500"><span className="font-mono">{g.count}</span>건</span>
          {!isOpen && g.count > 0 && <span className="sr-only">접힘</span>}
        </div>
      ),
      footer: left > 0 ? (
        <div className="border-b border-n-200 px-5 py-1.5">
          <Button variant="ghost" size="sm" onClick={() => onMore(gi)} loading={g.loading} className="-ml-2">
            더 보기 <span className="tnum text-n-500">남은 <span className="font-mono">{left}</span>건</span>
          </Button>
        </div>
      ) : null,
    };
  });
  return (
    <>
      {multiValued > 0 && multiNote && (
        <p className="border-b border-n-200 px-5 py-1.5 text-meta text-n-500">
          {multiNote} <span className="font-mono">{multiValued}</span>건은 해당하는 묶음마다 모두 보입니다.
        </p>
      )}
      <ResultList unit="entry" sections={sections} selectedKey={selectedKey} onSelect={onSelect} onOpen={onOpen}
                  terms={terms} filters={filters} />
    </>
  );
}

export { itemKey };
