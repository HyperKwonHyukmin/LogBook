import { useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { FILTER_KEYS, filterValues } from '../../lib/search.js';
import { FACET_LABELS, KIND_LABELS } from '../../lib/labels.js';
import { vocabKey } from '../../lib/vocab.js';

const SHOW = 8;
const MONO_KEYS = new Set(['hull']);

export function valueLabel(key, f) {
  if (key === 'kind') return KIND_LABELS[f.value] || f.value;
  if (key === 'uploaded_by') return f.label || f.value;
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
 * 무관하게 해제할 수 있게). 값이 SHOW 개보다 많으면 칸 안 찾기 입력이 생긴다(값·라벨·동의어, 공백·대소문자 무시).
 */
function Facet({ name, items, selected, onPick }) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState('');
  if (!items.length && !selected.length) return null;
  // 고른 값이 건수 목록에 없으면(0건) 그래도 보여야 해제할 수 있다.
  const byValue = new Map(items.map((f) => [f.value, f]));
  const picked = selected.map((v) => byValue.get(v) || { value: v, count: 0 });
  const rest = items.filter((f) => !selected.includes(f.value));
  const total = picked.length + rest.length;
  const searchable = total > SHOW;
  const matched = find ? rest.filter((f) => matchesFilter(name, f, find)) : rest;
  // 찾는 중에는 맞는 값을 모두, 아니면 고른 값과 합쳐 SHOW 개까지(더 보기로 전부)
  const room = Math.max(0, SHOW - picked.length);
  const shown = open || find ? matched : matched.slice(0, room);
  const label = FACET_LABELS[name];
  return (
    <div role="group" aria-label={label} className="mt-4 first:mt-0">
      <h3 className="mb-1 flex items-baseline gap-1.5 px-2 text-meta font-semibold text-n-700">
        {label}
        {selected.length > 1 && <span className="font-normal text-n-500">{selected.length}개 중 하나</span>}
      </h3>
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
      <ul className="flex flex-col gap-px">
        {[...picked, ...shown].map((f) => {
          const on = selected.includes(f.value);
          return (
            <li key={f.value}>
              <button type="button" onClick={() => onPick(f.value)} aria-pressed={on}
                      className={`group flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-ui transition-colors duration-150 ease-out
                        ${on ? 'bg-brand-subtle font-medium text-brand hover:bg-brand-muted' : 'text-n-700 hover:bg-n-100 hover:text-n-900 active:bg-n-150'}`}>
                <span className={`min-w-0 flex-1 truncate ${isMonoValue(name, f.value) ? 'font-mono' : ''}`}>{valueLabel(name, f)}</span>
                {on ? (
                  <span className="flex h-3.5 w-3.5 items-center justify-center" aria-label="해제">
                    <Check size={14} aria-hidden="true" className="group-hover:hidden" />
                    <X size={14} aria-hidden="true" className="hidden group-hover:block" />
                  </span>
                ) : <span className="font-mono text-meta text-n-500">{f.count}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {find && matched.length === 0 && <p className="px-2 py-1 text-meta text-n-500">맞는 값이 없습니다</p>}
      {!find && rest.length > room && (
        <button type="button" onClick={() => setOpen(!open)}
                className="mt-0.5 h-6 rounded-md px-2 text-meta text-n-600 transition-colors duration-150 hover:bg-n-100 hover:text-n-900">
          {open ? '접기' : `더 보기 ${rest.length - room}`}
        </button>
      )}
    </div>
  );
}

/**
 * 필터 차원 목록. applied 는 서버가 정리한 필터 값(구역 동의어 → 대표 값, 칸마다 목록) — 있으면 그 값을 강조한다.
 * onChange(칸, 값) 은 그 값을 켜고 끈다(19).
 */
export function FacetList({ facets, filters, applied, onChange }) {
  return FILTER_KEYS.map((k) => {
    const selected = filterValues(applied?.[k] != null ? applied : filters, k);
    return <Facet key={k} name={k} items={facets?.[k] || []} selected={selected} onPick={(v) => onChange(k, v)} />;
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
