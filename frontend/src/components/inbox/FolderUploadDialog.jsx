import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Folder } from 'lucide-react';
import Button from '../ui/Button.jsx';
import VocabInput from '../ui/VocabInput.jsx';
import AssigneeInput from '../people/AssigneeInput.jsx';
import { formatBytes } from '../../lib/labels.js';
import { initialChecked, previewDrafts, skippedByExt } from '../../lib/folderPlan.js';

/** 그룹 머리 체크 — 모두 체크면 체크, 일부면 중간 표시. */
function GroupCheck({ files, checked, onToggle, label }) {
  const ref = useRef(null);
  const n = files.filter((f) => checked.has(f.relPath)).length;
  useEffect(() => { if (ref.current) ref.current.indeterminate = n > 0 && n < files.length; }, [n, files.length]);
  return (
    <input ref={ref} type="checkbox" checked={n === files.length} onChange={() => onToggle(n < files.length)}
           aria-label={label} className="h-3.5 w-3.5 shrink-0" />
  );
}

/**
 * 52 — 폴더째 올리기 목록. 파일을 소속 폴더별로 보이고, 제외 추천 형식(op2·HyperView 등)은 체크를 풀어 둔다.
 * 묶는 단위(과제 폴더마다 / 전체 1건)와 모든 초안에 넣을 공통 분류(구역·대상·담당자)를 여기서 한 번 정한다.
 * onSubmit({ relPaths: Set, preset, splitTop }) · onCancel().
 */
export default function FolderUploadDialog({ plan, onSubmit, onCancel }) {
  const id = useId();
  const [checked, setChecked] = useState(() => initialChecked(plan));
  const [split, setSplit] = useState(plan.defaultSplit);
  const [zones, setZones] = useState([]);
  const [target, setTarget] = useState(null);
  const [assignees, setAssignees] = useState([]);
  const drafts = useMemo(() => previewDrafts(plan, checked, split), [plan, checked, split]);
  const skipped = useMemo(() => skippedByExt(plan, checked), [plan, checked]);
  const chosen = plan.files.filter((f) => checked.has(f.relPath));
  const chosenSize = chosen.reduce((s, f) => s + f.size, 0);
  const canSplit = !!plan.root && plan.groups.some((g) => g.dir.split('/').length >= 2);

  const set = (paths, on) => setChecked((cur) => {
    const next = new Set(cur);
    paths.forEach((p) => (on ? next.add(p) : next.delete(p)));
    return next;
  });
  const includeExt = (ext) => set(plan.files.filter((f) => f.ext === ext).map((f) => f.relPath), true);
  // 고른 폴더 이름은 모든 경로 앞에 같으니 떼고 보인다
  const shown = (dir) => (plan.root && dir.startsWith(plan.root) ? dir.slice(plan.root.length + 1) : dir) || '(맨 위)';

  function submit() {
    const preset = {
      zones, target: target || null,
      assignees: assignees.map((p) => (p.id ? { id: p.id } : { employee_id: p.employee_id })),
    };
    const empty = !zones.length && !target && !assignees.length;
    onSubmit({ relPaths: checked, preset: empty ? null : preset, splitTop: canSplit && split });
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 animate-fade">
      <div role="dialog" aria-modal="true" aria-labelledby={`${id}-t`}
           onKeyDown={(e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onCancel(); } }}
           className="flex max-h-[92vh] w-full max-w-[880px] animate-pop flex-col gap-4 rounded-xl bg-n-0 p-5 shadow-lg">
        <div>
          <h2 id={`${id}-t`} className="text-[16px] leading-6 font-semibold text-n-900">
            폴더 올리기{plan.root && <> · <span className="font-mono">{plan.root}</span></>}
          </h2>
          <p className="mt-1 text-ui text-n-600">
            체크한 파일만 올립니다. 결과·세션 파일(op2·mvw 등)은 체크를 풀어 두었으니, 필요하면 체크해서 함께 올리세요.
          </p>
        </div>

        <section aria-label="자료 묶기" className="flex flex-col gap-2">
          {canSplit && (
            <div role="radiogroup" aria-label="묶는 단위" className="flex flex-wrap gap-x-5 gap-y-1 text-ui text-n-800">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="radio" name={`${id}-split`} checked={split} onChange={() => setSplit(true)} />
                하위 폴더마다 자료 1건
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="radio" name={`${id}-split`} checked={!split} onChange={() => setSplit(false)} />
                폴더 전체를 자료 1건
              </label>
            </div>
          )}
          <ul aria-label="만들어질 초안" className="flex flex-wrap gap-1.5">
            {drafts.map((d) => (
              <li key={d.name} className="rounded-md border border-n-200 bg-n-25 px-2 py-1 text-meta text-n-700">
                <span className="font-medium text-n-900">{d.name}</span> · {d.count}개 · {formatBytes(d.size)}
              </li>
            ))}
            {!drafts.length && <li className="text-meta text-err">체크한 파일이 없습니다.</li>}
          </ul>
        </section>

        <section aria-label="공통 분류" className="grid gap-3 rounded-md border border-n-200 p-3 sm:grid-cols-3">
          <p className="text-meta text-n-600 sm:col-span-3">
            아래 값은 만들어지는 모든 초안에 같이 들어갑니다(선택). 호선은 넣지 않습니다. 초안마다 정리 대기에서 고칠 수 있습니다.
          </p>
          <div className="flex min-w-0 flex-col gap-1 text-meta font-medium text-n-600">
            <span>구역</span>
            <VocabInput multiple kind="zone" label="구역" values={zones} onChange={setZones} />
          </div>
          <div className="flex min-w-0 flex-col gap-1 text-meta font-medium text-n-600">
            <span>대상</span>
            <VocabInput kind="target" label="대상" value={target} onChange={(v) => setTarget(v || null)} />
          </div>
          <div className="flex min-w-0 flex-col gap-1 text-meta font-medium text-n-600">
            <span>담당자</span>
            <div className="font-normal"><AssigneeInput values={assignees} onChange={setAssignees} /></div>
          </div>
        </section>

        <section aria-label="올릴 파일" className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-n-600">
            <span className="text-ui text-n-800">
              <span className="font-mono">{chosen.length}</span> / <span className="font-mono">{plan.files.length}</span>개 체크 · {formatBytes(chosenSize)}
            </span>
            {skipped.map((s) => (
              <span key={s.ext} className="flex items-center gap-1">
                <span className="font-mono">{s.ext}</span> {s.count}개 빠짐
                <Button variant="ghost" size="sm" onClick={() => includeExt(s.ext)}>포함</Button>
              </span>
            ))}
            {plan.junk.length > 0 && <span>임시 파일 {plan.junk.length}개는 자동으로 뺍니다.</span>}
          </div>
          <div className="min-h-[120px] flex-1 overflow-y-auto rounded-md border border-n-200">
            {plan.groups.map((g) => (
              <div key={g.dir} role="group" aria-label={`${shown(g.dir)} 폴더`}>
                <label className="sticky top-0 flex cursor-pointer items-center gap-2 border-b border-n-100 bg-n-50 px-3 py-1.5 text-ui font-medium text-n-800">
                  <GroupCheck files={g.files} checked={checked} label={`${shown(g.dir)} 폴더 모두`}
                              onToggle={(on) => set(g.files.map((f) => f.relPath), on)} />
                  <Folder size={14} className="shrink-0 text-n-500" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-mono">{shown(g.dir)}</span>
                  <span className="text-meta font-normal text-n-500">{g.files.length}개</span>
                </label>
                <ul>
                  {g.files.map((f) => (
                    <li key={f.relPath}>
                      <label className="flex cursor-pointer items-center gap-2 py-1 pl-8 pr-3 text-ui text-n-800 hover:bg-n-25">
                        <input type="checkbox" checked={checked.has(f.relPath)} onChange={(e) => set([f.relPath], e.target.checked)}
                               aria-label={`${f.relPath} 올리기`} className="h-3.5 w-3.5 shrink-0" />
                        <span className={`min-w-0 flex-1 truncate ${checked.has(f.relPath) ? '' : 'text-n-500'}`}>{f.name}</span>
                        {f.skip && <span className="shrink-0 rounded bg-n-100 px-1.5 text-meta text-n-600">제외 추천</span>}
                        <span className="w-20 shrink-0 text-right font-mono text-meta text-n-500">{formatBytes(f.size)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>취소</Button>
          <Button variant="primary" disabled={!chosen.length} onClick={submit}>
            {drafts.length > 1 ? `초안 ${drafts.length}건으로 올리기` : '올리기'} ({chosen.length}개)
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
