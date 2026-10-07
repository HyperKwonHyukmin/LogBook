import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, GripVertical, Lock, Scissors, Trash2 } from 'lucide-react';
import Button from '../ui/Button.jsx';
import ChipInput from '../ui/ChipInput.jsx';
import VocabInput from '../ui/VocabInput.jsx';
import { useConfirm } from '../ui/ConfirmDialog.jsx';
import { Labeled, inputClass, selectClass } from '../ui/Field.jsx';
import KindBadge from '../ui/KindBadge.jsx';
import { api } from '../../api/client.js';
import { errorText, formatBytes } from '../../lib/labels.js';
import { MODEL_CONVERT_LABELS, draftChecks, modelConvertState } from '../../lib/inboxStatus.js';
import Spinner from '../ui/Spinner.jsx';

const DRAG_TYPE = 'application/x-logbook-file';
const hullRule = (v) => /^\d{4}$/.test(v) || '호선은 숫자 4자리입니다.';


/** 정리 대기 화면의 초안 Entry 카드 — 추정값을 고치고, 파일을 옮기고, 확정한다(설계 §5.5). */
const TEXT_FIELDS = ['title', 'analysis_period', 'description']; // 해석 종류·구역은 목록에서 고르는 즉시 저장(08)
/** 서버 쪽 내용이 실제로 바뀌었을 때만 달라지는 열쇠 — 폴링으로 같은 내용의 새 객체가 와도 입력을 지우지 않는다. */
const entryKey = (e) => `${e.entry_id}|${e.version}|${e.files.map((f) => f.id).join(',')}`;

export default function DraftCard({ entry, siblings, canEdit, onChanged }) {
  const [form, setForm] = useState(entry);
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); // 확정·버리기·나누기 등 동작 중(저장 중에는 켜지 않는다)
  const [over, setOver] = useState(false);
  const [confirm, dialog] = useConfirm();
  const baseRef = useRef(entry); // 폼이 마지막으로 맞춘 서버 값(칸별로 '고쳤는가'를 가린다)
  const versionRef = useRef(entry.version); // 다음 PATCH 에 실을 version — PATCH 응답으로 갱신
  const queueRef = useRef(Promise.resolve()); // 저장·동작을 한 줄로 세운다
  const saveFailedRef = useRef(''); // 실패한 저장의 사유(비었으면 실패 없음)

  const key = entryKey(entry);
  useEffect(() => {
    const base = baseRef.current;
    // 사용자가 고치고 아직 저장하지 않은 칸은 그대로 두고, 나머지는 서버 값으로 맞춘다.
    setForm((f) => {
      const next = { ...entry };
      for (const k of TEXT_FIELDS) if ((f[k] || '') !== (base[k] || '')) next[k] = f[k];
      return next;
    });
    baseRef.current = entry;
    versionRef.current = Math.max(versionRef.current, entry.version);
    saveFailedRef.current = '';
    const ids = new Set(entry.files.map((f) => f.id));
    setSelected((sel) => sel.filter((id) => ids.has(id)));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  function enqueue(task) {
    const p = queueRef.current.then(task);
    queueRef.current = p.catch(() => {});
    return p;
  }

  function fail(err) {
    setError(errorText(err));
    if (err.detail === 'version_conflict') onChanged();
  }

  /** 칸 저장 — 앞선 저장이 끝난 뒤 그 응답의 version 으로 보낸다. */
  function patch(fields) {
    return enqueue(async () => {
      try {
        const res = await api(`/entries/${entry.entry_id}`, { method: 'PATCH', body: { version: versionRef.current, ...fields } });
        takeVersion(res);
        saveFailedRef.current = '';
        setError('');
        onChanged();
      } catch (err) {
        saveFailedRef.current = errorText(err);
        fail(err);
      }
    });
  }

  /** 이 Entry 에 대한 응답이면 그 version 을 다음 저장에 쓴다(나누기는 '새' Entry 를 돌려주므로 거른다). */
  function takeVersion(res) {
    if (res?.entry_id === entry.entry_id && typeof res.version === 'number') versionRef.current = res.version;
  }

  /**
   * 확정·버리기·나누기·합치기·옮기기 — 줄 선 저장이 모두 끝난 뒤 실행한다.
   * 앞 저장이 실패했으면 실행하지 않고 그 사유를 다시 보여 준다(verb 예: '확정하지').
   */
  function act(fn, verb) {
    setBusy(true);
    return enqueue(async () => {
      if (saveFailedRef.current) {
        setError(`저장하지 못한 내용이 있어 ${verb} 않았습니다. ${saveFailedRef.current}`);
        return;
      }
      setError('');
      try { takeVersion(await fn()); onChanged(); } catch (err) { fail(err); }
    }).finally(() => setBusy(false));
  }

  const saveIfChanged = (k) => {
    const value = form[k] || '';
    if (value === (baseRef.current[k] || '')) return;
    baseRef.current = { ...baseRef.current, [k]: value };
    patch({ [k]: value || null });
  };
  const moveFile = (fileId, to) => act(() => api(`/files/${fileId}/move`, { method: 'POST', body: { to_entry_id: to } }), '옮기지');
  /** 칩은 화면 값을 먼저 바꾸고 저장한다 — 서버 새로 부르기 전에 이어서 더해도 앞 값이 빠지지 않게. */
  const setHulls = (v) => { setForm((f) => ({ ...f, hulls: v.map((h) => ({ hull_no: h })) })); patch({ hulls: v }); };
  const setZones = (v) => { setForm((f) => ({ ...f, zones: v })); patch({ zones: v }); };
  const setAtype = (v) => { setForm((f) => ({ ...f, analysis_type: v })); patch({ analysis_type: v }); };

  const disabled = !canEdit || busy; // 버튼용
  const fieldDisabled = !canEdit; // 입력 칸은 저장 중에도 막지 않는다(포커스가 빠지지 않게)
  const hulls = form.hulls.map((h) => h.hull_no);
  const checks = canEdit ? draftChecks(form, entry) : [];

  /** 초안 버리기 — 초안은 휴지통에서 복원할 수 없어 확인 대화상자를 거친다. */
  async function discard() {
    const ok = await confirm({
      title: `${entry.entry_id} 초안을 버릴까요?`,
      body: '파일은 휴지통으로 가며, 초안은 복원할 수 없습니다.',
      confirmLabel: '버리기',
    });
    if (ok) act(() => api(`/entries/${entry.entry_id}`, { method: 'DELETE' }), '버리지');
  }

  return (
    <article aria-label={`${entry.entry_id} ${entry.title}`}
             onDragOver={(e) => { if (canEdit) { e.preventDefault(); setOver(true); } }}
             onDragLeave={() => setOver(false)}
             onDrop={(e) => {
               e.preventDefault(); setOver(false);
               if (!canEdit) return;
               const raw = e.dataTransfer.getData(DRAG_TYPE);
               if (!raw) return;
               const { fileId, from } = JSON.parse(raw);
               if (from !== entry.entry_id) moveFile(fileId, entry.entry_id);
             }}
             className={`rounded-lg border bg-n-0 transition-[border-color,box-shadow] duration-150 ${over ? 'border-brand ring-3 ring-brand-muted' : 'border-n-200'}`}>
      {dialog}
      <header className="flex h-11 items-center gap-2.5 border-b border-n-200 px-4">
        <span className="inline-flex items-center gap-1.5 text-meta font-medium text-wait">
          <span className="h-1.5 w-1.5 rounded-full bg-wait" aria-hidden="true" />미확정
        </span>
        <span className="font-mono text-meta text-n-500">{entry.entry_id}</span>
        {!canEdit && <span className="inline-flex items-center gap-1 text-meta text-n-500"><Lock size={12} aria-hidden="true" />올린 사람만 수정</span>}
        <div className="flex-1" />
        <Button variant="ghost" size="sm" disabled={disabled} onClick={discard} className="hover:text-err">
          <Trash2 size={14} aria-hidden="true" />버리기
        </Button>
        <Button size="sm" disabled={disabled}
                onClick={() => act(() => api(`/entries/${entry.entry_id}/confirm`, { method: 'POST' }), '확정하지')}>
          <CheckCircle2 size={14} aria-hidden="true" />확정
        </Button>
      </header>
      {checks.length > 0 && (
        <p aria-label="확인할 것" className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 border-b border-n-200 bg-n-50 px-4 py-1.5 text-meta text-n-600">
          <span className="font-medium text-n-700">확인할 것</span>
          {checks.map((c, i) => (
            <span key={c.id} className={c.blocking ? 'font-medium text-err' : ''}>
              {i > 0 && <span aria-hidden="true" className="mr-1.5 text-n-400">·</span>}{c.text}
            </span>
          ))}
        </p>
      )}

      <div className="grid grid-cols-1 gap-x-4 gap-y-3 px-4 py-4 md:grid-cols-2">
        <Labeled label="제목">
          <input className={inputClass()} value={form.title || ''} disabled={fieldDisabled}
                 onChange={(e) => setForm({ ...form, title: e.target.value })} onBlur={() => saveIfChanged('title')} />
        </Labeled>
        <div className="flex min-w-0 flex-col gap-1 text-meta font-medium text-n-600">해석 종류
          <VocabInput kind="atype" label="해석 종류" value={form.analysis_type || null} disabled={fieldDisabled} onChange={setAtype} />
        </div>
        <div className="flex min-w-0 flex-col gap-1 text-meta font-medium text-n-600">호선
          <ChipInput label="호선" kind="hull" mono values={hulls} validate={hullRule} disabled={fieldDisabled}
                     onChange={setHulls} />
          {entry.hull_evidence?.length > 0 && (
            <span className="font-normal text-n-500">추정 근거: {entry.hull_evidence.map((h) => `${h.hull_no} (${(h.reasons || []).join(', ')})`).join(' · ')}</span>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1 text-meta font-medium text-n-600">구역
          <VocabInput multiple kind="zone" label="구역" values={form.zones} disabled={fieldDisabled} onChange={setZones} />
        </div>
        <Labeled label="해석 시기">
          <input className={inputClass('font-mono placeholder:font-sans')} value={form.analysis_period || ''} disabled={fieldDisabled} placeholder="YYYY-MM"
                 onChange={(e) => setForm({ ...form, analysis_period: e.target.value })} onBlur={() => saveIfChanged('analysis_period')} />
        </Labeled>
        <Labeled label="설명">
          <input className={inputClass()} value={form.description || ''} disabled={fieldDisabled}
                 onChange={(e) => setForm({ ...form, description: e.target.value })} onBlur={() => saveIfChanged('description')} />
        </Labeled>
      </div>

      {(entry.suggested_entry || entry.merge_into) && (
        <div className="mx-4 mb-4 flex flex-wrap items-center gap-2 rounded-md bg-brand-subtle px-3 py-2 text-ui text-n-800">
          {entry.merge_into ? (
            <>
              <span>확정하면 <span className="font-mono font-medium text-brand">{entry.merge_into.entry_id}</span> ‘{entry.merge_into.title}’ 에 파일이 추가됩니다.</span>
              <div className="flex-1" />
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => patch({ merge_into_id: null })}>새 Entry 로 확정</Button>
            </>
          ) : (
            <>
              <span>비슷한 기존 자료 <span className="font-mono font-medium text-brand">{entry.suggested_entry.entry_id}</span> ‘{entry.suggested_entry.title}’ 에 추가할까요?</span>
              <div className="flex-1" />
              <Button variant="secondary" size="sm" disabled={disabled} aria-label={`${entry.suggested_entry.entry_id} 에 추가`}
                      onClick={() => patch({ merge_into_id: entry.suggested_entry.entry_id })}>추가</Button>
            </>
          )}
        </div>
      )}

      <div className="border-t border-n-200">
        <div className="flex h-10 items-center gap-2 px-4 text-meta text-n-600">
          <span className="font-medium text-n-700">파일 <span className="font-mono font-normal text-n-500">{entry.files.length}</span></span>
          <div className="flex-1" />
          {canEdit && siblings.length > 0 && (
            <select aria-label="다른 묶음과 합치기" disabled={disabled} value="" className={selectClass('h-7 text-meta')}
                    onChange={(e) => e.target.value && act(() => api(`/entries/${entry.entry_id}/merge`, { method: 'POST', body: { from_entry_id: e.target.value } }), '합치지')}>
              <option value="">다른 묶음과 합치기…</option>
              {siblings.map((s) => <option key={s.entry_id} value={s.entry_id}>{s.entry_id} {s.title}</option>)}
            </select>
          )}
          {canEdit && (
            <Button variant="secondary" size="sm" disabled={disabled || selected.length === 0 || selected.length === entry.files.length}
                    onClick={() => act(() => api(`/entries/${entry.entry_id}/split`, { method: 'POST', body: { file_ids: selected } }), '나누지')}>
              <Scissors size={14} aria-hidden="true" />새 묶음으로 나누기
            </Button>
          )}
        </div>
        <ul>
          {entry.files.map((f) => (
            <li key={f.id} draggable={canEdit}
                onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ fileId: f.id, from: entry.entry_id }))}
                className="flex h-9 items-center gap-2.5 border-t border-n-200 px-4 text-ui transition-colors duration-150 hover:bg-n-50">
              {canEdit && <GripVertical size={14} className="cursor-grab text-n-400" aria-hidden="true" />}
              {canEdit && (
                <input type="checkbox" aria-label={`${f.rel_path} 선택`} checked={selected.includes(f.id)} disabled={busy}
                       className="h-3.5 w-3.5 accent-brand"
                       onChange={(e) => setSelected(e.target.checked ? [...selected, f.id] : selected.filter((x) => x !== f.id))} />
              )}
              <KindBadge kind={f.kind} name={f.name} />
              <span className="min-w-0 flex-1 truncate text-n-800" title={f.rel_path}>{f.rel_path}</span>
              {f.duplicate_of_entry && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-xs bg-wait-bg px-1.5 text-micro font-medium text-wait"><Copy size={11} aria-hidden="true" />{f.duplicate_of_entry} 에 이미 있음</span>
              )}
              <ConvertBadge f={f} />
              {f.drm_encrypted && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-xs bg-err-bg px-1.5 text-micro font-medium text-err"><AlertTriangle size={11} aria-hidden="true" />암호화됨</span>
              )}
              <span className="w-16 shrink-0 text-right font-mono text-meta text-n-500">{formatBytes(f.size)}</span>
              {canEdit && siblings.length > 0 && (
                <select aria-label={`${f.rel_path} 옮기기`} disabled={busy} value="" className={selectClass('h-6 px-1.5 text-micro')}
                        onChange={(e) => e.target.value && moveFile(f.id, e.target.value)}>
                  <option value="">옮기기…</option>
                  {siblings.map((s) => <option key={s.entry_id} value={s.entry_id}>{s.entry_id}</option>)}
                </select>
              )}
            </li>
          ))}
        </ul>
      </div>
      {error && <p role="alert" className="border-t border-err-line bg-err-bg px-4 py-2 text-ui text-err">{error}</p>}
    </article>
  );
}

const CONVERT_TONE = {
  queued: 'text-n-600', running: 'text-n-700', done: 'text-n-600', failed: 'text-err', skipped: 'text-n-500', include: 'text-n-500',
};

/** BDF 파일 줄의 3D 변환 상태(대기·변환 중·준비됨·실패). 모델 파일이 아니면 그리지 않는다. */
function ConvertBadge({ f }) {
  const st = modelConvertState(f);
  if (!st) return null;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 text-micro font-medium ${CONVERT_TONE[st]}`}
          title={st === 'failed' ? f.model?.error || undefined : undefined}>
      {st === 'running' && <Spinner size={11} />}
      {MODEL_CONVERT_LABELS[st]}
    </span>
  );
}
