import { useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { SOLVE_SUMMARY, barPct, bucketLabel, compact, num } from '../../lib/insight.js';
import { FACET_LABELS } from '../../lib/labels.js';
import { filterValues } from '../../lib/search.js';

const STORAGE_KEY = 'logbook.searchSummaryCollapsed.v1';
const SHOW_VALUES = 3;
const TONE_TEXT = { ok: 'text-ok', err: 'text-err', wait: 'text-wait', none: 'text-n-600' };

function readCollapsed() {
  try { return globalThis.localStorage?.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}
function writeCollapsed(v) {
  try { if (v) globalThis.localStorage?.setItem(STORAGE_KEY, '1'); else globalThis.localStorage?.removeItem(STORAGE_KEY); } catch { /* 없어도 동작 */ }
}

const Label = ({ children }) => <span className="shrink-0 text-meta font-medium text-n-600">{children}</span>;

/**
 * 값 막대 묶음(호선) — '값 ▬▬ 12'. 누르면 그 값을 필터에 더하고 다시 누르면 뺀다(19 — 한 칸 여러 값).
 * 한 색(옅은 남색)이고, 지금 걸린 값만 브랜드 남색으로 강조한다.
 */
function ValueBars({ field, items, more, selected, onFilter, mono = false }) {
  if (!items?.length) return null;
  const max = Math.max(...items.map((f) => f.count));
  return (
    <div role="group" aria-label={`${FACET_LABELS[field]} 분포`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <Label>{FACET_LABELS[field]}</Label>
      {items.slice(0, SHOW_VALUES).map((f) => {
        const on = selected.includes(f.value);
        return (
          <button key={f.value} type="button" aria-pressed={on} onClick={() => onFilter(field, f.value)}
                  title={`${FACET_LABELS[field]} ‘${f.value}’ ${f.count}건${on ? ' — 누르면 해제' : ' — 누르면 이 값으로 거르기'}`}
                  className={`group inline-flex h-6 min-w-0 items-center gap-1.5 rounded-sm px-1 text-meta transition-colors duration-150 ease-out hover:bg-n-100
                    ${on ? 'font-medium text-brand' : 'text-n-700 hover:text-n-900'}`}>
            <span className={`max-w-32 truncate ${mono ? 'font-mono' : ''}`}>{f.value}</span>
            <span aria-hidden="true" className="h-1.5 w-9 overflow-hidden rounded-full bg-n-100">
              <span className={`block h-full rounded-full ${on ? 'bg-brand' : 'bg-brand-ring/60 group-hover:bg-brand-ring'}`}
                    style={{ width: `${barPct(f.count, max)}%` }} />
            </span>
            <span className="font-mono text-n-600">{f.count}</span>
          </button>
        );
      })}
      {more > 0 && <span className="text-meta text-n-500">외 {more}</span>}
    </div>
  );
}

/** 모델 규모 — 요소 수 최소~최대 + 0 이 아닌 구간별 자료 수(필터가 아니라 보기만). */
function SizeSummary({ size }) {
  if (!size?.models) return null;
  const parts = size.buckets.filter((b) => b.count > 0);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-n-600" title="자료마다 대표 BDF 한 개의 요소 수">
      <Label>모델 규모</Label>
      <span className="tnum">요소 <span className="font-mono text-n-800">{compact(size.min)}</span>
        {size.max !== size.min && <>~<span className="font-mono text-n-800">{compact(size.max)}</span></>}</span>
      {parts.map((b) => (
        <span key={b.min} className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="text-n-300">·</span>
          <span>{bucketLabel(b)} <span className="font-mono">{b.count}</span></span>
        </span>
      ))}
    </div>
  );
}

/** 해석 검증 — 상태별 자료 수(아이콘 + 글자). 대표 모델 기준, 모델 없는 자료는 따로. */
function SolveCounts({ solve }) {
  if (!solve) return null;
  const parts = SOLVE_SUMMARY.filter((s) => solve[s.key] > 0);
  if (!parts.length) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1" title="자료마다 대표 BDF 한 개의 해석 검증 상태">
      <Label>해석 검증</Label>
      {parts.map((s) => (
        <span key={s.key} className={`inline-flex items-center gap-1 text-meta ${TONE_TEXT[s.tone]}`}>
          {s.tone === 'ok' && <Check size={12} strokeWidth={2.25} aria-hidden="true" />}
          {s.tone === 'err' && <X size={12} strokeWidth={2.25} aria-hidden="true" />}
          {s.label} <span className="font-mono">{num(solve[s.key])}</span>
        </span>
      ))}
      {solve.no_model > 0 && <span className="text-meta text-n-500">BDF 없음 <span className="font-mono">{num(solve.no_model)}</span></span>}
    </div>
  );
}

/**
 * 검색 결과 요약 띠(09) — 맞은 자료 전체(쪽이 아니라)의 분포를 두 줄로. 필터 열의 건수 목록과 달리
 * '한눈에 보기' 라 값은 위쪽 몇 개만, 막대를 누르면 그 필터가 걸린다. 접은 상태는 브라우저에 기억한다.
 * onFilter(칸, 값) — 그 값을 켜고 끈다(19).
 */
export default function ResultSummary({ summary, filters = {}, onFilter }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  if (!summary || summary.total < 2) return null;
  function toggle() { setCollapsed((c) => { writeCollapsed(!c); return !c; }); }
  const moreH = Math.max(0, (summary.hull_values || 0) - Math.min(SHOW_VALUES, summary.hull?.length || 0));
  return (
    <section aria-label="결과 요약" className="border-b border-n-200 bg-n-25 px-5 py-1.5">
      <button type="button" onClick={toggle} aria-expanded={!collapsed} aria-controls="result-summary-body"
              className="-mx-1 flex h-6 items-center gap-1 rounded-sm px-1 text-meta text-n-600 transition-colors duration-150 hover:bg-n-100 hover:text-n-900">
        <ChevronDown size={14} aria-hidden="true" className={`transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`} />
        결과 <span className="font-mono">{num(summary.total)}</span>건 요약
      </button>
      {!collapsed && (
        <div id="result-summary-body" className="flex flex-col gap-1 pb-1 pt-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-1">
            <ValueBars field="hull" items={summary.hull} more={moreH} selected={filterValues(filters, 'hull')} onFilter={onFilter} mono />
            <SizeSummary size={summary.model_size} />
            <SolveCounts solve={summary.solve} />
          </div>
        </div>
      )}
    </section>
  );
}
