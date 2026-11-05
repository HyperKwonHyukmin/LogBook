import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client.js';
import Button from '../ui/Button.jsx';
import VocabInput from '../ui/VocabInput.jsx';
import AssigneeInput from '../people/AssigneeInput.jsx';
import { selectClass } from '../ui/Field.jsx';
import { errorText } from '../../lib/labels.js';

/** 고른 칸 → 서버 본문(고르지 않은 칸은 건드리지 않는다). 바꿀 것이 없으면 null. */
export function bulkBody(entryIds, f) {
  const body = { entry_ids: entryIds };
  if (f.zonesAdd.length) body.zones_add = f.zonesAdd;
  if (f.zonesRemove.length) body.zones_remove = f.zonesRemove;
  if (f.targetMode === 'set' && f.target) Object.assign(body, { set_target: true, target: f.target });
  if (f.targetMode === 'clear') Object.assign(body, { set_target: true, target: null });
  if (f.assigneesAdd.length) body.assignees_add = f.assigneesAdd.map((p) => (p.id ? { id: p.id } : { employee_id: p.employee_id }));
  const remove = f.assigneesRemove.filter((p) => p.id).map((p) => p.id);
  if (remove.length) body.assignees_remove = remove;
  if (f.noHull !== '') body.no_hull = f.noHull === 'on';
  return Object.keys(body).length > 1 ? body : null;
}

const EMPTY = { zonesAdd: [], zonesRemove: [], targetMode: '', target: null, assigneesAdd: [], assigneesRemove: [], noHull: '' };

const failedText = (failed) => failed.map((f) => `${f.title || f.entry_id}(${f.reason})`).join(', ');

/**
 * 54 — 검색 결과에서 고른 자료의 분류를 한꺼번에 바꾼다. [미리보기]로 몇 건이 바뀌는지 먼저 보고 [N건 바꾸기].
 * 자료마다 한 건씩 고친 것과 같은 기록이 남고, 고칠 수 없는 자료는 건너뛴다(서버가 이유를 준다).
 * onDone(result) — 바꾼 뒤(검색을 다시 부른다), onCancel().
 */
export default function BulkClassifyDialog({ entryIds, onDone, onCancel }) {
  const id = useId();
  const [f, setF] = useState(EMPTY);
  const [preview, setPreview] = useState(null);   // 서버 dry_run 결과
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (v) => { setF((cur) => ({ ...cur, [k]: v })); setPreview(null); };
  const body = bulkBody(entryIds, f);
  useEffect(() => { setError(''); }, [f]);

  async function run(dryRun) {
    if (!body) return;
    setBusy(true);
    setError('');
    try {
      const r = await api('/entries/bulk-classify', { method: 'POST', body: { ...body, dry_run: dryRun } });
      if (dryRun) setPreview(r); else onDone(r);
    } catch (err) {
      setError(errorText(err, '분류를 바꾸지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 animate-fade">
      <div role="dialog" aria-modal="true" aria-labelledby={`${id}-t`}
           onKeyDown={(e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onCancel(); } }}
           className="flex max-h-[92vh] w-full max-w-[640px] animate-pop flex-col gap-4 overflow-y-auto rounded-xl bg-n-0 p-5 shadow-lg">
        <div>
          <h2 id={`${id}-t`} className="text-[16px] leading-6 font-semibold text-n-900">
            고른 자료 <span className="font-mono">{entryIds.length}</span>건 분류 바꾸기
          </h2>
          <p className="mt-1 text-ui text-n-600">고른 칸만 바꾸고 나머지는 그대로 둡니다. 자료마다 바뀐 기록이 남습니다.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1 text-meta font-medium text-n-600">
            <span>구역 더하기</span>
            <VocabInput multiple kind="zone" label="구역 더하기" values={f.zonesAdd} onChange={set('zonesAdd')} />
          </div>
          <div className="flex min-w-0 flex-col gap-1 text-meta font-medium text-n-600">
            <span>구역 빼기</span>
            <VocabInput multiple kind="zone" label="구역 빼기" values={f.zonesRemove} onChange={set('zonesRemove')} />
          </div>
          <div className="flex min-w-0 flex-col gap-1 text-meta font-medium text-n-600">
            <span>대상</span>
            <select aria-label="대상 바꾸기" value={f.targetMode} onChange={(e) => set('targetMode')(e.target.value)}
                    className={selectClass('h-8 text-ui')}>
              <option value="">그대로</option>
              <option value="set">이 값으로 바꾸기</option>
              <option value="clear">비우기</option>
            </select>
            {f.targetMode === 'set' && (
              <VocabInput kind="target" label="바꿀 대상" value={f.target} onChange={(v) => set('target')(v || null)} />
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1 text-meta font-medium text-n-600">
            <span>호선 없음(공용)</span>
            <select aria-label="공용 표시" value={f.noHull} onChange={(e) => set('noHull')(e.target.value)}
                    className={selectClass('h-8 text-ui')}>
              <option value="">그대로</option>
              <option value="on">공용으로 표시(호선이 있는 자료는 건너뜀)</option>
              <option value="off">공용 표시 풀기</option>
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-1 text-meta font-medium text-n-600">
            <span>담당자 더하기</span>
            <div className="font-normal"><AssigneeInput label="담당자 더하기" values={f.assigneesAdd} onChange={set('assigneesAdd')} /></div>
          </div>
          <div className="flex min-w-0 flex-col gap-1 text-meta font-medium text-n-600">
            <span>담당자 빼기</span>
            <div className="font-normal"><AssigneeInput label="담당자 빼기" values={f.assigneesRemove} onChange={set('assigneesRemove')} /></div>
          </div>
        </div>
        {preview && (
          <p role="status" className="rounded-md bg-n-50 px-3 py-2 text-ui text-n-800">
            바뀜 <span className="font-mono">{preview.changed.length}</span>건 · 이미 그 값 <span className="font-mono">{preview.same.length}</span>건
            {preview.failed.length > 0 && <> · 건너뜀 <span className="font-mono">{preview.failed.length}</span>건: {failedText(preview.failed)}</>}
          </p>
        )}
        {error && <p role="alert" className="rounded-md border border-err-line bg-err-bg px-3 py-2 text-ui text-err">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>취소</Button>
          {!preview ? (
            <Button variant="primary" disabled={!body || busy} loading={busy} onClick={() => run(true)}>미리보기</Button>
          ) : (
            <Button variant="primary" disabled={!preview.changed.length || busy} loading={busy} onClick={() => run(false)}>
              {preview.changed.length}건 바꾸기
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 바꾼 뒤 한 줄 안내. */
export function bulkDoneText(r) {
  const parts = [`${r.changed.length}건의 분류를 바꿨습니다.`];
  if (r.same.length) parts.push(`${r.same.length}건은 이미 그 값이었습니다.`);
  if (r.failed.length) parts.push(`건너뜀 ${r.failed.length}건: ${failedText(r.failed)}.`);
  return parts.join(' ');
}
