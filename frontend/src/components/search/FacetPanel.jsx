import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, Search, X } from 'lucide-react';
import { FILTER_KEYS, filterValues } from '../../lib/search.js';
import { FACET_LABELS, KIND_LABELS } from '../../lib/labels.js';
import { vocabKey } from '../../lib/vocab.js';

const SHOW = 8;
const GRID_SHOW = 12;   // 호선 격자는 3열 × 4줄
const MONO_KEYS = new Set(['hull']);
// 2026-11-06 — 처음엔 자주 쓰는 네 칸만 펼친다. 나머지는 접고, 고른 값이 있으면 펼친다. 사람이 연 칸·접은 칸은 기억한다
const OPEN_BY_DEFAULT = new Set(['hull', 'ship_type', 'zone', 'target']);
const OPEN_KEY = 'logbook_facet_open';

function readOpen() {
  try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') || {}; } catch { return {}; }
}
function writeOpen(name, value) {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify({ ...readOpen(), [name]: value })); } catch { /* 저장소가 막혀도 접기는 된다 */ }
}
const byNumber = (a, b) => a.value.localeCompare(b.value, 'ko', { numeric: true });

export function valueLabel(key, f) {
  if (key === 'kind') return KIND_LABELS[f.value] || f.value;
  if (key === 'uploaded_by' || key === 'assignee') return f.label || f.value;   // 사람은 이름(값은 사번·명부 번호)
  return f.value;
}

/** 숫자 값(호선)은 mono. */
export const isMonoValue = (key) => MONO_KEYS.has(key);

/**
 * 거르기 — 값·라벨(선종·이름)·동의어 어디에든 들어 있으면 남긴다(공백·대소문자 무시).
 * 분류 화면(09)과 필터 칸 안 찾기(19)가 같이 쓴다.
 */
export function matchesFilter(key, f, text) {
  const k = vocabKey(text);
  if (!k) return true;
  return [f.value, valueLabel(key, f), f.label, ...(f.aliases || [])].some((v) => v && vocabKey(v).includes(k));
}

/**
 * 필터 칸 하나. 19 — 값 여러 개를 고를 수 있다(같은 칸 안은 OR). 고른 값은 맨 위에 늘 보인다(찾기·더 보기와
 * 무관하게 해제할 수 있게).
 * 2026-11-06 가독성 — 머리를 눌러 접고 펼친다(고른 값이 있으면 늘 펼침). 호선은 번호 순 3열 격자
 * (4자리 mono 가 232px 에 셋 들어간다). 찾기 칸은 호선은 값이 많으면 늘, 다른 칸은 [더 보기] 로 펼쳤을 때만.
 * 값이 하나뿐이고 모든 결과가 그 값이면(예: 작성자 한 사람) 거를 힘이 없어 칸을 숨긴다(고른 값이 있으면 보인다).
 */
function Facet({ name, items, selected, onPick, total }) {
  const [more, setMore] = useState(false);
  const [expanded, setExpanded] = useState(() => readOpen()[name] ?? OPEN_BY_DEFAULT.has(name));
  const [find, setFind] = useState('');
  if (!items.length && !selected.length) return null;
  if (!selected.length && items.length === 1 && total != null && items[0].count >= total) return null;
  const grid = name === 'hull';
  const show = grid ? GRID_SHOW : SHOW;
  // 고른 값이 건수 목록에 없으면(0건) 그래도 보여야 해제할 수 있다.
  const byValue = new Map(items.map((f) => [f.value, f]));
  const picked = selected.map((v) => byValue.get(v) || { value: v, count: 0 });
  const others = items.filter((f) => !selected.includes(f.value));
  const rest = grid ? [...others].sort(byNumber) : others;
  const valueCount = picked.length + rest.length;
  const searchable = valueCount > show && (grid || more);
  const matched = find ? rest.filter((f) => matchesFilter(name, f, find)) : rest;
  // 찾는 중에는 맞는 값을 모두, 아니면 고른 값과 합쳐 show 개까지(더 보기로 전부)
  const room = Math.max(0, show - picked.length);
  const shown = more || find ? matched : matched.slice(0, room);
  const label = FACET_LABELS[name];
  const pinned = selected.length > 0;
  const isOpen = expanded || pinned;
  const toggle = () => { setExpanded(!isOpen); writeOpen(name, !isOpen); };
  const bodyId = `facet-${name}`;
  return (
    <div role="group" aria-label={label} className="group/facet mt-2.5 border-t border-n-200 pt-2.5 first:mt-0 first:border-t-0 first:pt-0">
      <div className="mb-1 flex items-center gap-1 pr-2">
        <button type="button" onClick={toggle} aria-expanded={isOpen} aria-controls={bodyId} disabled={pinned}
                title={pinned ? '고른 값이 있어 펼쳐 둡니다' : undefined}
                className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-left text-ui font-semibold text-n-800
                           transition-colors duration-150 ease-out hover:bg-n-100 disabled:cursor-default disabled:hover:bg-transparent">
          <ChevronRight size={14} aria-hidden="true"
                        className={`shrink-0 text-n-500 transition-transform duration-150 ease-out ${isOpen ? 'rotate-90' : ''}`} />
          <span className="truncate">{label}</span>
          {selected.length > 1 && <span className="shrink-0 text-meta font-normal text-n-500">{selected.length}개 중 하나</span>}
          {!isOpen && <span className="ml-auto shrink-0 font-mono text-meta font-normal text-n-500">{valueCount}</span>}
        </button>
        {/* 48 — 분류 메뉴 대신: 이 속성의 값 전체·건수(0건 포함)는 분류 화면에서. 칸에 올리거나 포커스가 있을 때만 */}
        {isOpen && (
          <Link to={`/browse?by=${name}`} title={`${label}의 모든 값과 자료 수를 봅니다`}
                className="shrink-0 rounded-xs text-meta text-n-500 underline-offset-2 opacity-0 transition-opacity duration-150 ease-out
                           hover:text-brand hover:underline focus-visible:opacity-100 group-hover/facet:opacity-100
                           group-focus-within/facet:opacity-100 [@media(hover:none)]:opacity-100">
            값 전체 보기
          </Link>
        )}
      </div>
      {isOpen && (
        <div id={bodyId}>
          {searchable && (
            <label className="mx-1 mb-1 flex h-7 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-1.5 text-meta
                              transition-[border-color] duration-150 focus-within:border-brand-ring hover:border-n-300">
              <Search size={12} aria-hidden="true" className="shrink-0 text-n-500" />
              <input type="search" value={find} onChange={(e) => setFind(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Escape' && find) { e.preventDefault(); e.stopPropagation(); setFind(''); } }}
                     aria-label={`${label} 값 찾기`} placeholder={`${label} 찾기`}
                     className="min-w-0 flex-1 bg-transparent text-meta text-n-900 outline-none placeholder:text-n-500 focus-visible:outline-none" />
            </label>
          )}
          {/* 격자는 칸 사이를 띄운다 — 붙이면 '2963 2 2972 1' 처럼 건수와 다음 호선이 한 줄로 읽힌다 */}
          <ul className={grid ? 'grid grid-cols-3 gap-x-2 gap-y-px' : 'flex flex-col gap-px'}>
            {[...picked, ...shown].map((f) => {
              const on = selected.includes(f.value);
              return (
                <li key={f.value} className="min-w-0">
                  <button type="button" onClick={() => onPick(f.value)} aria-pressed={on}
                          title={grid && f.label ? `${f.value} ${f.label}` : undefined}
                          className={`group flex h-7 w-full items-center rounded-md text-left text-ui transition-colors duration-150 ease-out
                            ${grid ? 'gap-1 px-1.5' : 'gap-2 px-2'}
                            ${on ? 'bg-brand-subtle font-medium text-brand hover:bg-brand-muted' : 'text-n-700 hover:bg-n-100 hover:text-n-900 active:bg-n-150'}`}>
                    <span className={`min-w-0 flex-1 truncate ${isMonoValue(name, f.value) ? 'font-mono' : ''}`}>{valueLabel(name, f)}</span>
                    {on ? (
                      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-label="해제">
                        <Check size={14} aria-hidden="true" className="group-hover:hidden" />
                        <X size={14} aria-hidden="true" className="hidden group-hover:block" />
                      </span>
                    ) : <span className={`shrink-0 font-mono text-n-500 ${grid ? 'text-micro' : 'text-meta'}`}>{f.count}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {find && matched.length === 0 && <p className="px-2 py-1 text-meta text-n-500">맞는 값이 없습니다</p>}
          {!find && rest.length > room && (
            <button type="button" onClick={() => { setMore(!more); setFind(''); }}
                    className="mt-0.5 h-6 rounded-md px-2 text-meta text-n-600 transition-colors duration-150 hover:bg-n-100 hover:text-n-900">
              {more ? '접기' : `더 보기 ${rest.length - room}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 필터 차원 목록. applied 는 서버가 정리한 필터 값(구역 동의어 → 대표 값, 칸마다 목록) — 있으면 그 값을 강조한다.
 * onChange(칸, 값) 은 그 값을 켜고 끈다(19). total = 결과 건수(자료 단위일 때만) — 거를 힘 없는 칸을 숨기는 데 쓴다.
 */
export function FacetList({ facets, filters, applied, onChange, total }) {
  return FILTER_KEYS.map((k) => {
    const selected = filterValues(applied?.[k] != null ? applied : filters, k);
    return <Facet key={k} name={k} items={facets?.[k] || []} selected={selected} total={total} onPick={(v) => onChange(k, v)} />;
  });
}

/** 필터와 건수(설계 §6.2). 건수는 서버가 "자기 필터만 뺀" 조건으로 센다. */
export default function FacetPanel({ className = '', ref, ...props }) {
  return (
    <aside ref={ref} aria-label="필터" className={`w-[232px] shrink-0 overflow-auto bg-n-50 px-2 py-3 ${className}`}>
      <FacetList {...props} />
    </aside>
  );
}
