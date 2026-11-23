import { useEffect, useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { api } from '../../api/client.js';
import { inputClass, selectClass } from '../ui/Field.jsx';
import { TASK_FIELDS } from '../../lib/entryEdit.js';

/** 68 — 과제 정보 칸 이름(서버 tasks.LABELS 와 같다). */
export const TASK_LABELS = {
  request_no: '과제의뢰서 NO.', category: 'Category', request_dept: '의뢰 부서', requester: '의뢰자',
  target_text: '대상(엑셀 원문)', key_point: 'Key point', purpose: '목적', criteria: '평가 기준',
  effect_note: '효과 설명', started_on: '시작 날짜', finished_on: '완료 날짜',
};
// 서버가 못 읽힐 때 쓰는 Category(2026년 통합과제 엑셀 6종, 서버 tasks.CATEGORIES 사본)
const CATEGORIES = ['공정공법 개선', '구조강도 평가 및 최적화', '안전', 'RCA', '변형 제어', '자동화 프로그램 개발'];

let cache = null;
/** 선택지(Category, 의뢰 부서 자동완성) — 처음 펼칠 때 한 번 읽고 화면이 사는 동안 같이 쓴다. */
function useTaskOptions(active) {
  const [opts, setOpts] = useState(cache);
  useEffect(() => {
    if (!active || cache) return;
    api('/tasks/options').then((o) => { cache = o; setOpts(o); }).catch(() => setOpts({ categories: CATEGORIES, departments: [] }));
  }, [active]);
  return opts || { categories: CATEGORIES, departments: [] };
}

const filled = (t) => TASK_FIELDS.filter((k) => String(t?.[k] ?? '').trim());

/** 접힌 머리줄에 보일 요약 — 의뢰서 NO., Category, 의뢰 부서. */
export function taskSummary(t) {
  return ['request_no', 'category', 'request_dept'].map((k) => String(t?.[k] ?? '').trim()).filter(Boolean).join(', ');
}

/**
 * 고치는 칸 묶음 — 접힌 '과제 정보'. value = 과제 정보(editValues 의 task), onChange(next), changed = 바뀐 표시.
 * 값이 있으면 펼친 채로 연다(과제 엑셀에서 온 초안은 바로 보이게).
 */
export function TaskFields({ value, onChange, changed = false, disabled = false }) {
  const [open, setOpen] = useState(() => filled(value).length > 0);
  const opts = useTaskOptions(open);
  const id = useId();
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const text = (k, max, wide = false) => (
    <label className={`flex flex-col gap-1 ${wide ? 'min-[700px]:col-span-2' : ''}`}>
      <span className="text-meta font-medium text-n-600">{TASK_LABELS[k]}</span>
      <input aria-label={TASK_LABELS[k]} value={value?.[k] ?? ''} onChange={set(k)} maxLength={max} disabled={disabled}
             list={k === 'request_dept' ? `${id}-dept` : undefined} className={inputClass('h-9 w-full')} />
    </label>
  );
  const summary = taskSummary(value);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="group rounded-md border border-n-200 bg-n-0">
      <summary className="flex min-h-9 cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-ui text-n-800 hover:bg-n-50 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} aria-hidden="true" className="text-n-500 transition-transform duration-150 group-open:rotate-90" />
        <span className="font-medium">과제 정보</span>
        {changed && <span className="text-meta text-brand">(변경됨)</span>}
        <span className="min-w-0 truncate text-meta text-n-500">{summary || '선택 칸: 과제의뢰서 NO., Category, 의뢰 부서 등'}</span>
      </summary>
      {open && (
        <div className="grid grid-cols-1 gap-3 border-t border-n-200 px-3 py-3 min-[700px]:grid-cols-2">
          {text('request_no', 80)}
          <label className="flex flex-col gap-1">
            <span className="text-meta font-medium text-n-600">{TASK_LABELS.category}</span>
            <select aria-label={TASK_LABELS.category} value={value?.category ?? ''} onChange={set('category')} disabled={disabled}
                    className={selectClass('h-9 w-full')}>
              <option value="">(없음)</option>
              {opts.categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          {text('request_dept', 60)}
          <datalist id={`${id}-dept`}>{opts.departments.map((d) => <option key={d} value={d} />)}</datalist>
          {text('requester', 60)}
          {text('key_point', 300)}
          {text('purpose', 300)}
          {text('criteria', 300, true)}
          <label className="flex flex-col gap-1 min-[700px]:col-span-2">
            <span className="text-meta font-medium text-n-600">{TASK_LABELS.effect_note}</span>
            <textarea aria-label={TASK_LABELS.effect_note} rows={2} value={value?.effect_note ?? ''} onChange={set('effect_note')}
                      maxLength={4000} disabled={disabled} className={inputClass('h-auto w-full py-1.5')} />
          </label>
          {['started_on', 'finished_on'].map((k) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-meta font-medium text-n-600">{TASK_LABELS[k]}</span>
              <input type="date" aria-label={TASK_LABELS[k]} value={value?.[k] ?? ''} onChange={set(k)} disabled={disabled}
                     className={inputClass('h-9 w-full')} />
            </label>
          ))}
          {String(value?.target_text ?? '').trim() && text('target_text', 200, true)}
        </div>
      )}
    </details>
  );
}

/** 읽기 화면 — 값이 있는 칸만 이름과 함께. 과제 정보가 없으면 그리지 않는다. */
export function TaskSummary({ task }) {
  const keys = filled(task);
  if (!keys.length) return null;
  return (
    <section aria-label="과제 정보" className="mt-3 rounded-md border border-n-200 px-3 py-2.5">
      <h2 className="text-meta font-semibold text-n-700">과제 정보</h2>
      <dl className="mt-1.5 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-ui">
        {keys.map((k) => (
          <div key={k} className="contents">
            <dt className="text-n-500">{TASK_LABELS[k]}</dt>
            <dd className="whitespace-pre-wrap text-n-800">{task[k]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
