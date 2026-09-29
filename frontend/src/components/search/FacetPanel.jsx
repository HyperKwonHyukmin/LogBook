import { useState } from 'react';
import { X } from 'lucide-react';
import { FILTER_KEYS } from '../../lib/search.js';
import { FACET_LABELS, KIND_LABELS } from '../../lib/labels.js';

const SHOW = 8;

function valueLabel(key, f) {
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
    <div role="group" aria-label={FACET_LABELS[name]} className="border-b border-line py-3">
      <h3 className="mb-1.5 px-1 text-xs font-semibold text-zinc-500">{FACET_LABELS[name]}</h3>
      <ul className="space-y-0.5">
        {shown.map((f) => {
          const on = selected === f.value;
          return (
            <li key={f.value}>
              <button type="button" onClick={() => onPick(on ? null : f.value)} aria-pressed={on}
                      className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] ${on ? 'bg-brand-tint font-semibold text-brand' : 'text-zinc-700 hover:bg-zinc-100'}`}>
                <span className={`min-w-0 flex-1 truncate ${name === 'hull' || name === 'year' ? 'font-mono' : ''}`}>{valueLabel(name, f)}</span>
                {on ? <X size={13} aria-label="해제" /> : <span className="font-mono text-xs tabular-nums text-zinc-500">{f.count}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {all.length > SHOW && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-1 px-2 text-xs text-brand hover:underline">
          {open ? '접기' : `더 보기 (${all.length - SHOW})`}
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
    <aside aria-label="필터" className={`w-60 shrink-0 overflow-auto border-r border-line bg-white px-3 ${className}`}>
      <FacetList {...props} />
    </aside>
  );
}
