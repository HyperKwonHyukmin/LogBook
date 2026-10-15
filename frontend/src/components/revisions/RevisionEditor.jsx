import { ArrowDown, ArrowUp, Check, RotateCcw, X } from 'lucide-react';
import Button from '../ui/Button.jsx';
import { inputClass } from '../ui/Field.jsx';
import { addItem, moveItem, removeItem, setLabel, setLatest, singletonSeries } from '../../lib/revisions.js';

const selectClass = (extra = '') => `${inputClass(extra)} pr-6`;

/**
 * 판 정리 모드(14 D) — 계열에서 빼기·넣기, 순서, 최신판, 판 이름. [완료] 한 번에 저장한다(이력 한 줄).
 * state 는 lib/revisions.editorState() 모양. 저장·취소·되돌리기는 부모가 한다.
 */
export default function RevisionEditor({ state, setState, saving, error, onSave, onCancel, onReset, canReset }) {
  const singles = singletonSeries(state);
  const seriesName = (s, i) => `계열 ${i + 1} · ${s.items[0]?.name || ''}`;
  return (
    <section aria-label="판 정리" className="mb-3 rounded-lg border border-brand-muted bg-n-0">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-n-200 px-3 py-2">
        <h3 className="text-ui font-semibold text-n-900">판 정리</h3>
        <span className="text-meta text-n-600">순서·최신판·판 이름을 고치고 [완료]를 누르면 한 번에 저장합니다.</span>
        <div className="flex-1" />
        {canReset && (
          <Button variant="ghost" size="sm" onClick={onReset} disabled={saving} title="사용자가 정리한 것을 지우고 파일 이름·내용으로 다시 묶습니다">
            <RotateCcw size={14} aria-hidden="true" />자동 추정으로 되돌리기
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>취소</Button>
        <Button size="sm" onClick={onSave} loading={saving}><Check size={14} aria-hidden="true" />완료</Button>
      </header>
      <div className="flex flex-col gap-3 px-3 py-3">
        {error && <p role="alert" className="text-meta text-err">{error}</p>}
        {state.series.length === 0 && <p className="text-meta text-n-500">묶인 판이 없습니다. 아래 파일을 계열에 넣어 만드세요.</p>}
        {state.series.map((s, i) => (
          <div key={s.key} role="group" aria-label={seriesName(s, i)} className="rounded-md border border-n-200">
            <div className="flex h-8 items-center gap-2 border-b border-n-200 bg-n-50 px-2 text-meta font-medium text-n-700">
              {seriesName(s, i)}
              {s.items.length === 1 && <span className="font-normal text-wait">판이 하나뿐이라 저장하면 계열이 풀립니다</span>}
            </div>
            <ol className="flex flex-col">
              {s.items.map((x, k) => (
                <li key={x.file_id} className="flex min-h-9 flex-wrap items-center gap-2 border-t border-n-200 px-2 py-1 first:border-t-0">
                  <span className="w-6 shrink-0 text-right font-mono text-meta text-n-500">{k}</span>
                  <span className="min-w-0 flex-1 truncate text-ui text-n-800" title={x.name}>{x.name}</span>
                  <input aria-label={`${x.name} 판 이름`} value={x.label} maxLength={20} placeholder={`R${k}`}
                         onChange={(e) => setState(setLabel(state, i, x.file_id, e.target.value))}
                         className={inputClass('h-7 w-24 text-meta')} />
                  <label className="inline-flex items-center gap-1 text-meta text-n-700">
                    <input type="radio" name={`latest-${s.key}`} checked={s.latest === x.file_id} className="accent-brand"
                           onChange={() => setState(setLatest(state, i, x.file_id))} />최신판
                  </label>
                  <Button variant="ghost" size="icon-sm" aria-label={`${x.name} 위로`} disabled={k === 0}
                          onClick={() => setState(moveItem(state, i, x.file_id, -1))}><ArrowUp size={14} aria-hidden="true" /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`${x.name} 아래로`} disabled={k === s.items.length - 1}
                          onClick={() => setState(moveItem(state, i, x.file_id, 1))}><ArrowDown size={14} aria-hidden="true" /></Button>
                  <Button variant="ghost" size="sm" aria-label={`${x.name} 계열에서 빼기`}
                          onClick={() => setState(removeItem(state, i, x.file_id))}>
                    <X size={14} aria-hidden="true" />빼기
                  </Button>
                </li>
              ))}
            </ol>
          </div>
        ))}
        {state.others.length > 0 && (
          <div className="rounded-md border border-n-200">
            <div className="flex h-8 items-center border-b border-n-200 bg-n-50 px-2 text-meta font-medium text-n-700">계열 밖 모델</div>
            <ul>
              {state.others.map((x) => (
                <li key={x.file_id} className="flex h-9 items-center gap-2 border-t border-n-200 px-2 first:border-t-0">
                  <span className="min-w-0 flex-1 truncate text-ui text-n-800" title={x.name}>{x.name}</span>
                  <select aria-label={`${x.name} 넣을 계열`} value="" className={selectClass('h-7 text-meta')}
                          onChange={(e) => e.target.value !== '' && setState(addItem(state, x.file_id, e.target.value === 'new' ? 'new' : Number(e.target.value)))}>
                    <option value="">계열에 넣기…</option>
                    {state.series.map((s, i) => <option key={s.key} value={i}>{seriesName(s, i)}</option>)}
                    <option value="new">새 계열 만들기</option>
                  </select>
                </li>
              ))}
            </ul>
          </div>
        )}
        {singles > 0 && <p className="text-meta text-n-600">판이 하나뿐인 계열 {singles}개는 저장하면 계열 밖으로 돌아갑니다.</p>}
      </div>
    </section>
  );
}
