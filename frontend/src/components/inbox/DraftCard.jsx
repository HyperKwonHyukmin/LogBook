import { useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, GripVertical, Layers, Lock, Paperclip, Save, Scissors, Trash2, Wand2 } from 'lucide-react';
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
import { EntryLink, SameModelChips } from '../preview/SameModel.jsx';
import { changedFields, editErrors, editValues, patchBody } from '../../lib/entryEdit.js';
import { ACCESS_OPTIONS, AccessSelect } from '../access/AccessPanel.jsx';
import { accessOf, isAdminLevel } from '../../lib/levels.js';
import { AuthContext } from '../../auth/AuthContext.jsx';
import { DuplicateTargets } from './DuplicateBlocked.jsx';
import DraftAttachments from './DraftAttachments.jsx';
import HullPlmLookup from '../hull/HullPlmLookup.jsx';
import { DROP_ZONE_ATTR, isOsFileDrag, useOsFileDragActive } from './UploadZone.jsx';

const DRAG_TYPE = 'application/x-logbook-file';
/** 화면 안 끌기(카드 사이 파일 옮기기) — 탐색기에서 끌어 온 파일이 아님. */
const isInternalDrag = (e) => !isOsFileDrag(e);
const hullRule = (v) => /^\d{4}$/.test(v) || '호선은 숫자 4자리입니다.';


/**
 * 정리 대기 화면의 초안 Entry 카드 — 추정값을 고치고, 파일을 옮기고, 확정한다(설계 §5.5).
 * 11 — 고친 칸은 바로 저장하지 않는다. [변경 저장] 이나 [저장하고 확정](확정·나누기·합치기·옮기기 전에도)이
 * 바뀐 칸 전부를 한 번의 PATCH 로 보낸다. 카드 자체가 고치는 양식이라 [변경하기] 단계는 두지 않는다.
 */
// 15 — 해석 시기는 없앴다
// 20 — '호선 없음(공용)'(no_hull). 29 — 프로젝트(21)는 없앴다
const CARD_FIELDS = ['title', 'analysis_type', 'hulls', 'no_hull', 'zones', 'target', 'description'];
const FIELD_LABELS = { title: '제목', analysis_type: '해석 종류', hulls: '호선', no_hull: '호선 없음(공용)', zones: '구역',
  target: '대상', description: '설명' };
// 20 — 바뀌면 (사람이 고치지 않은) 초안 제목이 따라 바뀌는 칸(서버 update_entry 의 TITLE_VALUE_FIELDS 와 같다)
const TITLE_VALUE_FIELDS = ['hulls', 'no_hull', 'zones', 'analysis_type'];
/** 서버 쪽 내용이 실제로 바뀌었을 때만 달라지는 열쇠 — 폴링으로 같은 내용의 새 객체가 와도 입력을 지우지 않는다. */
const entryKey = (e) => `${e.entry_id}|${e.version}|${e.files.map((f) => f.id).join(',')}`;

export default function DraftCard({ entry, siblings, canEdit, onChanged, onDirtyChange }) {
  const [values, setValues] = useState(() => editValues(entry)); // 고치는 값
  const [base, setBase] = useState(() => editValues(entry));     // 마지막으로 맞춘 서버 값(바뀐 칸을 가린다)
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');
  const [dup, setDup] = useState(null); // 17 — 확정 409 duplicate_model 의 대상 목록(오류가 아니라 안내로 보인다)
  const canForce = isAdminLevel(useContext(AuthContext)?.user);
  const [busy, setBusy] = useState(false); // 저장·확정·버리기·나누기 등 동작 중
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const attaching = attachmentBusy || (entry.pending_attachments || []).length > 0;
  const [over, setOver] = useState(false);
  // 탐색기 파일을 끄는 동안 카드 전체가 '이 초안에 첨부' 받는 곳이 된다(화면 덮개 위로 올라온다)
  const dragging = useOsFileDragActive();
  const [osOver, setOsOver] = useState(false);
  const attachRef = useRef(null);
  const [confirm, dialog] = useConfirm();
  const versionRef = useRef(entry.version); // 다음 PATCH 에 실을 version — PATCH 응답으로 갱신
  const queueRef = useRef(Promise.resolve()); // 저장·동작을 한 줄로 세운다

  const key = entryKey(entry);
  useEffect(() => {
    const server = editValues(entry);
    // 사용자가 고치고 아직 저장하지 않은 칸은 그대로 두고, 나머지는 서버 값으로 맞춘다.
    setValues((v) => {
      const mine = changedFields(base, v);
      return { ...server, ...Object.fromEntries(mine.map((k) => [k, v[k]])) };
    });
    setBase(server);
    versionRef.current = Math.max(versionRef.current, entry.version);
    const ids = new Set(entry.files.map((f) => f.id));
    setSelected((sel) => sel.filter((id) => ids.has(id)));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = changedFields(base, values).filter((k) => CARD_FIELDS.includes(k));
  const dirty = changed.length > 0;
  const { title: _ignored, ...errors } = editErrors(values); // 제목 비움은 저장은 되고 확정만 막는다(확인할 것)
  const invalid = Object.keys(errors).length > 0;
  useEffect(() => { onDirtyChange?.(entry.entry_id, dirty || attachmentBusy); }, [dirty, attachmentBusy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDirtyChange?.(entry.entry_id, false), []); // eslint-disable-line react-hooks/exhaustive-deps

  function enqueue(task) {
    const p = queueRef.current.then(task);
    queueRef.current = p.catch(() => {});
    return p;
  }

  function fail(err) {
    if (err?.status === 409 && err.detail?.code === 'duplicate_model') {
      setError('');
      setDup(err.detail);
      return;
    }
    setError(errorText(err));
    if (err.detail === 'version_conflict') onChanged();
  }

  /** 이 Entry 에 대한 응답이면 그 version 을 다음 저장에 쓴다(나누기는 '새' Entry 를 돌려주므로 거른다). */
  function takeVersion(res) {
    if (res?.entry_id === entry.entry_id && typeof res.version === 'number') versionRef.current = res.version;
  }

  /** 줄 안에서 바뀐 칸 전부를 한 번의 PATCH 로 — 성공하면 true. 바뀐 것이 없으면 그대로 true. */
  async function saveNow() {
    const body = patchBody(base, values);
    if (Object.keys(body).length === 0) return true;
    const res = await api(`/entries/${entry.entry_id}`, { method: 'PATCH', body: { version: versionRef.current, ...body } });
    takeVersion(res);
    if (res?.entry_id === entry.entry_id) setBase(editValues(res));
    return true;
  }

  /** [변경 저장] */
  function save() {
    if (!dirty || invalid) return Promise.resolve();
    setBusy(true);
    return enqueue(async () => {
      setError('');
      try { await saveNow(); onChanged(); } catch (err) { fail(err); }
    }).finally(() => setBusy(false));
  }

  /**
   * 확정·나누기·합치기·옮기기 — 저장하지 않은 변경이 있으면 먼저 한 번에 저장하고 실행한다(저장이 실패하면 실행하지 않는다).
   * verb 예: '확정하지'.
   */
  function act(fn, verb) {
    if (attaching) {
      setError('파일 첨부가 끝난 뒤 다시 진행해 주세요.');
      return Promise.resolve();
    }
    if (dirty && invalid) {
      setError(`고칠 칸을 확인해 주세요 — 저장하지 못해 ${verb} 않았습니다.`);
      return Promise.resolve();
    }
    setBusy(true);
    return enqueue(async () => {
      setError('');
      setDup(null);
      try {
        await saveNow();
      } catch (err) {
        setError(`저장하지 못해 ${verb} 않았습니다. ${errorText(err)}`);
        if (err.detail === 'version_conflict') onChanged();
        return;
      }
      try { takeVersion(await fn()); onChanged(); } catch (err) { fail(err); }
    }).finally(() => setBusy(false));
  }

  /** 13·15 — 공개 범위(확정 전에 고른다, 기본 일반) — 합치기 제안처럼 그 한 칸만 바로 바꾼다. 블록은 LV3 만. */
  function patchAccess(value) {
    setBusy(true);
    return enqueue(async () => {
      try {
        const res = await api(`/entries/${entry.entry_id}`, { method: 'PATCH', body: { version: versionRef.current, access: value } });
        takeVersion(res);
        setError('');
        onChanged();
      } catch (err) { fail(err); }
    }).finally(() => setBusy(false));
  }

  /** 기존 Entry 에 추가하기 제안 — 그 한 칸만 바로 바꾼다(고친 칸과 섞지 않는다). */
  function patchMerge(value) {
    setBusy(true);
    return enqueue(async () => {
      try {
        const res = await api(`/entries/${entry.entry_id}`, { method: 'PATCH', body: { version: versionRef.current, merge_into_id: value } });
        takeVersion(res);
        setError('');
        onChanged();
      } catch (err) { fail(err); }
    }).finally(() => setBusy(false));
  }

  const set = (k) => (v) => setValues((cur) => ({ ...cur, [k]: v }));
  // 20 — 호선을 넣으면 '호선 없음(공용)' 이 풀리고, 공용을 고르면 호선을 비운다
  const setHulls = (v) => setValues((cur) => ({ ...cur, hulls: v, no_hull: v.length ? false : cur.no_hull }));
  const setNoHull = (on) => setValues((cur) => ({ ...cur, no_hull: on, hulls: on ? [] : cur.hulls }));
  const revert = () => { setValues(base); setError(''); };
  const moveFile = (fileId, to) => act(() => api(`/files/${fileId}/move`, { method: 'POST', body: { to_entry_id: to } }), '옮기지');

  const disabled = !canEdit || busy || attaching; // 버튼용
  const fieldDisabled = !canEdit; // 입력 칸은 저장 중에도 막지 않는다(포커스가 빠지지 않게)
  const form = { ...values, hulls: values.hulls.map((h) => ({ hull_no: h })) };
  const checks = canEdit ? draftChecks(form, entry) : [];
  // 20 — 확정을 막는 것(제목·BDF 자료의 필수 분류)이 있으면 확정 단추를 잠그고 이유를 보인다
  const blocking = checks.filter((c) => c.blocking);
  const confirmBlocked = blocking.length > 0;
  const advisory = checks.filter((c) => !c.blocking);
  const checksId = `checks-${entry.entry_id}`;
  const dropTarget = canEdit && dragging;
  // 20 — 제목 초안(title_draft): 서버가 저장된 값으로 만든 형식 제목. 값을 바꿔 저장하면 서버가 다시 만든다
  const valuesDirty = changed.some((k) => TITLE_VALUE_FIELDS.includes(k));
  const willFollow = !!entry.title_is_auto && valuesDirty && !changed.includes('title');
  const showRegen = canEdit && !entry.merge_into && !!entry.title_draft && !willFollow
    && (valuesDirty || values.title.trim() !== entry.title_draft);
  const similar = (entry.similar_entries || []).filter((s) => s.entry_id !== entry.suggested_entry?.entry_id);
  const regenTitle = () => act(() => api(`/entries/${entry.entry_id}`,
    { method: 'PATCH', body: { version: versionRef.current, title_auto: true } }), '제목을 만들지');
  const mark = (k) => (changed.includes(k) ? <ChangedDot /> : null);

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
    <article aria-label={`${entry.entry_id} ${entry.title}`} {...(canEdit ? { [DROP_ZONE_ATTR]: '' } : {})}
             // 화면 안 끌기 = 카드 사이 파일 옮기기, 탐색기 파일 = 이 초안에 첨부(올린 사람만)
             onDragOver={(e) => {
               if (!canEdit) return;
               e.preventDefault();
               if (isInternalDrag(e)) setOver(true); else setOsOver(true);
             }}
             onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) { setOver(false); setOsOver(false); } }}
             onDrop={(e) => {
               if (!isInternalDrag(e)) {
                 if (!canEdit) return;
                 e.preventDefault(); setOsOver(false);
                 attachRef.current?.drop(e.dataTransfer);
                 return;
               }
               e.preventDefault(); setOver(false);
               if (!canEdit) return;
               const raw = e.dataTransfer.getData(DRAG_TYPE);
               if (!raw) return;
               const { fileId, from } = JSON.parse(raw);
               if (from !== entry.entry_id) moveFile(fileId, entry.entry_id);
             }}
             className={`rounded-lg border bg-n-0 transition-[border-color,box-shadow] duration-150 ${
               over || (dropTarget && osOver) ? 'border-brand ring-3 ring-brand-muted'
                 : dropTarget ? 'border-brand-ring' : 'border-n-200'} ${dropTarget ? 'relative z-50' : ''}`}>
      {dialog}
      <header className="flex h-11 items-center gap-2.5 border-b border-n-200 px-4">
        <span className="inline-flex items-center gap-1.5 text-meta font-medium text-wait">
          <span className="h-1.5 w-1.5 rounded-full bg-wait" aria-hidden="true" />미확정
        </span>
        <span className="font-mono text-meta text-n-500">{entry.entry_id}</span>
        {dropTarget && (
          <span role="status" className="inline-flex min-w-0 items-center gap-1.5 text-meta font-medium text-brand">
            <Paperclip size={13} className="shrink-0" aria-hidden="true" />
            <span className="flex min-w-0">
              <span className="min-w-0 truncate">{entry.title}</span>
              <span className="shrink-0">{osOver ? '에 놓으면 첨부합니다' : '에 첨부하려면 이 카드에 놓기'}</span>
            </span>
          </span>
        )}
        {!canEdit && <span className="inline-flex items-center gap-1 text-meta text-n-500"><Lock size={12} aria-hidden="true" />올린 사람만 수정</span>}
        <div className="flex-1" />
        <Button variant="ghost" size="sm" disabled={disabled} onClick={discard} className="hover:text-err">
          <Trash2 size={14} aria-hidden="true" />버리기
        </Button>
        <Button size="sm" disabled={disabled || confirmBlocked}
                aria-describedby={confirmBlocked ? checksId : undefined}
                title={confirmBlocked ? `확정할 수 없음: ${blocking.map((c) => c.text.split(': ')[0]).join(', ')}`
                  : attaching ? '파일 첨부가 끝난 뒤 확정할 수 있습니다' : dirty ? '바뀐 칸을 저장한 뒤 확정합니다' : undefined}
                onClick={() => act(() => api(`/entries/${entry.entry_id}/confirm`, { method: 'POST' }), '확정하지')}>
          <CheckCircle2 size={14} aria-hidden="true" />{dirty ? '저장하고 확정' : '확정'}
        </Button>
      </header>
      {checks.length > 0 && (
        <p id={checksId} aria-label="확인할 것" className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 border-b border-n-200 bg-n-50 px-4 py-1.5 text-meta text-n-600">
          <span className="font-medium text-n-700">확인할 것</span>
          {/* 확정을 막는 것과 권하는 것을 색만이 아니라 머리말로도 나눈다 */}
          {blocking.length > 0 && (
            <span className="inline-flex items-center gap-1 font-medium text-err">
              <AlertTriangle size={12} aria-hidden="true" />확정 전에 필요
            </span>
          )}
          {blocking.map((c, i) => (
            <span key={c.id} className="text-err">
              {i > 0 && <span aria-hidden="true" className="mr-1.5 text-n-400">·</span>}{c.text}
            </span>
          ))}
          {advisory.length > 0 && <span className={`font-medium text-n-700 ${blocking.length ? 'ml-2' : ''}`}>권장</span>}
          {advisory.map((c, i) => (
            <span key={c.id}>
              {i > 0 && <span aria-hidden="true" className="mr-1.5 text-n-400">·</span>}{c.text}
            </span>
          ))}
        </p>
      )}

      <div className="grid grid-cols-1 gap-x-4 gap-y-3 px-4 py-4 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Labeled label={<>제목{mark('title')}</>}>
            <input aria-label="제목" className={inputClass()} value={values.title} disabled={fieldDisabled}
                   onChange={(e) => set('title')(e.target.value)} />
          </Labeled>
          {/* 20 — 제목 형식: 호선 · 구역 · 해석 종류 · 구별자(원래 이름에서 호선·분류·잡음을 뺀 나머지) */}
          {canEdit && willFollow && (
            <span className="text-meta text-n-500">저장하면 제목이 형식대로 바뀝니다(호선 · 구역 · 해석 종류).</span>
          )}
          {showRegen && (
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-n-500">
              <span className="min-w-0 truncate">
                형식: {valuesDirty ? '저장한 값으로 다시 만듭니다' : <span className="text-n-700">{entry.title_draft}</span>}
              </span>
              <Button variant="ghost" size="sm" disabled={disabled} onClick={regenTitle}>
                <Wand2 size={13} aria-hidden="true" />형식대로 다시 만들기
              </Button>
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1 text-meta font-medium text-n-600"><span>해석 종류{mark('analysis_type')}</span>
          <VocabInput kind="atype" label="해석 종류" value={values.analysis_type || null} disabled={fieldDisabled}
                      onChange={(v) => set('analysis_type')(v || '')} />
        </div>
        <div className="flex min-w-0 flex-col gap-1 text-meta font-medium text-n-600"><span>호선{mark('hulls')}</span>
          <ChipInput label="호선" kind="hull" mono values={values.hulls} validate={hullRule} disabled={fieldDisabled}
                     onChange={setHulls} />
          {canEdit ? (
            <label className="inline-flex w-fit items-center gap-1.5 font-normal text-n-600">
              <input type="checkbox" className="h-3.5 w-3.5 accent-brand" checked={!!values.no_hull}
                     onChange={(e) => setNoHull(e.target.checked)} />
              호선 없음(공용){mark('no_hull')}
            </label>
          ) : values.no_hull && <span className="font-normal text-n-600">공용(호선 없음)</span>}
          {canEdit && <HullPlmLookup hulls={values.hulls} disabled={fieldDisabled} />}
          {entry.hull_evidence?.length > 0 && (
            <span className="font-normal text-n-500">추정 근거: {entry.hull_evidence.map((h) => `${h.hull_no} (${(h.reasons || []).join(', ')})`).join(' · ')}</span>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1 text-meta font-medium text-n-600"><span>구역{mark('zones')}</span>
          <VocabInput multiple kind="zone" label="구역" values={values.zones} disabled={fieldDisabled} onChange={set('zones')} />
        </div>
        {/* 38 — 대상 구조물(선택). 고르면 초안 제목의 해석 종류 뒤에 붙는다 */}
        <div className="flex min-w-0 flex-col gap-1 text-meta font-medium text-n-600"><span>대상 <span className="font-normal text-n-500">(선택)</span>{mark('target')}</span>
          <VocabInput kind="target" label="대상" value={values.target || null} disabled={fieldDisabled}
                      onChange={(v) => set('target')(v || '')} />
        </div>
        <Labeled label={<>설명{mark('description')}</>}>
          <input aria-label="설명" className={inputClass()} value={values.description} disabled={fieldDisabled}
                 onChange={(e) => set('description')(e.target.value)} />
        </Labeled>
        {/* 13 — 공개 범위. 기존 자료에 추가하는 초안은 대상 자료의 범위를 따른다 */}
        {!entry.merge_into && (
          <div className="flex min-w-0 flex-col gap-1 text-meta font-medium text-n-600">
            <span>공개 범위</span>
            <AccessSelect value={accessOf(entry)} disabled={disabled || (accessOf(entry) === 'blocked' && !entry.can_block)}
                          canBlock={!!entry.can_block} onChange={patchAccess} />
            <span className="font-normal text-n-500">
              {ACCESS_OPTIONS.find((o) => o.value === accessOf(entry)).help}
            </span>
          </div>
        )}
      </div>
      {canEdit && dirty && (
        // 11 — 저장하지 않은 변경. [확정] 을 눌러도 먼저 저장한다
        <div role="status" aria-label="저장하지 않은 변경"
             className="mx-4 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md bg-n-50 px-3 py-2 text-meta text-n-700">
          <span className="min-w-0 flex-1">
            저장하지 않은 변경 <span className="font-mono">{changed.length}</span>칸 · {CARD_FIELDS.filter((k) => changed.includes(k)).map((k) => FIELD_LABELS[k]).join(', ')}
          </span>
          <Button variant="ghost" size="sm" onClick={revert} disabled={busy}>되돌리기</Button>
          <Button variant="secondary" size="sm" onClick={save} disabled={busy || invalid}>
            <Save size={14} aria-hidden="true" />변경 저장
          </Button>
        </div>
      )}

      {(entry.suggested_entry || entry.merge_into) && (
        <div className="mx-4 mb-4 flex flex-wrap items-center gap-2 rounded-md bg-brand-subtle px-3 py-2 text-ui text-n-800">
          {entry.merge_into ? (
            <>
              <span>확정하면 <span className="font-mono font-medium text-brand">{entry.merge_into.entry_id}</span> ‘{entry.merge_into.title}’ 에 파일이 추가됩니다.</span>
              <div className="flex-1" />
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => patchMerge(null)}>새 Entry 로 확정</Button>
            </>
          ) : (
            <>
              <span>비슷한 기존 자료 <span className="font-mono font-medium text-brand">{entry.suggested_entry.entry_id}</span> ‘{entry.suggested_entry.title}’ 에 추가할까요?</span>
              <div className="flex-1" />
              <Button variant="secondary" size="sm" disabled={disabled} aria-label={`${entry.suggested_entry.entry_id} 에 추가`}
                      onClick={() => patchMerge(entry.suggested_entry.entry_id)}>추가</Button>
            </>
          )}
        </div>
      )}

      {/* 20 — 같은 호선에 같은·비슷한 제목의 자료(막지 않는다). 같은 자료의 새 판이면 그 자료에 추가하면 판으로 묶인다(14) */}
      {canEdit && !entry.merge_into && similar.length > 0 && (
        <section aria-label="비슷한 제목" className="mx-4 mb-4 rounded-md bg-wait-bg px-3 py-2 text-meta text-n-800">
          <p className="font-medium text-wait">같은 호선에 같거나 비슷한 제목의 자료가 있습니다 — 확정은 할 수 있습니다.</p>
          <ul className="mt-1 flex flex-col gap-1">
            {similar.map((s) => (
              <li key={s.entry_id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <EntryLink entryId={s.entry_id} className="shrink-0 font-mono font-medium text-brand hover:underline">{s.entry_id}</EntryLink>
                <span className="min-w-0 truncate">‘{s.title}’</span>
                <span className="text-n-500">{s.match === 'same' ? '같은 제목' : '비슷한 제목'}</span>
                <div className="flex-1" />
                <Button variant="ghost" size="sm" disabled={disabled} aria-label={`${s.entry_id} 에 새 판으로 추가`}
                        onClick={() => patchMerge(s.entry_id)}>새 판이면 이 자료에 추가</Button>
              </li>
            ))}
          </ul>
        </section>
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
        {/* 14 — 이 초안 안의 BDF 판 묶음(이름만 — 변경 비교는 확정 뒤 상세에서) */}
        {entry.revisions?.length > 0 && (
          <ul aria-label="판 묶음" className="flex flex-col gap-0.5 border-t border-n-200 px-4 py-1.5">
            {entry.revisions.map((s) => (
              <li key={s.key} className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-meta text-n-600">
                <Layers size={12} className="shrink-0 text-n-400" aria-hidden="true" />판
                {s.items.map((x, k) => (
                  <span key={x.file_id} className="flex min-w-0 items-center gap-1.5">
                    {k > 0 && <span aria-hidden="true" className="text-n-400">→</span>}
                    <span className="min-w-0 truncate"><span className="font-medium text-n-800">{x.display}</span> {x.name}</span>
                    {x.is_latest && <span className="rounded-xs bg-brand-subtle px-1 text-micro font-medium text-brand">최신</span>}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
        <ul>
          {entry.files.map((f) => (
            <li key={f.id} draggable={canEdit && !attaching}
                onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ fileId: f.id, from: entry.entry_id }))}
                className="group flex h-9 items-center gap-2.5 border-t border-n-200 px-4 text-ui transition-colors duration-150 hover:bg-n-50">
              {canEdit && <GripVertical size={14} className="cursor-grab text-n-400" aria-hidden="true" />}
              {canEdit && (
                <input type="checkbox" aria-label={`${f.rel_path} 선택`} checked={selected.includes(f.id)} disabled={disabled}
                       className="h-3.5 w-3.5 accent-brand"
                       onChange={(e) => setSelected(e.target.checked ? [...selected, f.id] : selected.filter((x) => x !== f.id))} />
              )}
              <KindBadge kind={f.kind} name={f.name} />
              <span className="min-w-0 flex-1 truncate text-n-800" title={f.rel_path}>{f.rel_path}</span>
              {f.duplicate_of_entry && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-xs bg-wait-bg px-1.5 text-micro font-medium text-wait"><Copy size={11} aria-hidden="true" />{f.duplicate_of_entry} 에 이미 있음</span>
              )}
              {/* 12 — 내용 서명으로 찾은 동일 BDF(주의)·같은 형상(정보) */}
              <SameModelChips model={f.model} />
              <ConvertBadge f={f} />
              {f.drm_encrypted && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-xs bg-err-bg px-1.5 text-micro font-medium text-err"><AlertTriangle size={11} aria-hidden="true" />암호화됨</span>
              )}
              <span className="w-16 shrink-0 text-right font-mono text-meta text-n-500">{formatBytes(f.size)}</span>
              {canEdit && siblings.length > 0 && (
                <select aria-label={`${f.rel_path} 옮기기`} disabled={disabled} value="" className={selectClass('h-6 px-1.5 text-micro opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100')}
                        onChange={(e) => e.target.value && moveFile(f.id, e.target.value)}>
                  <option value="">옮기기…</option>
                  {siblings.map((s) => <option key={s.entry_id} value={s.entry_id}>{s.entry_id}</option>)}
                </select>
              )}
            </li>
          ))}
        </ul>
        {canEdit && <DraftAttachments ref={attachRef} entry={entry} disabled={!canEdit || busy}
          onChanged={onChanged} onBusyChange={setAttachmentBusy} />}
      </div>
      {dup && (
        <section aria-label="확정하지 않음: 동일 BDF" className="border-t border-n-200 bg-n-50 px-4 py-2.5 text-meta text-n-700">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Copy size={14} className="shrink-0 text-n-500" aria-hidden="true" />
            <p className="font-semibold text-n-900">
              확정하지 않음: 동일 BDF 가 이미 있음 <span className="font-mono font-normal text-n-600">{dup.files?.length || 0}</span>
            </p>
            <div className="flex-1" />
            {canForce && canEdit && (
              <Button variant="secondary" size="sm" disabled={disabled}
                      onClick={() => act(() => api(`/entries/${entry.entry_id}/confirm?force=true`, { method: 'POST' }), '확정하지')}>
                그래도 확정
              </Button>
            )}
          </div>
          <p className="mt-0.5 text-n-600">
            이 초안을 올린 뒤 같은 BDF 가 다른 자료에 생겼습니다. 아래 파일을 골라 [새 묶음으로 나누기] 한 뒤 그 초안을 버리면 나머지를 확정할 수 있습니다.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {(dup.files || []).map((f) => (
              <li key={f.file_id} className="flex min-w-0 flex-col gap-0.5">
                <p className="break-all font-medium text-n-900">{f.rel_path}</p>
                <DuplicateTargets item={{ ...f, scope: 'existing' }} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && <p role="alert" className="border-t border-err-line bg-err-bg px-4 py-2 text-ui text-err">{error}</p>}
    </article>
  );
}

/** 고친 칸 표시(11) — 작은 남색 점 + 화면 읽기용 글자. */
function ChangedDot() {
  return (
    <span title="바뀐 칸" className="ml-1.5 inline-flex items-center align-middle">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand" />
      <span className="sr-only">(변경됨)</span>
    </span>
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
