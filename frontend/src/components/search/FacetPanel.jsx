import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { FILTER_KEYS } from '../../lib/search.js';
import { FACET_LABELS, KIND_LABELS } from '../../lib/labels.js';

const SHOW = 8;
const MONO_KEYS = new Set(['hull', 'year']);

export function valueLabel(key, f) {
  if (key === 'kind') return KIND_LABELS[f.value] || f.value;
  if (key === 'uploaded_by') return f.label || f.value;
  return f.value;
}

function Facet({ name, items, selected, onPick }) {
  const [open, setOpen] = useState(false);
  if (!items.length && !selected) return null;
  // 고른 값이 건수 목록에 없으면(0건) 그래도 보여야 해제할 수 있다.
  const all = selected && !items.some((f) => f.value === selected) ? [{ value: selected, count: 0 }, ...items] : items;
  const shown = open ? all : all.slice(0, SHOW);
  return (
    <div role="group" aria-label={FACET_LABELS[name]} className="mt-4 first:mt-0">
      <h3 className="mb-1 px-2 text-meta font-semibold text-n-700">{FACET_LABELS[name]}</h3>
      <ul className="flex flex-col gap-px">
        {shown.map((f) => {
          const on = selected === f.value;
          return (
            <li key={f.value}>
              <button type="button" onClick={() => onPick(on ? null : f.value)} aria-pressed={on}
                      className={`group flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-ui transition-colors duration-120 ease-out
                        ${on ? 'bg-brand-subtle font-medium text-brand hover:bg-brand-muted' : 'text-n-700 hover:bg-n-100 hover:text-n-900 active:bg-n-150'}`}>
                <span className={`min-w-0 flex-1 truncate ${MONO_KEYS.has(name) ? 'font-mono' : ''}`}>{valueLabel(name, f)}</span>
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
      {all.length > SHOW && (
        <button type="button" onClick={() => setOpen(!open)}
                className="mt-0.5 h-6 rounded-md px-2 text-meta text-n-600 transition-colors duration-120 hover:bg-n-100 hover:text-n-900">
          {open ? '접기' : `더 보기 ${all.length - SHOW}`}
        </button>
      )}
    </div>
  );
}

/**
 * 필터 차원 목록. applied 는 서버가 정리한 필터 값(구역 동의어 → 대표 값) — 있으면 그 값을 강조한다.
 */
export function FacetList({ facets, filters, applied, onChange }) {
  return FILTER_KEYS.map((k) => (
    <Facet key={k} name={k} items={facets?.[k] || []} selected={applied?.[k] ?? filters[k]} onPick={(v) => onChange(k, v)} />
  ));
}

/** 필터와 건수(설계 §6.2). 건수는 서버가 "자기 필터만 뺀" 조건으로 센다. */
export default function FacetPanel({ className = '', ...props }) {
  return (
    <aside aria-label="필터" className={`w-[232px] shrink-0 overflow-auto bg-n-50 px-2 py-3 ${className}`}>
      <FacetList {...props} />
    </aside>
  );
}
